import { Haptics } from '../plugins/haptics';
import { useSettings } from '../state/settings';
import { HAPTIC_PATTERNS, type HapticCue } from './haptics/patterns';
import { playEarcon, type Earcon } from './voice/earcons';
import { VoiceGuide, type Priority } from './voice/voiceGuide';

export type Cue = HapticCue | 'offRoute';

const HAPTIC_FOR: Record<Cue, HapticCue | null> = {
  turnLeft: 'turnLeft',
  turnRight: 'turnRight',
  straight: 'straight',
  hazard: 'hazard',
  arrival: 'arrival',
  trackingLost: 'trackingLost',
  confirm: 'confirm',
  cancel: 'cancel',
  floorChange: 'floorChange',
  offRoute: 'trackingLost',
};

const VOICE_ID = import.meta.env.VITE_ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

function settings() {
  return useSettings.getState();
}

export const voice = new VoiceGuide({
  enabled: true,
  premium: true,
  voiceId: VOICE_ID,
  rate: 1,
});

useSettings.subscribe((s) => voice.update({ enabled: s.voiceEnabled, premium: s.premiumVoice, rate: s.speechRate }));

/** Live region announcer so VoiceOver users also get prompts as text. */
let liveRegion: ((text: string) => void) | null = null;
export function registerLiveRegion(fn: ((text: string) => void) | null) {
  liveRegion = fn;
}

/**
 * The single place that turns a navigation event into non-visual feedback. Every cue is a
 * haptic pattern plus a matching earcon, optionally followed by speech (PRD §8: always
 * pair haptics with speech and a unique earcon).
 */
export function cue(name: Cue, speech?: string, priority: Priority = 'normal'): Promise<void> {
  const s = settings();
  const h = HAPTIC_FOR[name];
  if (s.hapticsEnabled && h) void Haptics.play({ pattern: HAPTIC_PATTERNS[h], intensity: s.hapticIntensity }).catch(() => undefined);
  if (s.earconsEnabled) playEarcon(name as Earcon, s.earconVolume);
  if (speech) {
    liveRegion?.(speech);
    return voice.say(speech, priority);
  }
  return Promise.resolve();
}

export function say(text: string, priority: Priority = 'normal'): Promise<void> {
  liveRegion?.(text);
  return voice.say(text, priority);
}

export function hapticOnly(name: HapticCue) {
  const s = settings();
  if (s.hapticsEnabled) void Haptics.play({ pattern: HAPTIC_PATTERNS[name], intensity: s.hapticIntensity }).catch(() => undefined);
}
