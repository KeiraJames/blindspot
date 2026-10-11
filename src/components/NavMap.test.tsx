import { describe, expect, it } from 'vitest';
import { buildSampleHome } from '../data/sampleHome';
import { findRoute } from '../lib/graph/astar';
import { GraphIndex } from '../lib/graph/graph';
import { buildMapleHall } from '../test/fixtures/mapleHall';
import { splitRoute } from './NavMap';

describe('splitRoute', () => {
  it('splits the route at the walker', () => {
    const index = new GraphIndex(buildSampleHome());
    const route = findRoute(index, 'kitchen', 'closet')!.nodeIds;
    // Halfway along the hallway (from x = -1 to x = 6 at y = 0).
    const r = splitRoute(index.nodes, route, { floorId: 'home', position: { x: 2.5, y: 0.1 } });
    expect(r.walked.at(-1)).toEqual({ x: 2.5, y: 0 });
    expect(r.ahead[0]).toEqual({ x: 2.5, y: 0.1 });
    expect(r.ahead.at(-1)).toEqual(index.node('closet').position);
    expect(r.leavesFloor).toBe(false);
  });

  it('stops at a floor change', () => {
    const index = new GraphIndex(buildMapleHall());
    const route = findRoute(index, 'g-lobby', 'f1-202')!.nodeIds;
    const r = splitRoute(index.nodes, route, { floorId: 'g', position: { x: 0, y: 6 } });
    expect(r.leavesFloor).toBe(true);
    expect(r.ahead.at(-1)).toEqual(index.node('g-stairs').position);
  });
});
