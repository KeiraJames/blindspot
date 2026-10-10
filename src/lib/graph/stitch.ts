import type { ScanResult } from '../scan/types';
import { applyTransform, bearing, dist, polygonCentroid, wrapAngle } from './geometry';
import { mergeNodes, newId } from './graph';
import type { GraphEdge, GraphNode, MapGraph, Room, Transform2D, Vec2 } from './types';

/**
 * Least-squares rigid 2D alignment (Umeyama 1991 without scale): finds R, t minimizing
 * Σ‖dst_i − (R·src_i + t)‖². Needs at least one correspondence; with exactly one, the
 * rotation is undefined and `fallbackTheta` is used.
 */
export function umeyama2D(src: Vec2[], dst: Vec2[], fallbackTheta = 0): Transform2D & { rms: number } {
  if (src.length !== dst.length || src.length === 0) throw new Error('umeyama2D needs matching non-empty sets');
  const n = src.length;
  const ms = { x: 0, y: 0 };
  const md = { x: 0, y: 0 };
  for (let i = 0; i < n; i++) {
    ms.x += src[i]!.x / n;
    ms.y += src[i]!.y / n;
    md.x += dst[i]!.x / n;
    md.y += dst[i]!.y / n;
  }
  let sxx = 0; // Σ (s·d)
  let sxy = 0; // Σ (s × d)
  for (let i = 0; i < n; i++) {
    const sx = src[i]!.x - ms.x;
    const sy = src[i]!.y - ms.y;
    const dx = dst[i]!.x - md.x;
    const dy = dst[i]!.y - md.y;
    sxx += sx * dx + sy * dy;
    sxy += sx * dy - sy * dx;
  }
  const degenerate = Math.hypot(sxx, sxy) < 1e-9;
  const theta = degenerate ? fallbackTheta : Math.atan2(sxy, sxx);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const tx = md.x - (c * ms.x - s * ms.y);
  const ty = md.y - (s * ms.x + c * ms.y);
  const t = { theta, tx, ty };
  let err = 0;
  for (let i = 0; i < n; i++) {
    const p = applyTransform(t, src[i]!);
    err += (p.x - dst[i]!.x) ** 2 + (p.y - dst[i]!.y) ** 2;
  }
  return { ...t, rms: Math.sqrt(err / n) };
}

/**
 * Transform that places a new scan so its door B meets an existing door A face to face:
 * the two door positions coincide and B's outward normal points opposite A's.
 */
export function alignByDoor(placedPos: Vec2, placedNormal: number, scanPos: Vec2, scanNormal: number): Transform2D {
  const theta = wrapAngle(placedNormal + Math.PI - scanNormal);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { theta, tx: placedPos.x - (c * scanPos.x - s * scanPos.y), ty: placedPos.y - (s * scanPos.x + c * scanPos.y) };
}

/** Make every opening normal point away from the room interior. */
export function normalizeOpeningNormals(scan: ScanResult): ScanResult {
  const center = scan.floorPolygon.length >= 3 ? polygonCentroid(scan.floorPolygon) : { x: 0, y: 0 };
  return {
    ...scan,
    openings: scan.openings.map((o) => {
      const out = bearing(center, o.position);
      const diff = Math.abs(wrapAngle(o.normal - out));
      return diff > Math.PI / 2 ? { ...o, normal: wrapAngle(o.normal + Math.PI) } : o;
    }),
  };
}

export interface DoorMatchCandidate {
  placedDoorId: string;
  scanOpeningId: string;
  transform: Transform2D;
  /** Lower is better. */
  score: number;
  /** Other openings in the scan that also land on existing doors. */
  extraMatches: { placedDoorId: string; scanOpeningId: string }[];
  /** Fraction of the new room's footprint overlapping existing rooms on the floor. */
  overlap: number;
  widthDelta: number;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Approximate overlap by sampling a grid inside the new footprint. */
function footprintOverlap(newPoly: Vec2[], existing: Vec2[][]): number {
  if (newPoly.length < 3 || existing.length === 0) return 0;
  const xs = newPoly.map((p) => p.x);
  const ys = newPoly.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const step = Math.max(0.25, Math.max(maxX - minX, maxY - minY) / 20);
  let inside = 0;
  let overlapping = 0;
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let y = minY + step / 2; y < maxY; y += step) {
      const p = { x, y };
      if (!pointInPolygon(p, newPoly)) continue;
      inside++;
      if (existing.some((poly) => poly.length >= 3 && pointInPolygon(p, poly))) overlapping++;
    }
  }
  return inside === 0 ? 0 : overlapping / inside;
}

const MATCH_RADIUS = 0.6; // meters

/**
 * Propose door pairings to snap a new scan onto the floor. Each candidate aligns one
 * placed (unmatched) door with one scan opening, then checks how many other openings line
 * up and whether the rooms would overlap. When several doors line up, the transform is
 * refined with Umeyama over all matched door pairs.
 */
