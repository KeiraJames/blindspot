import type { Vec2 } from '../graph/types';

/**
 * Simplified RoomPlan capture as returned by ScanPlugin.
 * All positions are in the scan's local frame: ARKit x → plan x, ARKit -z → plan y.
 */
export interface ScannedOpening {
  id: string;
  category: 'door' | 'opening';
  position: Vec2;
  /** Clear width in meters. */
  width: number;
  /** Bearing of the wall normal, in radians. Normalized to point out of the room in JS. */
  normal: number;
  isOpen?: boolean;
  confidence: 'low' | 'medium' | 'high';
}

export interface ScannedStairs {
  id: string;
  position: Vec2;
  /** Footprint size in meters (width, depth). */
  size: { w: number; d: number };
  /** Bearing of the stair run (direction you face walking up), radians. */
  bearing: number;
  confidence: 'low' | 'medium' | 'high';
}

export interface ScannedObject {
  id: string;
  category: string;
  position: Vec2;
  size: { w: number; d: number; h: number };
}

export interface ScannedWall {
  start: Vec2;
  end: Vec2;
  height: number;
}

/** Labels proposed by the on-device Vision pass during capture (OCR'd room numbers etc.). */
export interface VisionLandmark {
  kind: 'room_number' | 'sign' | 'door' | 'stairs';
  text?: string;
  position?: Vec2;
  confidence: number;
}

export interface ScanResult {
  scanId: string;
  capturedAt: number;
  floorPolygon: Vec2[];
  walls: ScannedWall[];
  openings: ScannedOpening[];
  windows: { position: Vec2; width: number }[];
  stairs: ScannedStairs[];
  objects: ScannedObject[];
  landmarks: VisionLandmark[];
  /** ARKit y of the floor, so floors can be stacked. */
  floorHeight: number;
  /** Coverage estimate 0..1 from the capture session. */
  quality: number;
  files: {
    /** CapturedRoom JSON exported by RoomPlan. */
    roomJson?: string;
    /** USDZ parametric model for the 3D preview. */
    usdz?: string;
    /** Serialized ARWorldMap for relocalization. */
    worldMap?: string;
    /** Downsampled mesh (OBJ). */
    mesh?: string;
  };
}

export interface ScanDraft {
  id: string;
  mapId: string | null;
  name: string;
  floorId: string | null;
  result: ScanResult;
  status: 'draft' | 'uploading' | 'uploaded' | 'placed';
  uploadedPaths?: Partial<Record<keyof ScanResult['files'], string>>;
  createdAt: number;
}
