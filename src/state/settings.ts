import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { DistanceUnit } from '../lib/nav/units';
import { preferencesStorage } from './storage';

export interface Settings {
  /** User heard and accepted the safety notice (complements a cane or guide dog). */
  safetyAcknowledged: boolean;
  /** 0.6 (slow) … 1.6 (fast). */
  speechRate: number;
  vibration: boolean;
  /** Short sounds that pair with each vibration. */
  sounds: boolean;
  units: DistanceUnit;
  /** Step length in meters, used when units = steps. */
  stepLength: number;
  /** Speak a warning when the phone detects an obstacle or person ahead. */
  obstacleAlerts: boolean;
  highContrast: boolean;
  set: (patch: Partial<Omit<Settings, 'set' | 'reset'>>) => void;
  reset: () => void;
}

const DEFAULTS = {
  safetyAcknowledged: false,
  speechRate: 1,
  vibration: true,
  sounds: true,
  units: 'meters' as DistanceUnit,
  stepLength: 0.7,
  obstacleAlerts: true,
  highContrast: false,
};

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (patch) => set(patch),
      reset: () => set({ ...DEFAULTS, safetyAcknowledged: true }),
    }),
    {
      name: 'pathsense.settings',
      storage: createJSONStorage(() => preferencesStorage),
      version: 2,
      // Earlier versions had many more options; keep only what still exists.
      migrate: (old) => {
        const o = (old ?? {}) as Record<string, unknown>;
        return {
          ...DEFAULTS,
          safetyAcknowledged: Boolean(o.safetyAcknowledged),
          speechRate: typeof o.speechRate === 'number' ? o.speechRate : DEFAULTS.speechRate,
          units: (o.units as DistanceUnit) ?? DEFAULTS.units,
          highContrast: Boolean(o.highContrast),
        } as Settings;
      },
    },
  ),
);
