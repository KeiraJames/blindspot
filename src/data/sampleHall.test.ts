import { describe, expect, it } from 'vitest';
import { spriteFor } from '../components/PixelArt';
import { findRoute } from '../lib/graph/astar';
import { destinations, GraphIndex } from '../lib/graph/graph';
import { validateGraph } from '../lib/graph/validate';
import { buildSteps, stepText } from '../lib/nav/guidance';
import { buildSampleHall } from './sampleHall';

describe('open hall sample', () => {
  const graph = buildSampleHall();
  const index = new GraphIndex(graph);
  const say = (from: string, to: string) =>
    buildSteps(index, findRoute(index, from, to)!).map((s) => stepText(s, { unit: 'meters' }));

  it('offers the hall landmarks as destinations, each with a sprite', () => {
    const d = destinations(graph);
    expect(d.map((x) => x.label)).toEqual([
      'Coffee table',
      'Entrance',
      'Seating area',
      'Stage',
      'Welcome desk',
    ]);
    expect(d.map((x) => spriteFor(x))).toEqual(['coffee', 'door', 'seat', 'stage', 'desk']);
  });

  it('is valid with no warnings', () => {
    expect(validateGraph(graph)).toMatchObject({ ok: true, issues: [] });
  });

  it('gives real turns across the open floor', () => {
    expect(say('entrance', 'coffee')).toEqual([
      'Walk 7 meters to Middle of the hall.',
      'Turn right, then walk 5 meters to Coffee table.',
      'You have arrived at Coffee table.',
    ]);
    expect(say('desk', 'stage')[1]).toMatch(/^Turn right, then walk 10 meters/);
  });
});
