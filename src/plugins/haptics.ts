import { registerPlugin, WebPlugin } from '@capacitor/core';
import type { HapticPattern } from '../lib/haptics/patterns';
import { toVibrationPattern } from '../lib/haptics/patterns';

export interface HapticsPlugin {
  isSupported(): Promise<{ supported: boolean }>;
  /** Play a Core Haptics pattern. Intensity scales every event (0..1). */
  play(options: { pattern: HapticPattern; intensity?: number }): Promise<void>;
  stop(): Promise<void>;
}

class HapticsWeb extends WebPlugin implements HapticsPlugin {
  async isSupported() {
    return { supported: typeof navigator !== 'undefined' && 'vibrate' in navigator };
  }
  async play({ pattern }: { pattern: HapticPattern; intensity?: number }) {
    // Development aid only. iOS Safari ignores navigator.vibrate, which is why the app uses Core Haptics.
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator)
      navigator.vibrate(toVibrationPattern(pattern));
    if (import.meta.env.DEV) console.debug('[haptics]', pattern.name);
  }
  async stop() {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(0);
  }
}

export const Haptics = registerPlugin<HapticsPlugin>('Haptics', { web: () => new HapticsWeb() });
