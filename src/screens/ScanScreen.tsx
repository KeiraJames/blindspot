import type { PluginListenerHandle } from '@capacitor/core';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { Button, Card, ErrorBox, Field, LinkButton, Select, Spinner } from '../components/ui';
import { cue, say } from '../lib/feedback';
import type { ScanDraft, ScanResult } from '../lib/scan/types';
import { Scan, type ScanInstruction, type ScanProgress } from '../plugins/scan';
import { Speech } from '../plugins/speech';
import { useDraft } from '../state/queries';
import { useScanDrafts } from '../state/scanDrafts';
import { useRepo } from '../state/session';

const COACH: Record<ScanInstruction, string> = {
  normal: 'Good. Keep slowly sweeping the walls.',
  moveCloseToWall: 'Move closer to the wall.',
  moveAwayFromWall: 'Step back from the wall.',
  slowDown: 'Slow down.',
  turnOnLight: 'It is too dark. Turn on a light if you can.',
  lowTexture: 'Point the phone at a part of the room with more detail.',
};

const START_TIPS =
  'Hold the phone upright at chest height. Start at the door, then walk slowly along the walls all the way around the room. Point the phone at every door and any stairs. Double-tap Finish when you are back at the door.';

type Phase = 'ready' | 'capturing' | 'review' | 'saved';

