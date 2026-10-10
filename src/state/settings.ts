import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { DistanceUnit } from '../lib/nav/units';
import { preferencesStorage } from './storage';

export interface Settings {
  /** User acknowledged the safety notice (PathSense complements a cane or guide dog). */
  safetyAcknowledged: boolean;
  voiceEnabled: boolean;
  premiumVoice: boolean;
  speechRate: number;
  hapticsEnabled: boolean;
  hapticIntensity: number;
  earconsEnabled: boolean;
  earconVolume: number;
  units: DistanceUnit;
  stepLength: number;
  avoidStairs: boolean;
  preferElevator: boolean;
  /** Show the AR camera feed and guide path (low vision). Off = black screen. */
  showCamera: boolean;
  /** Steady straight-ahead tick while on course. */
  courseTicks: boolean;
  hazardAlerts: boolean;
  /** Detail level of spoken prompts. */
  verbosity: 'brief' | 'detailed';
  highContrast: boolean;
  /** Upload scans only on Wi-Fi. */
  wifiOnlyUploads: boolean;
  set: (patch: Partial<Omit<Settings, 'set' | 'reset'>>) => void;
  reset: () => void;
}

const DEFAULTS = {
  safetyAcknowledged: false,
  voiceEnabled: true,
  premiumVoice: true,
  speechRate: 1,
  hapticsEnabled: true,
  hapticIntensity: 1,
  earconsEnabled: true,
  earconVolume: 0.6,
  units: 'meters' as DistanceUnit,
  stepLength: 0.7,
  avoidStairs: false,
  preferElevator: false,
  showCamera: true,
  courseTicks: true,
  hazardAlerts: true,
  verbosity: 'detailed' as const,
  highContrast: false,
  wifiOnlyUploads: true,
};

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (patch) => set(patch),
      reset: () => set({ ...DEFAULTS, safetyAcknowledged: true }),
    }),
    { name: 'pathsense.settings', storage: createJSONStorage(() => preferencesStorage), version: 1 },
  ),
);
