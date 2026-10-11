import { useSyncExternalStore } from 'react';
import { Screen } from '../components/Screen';
import { Button, Card, Select, Slider, Toggle } from '../components/ui';
import { cue, say, voice } from '../lib/feedback';
import { stopTalking } from '../lib/voice/assistant';
import type { DistanceUnit } from '../lib/nav/units';
import {
  ELEVEN_VOICES,
  elevenLabsConfigured,
  elevenLabsStatus,
  needsPaidVoice,
  onElevenLabsStatus,
} from '../lib/voice/elevenlabs';
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
  const natural = useSyncExternalStore(onElevenLabsStatus, elevenLabsStatus);
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
        {elevenLabsConfigured ? (
          <>
            <Select
              label="Voice"
              value={s.voice}
              onChange={(e) => {
                const id = e.target.value;
                s.set({ voice: id });
                voice.stop();
                const v = ELEVEN_VOICES.find((x) => x.id === id);
                // Let the new voice introduce itself once the setting has applied.
                setTimeout(
                  () =>
                    void say(
                      v
                        ? needsPaidVoice(v.id)
                          ? `Hi, I'm Sarah, standing in for ${v.name}. In 5 meters, turn left.`
                          : `Hi, I'm ${v.name}. In 5 meters, turn left.`
                        : 'This is the iPhone voice. In 5 meters, turn left.',
                    ),
                  150,
                );
              }}
            >
              {ELEVEN_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}:{' '}
                  {needsPaidVoice(v.id) ? 'needs a paid ElevenLabs plan, so Sarah speaks.' : v.description}
                </option>
              ))}
              <option value="iphone">iPhone voice: works offline, nothing sent online.</option>
            </Select>
            {s.voice !== 'iphone' && (
              <p className="text-sm" role="status">
                <strong>Natural voice:</strong> {natural.detail}.
                {natural.ok === false && ' The iPhone voice is speaking for now.'}
              </p>
            )}
            <p className="text-muted text-sm">
              ElevenLabs voices send the words being spoken to ElevenLabs. Without internet, the iPhone voice
              is used.
            </p>
          </>
        ) : (
          <p className="text-muted text-sm">
            ElevenLabs voices: not set up. Add an ElevenLabs key to .env.local.
          </p>
        )}
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
          label="Talk with BlindSpöt"
          description="It listens after it asks you something. Off: it only speaks, and works like a screen reader app."
          checked={s.voiceCompanion}
          onChange={(v) => {
            s.set({ voiceCompanion: v });
            if (!v) stopTalking();
            void say(
              v
                ? "Okay. I'll listen after I ask you something."
                : "Okay. I won't listen unless you press a mic button.",
            );
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
