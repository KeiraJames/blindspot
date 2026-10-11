import { describe, expect, it } from 'vitest';
import { buildMapleHall } from '../../test/fixtures/mapleHall';
import type { ARPose } from '../../plugins/arnav';
import { PoseAdapter, arToLocal, yawToBearing } from './poseAdapter';

const ar = (x: number, y: number, z: number, yaw: number): ARPose => ({
  x,
  y,
  z,
  yaw,
  tracking: 'normal',
  relocalized: false,
  timestamp: 0,
});

describe('PoseAdapter', () => {
  it('converts ARKit axes to the plan frame', () => {
    expect(arToLocal({ x: 1, z: -2 })).toEqual({ x: 1, y: 2 });
    expect(yawToBearing(0)).toBeCloseTo(Math.PI / 2);
    expect(yawToBearing(Math.PI / 2)).toBeCloseTo(Math.PI);
  });

  it('anchors at a node and follows walking', () => {
    const a = new PoseAdapter(buildMapleHall());
    // Phone at session origin facing −z; user says they are at the entrance facing north (+y).
    a.anchorAt(ar(0, 0, 0, 0), { x: 0, y: 0 }, 'g', Math.PI / 2);
    // Walk 5 m forward (−z in AR) → lobby at (0, 5).
    const p = a.toMap(ar(0, 0, -5, 0))!;
    expect(p.position.x).toBeCloseTo(0);
    expect(p.position.y).toBeCloseTo(5);
    expect(p.heading).toBeCloseTo(Math.PI / 2);
    expect(p.floorId).toBe('g');
  });

  it('handles a rotated session frame', () => {
    const a = new PoseAdapter(buildMapleHall());
    // In the session the user faces +x (yaw −90°) but on the map they face north.
    a.anchorAt(ar(2, 0, 3, -Math.PI / 2), { x: 0, y: 0 }, 'g', Math.PI / 2);
    const p = a.toMap(ar(6, 0, 3, -Math.PI / 2))!; // 4 m along session +x
    expect(p.position.x).toBeCloseTo(0);
    expect(p.position.y).toBeCloseTo(4);
  });

  it('detects floor changes from height', () => {
    const a = new PoseAdapter(buildMapleHall());
    a.anchorAt(ar(0, 1.4, 0, 0), { x: 20, y: 12 }, 'g', 0);
    expect(a.toMap(ar(0, 1.4 + 3.1, 0, 0))!.floorId).toBe('f1');
    expect(a.toMap(ar(0, 1.4 + 1.0, 0, 0))!.floorId).toBe('g');
  });

  it('round-trips map → session → map', () => {
    const a = new PoseAdapter(buildMapleHall());
    a.anchorAt(ar(1, 1.4, 1, 0.3), { x: 10, y: 10 }, 'g', 1.0);
    const s = a.toSession({ x: 12, y: 7 }, 0)!;
    const back = a.toMap(ar(s.x, 1.4, s.z, 0))!;
    expect(back.position.x).toBeCloseTo(12);
    expect(back.position.y).toBeCloseTo(7);
  });

  it('recenters translation', () => {
    const a = new PoseAdapter(buildMapleHall());
    a.anchorAt(ar(0, 0, 0, 0), { x: 0, y: 0 }, 'g', Math.PI / 2);
    a.recenter(ar(0, 0, -4, 0), { x: 0, y: 5 });
    expect(a.toMap(ar(0, 0, -4, 0))!.position.y).toBeCloseTo(5);
  });
});
