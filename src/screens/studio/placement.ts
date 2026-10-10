import { create } from 'zustand';
import { applyTransform, wrapAngle } from '../../lib/graph/geometry';
import { proposeDoorMatches, normalizeOpeningNormals, type DoorMatchCandidate } from '../../lib/graph/stitch';
import type { MapGraph, Transform2D, Vec2 } from '../../lib/graph/types';
import type { ScanDraft } from '../../lib/scan/types';

/** In-progress placement of a scan onto the current floor (ghost on the canvas). */
interface PlacementState {
  draft: ScanDraft | null;
  candidates: DoorMatchCandidate[];
  index: number;
  /** Manual adjustment applied after the candidate transform. */
  transform: Transform2D | null;
  start: (graph: MapGraph, floorId: string, draft: ScanDraft) => void;
  choose: (i: number) => void;
  rotate: (radians: number) => void;
  move: (dx: number, dy: number) => void;
  cancel: () => void;
}

/** Where to drop a scan that can't be joined to anything yet: right of existing content. */
function freeSpot(graph: MapGraph, floorId: string): Vec2 {
  const xs = graph.nodes.filter((n) => n.floorId === floorId).map((n) => n.position.x);
  return xs.length ? { x: Math.max(...xs) + 6, y: 0 } : { x: 0, y: 0 };
}

export const usePlacement = create<PlacementState>((set, get) => ({
  draft: null,
  candidates: [],
  index: 0,
  transform: null,
  start: (graph, floorId, draft) => {
    const candidates = proposeDoorMatches(graph, floorId, draft.result);
    const spot = freeSpot(graph, floorId);
    set({ draft, candidates, index: 0, transform: candidates[0]?.transform ?? { theta: 0, tx: spot.x, ty: spot.y } });
  },
  choose: (i) => {
    const c = get().candidates[i];
    if (c) set({ index: i, transform: c.transform });
  },
  rotate: (r) => {
    const t = get().transform;
    const d = get().draft;
    if (!t || !d) return;
    // Rotate about the room's centre so it stays in place.
    const c = d.result.floorPolygon.length ? d.result.floorPolygon.reduce((a, p) => ({ x: a.x + p.x / d.result.floorPolygon.length, y: a.y + p.y / d.result.floorPolygon.length }), { x: 0, y: 0 }) : { x: 0, y: 0 };
    const before = applyTransform(t, c);
    const theta = wrapAngle(t.theta + r);
    const nt = { theta, tx: 0, ty: 0 };
    const after = applyTransform(nt, c);
    set({ transform: { theta, tx: before.x - after.x, ty: before.y - after.y } });
  },
  move: (dx, dy) => {
    const t = get().transform;
    if (t) set({ transform: { ...t, tx: t.tx + dx, ty: t.ty + dy } });
  },
  cancel: () => set({ draft: null, candidates: [], index: 0, transform: null }),
}));

export function ghostFor(draft: ScanDraft | null, t: Transform2D | null) {
  if (!draft || !t) return null;
  const scan = normalizeOpeningNormals(draft.result);
  return { footprint: scan.floorPolygon.map((p) => applyTransform(t, p)), doors: scan.openings.map((o) => applyTransform(t, o.position)) };
}
