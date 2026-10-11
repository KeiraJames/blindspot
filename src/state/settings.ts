import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { DistanceUnit } from '../lib/nav/units';
import { DEFAULT_ELEVEN_VOICE, elevenLabsConfigured } from '../lib/voice/elevenlabs';
import { preferencesStorage } from './storage';

export type SampleId = 'hall' | 'home';

export interface Settings {
  /** User heard and accepted the safety notice (complements a cane or guide dog). */
  safetyAcknowledged: boolean;
  /** Multiplier on the system speaking rate: 0.4 (very slow) … 1.4 (fast). */
  speechRate: number;
  /** ElevenLabs voice id, or 'iphone' for the built-in voice (always used offline). */
  voice: string;
  vibration: boolean;
  /** Short sounds that pair with each vibration. */
  sounds: boolean;
  units: DistanceUnit;
  /** Step length in meters, used when units = steps. */
  stepLength: number;
  /** Speak a warning when the phone detects an obstacle or person ahead. */
  obstacleAlerts: boolean;
  /** Talk with the app: it listens after asking, and a mic sits in every header. */
  voiceCompanion: boolean;
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
  voice: elevenLabsConfigured ? DEFAULT_ELEVEN_VOICE : 'iphone',
  vibration: true,
  sounds: true,
  units: 'meters' as DistanceUnit,
  stepLength: 0.7,
  obstacleAlerts: true,
  voiceCompanion: true,
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
      version: 5,
      // Earlier versions had many more options; keep only what still exists.
      migrate: (old, from) => {
        const o = (old ?? {}) as Record<string, unknown>;
        // Builds without an ElevenLabs key saved the iPhone voice as the default, and it stuck
        // after a key was added. Give the natural voice one fresh start.
        if (from < 5 && o.voice === 'iphone' && elevenLabsConfigured) delete o.voice;
        return {
          ...DEFAULTS,
          safetyAcknowledged: Boolean(o.safetyAcknowledged),
          // Speech used to default to 1.0, which people found too fast.
          speechRate:
            typeof o.speechRate === 'number' && o.speechRate < 1 ? o.speechRate : DEFAULTS.speechRate,
          units: (o.units as DistanceUnit) ?? DEFAULTS.units,
          highContrast: Boolean(o.highContrast),
          ...(typeof o.voice === 'string'
            ? { voice: o.voice }
            : o.naturalVoice === false
              ? { voice: 'iphone' }
              : {}),
          ...(o.sample === 'home' || o.sample === 'hall' ? { sample: o.sample } : {}),
          ...(typeof o.vibration === 'boolean' ? { vibration: o.vibration } : {}),
          ...(typeof o.sounds === 'boolean' ? { sounds: o.sounds } : {}),
          ...(typeof o.obstacleAlerts === 'boolean' ? { obstacleAlerts: o.obstacleAlerts } : {}),
          ...(typeof o.voiceCompanion === 'boolean' ? { voiceCompanion: o.voiceCompanion } : {}),
        } as Settings;
      },
    },
  ),
);
