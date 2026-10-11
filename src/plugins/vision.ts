import { registerPlugin, WebPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface HazardEvent {
  kind: 'obstacle' | 'person' | 'stairs' | 'door' | 'drop';
  /** Meters from the camera, when depth is known. */
  distance?: number;
  /** Bearing relative to where the phone points, radians (positive = left). */
  relativeBearing: number;
  confidence: number;
  source: 'lidar' | 'vision' | 'coreml';
}

export interface VisionConfig {
  /** Target detections per second; the native side lowers it when the device is hot. */
  rate?: number;
  detectPeople?: boolean;
  /** Read room numbers and signs (VNRecognizeTextRequest). */
  detectText?: boolean;
  /** LiDAR depth check for obstacles straight ahead. */
  depthObstacles?: boolean;
  /** Obstacle warning distance in meters. */
  obstacleDistance?: number;
  /** Use the bundled Core ML detector (doors, stairs) if PathSenseDetector.mlmodelc is present. */
  customModel?: boolean;
}

export interface VisionPlugin {
  /** Configure on-device detection that runs on ARNav camera frames (Neural Engine). */
  configure(config: VisionConfig): Promise<{ customModelLoaded: boolean }>;
  setEnabled(options: { enabled: boolean }): Promise<void>;
  addListener(event: 'hazard', cb: (e: HazardEvent) => void): Promise<PluginListenerHandle>;
  addListener(
    event: 'text',
    cb: (e: { text: string; confidence: number; relativeBearing: number }) => void,
  ): Promise<PluginListenerHandle>;
  /** Nearest surface in the left, middle and right of the view, in meters (LiDAR phones). */
  addListener(
    event: 'clearance',
    cb: (e: { left?: number; center?: number; right?: number }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'thermal',
    cb: (e: { state: 'nominal' | 'fair' | 'serious' | 'critical'; rate: number }) => void,
  ): Promise<PluginListenerHandle>;
}

class VisionWeb extends WebPlugin implements VisionPlugin {
  async configure() {
    return { customModelLoaded: false };
  }
  async setEnabled() {}
}

export const Vision = registerPlugin<VisionPlugin>('Vision', { web: () => new VisionWeb() });
