import { beforeEach, describe, expect, it, vi } from 'vitest';

const speak = vi.fn(async (_options: unknown) => undefined);
vi.mock('../../plugins/speech', () => ({
  Speech: { speak: (o: unknown) => speak(o), stop: vi.fn(async () => undefined) },
}));
const getClip = vi.fn<(text: string, rate: number, voice: string) => Promise<Blob | null>>();
let ready = true;
vi.mock('./elevenlabs', () => ({
  getClip: (t: string, r: number, v: string) => getClip(t, r, v),
  elevenLabsReady: () => ready,
}));

const { VoiceGuide } = await import('./voiceGuide');
const { elevenLabsSpeed } = await vi.importActual<typeof import('./elevenlabs')>('./elevenlabs');

describe('VoiceGuide with the natural voice', () => {
  beforeEach(() => {
    speak.mockClear();
    getClip.mockReset();
    ready = true;
  });

  it('falls back to the built-in voice when no clip comes back', async () => {
    getClip.mockResolvedValue(null);
    const v = new VoiceGuide({ enabled: true, rate: 0.75, voice: 'river' });
    await v.say('Turn left.');
    expect(getClip).toHaveBeenCalledWith('Turn left.', 0.75, 'river');
    expect(speak).toHaveBeenCalledWith({ text: 'Turn left.', rate: 0.75 });
  });

  it("doesn't wait for a slow network", async () => {
    vi.useFakeTimers();
    getClip.mockReturnValue(new Promise(() => undefined)); // never resolves
    const v = new VoiceGuide({ enabled: true, rate: 0.75, voice: 'river' });
    const done = v.say('Turn right.');
    await vi.advanceTimersByTimeAsync(1600);
    await done;
    vi.useRealTimers();
    expect(speak).toHaveBeenCalledWith({ text: 'Turn right.', rate: 0.75 });
  });

  it('uses only the built-in voice when the natural voice is off or unavailable', async () => {
    const off = new VoiceGuide({ enabled: true, rate: 1, voice: 'iphone' });
    await off.say('Hello.');
    ready = false;
    const unavailable = new VoiceGuide({ enabled: true, rate: 1, voice: 'river' });
    await unavailable.say('Hi.');
    expect(getClip).not.toHaveBeenCalled();
    expect(speak).toHaveBeenCalledTimes(2);
  });
});

describe('elevenLabsSpeed', () => {
  it('maps the app speed onto the ElevenLabs range', () => {
    expect(elevenLabsSpeed(0.4)).toBe(0.7);
    expect(elevenLabsSpeed(0.75)).toBe(0.88);
    expect(elevenLabsSpeed(1.4)).toBe(1.2);
    expect(elevenLabsSpeed(3)).toBe(1.2);
  });
});

describe('voice fallback for free accounts', () => {
  it('switches to the free built-in voice when the chosen voice needs a paid plan', async () => {
    vi.stubEnv('VITE_ELEVENLABS_API_KEY', 'sk_test');
    vi.stubEnv('VITE_ELEVENLABS_VOICE_ID', 'library-voice');
    vi.resetModules();
    const real = await vi.importActual<typeof import('./elevenlabs')>('./elevenlabs');
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return url.includes('library-voice')
          ? new Response('{}', { status: 402 })
          : new Response(new Blob(['mp3']), { status: 200 });
      }),
    );
    const clip = await real.getClip('Turn left.', 0.75, 'library-voice');
    expect(clip).not.toBeNull();
    expect(urls[0]).toContain('library-voice');
    expect(urls[1]).toContain(real.FALLBACK_VOICE_ID);
    expect(real.resolveVoice('library-voice')).toBe(real.FALLBACK_VOICE_ID);
    // Free voices are untouched.
    expect(real.resolveVoice('SAz9YHcvj6GT2YYXdXww')).toBe('SAz9YHcvj6GT2YYXdXww');
    expect(real.ELEVEN_VOICES.map((v) => v.name)).toEqual(['Jessa', 'Sarah', 'River', 'George']);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
