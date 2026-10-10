/**
 * Navigation graph types. The graph JSON is the routing source of truth (PRD §9);
 * meshes and world maps only help with visualization, occlusion and relocalization.
 *
 * Coordinates: every floor shares one metric map frame. `x` points right and `y` points
 * "up" on the floor plan (north), in meters. Bearings use the math convention:
 * radians counter-clockwise from +x, so a positive turn angle is a left turn.
 */

export type Vec2 = { x: number; y: number };

export type NodeKind =
  | 'room' // centroid of a scanned room
  | 'door' // door or opening; a port between two rooms
  | 'junction' // hallway decision point
  | 'landing' // stair landing
  | 'elevator' // elevator lobby / car stop on a floor
  | 'poi'; // point of interest inside a room

export type PoiType = 'bathroom' | 'exit' | 'ra_desk' | 'kitchen' | 'elevator' | 'stairs' | 'other';

export type EdgeKind = 'walk' | 'door' | 'stairs' | 'elevator' | 'ramp';

export interface Floor {
  id: string;
  name: string;
  /** Floor index (0 = ground). Used for ordering and spoken "floor N". */
  level: number;
  /** Height of the finished floor above level 0, in meters. */
  elevation: number;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  floorId: string;
  position: Vec2;
  label: string;
  /** Room this node belongs to (door nodes may belong to two rooms). */
  roomIds?: string[];
  poiType?: PoiType;
  /** Doors that lead outside the mapped area are allowed to have no partner room. */
  exterior?: boolean;
  /** Door clear width in meters (from RoomPlan); used for door matching. */
  width?: number;
  /** Door outward normal bearing in radians (map frame), used for stitching. */
  normal?: number;
  /** Scan that produced this node, if any. */
  scanId?: string;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  /** Walking length in meters. For vertical edges, the path length along stairs/elevator. */
  length: number;
  /** Edges are bidirectional unless explicitly marked one-way. */
  oneWay?: boolean;
}

export interface Room {
  id: string;
  name: string;
  floorId: string;
  scanId?: string;
  /** Floor footprint polygon in map frame (from RoomPlan), for drawing only. */
  footprint?: Vec2[];
}

/** Rigid 2D transform from a scan's local frame into the map frame. */
export interface Transform2D {
  theta: number;
  tx: number;
  ty: number;
}

export interface ScanPlacement {
  scanId: string;
  floorId: string;
  transform: Transform2D;
  /** Vertical offset between the scan's ARKit origin and the floor elevation, in meters. */
  heightOffset: number;
}

export interface MapGraph {
  schemaVersion: 1;
  floors: Floor[];
  rooms: Room[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  placements: ScanPlacement[];
}

export const POI_LABELS: Record<PoiType, string> = {
  bathroom: 'Bathroom',
  exit: 'Exit',
  ra_desk: 'RA desk',
  kitchen: 'Kitchen',
  elevator: 'Elevator',
  stairs: 'Stairs',
  other: 'Point of interest',
};

export function emptyGraph(): MapGraph {
  return {
    schemaVersion: 1,
    floors: [{ id: 'f0', name: 'Ground floor', level: 0, elevation: 0 }],
    rooms: [],
    nodes: [],
    edges: [],
    placements: [],
  };
}
