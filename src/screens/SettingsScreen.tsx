import { useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { Button, Card, Select, Slider, Toggle } from '../components/ui';
import { firebaseConfigured } from '../firebase/app';
import { signOut, useAuth } from '../firebase/auth';
import { cue } from '../lib/feedback';
import type { DistanceUnit } from '../lib/nav/units';
import { useSession } from '../state/session';
import { useSettings } from '../state/settings';

export default function SettingsScreen() {
  const s = useSettings();
  const { user } = useAuth();
  const mode = useSession((x) => x.mode);
  const setMode = useSession((x) => x.setMode);
  const navigate = useNavigate();

  return (
    <Screen title="Settings" back="/">
      <Card className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">Voice</h2>
        <Toggle label="Spoken directions" checked={s.voiceEnabled} onChange={(v) => s.set({ voiceEnabled: v })} />
        <Toggle
          label="Natural guide voice"
          description="Uses ElevenLabs when online and signed in. Falls back to the built-in iOS voice."
          checked={s.premiumVoice}
          onChange={(v) => s.set({ premiumVoice: v })}
        />
        <Slider label="Speaking rate" min={0.6} max={1.6} step={0.1} value={s.speechRate} onChange={(v) => s.set({ speechRate: v })} format={(v) => `${v.toFixed(1)}×`} />
        <Select label="Detail" value={s.verbosity} onChange={(e) => s.set({ verbosity: e.target.value as 'brief' | 'detailed' })}>
          <option value="detailed">Detailed (includes drift corrections)</option>
          <option value="brief">Brief (turns and arrival only)</option>
        </Select>
        <Button onClick={() => void cue('confirm', 'This is how directions will sound.')}>Test voice</Button>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">Haptics and sounds</h2>
        <Toggle label="Vibration cues" checked={s.hapticsEnabled} onChange={(v) => s.set({ hapticsEnabled: v })} />
        <Slider label="Vibration strength" min={0.2} max={1} step={0.1} value={s.hapticIntensity} onChange={(v) => s.set({ hapticIntensity: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <Toggle label="Earcons" description="Short sounds that match each vibration." checked={s.earconsEnabled} onChange={(v) => s.set({ earconsEnabled: v })} />
        <Slider label="Earcon volume" min={0.1} max={1} step={0.1} value={s.earconVolume} onChange={(v) => s.set({ earconVolume: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <Toggle label="On-course ticks" description="A soft tick every few seconds while you're heading the right way." checked={s.courseTicks} onChange={(v) => s.set({ courseTicks: v })} />
        <Toggle label="Obstacle alerts" description="Warns about obstacles and people the phone detects. It can't detect everything." checked={s.hazardAlerts} onChange={(v) => s.set({ hazardAlerts: v })} />
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">Routes</h2>
        <Toggle label="Avoid stairs" description="Use elevators and ramps only." checked={s.avoidStairs} onChange={(v) => s.set({ avoidStairs: v })} />
        <Toggle label="Prefer elevators" checked={s.preferElevator} onChange={(v) => s.set({ preferElevator: v })} />
        <Select label="Distances in" value={s.units} onChange={(e) => s.set({ units: e.target.value as DistanceUnit })}>
          <option value="meters">Meters</option>
          <option value="feet">Feet</option>
          <option value="steps">Steps</option>
        </Select>
        {s.units === 'steps' && (
          <Slider label="Your step length" min={0.4} max={1} step={0.05} value={s.stepLength} onChange={(v) => s.set({ stepLength: v })} format={(v) => `${Math.round(v * 100)} cm`} />
        )}
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">Display</h2>
        <Toggle label="Show camera and AR path" description="For low vision. Turn off for a black screen that saves battery." checked={s.showCamera} onChange={(v) => s.set({ showCamera: v })} />
        <Toggle label="Maximum contrast" checked={s.highContrast} onChange={(v) => s.set({ highContrast: v })} />
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">Scans</h2>
        <Toggle label="Upload scans on Wi-Fi only" checked={s.wifiOnlyUploads} onChange={(v) => s.set({ wifiOnlyUploads: v })} />
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Account</h2>
        {mode === 'cloud' && user ? (
          <>
            <p>Signed in as {user.displayName || user.email || 'Apple ID user'}.</p>
            <Button
              onClick={async () => {
                await signOut();
                navigate('/signin');
              }}
            >
              Sign out
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted">Maps are stored on this device only.</p>
            {firebaseConfigured && (
              <Button
                onClick={() => {
                  setMode('cloud');
                  navigate('/signin');
                }}
              >
                Sign in to share maps
              </Button>
            )}
          </>
        )}
        <Button variant="ghost" onClick={() => s.reset()}>
          Reset settings
        </Button>
      </Card>
    </Screen>
  );
}
