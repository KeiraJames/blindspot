import type { ARPose } from '../../plugins/arnav';
import { applyTransform, invertTransform, wrapAngle } from '../graph/geometry';
import type { Floor, MapGraph, Transform2D, Vec2 } from '../graph/types';
import type { MapPose } from './tracker';

/** ARKit world (x right, y up, camera looks −z) → plan frame of that session (x, y = −z). */
export function arToLocal(p: { x: number; z: number }): Vec2 {
  return { x: p.x, y: -p.z };
}

/** ARKit yaw (0 = facing −z, positive = turned left) → plan bearing (CCW from +x). */
export function yawToBearing(yaw: number): number {
  return wrapAngle(Math.PI / 2 + yaw);
}

/**
 * Converts ARKit session poses into map-frame poses. The session frame is tied to the map
 * either by a relocalized ARWorldMap (the scan's placement transform) or by anchoring the
 * first pose to a known node ("I'm at the entrance, facing the route").
 */
export class PoseAdapter {
  private transform: Transform2D | null = null;
  private refY = 0;
  private refElevation = 0;

  constructor(private graph: MapGraph) {}

  get anchored(): boolean {
    return this.transform !== null;
  }

  /** Use the placement of the scan whose world map relocalized the session. */
  anchorToScan(scanId: string, currentY: number): boolean {
    const placement = this.graph.placements.find((p) => p.scanId === scanId);
    if (!placement) return false;
    this.transform = placement.transform;
    const floor = this.graph.floors.find((f) => f.id === placement.floorId);
    // Camera height above the floor stays roughly constant while walking.
    this.refY = currentY;
    this.refElevation = floor?.elevation ?? 0;
    return true;
  }

  /** Anchor so the given AR pose sits at `position` on `floorId`, facing `bearing`. */
  anchorAt(pose: ARPose, position: Vec2, floorId: string, bearing: number) {
    const local = arToLocal(pose);
    const theta = wrapAngle(bearing - yawToBearing(pose.yaw));
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    this.transform = {
      theta,
      tx: position.x - (c * local.x - s * local.y),
      ty: position.y - (s * local.x + c * local.y),
    };
    this.refY = pose.y;
    this.refElevation = this.graph.floors.find((f) => f.id === floorId)?.elevation ?? 0;
  }

  /** Shift the translation so the current pose maps to `position`, keeping rotation. */
  recenter(pose: ARPose, position: Vec2) {
    if (!this.transform) return;
    const now = applyTransform(this.transform, arToLocal(pose));
    this.transform = { ...this.transform, tx: this.transform.tx + position.x - now.x, ty: this.transform.ty + position.y - now.y };
  }

  floorFor(elevation: number): Floor {
    let best = this.graph.floors[0]!;
    for (const f of this.graph.floors) if (Math.abs(f.elevation - elevation) < Math.abs(best.elevation - elevation)) best = f;
    return best;
  }

  toMap(pose: ARPose): MapPose | null {
    if (!this.transform) return null;
    const elevation = this.refElevation + (pose.y - this.refY);
    return {
      floorId: this.floorFor(elevation).id,
      position: applyTransform(this.transform, arToLocal(pose)),
      heading: wrapAngle(yawToBearing(pose.yaw) + this.transform.theta),
      tracking: pose.tracking === 'normal' ? 'normal' : pose.tracking === 'limited' ? 'limited' : 'lost',
      timestamp: pose.timestamp,
    };
  }

  /** Map point → AR session point, for drawing the guide path in AR. */
  toSession(p: Vec2, elevation: number, cameraHeight = 1.4): { x: number; y: number; z: number } | null {
    if (!this.transform) return null;
    const local = applyTransform(invertTransform(this.transform), p);
    return { x: local.x, y: this.refY - cameraHeight + (elevation - this.refElevation), z: -local.y };
  }
}
