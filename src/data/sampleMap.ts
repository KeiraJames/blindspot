import { edgeLengthBetween } from '../lib/graph/graph';
import type { EdgeKind, GraphEdge, GraphNode, MapGraph, NodeKind, PoiType } from '../lib/graph/types';

/**
 * Hand-authored two-floor dorm used for the Studio MVP, the web simulator and tests.
 * It is not hardcoded routing: the navigator still runs A* over this graph like any other.
 */
export function buildSampleMap(): MapGraph {
  const floors = [
    { id: 'g', name: 'Ground floor', level: 0, elevation: 0 },
    { id: 'f1', name: 'Floor 1', level: 1, elevation: 3.2 },
  ];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const n = (
    id: string,
    floorId: string,
    x: number,
    y: number,
    kind: NodeKind,
    label: string,
    extra: Partial<GraphNode> = {},
  ) => nodes.push({ id, floorId, position: { x, y }, kind, label, ...extra });
  const poi = (id: string, floorId: string, x: number, y: number, label: string, poiType: PoiType) =>
    n(id, floorId, x, y, 'poi', label, { poiType });

  // Ground floor
  n('g-entrance', 'g', 0, 0, 'door', 'Main entrance', {
    exterior: true,
    poiType: 'exit',
    width: 1.8,
    normal: -Math.PI / 2,
  });
  n('g-lobby', 'g', 0, 5, 'room', 'Lobby');
  poi('g-ra', 'g', -3, 6, 'RA desk', 'ra_desk');
  n('g-j1', 'g', 0, 10, 'junction', 'Lobby hallway');
  n('g-j2', 'g', 10, 10, 'junction', 'Middle hallway');
  n('g-j3', 'g', 20, 10, 'junction', 'East hallway');
  n('g-101d', 'g', 5, 11, 'door', 'Room 101 door', { width: 0.9 });
  n('g-101', 'g', 5, 15, 'room', 'Room 101');
  n('g-kitd', 'g', 10, 9, 'door', 'Kitchen door', { width: 0.9 });
  poi('g-kit', 'g', 10, 5, 'Kitchen', 'kitchen');
  n('g-bathd', 'g', 15, 11, 'door', 'Bathroom door', { width: 0.9 });
  poi('g-bath', 'g', 15, 14, 'Ground floor bathroom', 'bathroom');
  n('g-stairs', 'g', 20, 12, 'landing', 'Stairs', { poiType: 'stairs' });
  n('g-elev', 'g', 20, 8, 'elevator', 'Elevator', { poiType: 'elevator' });
  n('g-side', 'g', 25, 10, 'door', 'Side exit', { exterior: true, poiType: 'exit', width: 1, normal: 0 });

  // Floor 1
  n('f1-stairs', 'f1', 20, 12, 'landing', 'Stairs', { poiType: 'stairs' });
  n('f1-elev', 'f1', 20, 8, 'elevator', 'Elevator', { poiType: 'elevator' });
  n('f1-j4', 'f1', 20, 10, 'junction', 'East hallway');
  n('f1-j5', 'f1', 10, 10, 'junction', 'Middle hallway');
  n('f1-j6', 'f1', 0, 10, 'junction', 'West hallway');
  n('f1-201d', 'f1', 5, 11, 'door', 'Room 201 door', { width: 0.9 });
  n('f1-201', 'f1', 5, 15, 'room', 'Room 201');
  n('f1-202d', 'f1', 15, 11, 'door', 'Room 202 door', { width: 0.9 });
  n('f1-202', 'f1', 15, 15, 'room', 'Room 202');
  n('f1-bathd', 'f1', 10, 11, 'door', 'Bathroom door', { width: 0.9 });
  poi('f1-bath', 'f1', 10, 14, 'Floor 1 bathroom', 'bathroom');
  n('f1-lounged', 'f1', 0, 9, 'door', 'Lounge door', { width: 1.2 });
  n('f1-lounge', 'f1', 0, 5, 'room', 'Study lounge');

  const graph: MapGraph = { schemaVersion: 1, floors, rooms: [], nodes, edges, placements: [] };
  const e = (from: string, to: string, kind: EdgeKind = 'walk', length?: number) => {
    const a = nodes.find((x) => x.id === from)!;
    const b = nodes.find((x) => x.id === to)!;
    edges.push({ id: `e-${from}-${to}`, from, to, kind, length: length ?? edgeLengthBetween(graph, a, b) });
  };

  e('g-entrance', 'g-lobby', 'door');
  e('g-lobby', 'g-ra');
  e('g-lobby', 'g-j1');
  e('g-j1', 'g-101d');
  e('g-101d', 'g-j2');
  e('g-101d', 'g-101', 'door');
  e('g-j2', 'g-kitd');
  e('g-kitd', 'g-kit', 'door');
  e('g-j2', 'g-bathd');
  e('g-bathd', 'g-j3');
  e('g-bathd', 'g-bath', 'door');
  e('g-j3', 'g-stairs');
  e('g-j3', 'g-elev');
  e('g-j3', 'g-side', 'door');

  e('g-stairs', 'f1-stairs', 'stairs', 7);
  e('g-elev', 'f1-elev', 'elevator', 3.2);

  e('f1-stairs', 'f1-j4');
  e('f1-elev', 'f1-j4');
  e('f1-j4', 'f1-202d');
  e('f1-202d', 'f1-202', 'door');
  e('f1-202d', 'f1-bathd');
  e('f1-bathd', 'f1-bath', 'door');
  e('f1-bathd', 'f1-j5');
  e('f1-j5', 'f1-201d');
  e('f1-201d', 'f1-201', 'door');
  e('f1-201d', 'f1-j6');
  e('f1-j6', 'f1-lounged');
  e('f1-lounged', 'f1-lounge', 'door');

  return graph;
}

export const SAMPLE_MAP_ID = 'sample-maple-hall';
export const SAMPLE_MAP_NAME = 'Maple Hall (sample)';
