import { describe, expect, it } from 'vitest';
import { buildSampleMap } from '../../data/sampleMap';
import { findRoute } from '../graph/astar';
import { bearing } from '../graph/geometry';
import { GraphIndex } from '../graph/graph';
import type { Vec2 } from '../graph/types';
import { buildSteps } from './guidance';
import { RouteTracker, type MapPose, type TrackerEvent } from './tracker';

const index = new GraphIndex(buildSampleMap());

function setup(from: string, to: string) {
  const route = findRoute(index, from, to)!;
  const steps = buildSteps(index, route);
  return { route, steps, tracker: new RouteTracker(index, route, steps) };
}

/** Walk the route polyline at 1.2 m/s, sampling every 200 ms, facing along the path. */
function walk(tracker: RouteTracker, opts: { offset?: Vec2; stopAt?: number } = {}) {
  const events: TrackerEvent[] = [];
  let t = 0;
  for (const seg of tracker.segments) {
    if (seg.vertical) {
      for (let k = 0; k < 5; k++) events.push(...tracker.update(pose(seg.a, 0, seg.floorId === 'f1' ? 'g' : 'f1', (t += 200))));
      events.push(...tracker.update(pose(seg.b, 0, seg.floorId, (t += 200))));
      continue;
    }
    const h = bearing(seg.a, seg.b);
    const n = Math.max(1, Math.ceil(seg.length / 0.24));
    for (let k = 1; k <= n; k++) {
      const p = { x: seg.a.x + ((seg.b.x - seg.a.x) * k) / n + (opts.offset?.x ?? 0), y: seg.a.y + ((seg.b.y - seg.a.y) * k) / n + (opts.offset?.y ?? 0) };
      events.push(...tracker.update(pose(p, h, seg.floorId, (t += 200))));
      if (opts.stopAt !== undefined && tracker.distanceTravelled >= opts.stopAt) return events;
    }
  }
  return events;
}

const pose = (position: Vec2, heading: number, floorId: string, timestamp: number): MapPose => ({
  position,
  heading,
  floorId,
  timestamp,
  tracking: 'normal',
});

describe('RouteTracker', () => {
  it('announces each turn once, approach before maneuver, then arrives', () => {
    const { tracker, steps } = setup('g-entrance', 'g-kit');
    const events = walk(tracker);
    const maneuvers = events.filter((e) => e.type === 'maneuver');
    expect(maneuvers).toHaveLength(steps.filter((s) => s.kind === 'turn').length);
    const firstApproach = events.findIndex((e) => e.type === 'approach');
    const firstManeuver = events.findIndex((e) => e.type === 'maneuver');
    expect(firstApproach).toBeGreaterThanOrEqual(0);
    expect(firstApproach).toBeLessThan(firstManeuver);
    expect(events.filter((e) => e.type === 'arrived')).toHaveLength(1);
    expect(events.some((e) => e.type === 'off_route')).toBe(false);
    expect(tracker.hasArrived).toBe(true);
  });

  it('handles floor changes', () => {
    const { tracker } = setup('g-lobby', 'f1-202');
    const events = walk(tracker);
    const kinds = events.map((e) => e.type);
    expect(kinds).toContain('floor_reached');
    expect(kinds.at(-1)).toBe("arrived");
    const fcIdx = events.findIndex((e) => e.type === 'maneuver' && e.step.kind === 'floor_change');
    expect(fcIdx).toBeGreaterThanOrEqual(0);
  });

  it('reports off-route after the grace period', () => {
    const { tracker } = setup('g-entrance', 'g-kit');
    walk(tracker, { stopAt: 6 });
    const out: TrackerEvent[] = [];
    for (let t = 0; t <= 3000; t += 250) out.push(...tracker.update(pose({ x: 6, y: 6 }, 0, 'g', 100000 + t)));
    expect(out.filter((e) => e.type === 'off_route')).toHaveLength(1);
  });

  it('tolerates small lateral drift', () => {
    const { tracker } = setup('g-entrance', 'g-kit');
    const events = walk(tracker, { offset: { x: 0.8, y: 0 } });
    expect(events.some((e) => e.type === 'off_route')).toBe(false);
  });

  it('detects veering once and recovery', () => {
    const { tracker } = setup('g-entrance', 'g-kit');
    const out: TrackerEvent[] = [];
    // Standing at the entrance facing east (route goes north) → should say bear left.
    for (let t = 0; t <= 2000; t += 200) out.push(...tracker.update(pose({ x: 0, y: 0.5 }, 0, 'g', t)));
    const veers = out.filter((e) => e.type === 'veer');
    expect(veers).toHaveLength(1);
    expect(veers[0]).toMatchObject({ direction: 'left' });
    out.push(...tracker.update(pose({ x: 0, y: 0.6 }, Math.PI / 2, 'g', 2200)));
    expect(out.at(-1)).toEqual({ type: 'on_course' });
  });

  it('reports tracking loss once and restoration', () => {
    const { tracker } = setup('g-entrance', 'g-kit');
    const lost = { ...pose({ x: 0, y: 0 }, 0, 'g', 0), tracking: 'lost' as const };
    expect(tracker.update(lost)).toEqual([{ type: 'tracking_lost' }]);
    expect(tracker.update({ ...lost, timestamp: 100 })).toEqual([]);
    expect(tracker.update(pose({ x: 0, y: 0.2 }, Math.PI / 2, 'g', 200))[0]).toEqual({ type: 'tracking_restored' });
  });
});

describe('prompt redundancy', () => {
  it('does not announce an approach already covered by the previous "then walk" prompt', () => {
    const { tracker } = setup('g-entrance', 'f1-202');
    const events = walk(tracker);
    const approaches = events.filter((e): e is Extract<TrackerEvent, { type: 'approach' }> => e.type === 'approach');
    for (const a of approaches) {
      const k = tracker.steps.indexOf(a.step);
      const prev = tracker.steps.slice(0, k).reverse().find((s) => s.kind !== 'arrive')!;
      expect(prev.distanceAfter).toBeGreaterThan(8);
    }
    expect(approaches.some((a) => a.step.kind === 'arrive')).toBe(false);
  });
});

describe('veer suppression', () => {
  it('does not report veering while following the route through corners', () => {
    const { tracker } = setup('g-entrance', 'f1-202');
    // Walk with the heading pointing at the next node (like a person turning early at a corner).
    const events: TrackerEvent[] = [];
    let t = 0;
    for (const seg of tracker.segments) {
      if (seg.vertical) {
        events.push(...tracker.update(pose(seg.b, 0, seg.floorId, (t += 200))));
        continue;
      }
      const n = Math.max(1, Math.ceil(seg.length / 0.24));
      for (let k = 1; k <= n; k++) {
        const p = { x: seg.a.x + ((seg.b.x - seg.a.x) * k) / n, y: seg.a.y + ((seg.b.y - seg.a.y) * k) / n };
        events.push(...tracker.update(pose(p, bearing(seg.a, seg.b), seg.floorId, (t += 200))));
      }
    }
    expect(events.filter((e) => e.type === 'veer')).toEqual([]);
  });
});
