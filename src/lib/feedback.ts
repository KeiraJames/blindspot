import { Haptics } from '../plugins/haptics';
import { Speech } from '../plugins/speech';
import { useSettings } from '../state/settings';
import { HAPTIC_PATTERNS, type HapticCue } from './haptics/patterns';
import { playEarcon, type Earcon } from './voice/earcons';
import { VoiceGuide, type Priority } from './voice/voiceGuide';

export type Cue = HapticCue | 'offRoute';

const HAPTIC_FOR: Record<Cue, HapticCue> = {
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

const initial = useSettings.getState();
export const voice = new VoiceGuide({
  enabled: true,
  rate: initial.speechRate,
  voice: initial.voice,
});
useSettings.subscribe((s) => voice.update({ rate: s.speechRate, voice: s.voice }));

// ---- VoiceOver awareness ---------------------------------------------------------------
// When VoiceOver is on it already reads each screen; the app then speaks only what VoiceOver
// can't know (navigation prompts, scan coaching, answers to questions).
let voiceOver = false;
void Speech.isVoiceOverRunning()
  .then((r) => (voiceOver = r.running))
  .catch(() => undefined);
void Speech.addListener('voiceOverChanged', (e) => (voiceOver = e.running)).catch(() => undefined);
export const isVoiceOverRunning = () => voiceOver;

/** Live region announcer so VoiceOver and braille users also get prompts as text. */
let liveRegion: ((text: string) => void) | null = null;
export function registerLiveRegion(fn: ((text: string) => void) | null) {
  liveRegion = fn;
}

/**
 * Non-visual feedback for one event: a vibration plus a matching sound, optionally followed
 * by speech (every cue is always paired with speech and a unique sound).
 */
export function cue(name: Cue, speech?: string, priority: Priority = 'normal'): Promise<void> {
  const s = useSettings.getState();
  if (s.vibration) void Haptics.play({ pattern: HAPTIC_PATTERNS[HAPTIC_FOR[name]] }).catch(() => undefined);
  if (s.sounds) playEarcon(name as Earcon);
  if (speech) return say(speech, priority);
  return Promise.resolve();
}

/** Always spoken (navigation, coaching, answers). */
export function say(text: string, priority: Priority = 'normal'): Promise<void> {
  liveRegion?.(text);
  return voice.say(text, priority);
}

/** Screen guidance: spoken unless VoiceOver is already reading the screen. */
export function announce(text: string): Promise<void> {
  if (voiceOver) {
    liveRegion?.(text);
    return Promise.resolve();
  }
  return say(text);
}

/**
 * Ask a question out loud and listen for the answer: speak the prompt, play a tone, then
 * transcribe on the device. Resolves with the transcript ('' if nothing was heard).
 */
export async function ask(
  prompt: string,
  contextualStrings: string[] = [],
  timeoutMs = 6000,
): Promise<string> {
  voice.stop();
  await say(prompt);
  playEarcon('confirm');
  // Give the tone a moment so it isn't recorded.
  await new Promise((r) => setTimeout(r, 250));
  const { transcript } = await Speech.listen({ timeoutMs, contextualStrings });
  return cleanTranscript(transcript);
}

export function stopListening() {
  void Speech.stopListening().catch(() => undefined);
}

/** "the kitchen." → "Kitchen"; "living room" → "Living Room". */
export function cleanTranscript(t: string): string {
  return t
    .trim()
    .replace(/[.!?,]+$/g, '')
    .replace(/^(it'?s|it is|this is|the room is|call it|name it)\s+/i, '')
    .replace(/^(the|a|an|my)\s+/i, '')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
