import { hashKey, idb } from '../util/idb';

/**
 * ElevenLabs text-to-speech, called straight from the app. The key comes from `.env.local`
 * (git-ignored) at build time, so it is inside this build of the app: fine for your own
 * device and demos, but don't distribute a build that contains it.
 */
const API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY ?? '';
/** Your own pick from the Voice Library (needs a paid plan to use through the API). */
const CUSTOM_VOICE_ID = import.meta.env.VITE_ELEVENLABS_VOICE_ID ?? '';
const MODEL = 'eleven_flash_v2_5'; // lowest latency; good for short prompts
/**
 * Built-in ElevenLabs voice ("Sarah": female, American) that free accounts can use. Voices from
 * the Voice Library need a paid plan; if the chosen voice is refused for that reason, this one
 * is used instead until the app restarts.
 */
export const FALLBACK_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

export interface ElevenVoice {
  id: string;
  name: string;
  description: string;
}

/**
 * Voices to choose from. The built-in ones work on free ElevenLabs accounts; each has a clearly
 * different character so you can hear what ElevenLabs voices sound like.
 */
export const ELEVEN_VOICES: ElevenVoice[] = [
  ...(CUSTOM_VOICE_ID
    ? [
        {
          id: CUSTOM_VOICE_ID,
          name: 'Jessa',
          description: 'Warm and casual. Needs a paid ElevenLabs plan; otherwise Sarah speaks.',
        },
      ]
    : []),
  { id: FALLBACK_VOICE_ID, name: 'Sarah', description: 'Clear and professional.' },
  { id: 'SAz9YHcvj6GT2YYXdXww', name: 'River', description: 'Calm and relaxed.' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', description: 'Warm British storyteller.' },
];

export const DEFAULT_ELEVEN_VOICE = ELEVEN_VOICES[0]!.id;

/** Voices refused because they need a paid plan; Sarah stands in for them. */
const needsPaidPlan = new Set<string>();

/** The voice that will actually speak for a requested one. */
export const resolveVoice = (requested: string) =>
  needsPaidPlan.has(requested) ? FALLBACK_VOICE_ID : requested;

export const elevenLabsConfigured = API_KEY.startsWith('sk_');

const MAX_CACHE_ENTRIES = 500;

/** App speed setting (0.4–1.4, default 0.75) → ElevenLabs speed (0.7–1.2, 1 = natural). */
export function elevenLabsSpeed(rate: number): number {
  const s = 0.7 + ((rate - 0.4) / 1.0) * 0.5;
  return Math.round(Math.min(1.2, Math.max(0.7, s)) * 100) / 100;
}

let failures = 0;
let disabledUntil = 0;

/** True when it's worth trying ElevenLabs right now (configured, not recently failing). */
export function elevenLabsReady(): boolean {
  return elevenLabsConfigured && Date.now() > disabledUntil;
}

class PaidVoiceError extends Error {}

async function fetchClip(text: string, speed: number, voice: string): Promise<Blob> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': API_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: { stability: 0.6, similarity_boost: 0.75, speed },
    }),
  });
  if (res.status === 402) throw new PaidVoiceError('This voice needs a paid ElevenLabs plan');
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
  return res.blob();
}

const inflight = new Map<string, Promise<Blob | null>>();

/**
 * Audio for `text`, from the on-device cache or ElevenLabs. Resolves null on any failure; after
 * repeated failures (offline, bad key, quota) it pauses for a minute so the built-in voice
 * takes over without delays.
 */
export function getClip(text: string, rate: number, requestedVoice: string): Promise<Blob | null> {
  const speed = elevenLabsSpeed(rate);
  const voice = resolveVoice(requestedVoice);
  const key = hashKey(`${voice}|${speed}|${text}`);
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    const cached = await idb.get<Blob>('tts', key).catch(() => undefined);
    if (cached) return cached;
    if (!elevenLabsReady()) return null;
    try {
      const blob = await fetchClip(text, speed, voice);
      failures = 0;
      void store(key, blob);
      return blob;
    } catch (e) {
      if (e instanceof PaidVoiceError && voice !== FALLBACK_VOICE_ID) {
        needsPaidPlan.add(voice);
        inflight.delete(key);
        return getClip(text, rate, FALLBACK_VOICE_ID);
      }
      failures++;
      if (failures >= 2) disabledUntil = Date.now() + 60_000;
      return null;
    }
  })();
  inflight.set(key, p);
  void p.finally(() => inflight.delete(key));
  return p;
}

async function store(key: string, blob: Blob) {
  try {
    await idb.set('tts', key, blob);
    const keys = await idb.keys('tts');
    if (keys.length > MAX_CACHE_ENTRIES)
      for (const k of keys.slice(0, keys.length - MAX_CACHE_ENTRIES)) await idb.del('tts', k);
  } catch {
    /* caching is best effort */
  }
}
