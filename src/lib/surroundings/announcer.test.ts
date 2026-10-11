import { describe, expect, it } from 'vitest';
import type { SurroundingItem } from '../../plugins/arnav';
import { direction, SurroundingsAnnouncer, tickInterval } from './announcer';

const make = () => new SurroundingsAnnouncer({ unit: 'meters' });
const door = (id: string, distance: number, relativeBearing = 0): SurroundingItem => ({
  id,
  kind: 'door',
  distance,
  relativeBearing,
  width: 0.9,
});

describe('direction', () => {
  it.each([
    [0, 'ahead'],
    [0.5, 'slightly left'],
    [-0.5, 'slightly right'],
    [1.2, 'on your left'],
    [-1.2, 'on your right'],
    [3, 'behind you'],
  ])('%s → %s', (b, w) => expect(direction(b)).toBe(w));
});

describe('obstacles', () => {
  it('says stop when something is right in front, at most every 3 s', () => {
    const a = make();
    expect(a.onClearance({ center: 0.6 }, 0)).toEqual([
      { cue: 'hazard', text: 'Stop. Something is right in front of you.', priority: 'high' },
    ]);
    expect(a.onClearance({ center: 0.6 }, 1000)).toEqual([]);
    expect(a.onClearance({ center: 0.6 }, 3100)).toHaveLength(1);
  });

  it('warns about something ahead, and again only if it gets clearly closer', () => {
    const a = make();
    expect(a.onClearance({ center: 1.5 }, 0)[0]!.text).toBe('Something ahead, 2 meters.');
    expect(a.onClearance({ center: 1.4 }, 500)).toEqual([]);
    expect(a.onClearance({ center: 0.95 }, 1000)[0]!.text).toBe('Something ahead, 1 meter.');
  });

  it('re-arms after the path ahead opens up', () => {
    const a = make();
    a.onClearance({ center: 1.2 }, 0);
    a.onClearance({ center: 3 }, 500);
    expect(a.onClearance({ center: 1.2 }, 1000)).toHaveLength(1);
  });

  it('mentions close things at the sides quietly', () => {
    const out = make().onClearance({ center: 3, left: 0.4 }, 0);
    expect(out).toEqual([{ cue: 'turnLeft', text: 'Something close on your left.', priority: 'low' }]);
  });
});

describe('doors and furniture', () => {
  it('announces a door once when seen and once on arrival', () => {
    const a = make();
    expect(a.onItems([door('d1', 3.4, 0.5)], 0).map((x) => x.text)).toEqual([
      'Door slightly left, 3 meters.',
    ]);
    expect(a.onItems([door('d1', 2.5, 0.4)], 500)).toEqual([]);
    expect(a.onItems([door('d1', 1.0, 0.1)], 1000).map((x) => x.text)).toEqual([
      'Door right in front of you.',
    ]);
    expect(a.onItems([door('d1', 0.8, 0)], 1500)).toEqual([]);
  });

  it('ignores far doors and mentions nearby chairs once', () => {
    const a = make();
    expect(a.onItems([door('far', 5.5)], 0)).toEqual([]);
    const chair: SurroundingItem = {
      id: 'c',
      kind: 'seat',
      distance: 1.5,
      relativeBearing: -1.2,
      width: 0.5,
    };
    expect(a.onItems([chair], 0).map((x) => x.text)).toEqual(['Chair on your right.']);
    expect(a.onItems([chair], 500)).toEqual([]);
  });

  it('describes recent surroundings without ever claiming the way is clear', () => {
    const a = make();
    a.onItems(
      [door('d1', 3, 0), { id: 't', kind: 'table', distance: 1.4, relativeBearing: 1.2, width: 1 }],
      0,
    );
    a.onClearance({ center: 4 }, 0);
    const text = a.describe(1000);
    expect(text).toBe(
      "Table on your left, 1 meter. Door ahead, 3 meters. I don't detect anything close in front of you, but keep using your cane.",
    );
    expect(text).not.toMatch(/\bclear\b/i);
  });
});

describe('people', () => {
  it('warns about nearby people with a cooldown', () => {
    const a = make();
    expect(a.onPerson(1.8, -0.5, 0)[0]!.text).toBe('Person slightly right, 2 meters.');
    expect(a.onPerson(1.7, -0.5, 1000)).toEqual([]);
    expect(a.onPerson(4, 0, 9000)).toEqual([]);
  });
});

describe('tickInterval', () => {
  it('ticks faster as things get closer and stops when far', () => {
    expect(tickInterval(undefined)).toBeNull();
    expect(tickInterval(3)).toBeNull();
    expect(tickInterval(2.5)).toBe(1000);
    expect(tickInterval(0.3)).toBe(150);
    expect(tickInterval(1)! < tickInterval(2)!).toBe(true);
  });
});
