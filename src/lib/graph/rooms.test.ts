import { describe, expect, it } from 'vitest';
import type { ScanResult } from '../scan/types';
import { findRoute } from './astar';
import { destinations, GraphIndex } from './graph';
import { addScannedRoom, deleteRoom, emptyPlace, renameRoom } from './rooms';
import { buildSteps, stepText } from '../nav/guidance';

const rect = (w: number, h: number) => [
  { x: -w / 2, y: -h / 2 },
  { x: w / 2, y: -h / 2 },
  { x: w / 2, y: h / 2 },
  { x: -w / 2, y: h / 2 },
];

function scan(id: string, openings: ScanResult['openings']): ScanResult {
  return {
    scanId: id,
    capturedAt: 0,
    floorPolygon: rect(4, 4),
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

// Two 4×4 rooms that share one door, each scanned in its own frame.
const bedroom = scan('A', [
  { id: 'a1', category: 'door', position: { x: 2, y: 0 }, width: 0.9, normal: 0, confidence: 'high' },
]);
const closet = scan('B', [
  {
    id: 'b1',
    category: 'door',
    position: { x: 0, y: -2 },
    width: 0.88,
    normal: -Math.PI / 2,
    confidence: 'high',
  },
]);

describe('rooms', () => {
  it('connects a second room through the shared door and routes with spoken door names', () => {
    const first = addScannedRoom(emptyPlace(), bedroom, 'Bedroom');
    expect(first.joinedTo).toEqual([]);
    const second = addScannedRoom(first.graph, closet, 'Closet');
    expect(second.joinedTo).toEqual(['Bedroom']);

    const g = second.graph;
    expect(destinations(g).map((d) => d.label)).toEqual(['Bedroom', 'Closet']);
    const door = g.nodes.find((n) => n.kind === 'door')!;
    expect(door.label).toBe('the door between Bedroom and Closet');

    const index = new GraphIndex(g);
    const route = findRoute(index, destinations(g)[0]!.id, destinations(g)[1]!.id)!;
    const text = buildSteps(index, route).map((s) => stepText(s, { unit: 'meters' }));
    expect(text[0]).toBe('Walk 4 meters through the door between Bedroom and Closet to Closet.');
  });

  it('keeps an unmatched room separate instead of guessing', () => {
    const first = addScannedRoom(emptyPlace(), bedroom, 'Bedroom');
    const wide = scan('C', [
      {
        id: 'c1',
        category: 'opening',
        position: { x: 0, y: -2 },
        width: 2.5,
        normal: -Math.PI / 2,
        confidence: 'high',
      },
    ]);
    const r = addScannedRoom(first.graph, wide, 'Hall');
    expect(r.joinedTo).toEqual([]);
  });

  it('renames a room and its doors', () => {
    const a = addScannedRoom(emptyPlace(), bedroom, 'Bedroom');
    const b = addScannedRoom(a.graph, closet, 'Closet');
    const g = renameRoom(b.graph, b.roomId, 'Wardrobe');
    expect(destinations(g).map((d) => d.label)).toEqual(['Bedroom', 'Wardrobe']);
    expect(g.nodes.find((n) => n.kind === 'door')!.label).toBe('the door between Bedroom and Wardrobe');
    expect(g.rooms.map((r) => r.name)).toEqual(['Bedroom', 'Wardrobe']);
  });

  it('deletes a room but keeps the door for its neighbour', () => {
    const a = addScannedRoom(emptyPlace(), bedroom, 'Bedroom');
    const b = addScannedRoom(a.graph, closet, 'Closet');
    const g = deleteRoom(b.graph, b.roomId);
    expect(destinations(g).map((d) => d.label)).toEqual(['Bedroom']);
    expect(g.nodes.filter((n) => n.kind === 'door').map((n) => n.label)).toEqual(['Bedroom door']);
    expect(
      g.edges.every((e) => g.nodes.some((n) => n.id === e.from) && g.nodes.some((n) => n.id === e.to)),
    ).toBe(true);
    expect(g.placements.map((p) => p.scanId)).toEqual(['A']);
  });
});
