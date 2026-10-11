import { Screen } from '../components/Screen';
import { Button, Card, Select, Slider, Toggle } from '../components/ui';
import { cue, say, voice } from '../lib/feedback';
import type { DistanceUnit } from '../lib/nav/units';
import { useSettings } from '../state/settings';

const SAMPLE = 'In 5 meters, turn left. Then walk through the door to the kitchen.';

function speedLabel(v: number): string {
  const word =
    v < 0.6 ? 'Very slow' : v < 0.7 ? 'Slow' : v <= 0.85 ? 'Normal' : v <= 1.05 ? 'Fast' : 'Very fast';
  return `${word} (${Math.round(v * 100)}%)`;
}

let sampleTimer: ReturnType<typeof setTimeout> | null = null;

export default function SettingsScreen() {
  const s = useSettings();
  return (
    <Screen title="Settings" back="/">
      <Card className="flex flex-col gap-3">
        <Slider
          label="Speaking speed"
          min={0.4}
          max={1.4}
          step={0.05}
          value={s.speechRate}
          onChange={(v) => {
            s.set({ speechRate: v });
            // Play a sample at the new speed once the slider stops moving.
            if (sampleTimer) clearTimeout(sampleTimer);
            sampleTimer = setTimeout(() => {
              voice.stop();
              void say(SAMPLE);
            }, 450);
          }}
          format={speedLabel}
        />
        <Button onClick={() => void say(SAMPLE)}>Hear a sample</Button>
        <Select
          label="Say distances in"
          value={s.units}
          onChange={(e) => s.set({ units: e.target.value as DistanceUnit })}
        >
          <option value="meters">Meters</option>
          <option value="feet">Feet</option>
          <option value="steps">Steps</option>
        </Select>
        <Toggle
          label="Vibration"
          checked={s.vibration}
          onChange={(v) => {
            s.set({ vibration: v });
            if (v) void cue('confirm');
          }}
        />
        <Toggle
          label="Sounds"
          description="A short sound with each vibration."
          checked={s.sounds}
          onChange={(v) => s.set({ sounds: v })}
        />
        <Toggle
          label="Obstacle warnings"
          description="Warns about things the phone detects ahead. It can't detect everything."
          checked={s.obstacleAlerts}
          onChange={(v) => s.set({ obstacleAlerts: v })}
        />
        <Toggle
          label="Maximum contrast"
          checked={s.highContrast}
          onChange={(v) => s.set({ highContrast: v })}
        />
      </Card>
      <Button variant="ghost" onClick={() => s.reset()}>
        Reset settings
      </Button>
    </Screen>
  );
}
