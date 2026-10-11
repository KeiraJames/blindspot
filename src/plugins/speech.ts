import { registerPlugin, WebPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface SpeakOptions {
  text: string;
  /** 0.5 (slow) .. 2 (fast); 1 = normal. */
  rate?: number;
  /** BCP-47 language, default en-US. */
  language?: string;
  /** Stop current speech first. */
  interrupt?: boolean;
}

export interface SpeechPlugin {
  /** AVSpeechSynthesizer fallback when ElevenLabs is unavailable. Resolves when speech finishes. */
  speak(options: SpeakOptions): Promise<void>;
  stop(): Promise<void>;
  /** On-device dictation (SFSpeechRecognizer) for voice room naming and destination search. */
  listen(options?: { timeoutMs?: number; contextualStrings?: string[] }): Promise<{ transcript: string }>;
  stopListening(): Promise<void>;
  /** Configure AVAudioSession so prompts play with the ringer switch off and duck other audio. */
  configureAudioSession(): Promise<void>;
  /** Whether VoiceOver is running, so the UI can adapt. */
  isVoiceOverRunning(): Promise<{ running: boolean }>;
  addListener(
    event: 'voiceOverChanged',
    cb: (e: { running: boolean }) => void,
  ): Promise<PluginListenerHandle>;
}

type SpeechRecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

class SpeechWeb extends WebPlugin implements SpeechPlugin {
  private recognizer: InstanceType<SpeechRecognitionCtor> | null = null;

  async speak({ text, rate = 1, language = 'en-US', interrupt }: SpeakOptions) {
    if (typeof speechSynthesis === 'undefined') return;
    if (interrupt) speechSynthesis.cancel();
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate;
      u.lang = language;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
  }
  async stop() {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }
  async listen({ timeoutMs = 8000 }: { timeoutMs?: number } = {}) {
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) throw this.unavailable('Speech recognition is not available in this browser.');
    return new Promise<{ transcript: string }>((resolve, reject) => {
      const r = new Ctor();
      this.recognizer = r;
      r.lang = 'en-US';
      r.interimResults = false;
      r.maxAlternatives = 1;
      let transcript = '';
      const timer = setTimeout(() => r.stop(), timeoutMs);
      r.onresult = (e) => {
        transcript = e.results[0]?.[0]?.transcript ?? '';
      };
      r.onerror = (e) => {
        clearTimeout(timer);
        reject(new Error(e.error));
      };
      r.onend = () => {
        clearTimeout(timer);
        this.recognizer = null;
        resolve({ transcript });
      };
      r.start();
    });
  }
  async stopListening() {
    this.recognizer?.stop();
  }
  async configureAudioSession() {}
  async isVoiceOverRunning() {
    return { running: false };
  }
}

export const Speech = registerPlugin<SpeechPlugin>('Speech', { web: () => new SpeechWeb() });
