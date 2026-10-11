import { edgeLengthBetween } from '../lib/graph/graph';
import type { EdgeKind, GraphEdge, GraphNode, MapGraph, Room, Vec2 } from '../lib/graph/types';

export const SAMPLE_MAP_ID = 'sample-home';
export const SAMPLE_MAP_NAME = 'Sample home';

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/**
 * One-floor home with four places: Kitchen, Bedroom, Bathroom and Closet (the closet opens
 * off the bedroom). Hallway points and doors exist only for routing; they are not offered as
 * destinations. The navigator still runs A* over this graph like any scanned map.
 */
export function buildSampleHome(): MapGraph {
  const floorId = 'home';
  const rooms: Room[] = [
    { id: 'r-kitchen', name: 'Kitchen', floorId, footprint: rect(-4, 1, 1, 5) },
    { id: 'r-bathroom', name: 'Bathroom', floorId, footprint: rect(-4, -4, 1, -1) },
    { id: 'r-bedroom', name: 'Bedroom', floorId, footprint: rect(3, 1, 9, 6) },
    { id: 'r-closet', name: 'Closet', floorId, footprint: rect(9, 3, 11, 6) },
  ];
  const nodes: GraphNode[] = [
    {
      id: 'hall-west',
      kind: 'junction',
      floorId,
      position: { x: -1, y: 0 },
      label: 'Hallway by the kitchen',
    },
    { id: 'hall-east', kind: 'junction', floorId, position: { x: 6, y: 0 }, label: 'Hallway by the bedroom' },
    {
      id: 'kitchen-door',
      kind: 'door',
      floorId,
      position: { x: -1, y: 1 },
      label: 'Kitchen door',
      roomIds: ['hall', 'r-kitchen'],
      width: 0.9,
      normal: -Math.PI / 2,
    },
    {
      id: 'kitchen',
      kind: 'room',
      floorId,
      position: { x: -1.5, y: 3 },
      label: 'Kitchen',
      roomIds: ['r-kitchen'],
      poiType: 'kitchen',
    },
    {
      id: 'bathroom-door',
      kind: 'door',
      floorId,
      position: { x: -1, y: -1 },
      label: 'Bathroom door',
      roomIds: ['hall', 'r-bathroom'],
      width: 0.8,
      normal: Math.PI / 2,
    },
    {
      id: 'bathroom',
      kind: 'room',
      floorId,
      position: { x: -1.5, y: -2.5 },
      label: 'Bathroom',
      roomIds: ['r-bathroom'],
      poiType: 'bathroom',
    },
    {
      id: 'bedroom-door',
      kind: 'door',
      floorId,
      position: { x: 6, y: 1 },
      label: 'Bedroom door',
      roomIds: ['hall', 'r-bedroom'],
      width: 0.9,
      normal: -Math.PI / 2,
    },
    {
      id: 'bedroom',
      kind: 'room',
      floorId,
      position: { x: 6, y: 3.5 },
      label: 'Bedroom',
      roomIds: ['r-bedroom'],
    },
    {
      id: 'closet-door',
      kind: 'door',
      floorId,
      position: { x: 9, y: 4.5 },
      label: 'Closet door',
      roomIds: ['r-bedroom', 'r-closet'],
      width: 0.8,
      normal: 0,
    },
    {
      id: 'closet',
      kind: 'room',
      floorId,
      position: { x: 10, y: 4.5 },
      label: 'Closet',
      roomIds: ['r-closet'],
    },
  ];
  const graph: MapGraph = {
    schemaVersion: 1,
    floors: [{ id: floorId, name: 'Home', level: 0, elevation: 0 }],
    rooms,
    nodes,
    edges: [],
    placements: [],
  };
  const edges: GraphEdge[] = [];
  const e = (from: string, to: string, kind: EdgeKind = 'walk') => {
    const a = nodes.find((n) => n.id === from)!;
    const b = nodes.find((n) => n.id === to)!;
    edges.push({ id: `e-${from}-${to}`, from, to, kind, length: edgeLengthBetween(graph, a, b) });
  };
  e('hall-west', 'hall-east');
  e('hall-west', 'kitchen-door');
  e('kitchen-door', 'kitchen', 'door');
  e('hall-west', 'bathroom-door');
  e('bathroom-door', 'bathroom', 'door');
  e('hall-east', 'bedroom-door');
  e('bedroom-door', 'bedroom', 'door');
  e('bedroom', 'closet-door');
  e('closet-door', 'closet', 'door');
  return { ...graph, edges };
}
