import { Speech } from '../../plugins/speech';
import { elevenLabsReady, getClip } from './elevenlabs';

export type Priority = 'low' | 'normal' | 'high';

export interface VoiceSettings {
  enabled: boolean;
  rate: number;
  /** ElevenLabs voice id, or 'iphone' for the built-in iOS voice only. */
  voice: string;
}

interface Utterance {
  text: string;
  priority: Priority;
  resolve: () => void;
}

/**
 * The guide voice. Prompts are queued; a high-priority prompt (hazard, arrival) drops the queue
 * and interrupts, and low-priority hints are skipped when something else is talking.
 *
 * With the natural voice on, each prompt is played from ElevenLabs (cached on the phone). If a
 * clip isn't ready quickly — offline, slow network, no key — the built-in iOS voice speaks
 * instead, so a direction is never late or dropped.
 */
export class VoiceGuide {
  private queue: Utterance[] = [];
  private speaking: Utterance | null = null;
  private audio: HTMLAudioElement | null = null;
  private lastSpoken = '';
  /** How long to wait for an ElevenLabs clip before using the built-in voice. */
  latencyBudgetMs = 1500;

  constructor(private settings: VoiceSettings) {}

  update(settings: Partial<VoiceSettings>) {
    this.settings = { ...this.settings, ...settings };
  }

  get last(): string {
    return this.lastSpoken;
  }

  get busy(): boolean {
    return this.speaking !== null || this.queue.length > 0;
  }

  say(text: string, priority: Priority = 'normal'): Promise<void> {
    if (!this.settings.enabled || !text.trim()) return Promise.resolve();
    return new Promise((resolve) => {
      const u: Utterance = { text, priority, resolve };
      if (priority === 'high') {
        this.queue.forEach((q) => q.resolve());
        this.queue = [u];
        this.interrupt();
      } else {
        if (priority === 'low' && this.busy) return resolve();
        if (this.queue.at(-1)?.text === text || this.speaking?.text === text) return resolve();
        this.queue.push(u);
      }
      void this.pump();
    });
  }

  /** Start fetching clips for prompts that will be spoken soon. */
  prefetch(texts: string[]) {
    if (this.settings.voice === 'iphone' || !elevenLabsReady()) return;
    for (const t of texts) void getClip(t, this.settings.rate, this.settings.voice);
  }

  repeat() {
    if (this.lastSpoken) void this.say(this.lastSpoken);
  }

  /** Stop talking now and forget anything queued. */
  stop() {
    this.queue.forEach((q) => q.resolve());
    this.queue = [];
    this.interrupt();
  }

  private interrupt() {
    if (this.audio) {
      this.audio.pause();
      this.audio.dispatchEvent(new Event('ended'));
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
      let clip: Blob | null = null;
      if (this.settings.voice !== 'iphone' && elevenLabsReady()) {
        // Hazards can't wait for the network; only an already-cached clip is fast enough.
        const budget = next.priority === 'high' ? 150 : this.latencyBudgetMs;
        clip = await Promise.race([
          getClip(next.text, this.settings.rate, this.settings.voice),
          new Promise<null>((r) => setTimeout(() => r(null), budget)),
        ]);
      }
      if (this.speaking !== next) return; // interrupted while waiting
      if (clip) await this.play(clip);
      else await Speech.speak({ text: next.text, rate: this.settings.rate });
    } catch {
      /* speech unavailable: the live region still shows the text */
    } finally {
      next.resolve();
      if (this.speaking === next) this.speaking = null;
      void this.pump();
    }
  }

  private play(blob: Blob): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const el = new Audio(url);
      this.audio = el;
      const done = () => {
        URL.revokeObjectURL(url);
        if (this.audio === el) this.audio = null;
        resolve();
      };
      el.addEventListener('ended', done, { once: true });
      el.addEventListener('error', done, { once: true });
      el.play().catch(done);
    });
  }
}