export function proposeDoorMatches(graph: MapGraph, floorId: string, scan: ScanResult): DoorMatchCandidate[] {
  const placedDoors = graph.nodes.filter(
    (n) => n.floorId === floorId && n.kind === 'door' && !n.exterior && (n.roomIds?.length ?? 0) < 2,
  );
  const existingFootprints = graph.rooms.filter((r) => r.floorId === floorId && r.footprint).map((r) => r.footprint!);
  const normalized = normalizeOpeningNormals(scan);
  const out: DoorMatchCandidate[] = [];

  for (const door of placedDoors) {
    if (door.normal === undefined) continue;
    for (const o of normalized.openings) {
      let t: Transform2D = alignByDoor(door.position, door.normal, o.position, o.normal);
      const widthDelta = door.width !== undefined ? Math.abs(door.width - o.width) : 0.3;
      const pairs = [{ placedDoorId: door.id, scanOpeningId: o.id }];
      for (const other of normalized.openings) {
        if (other.id === o.id) continue;
        const p = applyTransform(t, other.position);
        const hit = placedDoors.find((d) => d.id !== door.id && dist(d.position, p) < MATCH_RADIUS);
        if (hit) pairs.push({ placedDoorId: hit.id, scanOpeningId: other.id });
      }
      if (pairs.length > 1) {
        const src = pairs.map((pr) => normalized.openings.find((x) => x.id === pr.scanOpeningId)!.position);
        const dst = pairs.map((pr) => graph.nodes.find((x) => x.id === pr.placedDoorId)!.position);
        const refined = umeyama2D(src, dst, t.theta);
        t = { theta: refined.theta, tx: refined.tx, ty: refined.ty };
      }
      const overlap = footprintOverlap(
        normalized.floorPolygon.map((p) => applyTransform(t, p)),
        existingFootprints,
      );
      const score = widthDelta * 4 + overlap * 10 - (pairs.length - 1) * 1.5;
      out.push({
        placedDoorId: door.id,
        scanOpeningId: o.id,
        transform: t,
        score,
        extraMatches: pairs.slice(1),
        overlap,
        widthDelta,
      });
    }
  }
  return out.sort((a, b) => a.score - b.score);
}

export interface PlaceScanOptions {
  floorId: string;
  name: string;
  transform: Transform2D;
  /** Door pairs to merge: placed door node id ↔ scan opening id. */
  doorPairs?: { placedDoorId: string; scanOpeningId: string }[];
}

/**
 * Add a scanned room to the graph: a room node at the footprint centroid, a door node per
 * opening, a landing node per staircase, and walk edges from the room to each. Paired doors
 * are merged with existing door nodes so the rooms connect.
 */
export function placeScan(graph: MapGraph, scanIn: ScanResult, opts: PlaceScanOptions): MapGraph {
  const scan = normalizeOpeningNormals(scanIn);
  const t = opts.transform;
  const roomId = newId('room');
  const footprint = scan.floorPolygon.map((p) => applyTransform(t, p));
  const center = footprint.length >= 3 ? polygonCentroid(footprint) : applyTransform(t, { x: 0, y: 0 });

  const room: Room = { id: roomId, name: opts.name, floorId: opts.floorId, scanId: scan.scanId, footprint };
  const roomNode: GraphNode = {
    id: newId('n'),
    kind: 'room',
    floorId: opts.floorId,
    position: center,
    label: opts.name,
    roomIds: [roomId],
    scanId: scan.scanId,
  };
  const nodes: GraphNode[] = [roomNode];
  const edges: GraphEdge[] = [];
  const openingNode = new Map<string, string>();

  scan.openings.forEach((o, i) => {
    const pos = applyTransform(t, o.position);
    const node: GraphNode = {
      id: newId('n'),
      kind: 'door',
      floorId: opts.floorId,
      position: pos,
      label: `${opts.name} ${o.category === 'door' ? 'door' : 'opening'}${scan.openings.length > 1 ? ` ${i + 1}` : ''}`,
      roomIds: [roomId],
      width: o.width,
      normal: wrapAngle(o.normal + t.theta),
      scanId: scan.scanId,
    };
    openingNode.set(o.id, node.id);
    nodes.push(node);
    edges.push({ id: newId('e'), from: roomNode.id, to: node.id, kind: 'walk', length: Math.max(0.01, dist(center, pos)) });
  });

  scan.stairs.forEach((s, i) => {
    const pos = applyTransform(t, s.position);
    const node: GraphNode = {
      id: newId('n'),
      kind: 'landing',
      floorId: opts.floorId,
      position: pos,
      label: `${opts.name} stairs${scan.stairs.length > 1 ? ` ${i + 1}` : ''}`,
      roomIds: [roomId],
      poiType: 'stairs',
      scanId: scan.scanId,
    };
    nodes.push(node);
    edges.push({ id: newId('e'), from: roomNode.id, to: node.id, kind: 'walk', length: Math.max(0.01, dist(center, pos)) });
  });

  let next: MapGraph = {
    ...graph,
    rooms: [...graph.rooms, room],
    nodes: [...graph.nodes, ...nodes],
    edges: [...graph.edges, ...edges],
    placements: [
      ...graph.placements.filter((p) => p.scanId !== scan.scanId),
      { scanId: scan.scanId, floorId: opts.floorId, transform: t, heightOffset: scan.floorHeight },
    ],
  };
  for (const pair of opts.doorPairs ?? []) {
    const fresh = openingNode.get(pair.scanOpeningId);
    if (fresh) next = mergeNodes(next, pair.placedDoorId, fresh);
  }
  return next;
}
