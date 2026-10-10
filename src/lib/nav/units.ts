export type DistanceUnit = 'meters' | 'feet' | 'steps';

/** Average walking step length in meters; users can tune it in Settings. */
export const DEFAULT_STEP_LENGTH = 0.7;

export function formatDistance(meters: number, unit: DistanceUnit, stepLength = DEFAULT_STEP_LENGTH): string {
  const m = Math.max(0, meters);
  switch (unit) {
    case 'feet': {
      const ft = m * 3.28084;
      const r = ft < 10 ? Math.max(1, Math.round(ft)) : Math.round(ft / 5) * 5;
      return `${r} ${r === 1 ? 'foot' : 'feet'}`;
    }
    case 'steps': {
      const s = Math.max(1, Math.round(m / stepLength));
      return `${s} ${s === 1 ? 'step' : 'steps'}`;
    }
    default: {
      const r = m < 10 ? Math.max(1, Math.round(m)) : Math.round(m / 5) * 5;
      return `${r} ${r === 1 ? 'meter' : 'meters'}`;
    }
  }
}
