import type { PluginListenerHandle } from '@capacitor/core';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MicButton } from '../components/MicButton';
import { Screen } from '../components/Screen';
import { canAutoListen, useScreenVoice } from '../components/TalkButton';
import { Button, Card, Field, LinkButton } from '../components/ui';
import { announce, cleanTranscript, cue, say } from '../lib/feedback';
import { runPracticeScan, type PracticeRun } from '../lib/scan/practice';
import type { ScanResult } from '../lib/scan/types';
import { inConversation, parseAppCommand, talk, type Reply } from '../lib/voice/assistant';
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
  'Stand in the door of the room. Hold the phone up in front of your chest. Walk slowly next to the walls, all the way around the room, and come back to the door. The phone will tell you what to do. If this room is next to a room you already added, start at the door between them.';

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
  const [practice, setPractice] = useState(false);
  const lastCoach = useRef(0);
  const handles = useRef<PluginListenerHandle[]>([]);
  const practiceRun = useRef<PracticeRun | null>(null);

  useEffect(() => {
    void Scan.isSupported().then((s) => {
      setSupport(s);
      const listen = canAutoListen() && inConversation();
      if (!s.supported) {
        const text = `${s.reason} You can try a practice scan to learn how it works. Nothing is saved.`;
        if (listen) void talk(`${text} Would you like to practice?`);
        else void say(text);
      } else if (listen)
        void talk(
          `Let's add a room. ${HOW_TO} Say scan when you're in the door, or say practice to try it first.`,
        );
      else
        void announce(
          `Add a room. ${HOW_TO} Press Start scanning when you're in the door. Or press Practice first to try it without saving.`,
        );
    });
    return () => {
      handles.current.forEach((h) => void h.remove());
      practiceRun.current?.cancel();
    };
  }, []);

  const signText = (r: ScanResult) => r.landmarks.find((l) => l.kind === 'room_number' && l.text)?.text;

  /** Ask for the room's name out loud; the answer comes back through `handleVoice`. */
  const askName = (r: ScanResult, intro = '') => {
    const sign = signText(r);
    const hint = sign ? ` I saw a sign that says ${sign}.` : '';
    if (canAutoListen()) void talk(`${intro}What is this room called?${hint}`);
    else void say(`${intro}What is this room called?${hint} Type the name, or press Say the name.`);
  };

  /**
   * What's said on this screen, as a conversation: "practice" or "scan" to begin, "done" while
   * scanning, then the room's name, read back and saved when you say yes.
   */
  const heardName = useRef('');
  const handleVoice = (heard: string): Reply => {
    const t = heard.toLowerCase();
    if (phase === 'ready') {
      if (/\bpractice\b/.test(t) || (support && !support.supported && /^(yes|yeah|sure|ok)/.test(t)))
        return (void start(true), true);
      if (/\b(scan|start|begin|go|real|yes)\b/.test(t)) return (void start(false), true);
      return false;
    }
    if (phase === 'capturing') {
      if (/\b(cancel|stop scanning|never ?mind)\b/.test(t)) return (void cancelCapture(), true);
      if (/\b(done|finish|finished|that'?s it|stop)\b/.test(t)) return (void finishCapture(), true);
      return false;
    }
    if (phase === 'naming') {
      if (
        heardName.current &&
        /^(yes|yeah|yep|save|save it|correct|that'?s right|right|sure|ok|okay)\b/.test(t)
      ) {
        void save(heardName.current);
        return true;
      }
      if (/^(no|nope|wrong|again|say it again)\b/.test(t)) return 'Okay. What is this room called?';
      if (parseAppCommand(heard).type !== 'unknown' && parseAppCommand(heard).type !== 'go') return false;
      const cleaned = cleanTranscript(heard);
      heardName.current = cleaned;
      setName(cleaned);
      setTyped(cleaned);
      return `I heard ${cleaned}. Should I save it?`;
    }
    if (phase === 'saved' && /\b(another|again|next|scan)\b/.test(t)) {
      setPhase('ready');
      return 'Okay. Say practice for a practice scan, or scan to scan a real room.';
    }
    return false;
  };
  useScreenVoice({
    handle: (h) => handleVoice(h),
    hints: ['practice', 'scan', 'done', 'save', 'yes', 'no', ...COMMON_ROOMS],
  });

  const onProgress = (p: ScanProgress) =>
    setProgress((prev) => {
      if (prev && p.doors + p.openings > prev.doors + prev.openings)
        void cue('confirm', 'Door found.', 'low');
      if (prev && p.stairs > prev.stairs) void cue('floorChange', 'Stairs found.', 'low');
      return p;
    });

  /** Real scan with RoomPlan, or a practice run that saves nothing. */
  const start = async (isPractice: boolean) => {
    setPractice(isPractice);
    setPhase('capturing');
    setProgress(null);
    setName('');
    setTyped('');
    void say(
      isPractice
        ? 'Practice scan. Nothing will be saved. Pretend to walk slowly next to the walls. I will tell you what to do.'
        : 'Scanning. Walk slowly next to the walls.',
    );
    handles.current.forEach((h) => void h.remove());
    handles.current = [];
    try {
      let result: ScanResult;
      if (isPractice) {
        practiceRun.current = runPracticeScan(onProgress, (text) => void say(text, 'low'));
        result = await practiceRun.current.result;
      } else {
        handles.current = await Promise.all([
          Scan.addListener('instruction', ({ instruction }) => {
            const now = Date.now();
            if (!COACH[instruction] || now - lastCoach.current < 4000) return;
            lastCoach.current = now;
            void say(COACH[instruction], 'low');
          }),
          Scan.addListener('progress', onProgress),
        ]);
        result = (await Scan.startCapture({ detectText: true })).result;
      }
      setResult(result);
      setPhase('naming');
      const doors = result.openings.length;
      await cue('arrival');
      void askName(result, `Scan finished. I found ${doors} ${doors === 1 ? 'door' : 'doors'}. `);
    } catch (e) {
      setPhase('ready');
      if (e instanceof Error && /cancel/i.test(e.message)) void cue('cancel', 'Scan stopped.');
      else void say(`The scan didn't finish. ${e instanceof Error ? e.message : ''} Try again.`);
    } finally {
      practiceRun.current = null;
      handles.current.forEach((h) => void h.remove());
      handles.current = [];
    }
  };

  const finishCapture = () => (practice ? practiceRun.current?.finish() : void Scan.finishCapture());
  const cancelCapture = () => (practice ? practiceRun.current?.cancel() : void Scan.cancelCapture());

  const save = async (spoken?: string) => {
    const finalName = (spoken ?? (typed || name)).trim();
    if (!result || !finalName) {
      void say('The room needs a name first.');
      return;
    }
    if (practice) {
      const text = `Great job! You called this room ${finalName}. That was practice, so nothing was saved. When you're ready, scan a real room.`;
      setMessage(text);
      setPhase('saved');
      void cue('arrival', text);
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
          <p className="text-muted mt-2">You can try a practice scan to learn how it works.</p>
        </Card>
      )}
      {support && !support.supported && phase === 'ready' && (
        <Button variant="primary" large block className="min-h-24 text-2xl" onClick={() => void start(true)}>
          Try a practice scan
        </Button>
      )}

      {support?.supported && phase === 'ready' && (
        <>
          {support.reason === 'simulated' && (
            <p className="text-warn">Development mode: the scanner is simulated in this browser.</p>
          )}
          <Card>
            <p className="text-lg">{HOW_TO}</p>
          </Card>
          <Button
            variant="primary"
            large
            block
            className="min-h-24 text-2xl"
            onClick={() => void start(false)}
          >
            Start scanning
          </Button>
          <Button large block onClick={() => void start(true)}>
            Practice first (nothing is saved)
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
          <Button variant="primary" large block onClick={finishCapture}>
            Finish
          </Button>
          <Button block onClick={cancelCapture}>
            Cancel
          </Button>
        </Card>
      )}

      {phase === 'naming' && result && (
        <>
          <MicButton label={name ? 'Say it again' : 'Say the name'} prompt="What is this room called?" />
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
          <Button
            variant="primary"
            large
            block
            className="min-h-20"
            onClick={() => void start(practice && !support?.supported)}
          >
            {practice ? (support?.supported ? 'Scan a real room' : 'Practice again') : 'Scan the next room'}
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
