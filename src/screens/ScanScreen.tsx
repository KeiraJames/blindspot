import type { PluginListenerHandle } from '@capacitor/core';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MicButton } from '../components/MicButton';
import { Screen } from '../components/Screen';
import { Button, Card, Field, LinkButton } from '../components/ui';
import { announce, ask, cue, say } from '../lib/feedback';
import type { ScanResult } from '../lib/scan/types';
import { Scan, type ScanInstruction, type ScanProgress } from '../plugins/scan';
import { usePlace } from '../state/place';

const COACH: Record<ScanInstruction, string> = {
  normal: '',
  moveCloseToWall: 'Move closer to the wall.',
  moveAwayFromWall: 'Step back from the wall.',
  slowDown: 'Slow down.',
  turnOnLight: 'It is too dark. Turn on a light if you can.',
  lowTexture: 'Point the phone at a part of the room with more detail.',
};

/** Help speech recognition with names people commonly give rooms. */
const COMMON_ROOMS = [
  'Kitchen',
  'Bedroom',
  'Bathroom',
  'Closet',
  'Living room',
  'Dining room',
  'Hallway',
  'Office',
  'Laundry room',
  'Entrance',
  'Garage',
];

const HOW_TO =
  'Stand in the doorway, holding the phone upright at chest height. Then walk slowly along the walls, all the way around the room, and come back to the door. The phone will coach you. If this room shares a door with a room you already scanned, start in that doorway so the two rooms connect.';

type Phase = 'ready' | 'capturing' | 'naming' | 'saved';

