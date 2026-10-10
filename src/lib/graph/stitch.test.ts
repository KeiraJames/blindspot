import { describe, expect, it } from 'vitest';
import type { ScanResult } from '../scan/types';
import { applyTransform, wrapAngle } from './geometry';
import { GraphIndex } from './graph';
import { findRoute } from './astar';
import { alignByDoor, placeScan, proposeDoorMatches, umeyama2D } from './stitch';
import { emptyGraph, type Transform2D } from './types';
import { validateGraph } from './validate';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

function rect(w: number, h: number) {
  return [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ];
}

function scan(id: string, openings: ScanResult['openings'], w = 4, h = 4): ScanResult {
  return {
    scanId: id,
    capturedAt: 0,
    floorPolygon: rect(w, h),
    walls: [],
    openings,
    windows: [],
    stairs: [],
    objects: [],
    landmarks: [],
    floorHeight: -1.4,
    quality: 0.9,
    files: {},
  };
}

describe('umeyama2D', () => {
  it('recovers a known rigid transform', () => {
    const truth: Transform2D = { theta: 0.7, tx: 3, ty: -2 };
    const src = [
      { x: 0, y: 0 },
      { x: 2, y: 1 },
      { x: -1, y: 4 },
      { x: 5, y: -3 },
    ];
    const dst = src.map((p) => applyTransform(truth, p));
    const r = umeyama2D(src, dst);
    close(r.theta, truth.theta);
    close(r.tx, truth.tx);
    close(r.ty, truth.ty);
    close(r.rms, 0);
  });

  it('is least-squares under noise', () => {
    const truth: Transform2D = { theta: -1.2, tx: 0.5, ty: 7 };
    const src = Array.from({ length: 30 }, (_, i) => ({ x: Math.cos(i) * i, y: Math.sin(i * 1.3) * 5 }));
    const dst = src.map((p, i) => {
      const q = applyTransform(truth, p);
      return { x: q.x + ((i * 7) % 5) * 0.01 - 0.02, y: q.y + ((i * 3) % 5) * 0.01 - 0.02 };
    });
    const r = umeyama2D(src, dst);
    expect(Math.abs(wrapAngle(r.theta - truth.theta))).toBeLessThan(0.01);
    expect(r.rms).toBeLessThan(0.05);
  });

  it('uses the fallback rotation with one correspondence', () => {
    const r = umeyama2D([{ x: 1, y: 1 }], [{ x: 4, y: 5 }], Math.PI / 2);
    close(r.theta, Math.PI / 2);
    const p = applyTransform(r, { x: 1, y: 1 });
    close(p.x, 4);
    close(p.y, 5);
  });
});

describe('alignByDoor', () => {
  it('puts doors face to face', () => {
    const t = alignByDoor({ x: 10, y: 0 }, 0, { x: 0, y: -2 }, -Math.PI / 2);
    const p = applyTransform(t, { x: 0, y: -2 });
    close(p.x, 10);
    close(p.y, 0);
    // new normal = -π/2 + θ should point back toward -x (π)
    close(Math.abs(wrapAngle(-Math.PI / 2 + t.theta)), Math.PI);
  });
});

describe('placeScan + proposeDoorMatches', () => {
  it('stitches two rooms through a shared door and routes across them', () => {
    // Room A: 4x4 with a door on its east wall (x = +2).
    const a = scan('A', [{ id: 'a1', category: 'door', position: { x: 2, y: 0 }, width: 0.9, normal: 0, confidence: 'high' }]);
    let g = placeScan(emptyGraph(), a, { floorId: 'f0', name: 'Room A', transform: { theta: 0, tx: 0, ty: 0 } });

    // Room B scanned in its own frame (rotated arbitrarily): door on its south wall.
    const b = scan('B', [
      { id: 'b1', category: 'door', position: { x: 0, y: -2 }, width: 0.92, normal: Math.PI / 2, confidence: 'high' }, // normal wrong way on purpose
      { id: 'b2', category: 'opening', position: { x: 0, y: 2 }, width: 1.5, normal: Math.PI / 2, confidence: 'medium' },
    ]);
    const candidates = proposeDoorMatches(g, 'f0', b);
    expect(candidates.length).toBeGreaterThan(0);
    const best = candidates[0]!;
    expect(best.scanOpeningId).toBe('b1');
    expect(best.overlap).toBe(0);

    g = placeScan(g, b, {
      floorId: 'f0',
      name: 'Room B',
      transform: best.transform,
      doorPairs: [{ placedDoorId: best.placedDoorId, scanOpeningId: best.scanOpeningId }],
    });

    const index = new GraphIndex(g);
    const roomA = g.nodes.find((n) => n.label === 'Room A')!;
    const roomB = g.nodes.find((n) => n.label === 'Room B')!;
    // B's centroid should be 2 m beyond the shared door on +x.
    close(roomB.position.x, 4, 1e-6);
    close(roomB.position.y, 0, 1e-6);
    const route = findRoute(index, roomA.id, roomB.id)!;
    expect(route.nodeIds).toHaveLength(3);
    close(route.length, 4, 1e-6);

    const shared = g.nodes.filter((n) => n.kind === 'door' && (n.roomIds?.length ?? 0) === 2);
    expect(shared).toHaveLength(1);
    // Only B's far opening remains unmatched.
    const issues = validateGraph(g).issues.filter((i) => i.code === 'unmatched_door');
    expect(issues).toHaveLength(1);
    expect(g.placements.map((p) => p.scanId)).toEqual(['A', 'B']);
  });

  it('ranks candidates that overlap existing rooms lower', () => {
    const a = scan('A', [
      { id: 'a1', category: 'door', position: { x: 2, y: 0 }, width: 0.9, normal: 0, confidence: 'high' },
    ]);
    const g = placeScan(emptyGraph(), a, { floorId: 'f0', name: 'A', transform: { theta: 0, tx: 0, ty: 0 } });
    // B's door is in its centre: any alignment pushes half the room into A.
    const b = scan('B', [{ id: 'b1', category: 'door', position: { x: 0, y: 0 }, width: 0.9, normal: 0, confidence: 'high' }]);
    const c = proposeDoorMatches(g, 'f0', b);
    expect(c[0]!.overlap).toBeGreaterThan(0.2);
  });
});
