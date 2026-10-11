import { create } from 'zustand';
import { connect, mergeNodes, newId, refreshEdgeLengths, removeNode } from '../lib/graph/graph';
import type { EdgeKind, Floor, GraphNode, MapGraph, NodeKind, Vec2 } from '../lib/graph/types';

export type Tool = 'select' | 'add' | 'connect';

interface StudioState {
  mapId: string | null;
  graph: MapGraph | null;
  past: MapGraph[];
  future: MapGraph[];
  dirty: boolean;
  floorId: string | null;
  selection: string[];
  tool: Tool;
  addKind: NodeKind;
  connectKind: EdgeKind;
  /** Graph before a drag started, so the whole drag is one undo step. */
  dragOrigin: MapGraph | null;

  load: (mapId: string, graph: MapGraph) => void;
  apply: (fn: (g: MapGraph) => MapGraph) => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
  setFloor: (id: string) => void;
  setTool: (t: Tool) => void;
  setAddKind: (k: NodeKind) => void;
  setConnectKind: (k: EdgeKind) => void;
  select: (id: string | null, additive?: boolean) => void;

  addNode: (p: Vec2, kind?: NodeKind) => string;
  updateNode: (id: string, patch: Partial<GraphNode>) => void;
  deleteNodes: (ids: string[]) => void;
  connectNodes: (a: string, b: string, kind?: EdgeKind) => void;
  disconnect: (edgeId: string) => void;
  merge: (keep: string, drop: string) => void;
  beginDrag: () => void;
  dragNode: (id: string, p: Vec2) => void;
  endDrag: () => void;
  nudge: (id: string, dx: number, dy: number) => void;

  addFloor: () => void;
  updateFloor: (id: string, patch: Partial<Floor>) => void;
  deleteFloor: (id: string) => void;
}

const HISTORY = 100;
const snap = (v: number) => Math.round(v * 4) / 4;

const DEFAULT_LABEL: Record<NodeKind, string> = {
  room: 'New room',
  door: 'Door',
  junction: 'Hallway',
  landing: 'Stairs',
  elevator: 'Elevator',
  poi: 'Point of interest',
};

export const useStudio = create<StudioState>((set, get) => {
  const commit = (next: MapGraph) => {
    const { graph, past } = get();
    if (!graph || next === graph) return;
    set({ graph: next, past: [...past, graph].slice(-HISTORY), future: [], dirty: true });
  };

  return {
    mapId: null,
    graph: null,
    past: [],
    future: [],
    dirty: false,
    floorId: null,
    selection: [],
    tool: 'select',
    addKind: 'junction',
    connectKind: 'walk',
    dragOrigin: null,

    load: (mapId, graph) =>
      set({
        mapId,
        graph,
        past: [],
        future: [],
        dirty: false,
        floorId: graph.floors[0]?.id ?? null,
        selection: [],
      }),
    apply: (fn) => {
      const g = get().graph;
      if (g) commit(fn(g));
    },
    undo: () => {
      const { past, graph, future } = get();
      if (!graph || past.length === 0) return;
      set({
        graph: past.at(-1)!,
        past: past.slice(0, -1),
        future: [graph, ...future],
        dirty: true,
        selection: [],
      });
    },
    redo: () => {
      const { past, graph, future } = get();
      if (!graph || future.length === 0) return;
      set({ graph: future[0]!, future: future.slice(1), past: [...past, graph], dirty: true, selection: [] });
    },
    markSaved: () => set({ dirty: false }),
    setFloor: (floorId) => set({ floorId, selection: [] }),
    setTool: (tool) => set({ tool, selection: [] }),
    setAddKind: (addKind) => set({ addKind }),
    setConnectKind: (connectKind) => set({ connectKind }),
    select: (id, additive) =>
      set((s) => ({
        selection:
          id === null
            ? []
            : additive
              ? s.selection.includes(id)
                ? s.selection.filter((x) => x !== id)
                : [...s.selection, id]
              : [id],
      })),

    addNode: (p, kind) => {
      const { floorId, addKind } = get();
      const k = kind ?? addKind;
      const id = newId('n');
      get().apply((g) => ({
        ...g,
        nodes: [
          ...g.nodes,
          {
            id,
            kind: k,
            floorId: floorId ?? g.floors[0]!.id,
            position: { x: snap(p.x), y: snap(p.y) },
            label: DEFAULT_LABEL[k],
            ...(k === 'elevator'
              ? { poiType: 'elevator' as const }
              : k === 'landing'
                ? { poiType: 'stairs' as const }
                : {}),
          },
        ],
      }));
      set({ selection: [id] });
      return id;
    },
    updateNode: (id, patch) =>
      get().apply((g) => {
        const next = { ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
        return patch.position ? refreshEdgeLengths(next, new Set([id])) : next;
      }),
    deleteNodes: (ids) => {
      get().apply((g) => ids.reduce((acc, id) => removeNode(acc, id), g));
      set({ selection: [] });
    },
    connectNodes: (a, b, kind) => get().apply((g) => connect(g, a, b, kind ?? get().connectKind)),
    disconnect: (edgeId) => get().apply((g) => ({ ...g, edges: g.edges.filter((e) => e.id !== edgeId) })),
    merge: (keep, drop) => {
      get().apply((g) => mergeNodes(g, keep, drop));
      set({ selection: [keep] });
    },
    beginDrag: () => set({ dragOrigin: get().graph }),
    dragNode: (id, p) => {
      const g = get().graph;
      if (!g) return;
      const next = refreshEdgeLengths(
        {
          ...g,
          nodes: g.nodes.map((n) => (n.id === id ? { ...n, position: { x: snap(p.x), y: snap(p.y) } } : n)),
        },
        new Set([id]),
      );
      set({ graph: next });
    },
    endDrag: () => {
      const { dragOrigin, graph, past } = get();
      if (dragOrigin && graph && dragOrigin !== graph)
        set({ past: [...past, dragOrigin].slice(-HISTORY), future: [], dirty: true });
      set({ dragOrigin: null });
    },
    nudge: (id, dx, dy) => {
      const n = get().graph?.nodes.find((x) => x.id === id);
      if (n) get().updateNode(id, { position: { x: snap(n.position.x + dx), y: snap(n.position.y + dy) } });
    },

    addFloor: () => {
      const g = get().graph;
      if (!g) return;
      const top = g.floors.reduce((a, b) => (b.level > a.level ? b : a), g.floors[0]!);
      const level = (top?.level ?? -1) + 1;
      const id = newId('floor');
      get().apply((x) => ({
        ...x,
        floors: [
          ...x.floors,
          { id, name: level === 0 ? 'Ground floor' : `Floor ${level}`, level, elevation: level * 3.2 },
        ],
      }));
      set({ floorId: id, selection: [] });
    },
    updateFloor: (id, patch) =>
      get().apply((g) =>
        refreshEdgeLengths({ ...g, floors: g.floors.map((f) => (f.id === id ? { ...f, ...patch } : f)) }),
      ),
    deleteFloor: (id) => {
      const g = get().graph;
      if (!g || g.floors.length <= 1) return;
      get().apply((x) => {
        const ids = new Set(x.nodes.filter((n) => n.floorId === id).map((n) => n.id));
        return {
          ...x,
          floors: x.floors.filter((f) => f.id !== id),
          nodes: x.nodes.filter((n) => !ids.has(n.id)),
          edges: x.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to)),
          rooms: x.rooms.filter((r) => r.floorId !== id),
          placements: x.placements.filter((p) => p.floorId !== id),
        };
      });
      set({ floorId: get().graph!.floors[0]!.id, selection: [] });
    },
  };
});
