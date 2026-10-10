/**
 * Full-screen gesture recognizer (PRD §8). Gestures ignore where on screen they happen;
 * only direction, finger count and timing matter, so they work without visual focus.
 *
 * "Forward" means away from the user when the phone is held upright in portrait, i.e. a
 * swipe toward the top of the screen.
 */

export type Gesture =
  | 'swipeForward'
  | 'swipeBack'
  | 'swipeLeft'
  | 'swipeRight'
  | 'doubleTap'
  | 'longPress'
  | 'twoFingerUp'
  | 'twoFingerDown'
  | 'tap';

export interface TouchSample {
  id: number;
  x: number;
  y: number;
  t: number;
}

export interface RecognizerConfig {
  swipeMinDistance: number;
  swipeMaxDuration: number;
  tapMaxMovement: number;
  tapMaxDuration: number;
  doubleTapWindow: number;
  longPressDuration: number;
}

export const DEFAULT_RECOGNIZER_CONFIG: RecognizerConfig = {
  swipeMinDistance: 50,
  swipeMaxDuration: 800,
  tapMaxMovement: 18,
  tapMaxDuration: 300,
  doubleTapWindow: 350,
  longPressDuration: 650,
};

interface Stroke {
  start: TouchSample;
  last: TouchSample;
}

/**
 * Stateful recognizer fed with pointer events. It emits through `onGesture`. A single tap is
 * delayed by the double-tap window so a double tap never also fires a tap.
 */
export class GestureRecognizer {
  private strokes = new Map<number, Stroke>();
  private maxFingers = 0;
  private gestureStart = 0;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressFired = false;
  private pendingTap: ReturnType<typeof setTimeout> | null = null;
  private lastTapAt = -Infinity;

  constructor(
    private onGesture: (g: Gesture) => void,
    private config: RecognizerConfig = DEFAULT_RECOGNIZER_CONFIG,
  ) {}

  down(s: TouchSample) {
    if (this.strokes.size === 0) {
      this.maxFingers = 0;
      this.gestureStart = s.t;
      this.longPressFired = false;
      this.clearLongPress();
      this.longPressTimer = setTimeout(() => {
        if (this.maxFingers === 1 && this.isStationary()) {
          this.longPressFired = true;
          this.emit('longPress');
        }
      }, this.config.longPressDuration);
    }
    this.strokes.set(s.id, { start: s, last: s });
    this.maxFingers = Math.max(this.maxFingers, this.strokes.size);
  }

  move(s: TouchSample) {
    const st = this.strokes.get(s.id);
    if (st) st.last = s;
    if (!this.isStationary()) this.clearLongPress();
  }

  up(s: TouchSample) {
    const st = this.strokes.get(s.id);
    if (st) st.last = s;
    if (this.strokes.size > 1) {
      // Wait for the last finger; keep this stroke's final sample for classification.
      this.finished.push(st ?? { start: s, last: s });
      this.strokes.delete(s.id);
      return;
    }
    this.finished.push(st ?? { start: s, last: s });
    this.strokes.delete(s.id);
    this.clearLongPress();
    const strokes = this.finished;
    this.finished = [];
    if (this.longPressFired) return;
    this.classify(strokes, s.t);
  }

  cancel() {
    this.strokes.clear();
    this.finished = [];
    this.clearLongPress();
  }

  dispose() {
    this.cancel();
    if (this.pendingTap) clearTimeout(this.pendingTap);
  }

  private finished: Stroke[] = [];

  private classify(strokes: Stroke[], endT: number) {
    const duration = endT - this.gestureStart;
    const fingers = this.maxFingers;
    const dx = avg(strokes.map((s) => s.last.x - s.start.x));
    const dy = avg(strokes.map((s) => s.last.y - s.start.y));
    const distance = Math.hypot(dx, dy);

    if (distance >= this.config.swipeMinDistance && duration <= this.config.swipeMaxDuration) {
      const vertical = Math.abs(dy) > Math.abs(dx);
      if (fingers >= 2) {
        if (vertical) this.emit(dy < 0 ? 'twoFingerUp' : 'twoFingerDown');
        return;
      }
      if (vertical) this.emit(dy < 0 ? 'swipeForward' : 'swipeBack');
      else this.emit(dx < 0 ? 'swipeLeft' : 'swipeRight');
      return;
    }

    if (fingers === 1 && distance <= this.config.tapMaxMovement && duration <= this.config.tapMaxDuration) {
      if (endT - this.lastTapAt <= this.config.doubleTapWindow && this.pendingTap) {
        clearTimeout(this.pendingTap);
        this.pendingTap = null;
        this.lastTapAt = -Infinity;
        this.emit('doubleTap');
        return;
      }
      this.lastTapAt = endT;
      this.pendingTap = setTimeout(() => {
        this.pendingTap = null;
        this.emit('tap');
      }, this.config.doubleTapWindow);
    }
  }

  private isStationary(): boolean {
    for (const s of this.strokes.values()) {
      if (Math.hypot(s.last.x - s.start.x, s.last.y - s.start.y) > this.config.tapMaxMovement) return false;
    }
    return true;
  }

  private clearLongPress() {
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }

  private emit(g: Gesture) {
    this.onGesture(g);
  }
}

const avg = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

export const GESTURE_HELP: { gesture: Gesture; label: string; action: string }[] = [
  { gesture: 'swipeForward', label: 'Swipe up', action: 'Repeat the current instruction' },
  { gesture: 'swipeBack', label: 'Swipe down', action: 'Cancel' },
  { gesture: 'swipeLeft', label: 'Swipe left', action: 'Previous destination or turn preview' },
  { gesture: 'swipeRight', label: 'Swipe right', action: 'Next destination or turn preview' },
  { gesture: 'doubleTap', label: 'Double-tap', action: 'Confirm' },
  { gesture: 'longPress', label: 'Touch and hold', action: 'Stop or pause guidance' },
  { gesture: 'twoFingerUp', label: 'Two-finger swipe up', action: 'Confirm going up a floor' },
  { gesture: 'twoFingerDown', label: 'Two-finger swipe down', action: 'Confirm going down a floor' },
  { gesture: 'tap', label: 'Single tap', action: 'Where am I?' },
];