export default function ScanScreen() {
  const navigate = useNavigate();
  const addRoom = usePlace((s) => s.addRoom);
  const roomCount = usePlace((s) => s.place.graph.rooms.length);
  const [support, setSupport] = useState<{ supported: boolean; reason?: string } | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [name, setName] = useState('');
  const [typed, setTyped] = useState('');
  const [message, setMessage] = useState('');
  const lastCoach = useRef(0);
  const handles = useRef<PluginListenerHandle[]>([]);

  useEffect(() => {
    void Scan.isSupported().then((s) => {
      setSupport(s);
      if (!s.supported) void say(`${s.reason} You can still navigate with the sample home.`);
      else void announce(`Add a room. ${HOW_TO} Press Start scanning when you're in the doorway.`);
    });
    return () => handles.current.forEach((h) => void h.remove());
  }, []);

  const signText = (r: ScanResult) => r.landmarks.find((l) => l.kind === 'room_number' && l.text)?.text;

  /** Ask for the room's name out loud; loop back here from "Say it again". */
  const askName = async (r: ScanResult, intro = '') => {
    const sign = signText(r);
    const hint = sign ? ` I saw a sign that says ${sign}.` : '';
    try {
      const heard = await ask(`${intro}What is this room called?${hint} Say its name after the tone.`, [
        ...COMMON_ROOMS,
        ...(sign ? [`Room ${sign}`] : []),
      ]);
      if (heard) {
        setName(heard);
        setTyped(heard);
        void say(`I heard ${heard}. Press Save, or Say it again.`);
      } else {
        void say("I didn't hear a name. Press Say the name to try again, or type it.");
      }
    } catch {
      void say('Listening is not available. Type the room name instead.');
    }
  };

  const start = async () => {
    setPhase('capturing');
    setProgress(null);
    setName('');
    setTyped('');
    void say('Scanning. Walk slowly along the walls.');
    handles.current.forEach((h) => void h.remove());
    handles.current = await Promise.all([
      Scan.addListener('instruction', ({ instruction }) => {
        const now = Date.now();
        if (!COACH[instruction] || now - lastCoach.current < 4000) return;
        lastCoach.current = now;
        void say(COACH[instruction], 'low');
      }),
      Scan.addListener('progress', (p) => {
        setProgress((prev) => {
          if (prev && p.doors + p.openings > prev.doors + prev.openings)
            void cue('confirm', 'Door found.', 'low');
          if (prev && p.stairs > prev.stairs) void cue('floorChange', 'Stairs found.', 'low');
          return p;
        });
      }),
    ]);
    try {
      const { result } = await Scan.startCapture({ detectText: true });
      setResult(result);
      setPhase('naming');
      const doors = result.openings.length;
      await cue('arrival');
      void askName(
        result,
        `Scan finished. I found ${doors} ${doors === 1 ? 'door or opening' : 'doors and openings'}. `,
      );
    } catch (e) {
      setPhase('ready');
      if (e instanceof Error && /cancel/i.test(e.message)) void cue('cancel', 'Scan cancelled.');
      else void say(`The scan didn't finish. ${e instanceof Error ? e.message : ''} Try again.`);
    } finally {
      handles.current.forEach((h) => void h.remove());
      handles.current = [];
    }
  };

  const save = async () => {
    const finalName = (typed || name).trim();
    if (!result || !finalName) {
      void say('The room needs a name first.');
      return;
    }
    const firstRoom = roomCount === 0;
    const { joinedTo } = await addRoom(result, finalName);
    const text = firstRoom
      ? `${finalName} saved. It's your first room. To add the next one, stand in a doorway of ${finalName} and scan the room on the other side.`
      : joinedTo.length > 0
        ? `${finalName} saved and connected to ${joinedTo.join(' and ')}.`
        : `${finalName} saved, but I couldn't find a door it shares with your other rooms, so you can't navigate to it yet. Scan the room next to it, starting in the doorway they share.`;
    setMessage(text);
    setPhase('saved');
    void cue('confirm', text);
  };

  return (
    <Screen title="Add a room" back="/">
      {support && !support.supported && (
        <Card>
          <p role="alert" className="text-lg">
            {support.reason}
          </p>
          <p className="text-muted mt-2">You can still navigate using the sample home.</p>
        </Card>
      )}

      {support?.supported && phase === 'ready' && (
        <>
          {support.reason === 'simulated' && (
            <p className="text-warn">Development mode: the scanner is simulated in this browser.</p>
          )}
          <Card>
            <p className="text-lg">{HOW_TO}</p>
          </Card>
          <Button variant="primary" large block className="min-h-24 text-2xl" onClick={() => void start()}>
            Start scanning
          </Button>
        </>
      )}

      {phase === 'capturing' && (
        <Card className="flex flex-col gap-4">
          <h2 className="text-xl font-bold">Scanning…</h2>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Walls covered</span>
            <progress
              max={1}
              value={progress?.coverage ?? 0}
              className="w-full h-4"
              aria-valuetext={`${Math.round((progress?.coverage ?? 0) * 100)} percent`}
            />
          </label>
          <p aria-live="polite" className="text-lg">
            {progress ? `${progress.walls} walls, ${progress.doors + progress.openings} doors.` : 'Starting…'}
          </p>
          <Button variant="primary" large block onClick={() => void Scan.finishCapture()}>
            Finish
          </Button>
          <Button block onClick={() => void Scan.cancelCapture()}>
            Cancel
          </Button>
        </Card>
      )}

      {phase === 'naming' && result && (
        <>
          <MicButton
            label={name ? 'Say it again' : 'Say the name'}
            prompt="Say the room's name after the tone."
            contextualStrings={COMMON_ROOMS}
            onHeard={(heard) => {
              if (!heard) return void say("I didn't hear anything. Try again, or type the name.");
              setName(heard);
              setTyped(heard);
              void say(`I heard ${heard}. Press Save, or Say it again.`);
            }}
          />
          {name && (
            <p className="text-2xl font-bold text-center" aria-live="polite">
              “{name}”
            </p>
          )}
          <Button
            variant="primary"
            large
            block
            className="min-h-20 text-2xl"
            disabled={!typed.trim()}
            onClick={() => void save()}
          >
            Save{typed.trim() ? ` ${typed.trim()}` : ''}
          </Button>
          <Field
            label="Or type the name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoCapitalize="words"
          />
          <Button block onClick={() => setPhase('ready')}>
            Scan again
          </Button>
        </>
      )}

      {phase === 'saved' && (
        <>
          <Card>
            <p role="status" className="text-lg">
              {message}
            </p>
          </Card>
          <Button variant="primary" large block className="min-h-20" onClick={() => void start()}>
            Scan the next room
          </Button>
          <LinkButton to="/go" large block>
            Go somewhere
          </LinkButton>
          <Button block onClick={() => navigate('/')}>
            Done
          </Button>
        </>
      )}
    </Screen>
  );
}
