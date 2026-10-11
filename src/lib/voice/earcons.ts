/**
 * Short synthesized earcons (no audio assets). Each cue has a distinct contour, and turn
 * cues are panned toward the turn side for headphone users. Always paired with haptics
 * and speech (PRD §8).
 */
export type Earcon =
  | 'turnLeft'
  | 'turnRight'
  | 'straight'
  | 'hazard'
  | 'arrival'
  | 'trackingLost'
  | 'confirm'
  | 'cancel'
  | 'floorChange'
  | 'offRoute'
  | 'listening'
  | 'heard'
  | 'notUnderstood';

type Tone = {
  f: number;
  t: number;
  d: number;
  type?: OscillatorType;
  gain?: number;
  pan?: number;
  f2?: number;
};

const SPECS: Record<Earcon, Tone[]> = {
  turnLeft: [
    { f: 880, t: 0, d: 0.12, pan: -0.8 },
    { f: 660, t: 0.13, d: 0.16, pan: -0.8 },
  ],
  turnRight: [
    { f: 660, t: 0, d: 0.12, pan: 0.8 },
    { f: 880, t: 0.13, d: 0.16, pan: 0.8 },
  ],
  straight: [{ f: 1200, t: 0, d: 0.03, type: 'triangle', gain: 0.25 }],
  hazard: [
    { f: 1568, t: 0, d: 0.07, type: 'square', gain: 0.35 },
    { f: 1568, t: 0.1, d: 0.07, type: 'square', gain: 0.35 },
    { f: 1568, t: 0.2, d: 0.07, type: 'square', gain: 0.35 },
  ],
  arrival: [
    { f: 523, t: 0, d: 0.18 },
    { f: 659, t: 0.15, d: 0.18 },
    { f: 784, t: 0.3, d: 0.18 },
    { f: 1047, t: 0.45, d: 0.4 },
  ],
  trackingLost: [{ f: 440, f2: 300, t: 0, d: 0.45, type: 'sawtooth', gain: 0.2 }],
  confirm: [
    { f: 988, t: 0, d: 0.08 },
    { f: 1319, t: 0.09, d: 0.12 },
  ],
  cancel: [{ f: 330, t: 0, d: 0.15, type: 'triangle' }],
  floorChange: [{ f: 400, f2: 900, t: 0, d: 0.4, type: 'triangle' }],
  // Rising and bright: "I'm listening, go ahead."
  listening: [
    { f: 660, t: 0, d: 0.07, gain: 0.35 },
    { f: 990, t: 0.07, d: 0.12, gain: 0.4 },
  ],
  // Falling and soft: "Got it."
  heard: [
    { f: 990, t: 0, d: 0.06, gain: 0.3 },
    { f: 740, t: 0.06, d: 0.1, gain: 0.3 },
  ],
  // Low and gentle: "Sorry, I didn't catch that."
  notUnderstood: [
    { f: 392, t: 0, d: 0.12, type: 'triangle', gain: 0.35 },
    { f: 330, t: 0.16, d: 0.18, type: 'triangle', gain: 0.35 },
  ],
  offRoute: [
    { f: 740, t: 0, d: 0.12, type: 'triangle' },
    { f: 554, t: 0.14, d: 0.12, type: 'triangle' },
    { f: 740, t: 0.28, d: 0.12, type: 'triangle' },
  ],
};

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Must be called from a user gesture once so iOS allows audio. */
export function unlockAudio() {
  const a = audio();
  if (!a) return;
  const b = a.createBuffer(1, 1, 22050);
  const src = a.createBufferSource();
  src.buffer = b;
  src.connect(a.destination);
  src.start(0);
}

export function playEarcon(name: Earcon, volume = 0.6) {
  const a = audio();
  if (!a) return;
  const now = a.currentTime + 0.01;
  for (const tone of SPECS[name]) {
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = tone.type ?? 'sine';
    osc.frequency.setValueAtTime(tone.f, now + tone.t);
    if (tone.f2) osc.frequency.linearRampToValueAtTime(tone.f2, now + tone.t + tone.d);
    const peak = (tone.gain ?? 0.5) * volume;
    g.gain.setValueAtTime(0, now + tone.t);
    g.gain.linearRampToValueAtTime(peak, now + tone.t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + tone.t + tone.d);
    let node: AudioNode = g;
    if (tone.pan && a.createStereoPanner) {
      const p = a.createStereoPanner();
      p.pan.value = tone.pan;
      g.connect(p);
      node = p;
    }
    osc.connect(g);
    node.connect(a.destination);
    osc.start(now + tone.t);
    osc.stop(now + tone.t + tone.d + 0.02);
  }
}

export const EARCON_SPECS = SPECS;
