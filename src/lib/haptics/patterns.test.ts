import { describe, expect, it } from 'vitest';
import { HAPTIC_PATTERNS, patternDuration, rhythmSignature, toVibrationPattern } from './patterns';

const all = Object.values(HAPTIC_PATTERNS);

describe('haptic patterns', () => {
  it('every cue has a unique rhythm', () => {
    const sigs = all.map(rhythmSignature);
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it('keeps parameters in Core Haptics range and cues short', () => {
    for (const p of all) {
      for (const e of p.events) {
        expect(e.intensity).toBeGreaterThanOrEqual(0);
        expect(e.intensity).toBeLessThanOrEqual(1);
        expect(e.sharpness).toBeGreaterThanOrEqual(0);
        expect(e.sharpness).toBeLessThanOrEqual(1);
        expect(e.time).toBeGreaterThanOrEqual(0);
        if (e.type === 'continuous') expect(e.duration).toBeGreaterThan(0);
      }
      expect(patternDuration(p)).toBeLessThanOrEqual(1.5);
    }
  });

  it('left and right turns are asymmetric mirrors', () => {
    const l = HAPTIC_PATTERNS.turnLeft.events;
    const r = HAPTIC_PATTERNS.turnRight.events;
    expect(l[0]!.type).toBe('continuous');
    expect(r[0]!.type).toBe('transient');
    expect(l.map((e) => e.type).reverse()).toEqual(r.map((e) => e.type));
  });

  it('hazard is the sharpest triple, arrival the longest two pulses', () => {
    const hz = HAPTIC_PATTERNS.hazard.events;
    expect(hz).toHaveLength(3);
    expect(hz.every((e) => e.sharpness === 1 && e.intensity === 1)).toBe(true);
    const arr = HAPTIC_PATTERNS.arrival;
    expect(arr.events.filter((e) => e.type === 'continuous')).toHaveLength(2);
    expect(Math.max(...all.map(patternDuration))).toBeLessThanOrEqual(patternDuration(arr) + 0.0001 + 0.1);
  });

  it('tracking lost has irregular gaps', () => {
    const times = HAPTIC_PATTERNS.trackingLost.events.map((e) => e.time);
    const gaps = times.slice(1).map((t, i) => +(t - times[i]!).toFixed(3));
    expect(new Set(gaps).size).toBeGreaterThan(2);
  });

  it('converts to a vibration pattern for web dev', () => {
    expect(toVibrationPattern(HAPTIC_PATTERNS.hazard)).toEqual([30, 70, 30, 70, 30]);
  });
});
