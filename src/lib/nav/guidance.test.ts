import { describe, expect, it } from 'vitest';
import { buildMapleHall } from '../../test/fixtures/mapleHall';
import { DEFAULT_PREFERENCES, findRoute } from '../graph/astar';
import { GraphIndex } from '../graph/graph';
import { approachText, buildSteps, classifyTurn, routeSummary, stepText } from './guidance';
import { formatDistance } from './units';

const deg = (d: number) => (d * Math.PI) / 180;
const opts = { unit: 'meters' as const };

describe('classifyTurn', () => {
  it.each([
    [0, 'straight'],
    [20, 'straight'],
    [-24, 'straight'],
    [40, 'slight_left'],
    [-40, 'slight_right'],
    [90, 'left'],
    [-90, 'right'],
    [140, 'sharp_left'],
    [-140, 'sharp_right'],
    [175, 'u_turn'],
    [-170, 'u_turn'],
  ])('%s° → %s', (d, expected) => expect(classifyTurn(deg(d))).toBe(expected));
});

describe('buildSteps', () => {
  const index = new GraphIndex(buildMapleHall());

  it('produces depart → turns → arrive on one floor', () => {
    const route = findRoute(index, 'g-entrance', 'g-kit')!;
    const steps = buildSteps(index, route);
    expect(steps[0]!.kind).toBe('depart');
    expect(steps.at(-1)!.kind).toBe('arrive');
    // Entrance → lobby → hallway (north), then right (east), then right again (south into kitchen).
    const turns = steps.filter((s) => s.kind === 'turn').map((s) => s.turn);
    expect(turns).toEqual(['right', 'right']);
    const walked = steps.reduce((s, x) => s + x.distanceAfter, 0);
    expect(walked).toBeCloseTo(route.length, 6);
    expect(stepText(steps.at(-1)!, opts)).toBe('You have arrived at Kitchen.');
  });

  it('emits a floor change with direction and floor name', () => {
    const route = findRoute(index, 'g-lobby', 'f1-202')!;
    const steps = buildSteps(index, route);
    const fc = steps.find((s) => s.kind === 'floor_change')!;
    expect(fc.floorChange).toMatchObject({
      via: 'stairs',
      direction: 'up',
      floors: 1,
      toFloorName: 'Floor 1',
    });
    expect(stepText(fc, opts)).toBe('Take the stairs up to Floor 1.');
    expect(approachText(fc, 6, opts)).toBe('Stairs in 6 meters. Going up to Floor 1.');
  });

  it('says elevator when avoiding stairs, and going down', () => {
    const route = findRoute(index, 'f1-201', 'g-kit', { ...DEFAULT_PREFERENCES, avoidStairs: true })!;
    const fc = buildSteps(index, route).find((s) => s.kind === 'floor_change')!;
    expect(stepText(fc, opts)).toBe('Take the elevator down to Ground floor.');
  });

  it('summarizes routes', () => {
    const route = findRoute(index, 'g-lobby', 'f1-202')!;
    const steps = buildSteps(index, route);
    expect(routeSummary(steps, route, opts, 'Room 202')).toMatch(
      /^Route to Room 202: \d+ meters, \d+ turns?, 1 floor change\.$/,
    );
  });

  it('handles a trivial one-edge route', () => {
    const route = findRoute(index, 'g-lobby', 'g-ra')!;
    const steps = buildSteps(index, route);
    expect(steps.map((s) => s.kind)).toEqual(['depart', 'arrive']);
    expect(stepText(steps[0]!, opts)).toBe('Walk 3 meters to RA desk.');
  });
});

describe('formatDistance', () => {
  it('rounds sensibly in each unit', () => {
    expect(formatDistance(0.4, 'meters')).toBe('1 meter');
    expect(formatDistance(7.6, 'meters')).toBe('8 meters');
    expect(formatDistance(23, 'meters')).toBe('25 meters');
    expect(formatDistance(3, 'feet')).toBe('10 feet');
    expect(formatDistance(7, 'steps')).toBe('10 steps');
    expect(formatDistance(7, 'steps', 0.5)).toBe('14 steps');
  });
});

describe('landmarks', () => {
  it('says "through" for doorways joining two rooms and "past" for hallway doors', () => {
    const g = buildMapleHall();
    g.nodes = g.nodes.map((n) => (n.id === 'g-101d' ? { ...n, roomIds: ['r-hall', 'r-101'] } : n));
    const index = new GraphIndex(g);
    const route = findRoute(index, 'g-j1', 'g-j3')!;
    expect(stepText(buildSteps(index, route)[0]!, opts)).toBe(
      'Walk 20 meters through Room 101 door to East hallway.',
    );
    const plain = new GraphIndex(buildMapleHall());
    expect(stepText(buildSteps(plain, findRoute(plain, 'g-j1', 'g-j3')!)[0]!, opts)).toBe(
      'Walk 20 meters past Room 101 door to East hallway.',
    );
  });

  it('never names the destination as something to walk through', () => {
    const index = new GraphIndex(buildMapleHall());
    const route = findRoute(index, 'g-entrance', 'f1-202')!;
    for (const s of buildSteps(index, route))
      expect(s.landmarks.map((l) => l.label)).not.toContain('Room 202');
  });
});
