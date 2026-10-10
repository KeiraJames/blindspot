import { useEffect, useState } from 'react';
import { registerLiveRegion } from '../lib/feedback';

/**
 * Mirrors every spoken prompt into an aria-live region, so VoiceOver and braille display
 * users get the same information as text. Messages that arrive together are joined, since
 * screen readers only read the final content of a region that changes twice in one frame.
 */
export function LiveRegion() {
  const [text, setText] = useState('');
  useEffect(() => {
    let n = 0;
    let pending: string[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    registerLiveRegion((t) => {
      pending.push(t);
      if (timer) return;
      timer = setTimeout(() => {
        n++;
        // Toggle a zero-width suffix so identical repeats are still announced.
        setText(pending.join(' ') + (n % 2 ? '​' : ''));
        pending = [];
        timer = null;
      }, 60);
    });
    return () => {
      registerLiveRegion(null);
      if (timer) clearTimeout(timer);
    };
  }, []);
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </div>
  );
}
