import { Speech } from '../../plugins/speech';
import { hashKey, idb } from '../util/idb';
import { synthesize } from './elevenlabs';

export type Priority = 'low' | 'normal' | 'high';

export interface VoiceSettings {
  enabled: boolean;
  /** Use ElevenLabs; otherwise always AVSpeech. */
  premium: boolean;
  voiceId: string;
  rate: number;
}

interface Utterance {
  text: string;
  priority: Priority;
  resolve: () => void;
}

const MAX_CACHE_ENTRIES = 400;

/**
 * One consistent guide voice. ElevenLabs clips are cached in IndexedDB by text + voice and
 * prefetched ahead of time; when synthesis fails or is slow, AVSpeechSynthesizer speaks
 * instead so a prompt is never dropped. High-priority prompts (hazards) interrupt.
 */
export class VoiceGuide {
  private queue: Utterance[] = [];
  private speaking: Utterance | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private inflight = new Map<string, Promise<Blob | null>>();
  private lastSpoken = '';
  private premiumFailures = 0;
  /** Fall back to AVSpeech when a clip isn't ready within this time. */
  latencyBudgetMs = 900;

  constructor(private settings: VoiceSettings) {}

  update(settings: Partial<VoiceSettings>) {
    this.settings = { ...this.settings, ...settings };
  }

  get last(): string {
    return this.lastSpoken;
  }

  say(text: string, priority: Priority = 'normal'): Promise<void> {
    if (!this.settings.enabled || !text.trim()) return Promise.resolve();
    return new Promise((resolve) => {
      const u: Utterance = { text, priority, resolve };
      if (priority === 'high') {
        // Drop queued low/normal prompts; they are stale once a hazard is announced.
        this.queue.forEach((q) => q.resolve());
        this.queue = [u];
        this.interruptCurrent();
      } else {
        if (priority === 'low' && (this.speaking || this.queue.length > 0)) return resolve();
        // Coalesce duplicate consecutive prompts.
        if (this.queue.at(-1)?.text === text || this.speaking?.text === text) return resolve();
        this.queue.push(u);
      }
      void this.pump();
    });
  }

  repeat() {
    if (this.lastSpoken) void this.say(this.lastSpoken, 'normal');
  }

  stop() {
    this.queue.forEach((q) => q.resolve());
    this.queue = [];
    this.interruptCurrent();
  }

  /** Warm the cache for upcoming prompts (PRD: prefetch next two). */
  prefetch(texts: string[]) {
    if (!this.settings.premium) return;
    for (const t of texts.slice(0, 2)) void this.clip(t);
  }

  private interruptCurrent() {
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.dispatchEvent(new Event('ended'));
    }
    void Speech.stop();
  }

  private async pump() {
    if (this.speaking) return;
    const next = this.queue.shift();
    if (!next) return;
    this.speaking = next;
    this.lastSpoken = next.text;
    try {
      // Hazards can't wait on the network: only an already-cached clip is fast enough.
      const budget = next.priority === 'high' ? 150 : this.latencyBudgetMs;
      const blob = this.settings.premium && this.premiumFailures < 3 ? await this.clipWithin(next.text, budget) : null;
      if (this.speaking !== next) return; // interrupted while fetching
      if (blob) await this.playBlob(blob);
      else await Speech.speak({ text: next.text, rate: this.settings.rate, interrupt: false });
    } catch {
      await Speech.speak({ text: next.text, rate: this.settings.rate }).catch(() => undefined);
    } finally {
      next.resolve();
      if (this.speaking === next) this.speaking = null;
      void this.pump();
    }
  }

  private clipWithin(text: string, budgetMs: number): Promise<Blob | null> {
    return Promise.race([
      this.clip(text),
      new Promise<null>((r) => setTimeout(() => r(null), budgetMs)),
    ]);
  }

  private clip(text: string): Promise<Blob | null> {
    const key = hashKey(`${this.settings.voiceId}|${text}`);
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const p = (async () => {
      const cached = await idb.get<Blob>('tts', key).catch(() => undefined);
      if (cached) return cached;
      try {
        const blob = await synthesize(text, this.settings.voiceId);
        this.premiumFailures = 0;
        void this.store(key, blob);
        return blob;
      } catch {
        this.premiumFailures++;
        return null;
      }
    })();
    this.inflight.set(key, p);
    void p.finally(() => this.inflight.delete(key));
    return p;
  }

  private async store(key: string, blob: Blob) {
    try {
      await idb.set('tts', key, blob);
      const keys = await idb.keys('tts');
      if (keys.length > MAX_CACHE_ENTRIES) for (const k of keys.slice(0, keys.length - MAX_CACHE_ENTRIES)) await idb.del('tts', k);
    } catch {
      /* cache is best effort */
    }
  }

  private playBlob(blob: Blob): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const el = new Audio(url);
      el.playbackRate = Math.min(2, Math.max(0.5, this.settings.rate));
      this.audioEl = el;
      const done = () => {
        URL.revokeObjectURL(url);
        if (this.audioEl === el) this.audioEl = null;
        resolve();
      };
      el.addEventListener('ended', done, { once: true });
      el.addEventListener('error', done, { once: true });
      el.play().catch(done);
    });
  }
}
