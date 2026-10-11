import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { DistanceUnit } from '../lib/nav/units';
import { preferencesStorage } from './storage';

export type SampleId = 'hall' | 'home';

export interface Settings {
  /** User heard and accepted the safety notice (complements a cane or guide dog). */
  safetyAcknowledged: boolean;
  /** Multiplier on the system speaking rate: 0.4 (very slow) … 1.4 (fast). */
  speechRate: number;
  /** ElevenLabs voice when available (falls back to the built-in voice automatically). */
  naturalVoice: boolean;
  vibration: boolean;
  /** Short sounds that pair with each vibration. */
  sounds: boolean;
  units: DistanceUnit;
  /** Step length in meters, used when units = steps. */
  stepLength: number;
  /** Speak a warning when the phone detects an obstacle or person ahead. */
  obstacleAlerts: boolean;
  highContrast: boolean;
  /** Which practice map to use before you've scanned your own rooms. */
  sample: SampleId;
  set: (patch: Partial<Omit<Settings, 'set' | 'reset'>>) => void;
  reset: () => void;
}

const DEFAULTS = {
  safetyAcknowledged: false,
  // Slower than the iOS default: easier to follow while walking.
  speechRate: 0.75,
  naturalVoice: true,
  vibration: true,
  sounds: true,
  units: 'meters' as DistanceUnit,
  stepLength: 0.7,
  obstacleAlerts: true,
  highContrast: false,
  sample: 'hall' as SampleId,
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
      version: 3,
      // Earlier versions had many more options; keep only what still exists.
      migrate: (old) => {
        const o = (old ?? {}) as Record<string, unknown>;
        return {
          ...DEFAULTS,
          safetyAcknowledged: Boolean(o.safetyAcknowledged),
          // Speech used to default to 1.0, which people found too fast.
          speechRate:
            typeof o.speechRate === 'number' && o.speechRate < 1 ? o.speechRate : DEFAULTS.speechRate,
          units: (o.units as DistanceUnit) ?? DEFAULTS.units,
          highContrast: Boolean(o.highContrast),
          ...(typeof o.naturalVoice === 'boolean' ? { naturalVoice: o.naturalVoice } : {}),
          ...(o.sample === 'home' || o.sample === 'hall' ? { sample: o.sample } : {}),
          ...(typeof o.vibration === 'boolean' ? { vibration: o.vibration } : {}),
          ...(typeof o.sounds === 'boolean' ? { sounds: o.sounds } : {}),
          ...(typeof o.obstacleAlerts === 'boolean' ? { obstacleAlerts: o.obstacleAlerts } : {}),
        } as Settings;
      },
    },
  ),
);
