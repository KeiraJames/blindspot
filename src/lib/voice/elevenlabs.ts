import { httpsCallable } from 'firebase/functions';
import { firebase } from '../../firebase/app';

export interface TtsResponse {
  audio: string; // base64
  contentType: string;
}

/**
 * ElevenLabs text-to-speech through the `tts` Cloud Function. The function holds the API
 * key (never shipped in the app) and enforces a per-user quota. It is a plain HTTPS proxy:
 * no ML runs in our backend.
 */
export async function synthesize(text: string, voiceId: string, signal?: AbortSignal): Promise<Blob> {
  const fb = firebase();
  if (!fb) throw new Error('Firebase is not configured');
  if (!fb.auth.currentUser) throw new Error('Sign in to use the guide voice');
  const call = httpsCallable<{ text: string; voiceId: string }, TtsResponse>(fb.functions, 'tts', {
    timeout: 8000,
  });
  const res = await call({ text, voiceId });
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const bin = atob(res.data.audio);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: res.data.contentType });
}
