import { registerPlugin, WebPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { Gesture } from '../lib/gestures/recognizer';

/** ARKit camera pose in the session's world frame (meters, radians). */
export interface ARPose {
  x: number;
  y: number;
  z: number;
  /** Rotation about +y (gravity up), radians; 0 = facing -z, positive = turned left. */
  yaw: number;
  tracking: 'normal' | 'limited' | 'notAvailable';
  reason?: 'initializing' | 'excessiveMotion' | 'insufficientFeatures' | 'relocalizing';
  /** True once a loaded ARWorldMap has relocalized. */
  relocalized: boolean;
  timestamp: number;
}

export interface ARNavStartOptions {
  /** Local path to a serialized ARWorldMap for relocalization. */
  worldMapPath?: string;
  /** Pose events per second (default 10). */
  poseRate?: number;
  /** Show the camera feed (low-vision users) or keep a black screen (saves battery, privacy). */
  showCamera?: boolean;
  /** Enable the native direct-touch gesture layer (works with VoiceOver on). */
  nativeGestures?: boolean;
}

export interface ARNavPlugin {
  isSupported(): Promise<{ worldTracking: boolean; sceneDepth: boolean; meshReconstruction: boolean }>;
  /** Start the AR session as a full-screen native view behind the transparent web view. */
  start(options: ARNavStartOptions): Promise<void>;
  stop(): Promise<void>;
  /** Draw an AR guide path (session frame points) for low-vision users. Empty array clears it. */
  setGuidePath(options: { points: { x: number; y: number; z: number }[] }): Promise<void>;
  /** Save the current world map (used after scanning a room in navigator mode). */
  saveWorldMap(options: { name: string }): Promise<{ path: string }>;
  addListener(event: 'pose', cb: (p: ARPose) => void): Promise<PluginListenerHandle>;
  addListener(event: 'gesture', cb: (e: { gesture: Gesture }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'interrupted', cb: (e: { interrupted: boolean }) => void): Promise<PluginListenerHandle>;
}

class ARNavWeb extends WebPlugin implements ARNavPlugin {
  async isSupported() {
    return { worldTracking: false, sceneDepth: false, meshReconstruction: false };
  }
  async start(): Promise<void> {
    throw this.unavailable('ARKit is only available in the iOS app. Use the walk simulator instead.');
  }
  async stop() {}
  async setGuidePath() {}
  async saveWorldMap(): Promise<{ path: string }> {
    throw this.unavailable('ARKit is only available in the iOS app.');
  }
}

export const ARNav = registerPlugin<ARNavPlugin>('ARNav', { web: () => new ARNavWeb() });
