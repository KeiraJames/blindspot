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
  listening: 'listening',
  heard: 'heard',
  notUnderstood: 'notUnderstood',
};

const initial = useSettings.getState();
export const voice = new VoiceGuide({
  enabled: true,
  rate: initial.speechRate,
  voice: initial.voice,
});
useSettings.subscribe((s) => voice.update({ rate: s.speechRate, voice: s.voice }));

// Fetch the natural-voice audio for the questions the app asks most, so the first time each
// is asked it plays straight away instead of waiting on the network.
setTimeout(
  () =>
    voice.prefetch([
      "Where are you? Say the room you're in.",
      'Where do you want to go?',
      'Say a command.',
      'What is this room called?',
      "Sorry, I didn't catch that. Where do you want to go?",
    ]),
  1500,
);

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
 * Ask a question out loud and listen for the answer, like a conversation: speak the prompt,
 * play a short tone and start listening at once. Listening ends as soon as the person pauses
 * after speaking (never mid-sentence), and the app holds its own prompts while they talk.
 * Resolves with the transcript ('' if nothing was heard).
 */
export async function ask(
  prompt: string,
  contextualStrings: string[] = [],
  timeoutMs = 8000,
): Promise<string> {
  if (prompt) {
    voice.stop();
    await say(prompt);
  } else {
    // Let whatever the app is already saying finish, then listen.
    await voice.whenIdle();
  }
  // Mic open: a rising tone and a soft buzz mean "your turn".
  void cue('listening');
  voice.hold();
  try {
    const { transcript } = await Speech.listen({ timeoutMs, silenceMs: 1000, contextualStrings });
    const heard = cleanTranscript(transcript);
    // Mic closed: "got it", or a gentle "didn't catch that".
    void cue(heard ? 'heard' : 'notUnderstood');
    return heard;
  } finally {
    voice.release();
  }
}

export function stopListening() {
  void Speech.stopListening().catch(() => undefined);
}

const FILLER = /^(um+|uh+|er+|erm|hmm+|ah+|oh|so|okay|ok|well|yeah|yes)\b[\s,.]*/i;

/** "the kitchen." → "Kitchen"; "um, living room" → "Living Room". */
export function cleanTranscript(t: string): string {
  let s = t.trim();
  for (let prev = ''; prev !== s;) {
    prev = s;
    s = s.replace(FILLER, '');
  }
  return s
    .replace(/[.!?,]+$/g, '')
    .replace(/^(it'?s|it is|this is|the room is|call it|name it)\s+/i, '')
    .replace(/^(the|a|an|my)\s+/i, '')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
