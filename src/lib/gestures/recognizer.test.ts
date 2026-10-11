import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GestureRecognizer, type Gesture } from './recognizer';

describe('GestureRecognizer', () => {
  let got: Gesture[];
  let r: GestureRecognizer;
  beforeEach(() => {
    vi.useFakeTimers();
    got = [];
    r = new GestureRecognizer((g) => got.push(g));
  });
  afterEach(() => {
    r.dispose();
    vi.useRealTimers();
  });

  const swipe = (dx: number, dy: number, fingers = 1, t0 = 0) => {
    for (let f = 0; f < fingers; f++) r.down({ id: f, x: 100 + f * 40, y: 300, t: t0 });
    for (let f = 0; f < fingers; f++)
      r.move({ id: f, x: 100 + f * 40 + dx / 2, y: 300 + dy / 2, t: t0 + 80 });
    for (let f = 0; f < fingers; f++) r.up({ id: f, x: 100 + f * 40 + dx, y: 300 + dy, t: t0 + 160 });
  };

  it.each([
    [0, -120, 'swipeForward'],
    [0, 120, 'swipeBack'],
    [-120, 10, 'swipeLeft'],
    [120, -10, 'swipeRight'],
  ] as const)('swipe %s,%s → %s', (dx, dy, g) => {
    swipe(dx, dy);
    expect(got).toEqual([g]);
  });

  it('two-finger vertical swipes', () => {
    swipe(0, -150, 2);
    swipe(0, 150, 2, 1000);
    expect(got).toEqual(['twoFingerUp', 'twoFingerDown']);
  });

  it('double tap does not also fire a tap', () => {
    r.down({ id: 0, x: 10, y: 10, t: 0 });
    r.up({ id: 0, x: 11, y: 10, t: 80 });
    r.down({ id: 0, x: 12, y: 10, t: 200 });
    r.up({ id: 0, x: 12, y: 11, t: 260 });
    vi.advanceTimersByTime(1000);
    expect(got).toEqual(['doubleTap']);
  });

  it('single tap fires after the double-tap window', () => {
    r.down({ id: 0, x: 10, y: 10, t: 0 });
    r.up({ id: 0, x: 10, y: 10, t: 80 });
    expect(got).toEqual([]);
    vi.advanceTimersByTime(400);
    expect(got).toEqual(['tap']);
  });

  it('long press fires once and suppresses tap', () => {
    r.down({ id: 0, x: 10, y: 10, t: 0 });
    vi.advanceTimersByTime(700);
    r.up({ id: 0, x: 10, y: 10, t: 700 });
    vi.advanceTimersByTime(500);
    expect(got).toEqual(['longPress']);
  });

  it('movement cancels long press', () => {
    r.down({ id: 0, x: 10, y: 10, t: 0 });
    r.move({ id: 0, x: 60, y: 10, t: 100 });
    vi.advanceTimersByTime(700);
    expect(got).toEqual([]);
  });
});
