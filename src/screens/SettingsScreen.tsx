import { Screen } from '../components/Screen';
import { Button, Card, Select, Slider, Toggle } from '../components/ui';
import { cue, say } from '../lib/feedback';
import type { DistanceUnit } from '../lib/nav/units';
import { useSettings } from '../state/settings';

export default function SettingsScreen() {
  const s = useSettings();
  return (
    <Screen title="Settings" back="/">
      <Card className="flex flex-col gap-3">
        <Slider
          label="Speaking speed"
          min={0.6}
          max={1.6}
          step={0.1}
          value={s.speechRate}
          onChange={(v) => s.set({ speechRate: v })}
          format={(v) => (v < 0.95 ? 'Slower' : v > 1.05 ? 'Faster' : 'Normal') + ` (${v.toFixed(1)}×)`}
        />
        <Button onClick={() => void say('This is how fast I will speak.')}>Test speaking speed</Button>
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
