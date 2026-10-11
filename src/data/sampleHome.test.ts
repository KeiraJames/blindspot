import { describe, expect, it } from 'vitest';
import { findRoute } from '../lib/graph/astar';
import { destinations, GraphIndex } from '../lib/graph/graph';
import { validateGraph } from '../lib/graph/validate';
import { buildSteps, stepText } from '../lib/nav/guidance';
import { buildSampleHome } from './sampleHome';

describe('sample home', () => {
  const graph = buildSampleHome();
  const index = new GraphIndex(graph);

  it('offers exactly four destinations', () => {
    expect(destinations(graph).map((d) => d.label)).toEqual(['Bathroom', 'Bedroom', 'Closet', 'Kitchen']);
  });

  it('has no errors; the only warning is the missing exit', () => {
    const r = validateGraph(graph);
    expect(r.ok).toBe(true);
    expect(r.issues.map((i) => i.code)).toEqual(['no_exit']);
  });

  it('routes between every pair of places', () => {
    const ids = destinations(graph).map((d) => d.id);
    for (const a of ids) for (const b of ids) expect(findRoute(index, a, b)).not.toBeNull();
  });

  it('reaches the closet through the bedroom', () => {
    const route = findRoute(index, 'kitchen', 'closet')!;
    expect(route.nodeIds).toContain('bedroom');
    const text = buildSteps(index, route).map((s) => stepText(s, { unit: 'meters' }));
    expect(text.at(-1)).toBe('You have arrived at Closet.');
    expect(text.join(' ')).toMatch(/through Kitchen door/);
  });
});
