import type { ScanResult } from '../scan/types';
import { removeNode } from './graph';
import { placeScan, proposeDoorMatches } from './stitch';
import type { MapGraph, Transform2D } from './types';

/** A door match is trusted only if widths agree and the rooms don't overlap. */
const MAX_WIDTH_DELTA = 0.4;
const MAX_OVERLAP = 0.15;

export function emptyPlace(): MapGraph {
  return {
    schemaVersion: 1,
    floors: [{ id: 'home', name: 'Home', level: 0, elevation: 0 }],
    rooms: [],
    nodes: [],
    edges: [],
    placements: [],
  };
}

/**
 * Door names are what the guide says when you pass through them, so they come from the
 * rooms they join: "the door between Bedroom and Kitchen", or "Kitchen door 2".
 */
export function relabelDoors(graph: MapGraph): MapGraph {
  const roomName = new Map(graph.rooms.map((r) => [r.id, r.name]));
  const count = new Map<string, number>();
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.kind !== 'door' || n.exterior) return n;
      const names = (n.roomIds ?? []).map((id) => roomName.get(id)).filter((x): x is string => Boolean(x));
      if (names.length >= 2) return { ...n, label: `the door between ${names[0]} and ${names[1]}` };
      const name = names[0] ?? 'Room';
      const k = (count.get(name) ?? 0) + 1;
      count.set(name, k);
      return { ...n, label: k === 1 ? `${name} door` : `${name} door ${k}` };
    }),
  };
}

/** Names of the rooms that share a door with `roomId`. */
export function neighbours(graph: MapGraph, roomId: string): string[] {
  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (n.kind === 'door' && n.roomIds?.includes(roomId))
      for (const r of n.roomIds) if (r !== roomId) ids.add(r);
  }
  return graph.rooms.filter((r) => ids.has(r.id)).map((r) => r.name);
}

export interface AddRoomResult {
  graph: MapGraph;
  roomId: string;
  /** Rooms it was connected to through a shared door. Empty = not connected yet. */
  joinedTo: string[];
}

/**
 * Add a freshly scanned room. The first room anchors the map. Later rooms are snapped onto an
 * unmatched door of an existing room when one fits (same width, no overlap); otherwise the
 * room is placed on its own and the caller tells the user how to connect it.
 */
export function addScannedRoom(graph: MapGraph, scan: ScanResult, name: string): AddRoomResult {
  const floorId = graph.floors[0]!.id;
  let transform: Transform2D = { theta: 0, tx: 0, ty: 0 };
  let doorPairs: { placedDoorId: string; scanOpeningId: string }[] = [];
  if (graph.rooms.length > 0) {
    const match = proposeDoorMatches(graph, floorId, scan).find(
      (c) => c.overlap < MAX_OVERLAP && c.widthDelta < MAX_WIDTH_DELTA,
    );
    if (match) {
      transform = match.transform;
      doorPairs = [
        { placedDoorId: match.placedDoorId, scanOpeningId: match.scanOpeningId },
        ...match.extraMatches,
      ];
    } else {
      // Off to the side of everything else so it can't be mistaken for a neighbour.
      const xs = graph.nodes.map((n) => n.position.x);
      transform = { theta: 0, tx: Math.max(...xs, 0) + 8, ty: 0 };
    }
  }
  const placed = relabelDoors(placeScan(graph, scan, { floorId, name, transform, doorPairs }));
  const roomId = placed.rooms.find((r) => r.scanId === scan.scanId)!.id;
  return { graph: placed, roomId, joinedTo: neighbours(placed, roomId) };
}

export function renameRoom(graph: MapGraph, roomId: string, name: string): MapGraph {
  return relabelDoors({
    ...graph,
    rooms: graph.rooms.map((r) => (r.id === roomId ? { ...r, name } : r)),
    nodes: graph.nodes.map((n) => {
      if (!n.roomIds?.includes(roomId)) return n;
      if (n.kind === 'room') return { ...n, label: name };
      if (n.kind === 'landing') return { ...n, label: `${name} stairs` };
      return n;
    }),
  });
}

/** Remove a room. Doors it shared with another room stay, as that room's doors. */
export function deleteRoom(graph: MapGraph, roomId: string): MapGraph {
  const room = graph.rooms.find((r) => r.id === roomId);
  let next: MapGraph = {
    ...graph,
    rooms: graph.rooms.filter((r) => r.id !== roomId),
    placements: graph.placements.filter((p) => p.scanId !== room?.scanId),
    nodes: graph.nodes.map((n) =>
      n.kind === 'door' && n.roomIds?.includes(roomId) && n.roomIds.length > 1
        ? { ...n, roomIds: n.roomIds.filter((r) => r !== roomId) }
        : n,
    ),
  };
  for (const n of next.nodes.filter((x) => x.roomIds?.length === 1 && x.roomIds[0] === roomId)) {
    next = removeNode(next, n.id);
  }
  // A kept shared door may now hang off a deleted room node; drop its dangling edges.
  const ids = new Set(next.nodes.map((n) => n.id));
  next = { ...next, edges: next.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
  return relabelDoors(next);
}
