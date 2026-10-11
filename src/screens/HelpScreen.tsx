import { useEffect } from 'react';
import { PixelArt, type SpriteName } from '../components/PixelArt';
import { Screen } from '../components/Screen';
import { Button, Card } from '../components/ui';
import { announce, cue, say, voice } from '../lib/feedback';

/** Instructions in short, simple sentences: easy to follow by ear, at any age. */
const SECTIONS: { title: string; sprite: SpriteName; lines: string[] }[] = [
  {
    title: 'What is this?',
    sprite: 'house',
    lines: [
      'This app helps you find your way inside a building.',
      'It talks to you. You can talk back.',
      'You don’t have to look at the screen.',
    ],
  },
  {
    title: 'Talking to the app',
    sprite: 'mic',
    lines: [
      'Press the big pink button.',
      'Wait for the little beep.',
      'Then say your answer, like “kitchen”.',
      'The app tells you what it heard.',
    ],
  },
  {
    title: 'Go somewhere',
    sprite: 'arrow',
    lines: [
      'Press Go somewhere.',
      'Press the big button and say where you are.',
      'Press it again and say where you want to go.',
      'Press Start and walk slowly.',
      'The app tells you when to turn.',
    ],
  },
  {
    title: 'Look around',
    sprite: 'eye',
    lines: [
      'Press Look around. You don’t need a map for this.',
      'Hold the phone up in front of your chest, with the back camera facing forward.',
      'Walk slowly. The phone tells you when something is in your way.',
      'It tells you about people and doors too.',
      'Ticks get faster when something is close in front of you.',
      'Tap the screen to hear what is around you.',
    ],
  },
  {
    title: 'Feel the buzzes',
    sprite: 'heart',
    lines: [
      'A long buzz, then a tap, means turn left.',
      'A tap, then a long buzz, means turn right.',
      'Three quick taps mean be careful, something is in the way.',
      'Two long buzzes mean you made it!',
    ],
  },
  {
    title: 'While you walk',
    sprite: 'sparkle',
    lines: [
      'Press Speak and say a word.',
      'Say “where am I” to hear where you are.',
      'Say “repeat” to hear it again.',
      'Say “pause” to take a break, and “keep going” to start again.',
      'Say “stop” when you want to finish.',
      'Or say a new place to go there instead.',
    ],
  },
  {
    title: 'Teach it a room',
    sprite: 'closet',
    lines: [
      'Press Add a room.',
      'Stand in the door of the room.',
      'Press Start scanning.',
      'Walk slowly next to the walls, all the way around.',
      'Come back to the door.',
      'The app asks: what is this room called?',
      'Say the name. Then press Save.',
      'To learn how, press Practice first. Nothing is saved.',
    ],
  },
  {
    title: 'Teach it the next room',
    sprite: 'door',
    lines: [
      'Go to the door between your room and the next room.',
      'Stand in that door and scan the next room.',
      'Now the app knows the rooms are next to each other.',
    ],
  },
  {
    title: 'Try it in a big hall',
    sprite: 'stage',
    lines: [
      'Before you add your own rooms, the app has a practice map of a big hall.',
      'It has an entrance, a welcome desk, a coffee table, a seating area and a stage.',
      'Stand at the entrance of the hall, facing in.',
      'Press Go somewhere and say “entrance”.',
      'Then say “coffee table”, press Start, and walk.',
    ],
  },
  {
    title: 'Stay safe',
    sprite: 'heart',
    lines: [
      'Always use your cane or your guide dog too.',
      'The phone can’t see everything.',
      'If something feels wrong, stop and ask someone for help.',
    ],
  },
];

const read = (s: (typeof SECTIONS)[number]) => `${s.title} ${s.lines.join(' ')}`;

export default function HelpScreen() {
  useEffect(() => {
    void announce('How to use PathSense. Press Listen on any part to hear it, or Listen to everything.');
  }, []);
  return (
    <Screen title="How to use" back="/">
      <Button variant="primary" large block onClick={() => void say(SECTIONS.map(read).join(' '))}>
        Listen to everything
      </Button>
      <Button block onClick={() => voice.stop()}>
        Stop talking
      </Button>
      {SECTIONS.map((s) => (
        <Card key={s.title} className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold flex items-center gap-3">
            <PixelArt name={s.sprite} size={36} />
            {s.title}
          </h2>
          <ul className="flex flex-col gap-2 text-xl leading-snug">
            {s.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <Button onClick={() => void say(read(s))} aria-label={`Listen to ${s.title}`}>
            Listen
          </Button>
        </Card>
      ))}
      <Card className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold">Try the buzzes</h2>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => void cue('turnLeft', 'Turn left')}>Turn left</Button>
          <Button onClick={() => void cue('turnRight', 'Turn right')}>Turn right</Button>
          <Button onClick={() => void cue('hazard', 'Be careful')}>Be careful</Button>
          <Button onClick={() => void cue('arrival', 'You made it!')}>You made it</Button>
        </div>
      </Card>
    </Screen>
  );
}
