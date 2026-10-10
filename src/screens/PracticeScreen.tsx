import { useState } from 'react';
import { GestureSurface } from '../components/GestureSurface';
import { Screen } from '../components/Screen';
import { Button, Card } from '../components/ui';
import { cue, type Cue } from '../lib/feedback';
import { GESTURE_HELP, type Gesture } from '../lib/gestures/recognizer';

const CUES: { cue: Cue; label: string; meaning: string }[] = [
  { cue: 'turnLeft', label: 'Turn left', meaning: 'Long buzz, then a tap. Sound falls, on the left.' },
  { cue: 'turnRight', label: 'Turn right', meaning: 'Tap, then a long buzz. Sound rises, on the right.' },
  { cue: 'straight', label: 'On course', meaning: 'One soft tick.' },
  { cue: 'hazard', label: 'Hazard', meaning: 'Three sharp taps.' },
  { cue: 'arrival', label: 'Arrived', meaning: 'Two long pulses.' },
  { cue: 'trackingLost', label: 'Tracking lost', meaning: 'Irregular stutter.' },
  { cue: 'floorChange', label: 'Stairs or elevator', meaning: 'Four taps getting stronger.' },
  { cue: 'offRoute', label: 'Off route', meaning: 'Stutter with a three-note alert.' },
  { cue: 'confirm', label: 'Confirm', meaning: 'Two quick taps.' },
];

export default function PracticeScreen() {
  const [last, setLast] = useState<Gesture | null>(null);
  const onGesture = (g: Gesture) => {
    setLast(g);
    const h = GESTURE_HELP.find((x) => x.gesture === g)!;
    void cue('confirm', `${h.label}: ${h.action}.`);
  };
  return (
    <Screen title="Practice" back="/">
      <Card className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Vibrations</h2>
        <p className="text-muted">Each cue always comes with a sound and, during navigation, a spoken instruction.</p>
        <ul className="flex flex-col gap-2">
          {CUES.map((c) => (
            <li key={c.cue}>
              <Button block className="justify-between text-left" onClick={() => void cue(c.cue, c.label)} aria-describedby={`cue-${c.cue}`}>
                <span>{c.label}</span>
                <span id={`cue-${c.cue}`} className="text-sm text-muted font-normal">
                  {c.meaning}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Gestures</h2>
        <p className="text-muted">
          Try gestures anywhere in the box below. If VoiceOver is on, first double-tap and hold the box, or use the Navigate screen in the iOS app,
          which takes gestures directly.
        </p>
        <GestureSurface onGesture={onGesture} label="Gesture practice area" className="h-72 rounded-2xl border-2 border-dashed border-line flex items-center justify-center text-center p-4">
          <p aria-hidden className="text-2xl font-bold">
            {last ? GESTURE_HELP.find((x) => x.gesture === last)!.label : 'Swipe, tap or hold here'}
          </p>
        </GestureSurface>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          {GESTURE_HELP.map((g) => (
            <div key={g.gesture} className="contents">
              <dt className="font-semibold">{g.label}</dt>
              <dd className="text-muted">{g.action}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </Screen>
  );
}
