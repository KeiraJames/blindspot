import { describe, expect, it } from 'vitest';
import { buildMapleHall } from '../../test/fixtures/mapleHall';
import { DEFAULT_PREFERENCES, edgeCost, findRoute, nearestNode, nearestOfType } from './astar';
import { GraphIndex } from './graph';
import type { MapGraph } from './types';

const idx = () => new GraphIndex(buildMapleHall());

/** Reference Dijkstra used to check A* optimality. */
function dijkstraCost(index: GraphIndex, start: string, goal: string, prefs = DEFAULT_PREFERENCES): number {
  const d = new Map<string, number>([[start, 0]]);
  const done = new Set<string>();
  for (;;) {
    let cur: string | null = null;
    for (const [k, v] of d) if (!done.has(k) && (cur === null || v < d.get(cur)!)) cur = k;
    if (cur === null) return Infinity;
    if (cur === goal) return d.get(cur)!;
    done.add(cur);
    for (const { edge, to } of index.adjacency.get(cur) ?? []) {
      const c = edgeCost(edge, prefs);
      if (!Number.isFinite(c)) continue;
      const t = d.get(cur)! + c;
      if (t < (d.get(to) ?? Infinity)) d.set(to, t);
    }
  }
}

describe('findRoute', () => {
  it('routes within a floor', () => {
    const r = findRoute(idx(), 'g-entrance', 'g-kit')!;
    expect(r.nodeIds[0]).toBe('g-entrance');
    expect(r.nodeIds.at(-1)).toBe('g-kit');
    expect(r.nodeIds).toContain('g-kitd');
    expect(r.length).toBeGreaterThan(15);
  });

  it('prefers stairs by default and elevator when avoiding stairs', () => {
    const index = idx();
    const viaStairs = findRoute(index, 'g-lobby', 'f1-202')!;
    expect(viaStairs.edges.some((e) => e.kind === 'stairs')).toBe(true);
    const noStairs = findRoute(index, 'g-lobby', 'f1-202', { ...DEFAULT_PREFERENCES, avoidStairs: true })!;
    expect(noStairs.edges.some((e) => e.kind === 'stairs')).toBe(false);
    expect(noStairs.edges.some((e) => e.kind === 'elevator')).toBe(true);
  });

  it('switches to elevator when the stair penalty is high', () => {
    const r = findRoute(idx(), 'g-lobby', 'f1-202', { ...DEFAULT_PREFERENCES, stairPenalty: 100 })!;
    expect(r.edges.some((e) => e.kind === 'elevator')).toBe(true);
  });

  it('matches Dijkstra cost for every pair (optimality)', () => {
    const index = idx();
    const ids = [...index.nodes.keys()];
    for (const a of ids) {
      for (const b of ids) {
        const r = findRoute(index, a, b);
        expect(r?.cost ?? Infinity).toBeCloseTo(dijkstraCost(index, a, b), 6);
      }
    }
  });

  it('returns null when unreachable and for unknown nodes', () => {
    const g: MapGraph = buildMapleHall();
    g.edges = g.edges.filter((e) => e.kind !== 'stairs' && e.kind !== 'elevator');
    expect(findRoute(new GraphIndex(g), 'g-lobby', 'f1-202')).toBeNull();
    expect(findRoute(idx(), 'nope', 'g-lobby')).toBeNull();
  });

  it('respects one-way edges', () => {
    const g = buildMapleHall();
    g.edges = g.edges.map((e) => (e.id === 'e-g-lobby-g-j1' ? { ...e, oneWay: true } : e));
    const index = new GraphIndex(g);
    expect(findRoute(index, 'g-lobby', 'g-j1')).not.toBeNull();
    expect(findRoute(index, 'g-j1', 'g-lobby')).toBeNull();
  });

  it('handles start === goal', () => {
    expect(findRoute(idx(), 'g-lobby', 'g-lobby')).toMatchObject({ nodeIds: ['g-lobby'], length: 0 });
  });
});

describe('nearest helpers', () => {
  it('finds the nearest node on a floor', () => {
    expect(nearestNode(idx(), 'g', { x: 9.6, y: 5.2 })).toBe('g-kit');
  });

  it('finds the nearest exit by walking cost, not straight line', () => {
    const index = idx();
    const r = nearestOfType(index, 'g-bath', (id) => index.node(id).poiType === 'exit')!;
    expect(r.nodeIds.at(-1)).toBe('g-side');
    const r2 = nearestOfType(index, 'g-ra', (id) => index.node(id).poiType === 'exit')!;
    expect(r2.nodeIds.at(-1)).toBe('g-entrance');
  });
});
