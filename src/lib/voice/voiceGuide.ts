import { Speech } from '../../plugins/speech';

export type Priority = 'low' | 'normal' | 'high';

export interface VoiceSettings {
  enabled: boolean;
  rate: number;
}

interface Utterance {
  text: string;
  priority: Priority;
  resolve: () => void;
}

/**
 * The guide voice: the built-in iOS voice (AVSpeechSynthesizer), so it works offline and
 * starts instantly. Prompts are queued; a high-priority prompt (hazard, arrival) drops the
 * queue and interrupts, and low-priority hints are skipped when something else is talking.
 */
export class VoiceGuide {
  private queue: Utterance[] = [];
  private speaking: Utterance | null = null;
  private lastSpoken = '';

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
        void Speech.stop();
      } else {
        if (priority === 'low' && this.busy) return resolve();
        if (this.queue.at(-1)?.text === text || this.speaking?.text === text) return resolve();
        this.queue.push(u);
      }
      void this.pump();
    });
  }

  repeat() {
    if (this.lastSpoken) void this.say(this.lastSpoken);
  }

  /** Stop talking now and forget anything queued. */
  stop() {
    this.queue.forEach((q) => q.resolve());
    this.queue = [];
    void Speech.stop();
  }

  private async pump() {
    if (this.speaking) return;
    const next = this.queue.shift();
    if (!next) return;
    this.speaking = next;
    this.lastSpoken = next.text;
    try {
      await Speech.speak({ text: next.text, rate: this.settings.rate });
    } catch {
      /* speech unavailable: the live region still shows the text */
    } finally {
      next.resolve();
      this.speaking = null;
      void this.pump();
    }
  }
}
