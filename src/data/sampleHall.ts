import { edgeLengthBetween } from '../lib/graph/graph';
import type { EdgeKind, GraphEdge, GraphNode, MapGraph } from '../lib/graph/types';

/**
 * Demo map for a large open hall. There are no walls to follow with a cane in a space like
 * this, which is where spoken turn-by-turn guidance helps most. It fits in about 13 × 14 m:
 * stand at the entrance, face into the hall, and every route has real distances and turns.
 *
 *            Stage (0, 14)
 *                 |
 *        front of the stage (0, 11)
 *                 |
 * Seating ---- middle (0, 7) ---- Coffee table
 * (-4.5, 7)       |                (4.5, 7)
 *        front (0, 3) ---- Welcome desk (3, 3)
 *                 |
 *            Entrance (0, 0)
 */
export function buildSampleHall(): MapGraph {
  const floorId = 'hall';
  const n = (
    id: string,
    kind: GraphNode['kind'],
    x: number,
    y: number,
    label: string,
    extra: Partial<GraphNode> = {},
  ): GraphNode => ({
    id,
    kind,
    floorId,
    position: { x, y },
    label,
    roomIds: ['r-hall'],
    ...extra,
  });
  const nodes: GraphNode[] = [
    n('entrance', 'door', 0, 0, 'Entrance', {
      exterior: true,
      poiType: 'exit',
      width: 2,
      normal: -Math.PI / 2,
    }),
    n('front', 'junction', 0, 3, 'Front of the hall'),
    n('desk', 'poi', 3, 3, 'Welcome desk', { poiType: 'other' }),
    n('middle', 'junction', 0, 7, 'Middle of the hall'),
    n('coffee', 'poi', 4.5, 7, 'Coffee table', { poiType: 'other' }),
    n('seating', 'poi', -4.5, 7, 'Seating area', { poiType: 'other' }),
    n('stage-front', 'junction', 0, 11, 'Front of the stage'),
    n('stage', 'poi', 0, 14, 'Stage', { poiType: 'other' }),
  ];
  const graph: MapGraph = {
    schemaVersion: 1,
    floors: [{ id: floorId, name: 'Hall', level: 0, elevation: 0 }],
    rooms: [
      {
        id: 'r-hall',
        name: 'Hall',
        floorId,
        footprint: [
          { x: -7, y: -0.5 },
          { x: 7, y: -0.5 },
          { x: 7, y: 15.5 },
          { x: -7, y: 15.5 },
        ],
      },
    ],
    nodes,
    edges: [],
    placements: [],
  };
  const edges: GraphEdge[] = [];
  const e = (from: string, to: string, kind: EdgeKind = 'walk') => {
    const a = nodes.find((x) => x.id === from)!;
    const b = nodes.find((x) => x.id === to)!;
    edges.push({ id: `e-${from}-${to}`, from, to, kind, length: edgeLengthBetween(graph, a, b) });
  };
  e('entrance', 'front');
  e('front', 'desk');
  e('front', 'middle');
  e('middle', 'coffee');
  e('middle', 'seating');
  e('middle', 'stage-front');
  e('stage-front', 'stage');
  return { ...graph, edges };
}
