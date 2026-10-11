import { useEffect } from 'react';
import { SAFETY_TEXT } from '../components/SafetyNotice';
import { Screen } from '../components/Screen';
import { Button, Card } from '../components/ui';
import { announce, cue, say } from '../lib/feedback';
import { VOICE_HELP } from '../lib/voice/commands';

const SECTIONS: { title: string; text: string }[] = [
  {
    title: 'Add a room',
    text: 'Stand in the doorway and press Start scanning. Walk slowly along the walls and back to the door. When the scan finishes, the phone asks what the room is called. Say the name after the tone, then press Save. Scan rooms that share a door one after another, starting in the shared doorway, so they connect.',
  },
  {
    title: 'Go somewhere',
    text: 'Press the big button and say the room you are in, then say where you want to go. The phone reads the route. Press Start and walk. It tells you each turn before you reach it, and vibrates: a long buzz then a tap means left, a tap then a long buzz means right, three sharp taps mean something is in the way, and two long pulses mean you have arrived.',
  },
  {
    title: 'While walking',
    text: `Press Speak and say a command. ${VOICE_HELP} You can also tap anywhere on the map to hear where you are, swipe up to repeat, and touch and hold to pause.`,
  },
  {
    title: 'Devices',
    text: 'Scanning needs an iPhone 12 Pro or a later Pro model, or an iPad Pro, because it uses the LiDAR scanner. Everything stays on your phone.',
  },
  { title: 'Safety', text: SAFETY_TEXT },
];

export default function HelpScreen() {
  useEffect(() => {
    void announce('Help. Each section has a Listen button.');
  }, []);
  return (
    <Screen title="Help" back="/">
      <Button
        variant="primary"
        large
        block
        onClick={() => void say(SECTIONS.map((s) => `${s.title}. ${s.text}`).join(' '))}
      >
        Listen to all help
      </Button>
      {SECTIONS.map((s) => (
        <Card key={s.title} className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">{s.title}</h2>
          <p className="text-lg">{s.text}</p>
          <Button onClick={() => void say(`${s.title}. ${s.text}`)} aria-label={`Listen to ${s.title}`}>
            Listen
          </Button>
        </Card>
      ))}
      <Card className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">Try the vibrations</h2>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => void cue('turnLeft', 'Turn left')}>Left turn</Button>
          <Button onClick={() => void cue('turnRight', 'Turn right')}>Right turn</Button>
          <Button onClick={() => void cue('hazard', 'Something ahead')}>Obstacle</Button>
          <Button onClick={() => void cue('arrival', 'Arrived')}>Arrived</Button>
        </div>
      </Card>
    </Screen>
  );
}
