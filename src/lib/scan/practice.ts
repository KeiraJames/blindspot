import type { ScanProgress } from '../../plugins/scan';
import { syntheticScan } from './synthetic';
import type { ScanResult } from './types';

export interface PracticeRun {
  result: Promise<ScanResult>;
  /** End early, like pressing Finish. */
  finish(): void;
  cancel(): void;
}

/** What the coach says during a practice scan, by step (one step ≈ 1.5 s). */
const SCRIPT: Record<number, string> = {
  1: 'Good. Keep walking slowly next to the wall.',
  3: 'Move a little closer to the wall.',
  6: 'Slow down.',
  7: 'Almost done. Walk back to the door.',
};

/**
 * A pretend scan for learning the steps on any phone (or the Simulator): spoken coaching,
 * a door being found and the coverage filling up, then a made-up room to name. Nothing is
 * saved by the caller in practice mode.
 */
export function runPracticeScan(
  onProgress: (p: ScanProgress) => void,
  onCoach: (text: string) => void,
  stepMs = 1500,
): PracticeRun {
  let timer: ReturnType<typeof setInterval> | null = null;
  let settle: ((r: ScanResult) => void) | null = null;
  let fail: ((e: Error) => void) | null = null;
  const result = new Promise<ScanResult>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const done = () => {
    stop();
    settle?.(syntheticScan(`practice_${Date.now().toString(36)}`));
  };

  let step = 0;
  timer = setInterval(() => {
    step++;
    onProgress({
      coverage: Math.min(1, step / 8),
      tracking: 'normal',
      walls: Math.min(4, Math.ceil(step / 2)),
      doors: step >= 4 ? 1 : 0,
      openings: 0,
      stairs: 0,
    });
    const line = SCRIPT[step];
    if (line) onCoach(line);
    if (step >= 8) done();
  }, stepMs);

  return {
    result,
    finish: done,
    cancel: () => {
      stop();
      fail?.(new Error('cancelled'));
    },
  };
}
