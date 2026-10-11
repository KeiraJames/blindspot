/**
 * Core Haptics pattern specs (PRD §8). These are sent as-is to HapticsPlugin, which turns
 * them into CHHapticEvents. Times and durations are in seconds; intensity and sharpness
 * are 0..1 like CHHapticEventParameter.
 *
 * Design rules, enforced by tests:
 * - every cue is distinguishable by rhythm alone (different event counts or timing),
 * - left and right turns are mirror-asymmetric (left = long-short, right = short-long),
 * - hazard is the sharpest cue, arrival is the longest,
 * - no cue lasts longer than 1.5 s, so it never masks the next spoken prompt.
 */

export interface HapticEvent {
  type: 'transient' | 'continuous';
  time: number;
  duration?: number;
  intensity: number;
  sharpness: number;
}

export interface HapticPattern {
  name: HapticCue;
  events: HapticEvent[];
}

export type HapticCue =
  | 'turnLeft'
  | 'turnRight'
  | 'straight'
  | 'hazard'
  | 'arrival'
  | 'trackingLost'
  | 'confirm'
  | 'cancel'
  | 'floorChange';

const t = (time: number, intensity: number, sharpness: number): HapticEvent => ({
  type: 'transient',
  time,
  intensity,
  sharpness,
});
const c = (time: number, duration: number, intensity: number, sharpness: number): HapticEvent => ({
  type: 'continuous',
  time,
  duration,
  intensity,
  sharpness,
});

export const HAPTIC_PATTERNS: Record<HapticCue, HapticPattern> = {
  // Long buzz then short tap: "loooong-tap" reads as left.
  turnLeft: { name: 'turnLeft', events: [c(0, 0.35, 0.9, 0.3), t(0.5, 1, 0.6)] },
  // Short tap then long buzz: mirror of left.
  turnRight: { name: 'turnRight', events: [t(0, 1, 0.6), c(0.15, 0.35, 0.9, 0.3)] },
  // Single soft tick, repeated by the navigator while the walker is on course.
  straight: { name: 'straight', events: [t(0, 0.45, 0.4)] },
  // Three sharp, strong taps close together.
  hazard: { name: 'hazard', events: [t(0, 1, 1), t(0.1, 1, 1), t(0.2, 1, 1)] },
  // Two long, smooth pulses.
  arrival: { name: 'arrival', events: [c(0, 0.5, 0.8, 0.1), c(0.7, 0.5, 0.8, 0.1)] },
  // Irregular stutter: uneven gaps and intensities.
  trackingLost: {
    name: 'trackingLost',
    events: [t(0, 0.7, 0.5), t(0.07, 0.4, 0.8), t(0.31, 0.8, 0.3), t(0.38, 0.5, 0.7), t(0.8, 0.6, 0.5)],
  },
  confirm: { name: 'confirm', events: [t(0, 0.8, 0.5), t(0.12, 0.6, 0.5)] },
  cancel: { name: 'cancel', events: [c(0, 0.2, 0.6, 0.8)] },
  // Rising ramp of four taps for stairs/elevator.
  floorChange: {
    name: 'floorChange',
    events: [t(0, 0.4, 0.3), t(0.15, 0.6, 0.45), t(0.3, 0.8, 0.6), t(0.45, 1, 0.75)],
  },
};

export function patternDuration(p: HapticPattern): number {
  return Math.max(...p.events.map((e) => e.time + (e.duration ?? 0.02)));
}

/** Rhythm signature used to check that cues are distinguishable without looking at intensity. */
export function rhythmSignature(p: HapticPattern): string {
  return p.events
    .map((e) => `${e.type[0]}@${e.time.toFixed(2)}${e.duration ? `+${e.duration.toFixed(2)}` : ''}`)
    .join(',');
}

/** Approximate the pattern for navigator.vibrate() (web dev only; iOS ignores it). */
export function toVibrationPattern(p: HapticPattern): number[] {
  const out: number[] = [];
  let cursor = 0;
  for (const e of [...p.events].sort((a, b) => a.time - b.time)) {
    const start = Math.round(e.time * 1000);
    const len = Math.max(20, Math.round((e.duration ?? 0.03) * 1000));
    if (out.length > 0) out.push(Math.max(0, start - cursor));
    out.push(len);
    cursor = start + len;
  }
  return out;
}
