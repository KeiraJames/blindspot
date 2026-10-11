import { registerPlugin, WebPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { ScanResult } from '../lib/scan/types';
import { syntheticScan } from '../lib/scan/synthetic';

export type ScanInstruction =
  'moveCloseToWall' | 'moveAwayFromWall' | 'slowDown' | 'turnOnLight' | 'normal' | 'lowTexture';

export interface ScanProgress {
  /** Rough coverage 0..1 (walls found vs. expected; see ScanPlugin.swift). */
  coverage: number;
  tracking: 'normal' | 'limited' | 'notAvailable';
  trackingReason?: 'initializing' | 'excessiveMotion' | 'insufficientFeatures' | 'relocalizing';
  walls: number;
  doors: number;
  openings: number;
  stairs: number;
}

export interface ScanPlugin {
  /** RoomPlan needs a LiDAR device on iOS 16+. */
  isSupported(): Promise<{ supported: boolean; reason?: string }>;
  /** Present the native RoomPlan capture screen. Resolves with the processed room when the user taps Done. */
  startCapture(options?: { scanId?: string; detectText?: boolean }): Promise<{ result: ScanResult }>;
  /** Finish capture from JS (same as tapping Done). */
  finishCapture(): Promise<void>;
  cancelCapture(): Promise<void>;
  /** Delete local files of a scan after upload. */
  deleteScanFiles(options: { scanId: string }): Promise<void>;
  addListener(
    event: 'instruction',
    cb: (e: { instruction: ScanInstruction }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(event: 'progress', cb: (e: ScanProgress) => void): Promise<PluginListenerHandle>;
  addListener(
    event: 'landmark',
    cb: (e: { kind: 'room_number' | 'sign'; text: string; confidence: number }) => void,
  ): Promise<PluginListenerHandle>;
}

class ScanWeb extends WebPlugin implements ScanPlugin {
  private cancel: (() => void) | null = null;
  private finish: (() => void) | null = null;

  async isSupported() {
    if (import.meta.env.DEV || import.meta.env.VITE_ENABLE_SCAN_SIMULATOR === 'true') {
      return { supported: true, reason: 'simulated' };
    }
    return {
      supported: false,
      reason: 'Scanning needs an iPhone or iPad Pro with LiDAR running the BlindSpöt app.',
    };
  }

  /** Development simulator: emits coach instructions and progress, then returns a synthetic room. */
  async startCapture(options: { scanId?: string } = {}) {
    const scanId = options.scanId ?? `scan_${Date.now().toString(36)}`;
    const instructions: ScanInstruction[] = ['normal', 'moveCloseToWall', 'slowDown', 'normal'];
    return new Promise<{ result: ScanResult }>((resolve, reject) => {
      let step = 0;
      const timer = setInterval(() => {
        step++;
        this.notifyListeners('progress', {
          coverage: Math.min(1, step / 8),
          tracking: 'normal',
          walls: Math.min(4, step),
          doors: step > 3 ? 1 : 0,
          openings: step > 5 ? 1 : 0,
          stairs: 0,
        } satisfies ScanProgress);
        if (step % 2 === 0)
          this.notifyListeners('instruction', {
            instruction: instructions[(step / 2) % instructions.length],
          });
        if (step === 4)
          this.notifyListeners('landmark', { kind: 'room_number', text: '214', confidence: 0.92 });
        if (step >= 8) done();
      }, 600);
      const done = () => {
        clearInterval(timer);
        this.finish = this.cancel = null;
        resolve({ result: syntheticScan(scanId) });
      };
      this.finish = done;
      this.cancel = () => {
        clearInterval(timer);
        this.finish = this.cancel = null;
        reject(new Error('cancelled'));
      };
    });
  }
  async finishCapture() {
    this.finish?.();
  }
  async cancelCapture() {
    this.cancel?.();
  }
  async deleteScanFiles() {}
}

export const Scan = registerPlugin<ScanPlugin>('Scan', { web: () => new ScanWeb() });