export default function ScanScreen() {
  const { mapId } = useParams();
  const repo = useRepo();
  const draft = useDraft(mapId);
  const saveDraft = useScanDrafts((s) => s.save);
  const allDrafts = useScanDrafts((s) => s.drafts);
  const drafts = allDrafts.filter((d) => d.mapId === mapId);
  const progressById = useScanDrafts((s) => s.progress);
  const errors = useScanDrafts((s) => s.errors);
  const [support, setSupport] = useState<{ supported: boolean; reason?: string } | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [name, setName] = useState('');
  const [chosenFloor, setFloorId] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [listening, setListening] = useState(false);
  const lastCoach = useRef(0);
  const handles = useRef<PluginListenerHandle[]>([]);

  useEffect(() => {
    void Scan.isSupported().then(setSupport);
    return () => {
      handles.current.forEach((h) => void h.remove());
    };
  }, []);

  const start = async () => {
    setError(null);
    setPhase('capturing');
    setProgress(null);
    say(START_TIPS);
    handles.current.forEach((h) => void h.remove());
    handles.current = await Promise.all([
      Scan.addListener('instruction', ({ instruction }) => {
        // Throttle coaching so it doesn't talk over itself.
        const now = Date.now();
        if (now - lastCoach.current < 4000 || instruction === 'normal') return;
        lastCoach.current = now;
        void say(COACH[instruction], 'low');
      }),
      Scan.addListener('progress', (p) => {
        setProgress((prev) => {
          if (prev && p.doors > prev.doors) void cue('confirm', 'Door found.', 'low');
          if (prev && p.stairs > prev.stairs) void cue('floorChange', 'Stairs found.', 'low');
          return p;
        });
      }),
      Scan.addListener('landmark', (l) => {
        if (l.kind === 'room_number') setName((n) => n || `Room ${l.text}`);
      }),
    ]);
    try {
      const { result } = await Scan.startCapture({ detectText: true });
      setResult(result);
      setName((n) => n || (result.landmarks.find((l) => l.kind === 'room_number')?.text ? `Room ${result.landmarks.find((l) => l.kind === 'room_number')!.text}` : ''));
      setPhase('review');
      const doors = result.openings.length;
      await cue(
        'arrival',
        `Scan complete. Found ${doors} ${doors === 1 ? 'door or opening' : 'doors and openings'}${result.stairs.length ? ` and ${result.stairs.length} stairs` : ''}. Now name the room.`,
      );
    } catch (e) {
      setPhase('ready');
      if (e instanceof Error && /cancel/i.test(e.message)) void cue('cancel', 'Scan cancelled.');
      else setError(e);
    } finally {
      handles.current.forEach((h) => void h.remove());
      handles.current = [];
    }
  };

  const dictate = async () => {
    setListening(true);
    try {
      await say('Say the room name after the tone.');
      void cue('confirm');
      const { transcript } = await Speech.listen({ timeoutMs: 6000 });
      if (transcript) {
        const clean = transcript.replace(/[.]$/, '').replace(/\b\w/g, (c) => c.toUpperCase());
        setName(clean);
        void say(`Name set to ${clean}.`);
      } else void say('I did not catch that. You can type the name instead.');
    } catch (e) {
      setError(e);
    } finally {
      setListening(false);
    }
  };

  const floorId = chosenFloor || draft.data?.floors[0]?.id || '';

  const save = async () => {
    if (!result || !mapId) return;
    const d: ScanDraft = {
      id: result.scanId,
      mapId,
      name: name.trim() || 'Unnamed room',
      floorId: floorId || null,
      result,
      status: 'draft',
      createdAt: Date.now(),
    };
    await saveDraft(d);
    setPhase('saved');
    void cue('confirm', repo.kind === 'firebase' ? 'Saved. It will upload on Wi-Fi.' : 'Saved on this device.');
  };

  if (!support) return <Spinner />;

  return (
    <Screen title="Scan a room" back={`/maps/${mapId}`}>
      {!support.supported && (
        <Card>
          <p role="alert">{support.reason}</p>
          <p className="text-muted mt-2">You can still navigate any map that has been scanned and published.</p>
        </Card>
      )}

      {support.supported && phase === 'ready' && (
        <Card className="flex flex-col gap-4">
          {support.reason === 'simulated' && <p className="text-warn">Development mode: the scanner is simulated in this browser.</p>}
          <p>{START_TIPS}</p>
          {draft.data && draft.data.floors.length > 1 && (
            <Select label="Floor" value={floorId} onChange={(e) => setFloorId(e.target.value)}>
              {draft.data.floors.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          )}
          <Button variant="primary" large block onClick={() => void start()}>
            Start scanning
          </Button>
        </Card>
      )}

      {phase === 'capturing' && (
        <Card className="flex flex-col gap-4">
          <h2 className="text-xl font-bold">Scanning…</h2>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Coverage</span>
            <progress max={1} value={progress?.coverage ?? 0} className="w-full h-4" aria-valuetext={`${Math.round((progress?.coverage ?? 0) * 100)} percent`} />
          </label>
          <p aria-live="polite">
            {progress
              ? `${progress.walls} walls, ${progress.doors} doors, ${progress.openings} openings, ${progress.stairs} stairs. Tracking ${progress.tracking === 'normal' ? 'good' : 'limited'}.`
              : 'Starting…'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="primary" large onClick={() => void Scan.finishCapture()}>
              Finish
            </Button>
            <Button large onClick={() => void Scan.cancelCapture()}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {phase === 'review' && result && (
        <Card className="flex flex-col gap-4">
          <h2 className="text-xl font-bold">Review scan</h2>
          <div className="flex gap-2 items-end">
            <Field label="Room name" className="flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Room 214" />
            <Button onClick={() => void dictate()} disabled={listening} aria-label="Say the room name">
              {listening ? 'Listening…' : 'Speak'}
            </Button>
          </div>
          <ul className="list-disc pl-6">
            {result.openings.map((o, i) => (
              <li key={o.id}>
                {o.category === 'door' ? 'Door' : 'Opening'} {i + 1}: {o.width.toFixed(2)} m wide ({o.confidence} confidence)
              </li>
            ))}
            {result.stairs.map((s, i) => (
              <li key={s.id}>Stairs {i + 1}</li>
            ))}
            {result.landmarks
              .filter((l) => l.text)
              .map((l, i) => (
                <li key={i}>
                  Sign read: “{l.text}”
                </li>
              ))}
          </ul>
          <p className={result.quality < 0.6 ? 'text-warn' : 'text-muted'}>
            Scan quality {Math.round(result.quality * 100)}%. {result.quality < 0.6 ? 'Consider scanning again for better door detection.' : ''}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="primary" large onClick={() => void save()}>
              Save
            </Button>
            <Button large onClick={() => setPhase('ready')}>
              Scan again
            </Button>
          </div>
        </Card>
      )}

      {phase === 'saved' && (
        <Card className="flex flex-col gap-3">
          <p role="status">Saved “{name || 'Unnamed room'}”.</p>
          <LinkButton to={`/maps/${mapId}/studio`} variant="primary" block>
            Place it in Map Studio
          </LinkButton>
          <Button block onClick={() => (setResult(null), setName(''), setPhase('ready'))}>
            Scan another room
          </Button>
        </Card>
      )}

      <ErrorBox error={error} />

      {drafts.length > 0 && (
        <Card>
          <h2 className="text-xl font-bold mb-2">Your scans</h2>
          <ul className="flex flex-col gap-2">
            {drafts.map((d) => (
              <li key={d.id} className="flex justify-between gap-2">
                <span>{d.name}</span>
                <span className="text-muted text-sm">
                  {d.status === 'uploading'
                    ? `Uploading ${Math.round((progressById[d.id] ?? 0) * 100)}%`
                    : d.status === 'draft'
                      ? errors[d.id]
                        ? `Waiting to upload (${errors[d.id]})`
                        : 'Waiting for Wi-Fi'
                      : d.status === 'placed'
                        ? 'Placed on map'
                        : repo.kind === 'local'
                          ? 'Saved on this phone'
                          : 'Uploaded'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Screen>
  );
}
