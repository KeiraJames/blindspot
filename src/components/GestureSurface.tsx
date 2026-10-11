import { useEffect, useRef, type ReactNode } from 'react';
import { GestureRecognizer, type Gesture } from '../lib/gestures/recognizer';

/**
 * Full-screen touch layer for eyes-free control. Position is ignored; only direction,
 * fingers and timing matter. With VoiceOver on, iOS intercepts touches in the web view, so
 * the iOS app uses the native direct-interaction overlay from ARNavPlugin instead and the
 * on-screen buttons remain available as a fallback.
 */
export function GestureSurface({
  onGesture,
  label,
  children,
  className,
}: {
  onGesture: (g: Gesture) => void;
  label: string;
  children?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onGesture);
  useEffect(() => {
    cb.current = onGesture;
  }, [onGesture]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = new GestureRecognizer((g) => cb.current(g));
    const sample = (e: PointerEvent) => ({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp });
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button, a, input, select, [data-no-gesture]')) return;
      el.setPointerCapture?.(e.pointerId);
      r.down(sample(e));
    };
    const move = (e: PointerEvent) => r.move(sample(e));
    const up = (e: PointerEvent) => r.up(sample(e));
    const cancel = () => r.cancel();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      r.dispose();
    };
  }, []);

  return (
    <div
      ref={ref}
      role="application"
      aria-label={label}
      className={className}
      style={{ touchAction: 'none' }}
    >
      {children}
    </div>
  );
}
