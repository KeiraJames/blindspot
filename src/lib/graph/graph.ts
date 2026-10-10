import { dist } from './geometry';
import type { EdgeKind, Floor, GraphEdge, GraphNode, MapGraph } from './types';

/** Read-only indexed view over a MapGraph for fast lookups during routing. */
export class GraphIndex {
  readonly nodes = new Map<string, GraphNode>();
  readonly floors = new Map<string, Floor>();
  readonly edges = new Map<string, GraphEdge>();
  /** node id → outgoing edges (bidirectional edges appear on both ends). */
  readonly adjacency = new Map<string, { edge: GraphEdge; to: string }[]>();

  constructor(readonly graph: MapGraph) {
    for (const f of graph.floors) this.floors.set(f.id, f);
    for (const n of graph.nodes) {
      this.nodes.set(n.id, n);
      this.adjacency.set(n.id, []);
    }
    for (const e of graph.edges) {
      this.edges.set(e.id, e);
      if (!this.nodes.has(e.from) || !this.nodes.has(e.to)) continue;
      this.adjacency.get(e.from)!.push({ edge: e, to: e.to });
      if (!e.oneWay) this.adjacency.get(e.to)!.push({ edge: e, to: e.from });
    }
  }

  node(id: string): GraphNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`Unknown node ${id}`);
    return n;
  }

  elevation(nodeId: string): number {
    return this.floors.get(this.node(nodeId).floorId)?.elevation ?? 0;
  }

  degree(nodeId: string): number {
    return this.adjacency.get(nodeId)?.length ?? 0;
  }

  /** Straight-line 3D distance between two nodes. Admissible A* heuristic. */
  distance3d(a: string, b: string): number {
    const na = this.node(a);
    const nb = this.node(b);
    const dz = this.elevation(a) - this.elevation(b);
    return Math.hypot(dist(na.position, nb.position), dz);
  }

  nodesOnFloor(floorId: string): GraphNode[] {
    return this.graph.nodes.filter((n) => n.floorId === floorId);
  }
}

let counter = 0;
export function newId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

/** Edge length for a new edge between two nodes; vertical edges include the climb. */
export function edgeLengthBetween(graph: MapGraph, a: GraphNode, b: GraphNode): number {
  const fa = graph.floors.find((f) => f.id === a.floorId)?.elevation ?? 0;
  const fb = graph.floors.find((f) => f.id === b.floorId)?.elevation ?? 0;
  return Math.max(0.01, Math.hypot(dist(a.position, b.position), fa - fb));
}

export function connect(graph: MapGraph, fromId: string, toId: string, kind: EdgeKind = 'walk'): MapGraph {
  const a = graph.nodes.find((n) => n.id === fromId);
  const b = graph.nodes.find((n) => n.id === toId);
  if (!a || !b || a.id === b.id) return graph;
  const exists = graph.edges.some(
    (e) => (e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId),
  );
  if (exists) return graph;
  const edge: GraphEdge = { id: newId('e'), from: fromId, to: toId, kind, length: edgeLengthBetween(graph, a, b) };
  return { ...graph, edges: [...graph.edges, edge] };
}

/** Recompute lengths of every edge touching the given nodes (after a node moves). */
export function refreshEdgeLengths(graph: MapGraph, nodeIds?: Set<string>): MapGraph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return {
    ...graph,
    edges: graph.edges.map((e) => {
      if (nodeIds && !nodeIds.has(e.from) && !nodeIds.has(e.to)) return e;
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) return e;
      return { ...e, length: edgeLengthBetween(graph, a, b) };
    }),
  };
}

export function removeNode(graph: MapGraph, nodeId: string): MapGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== nodeId),
    edges: graph.edges.filter((e) => e.from !== nodeId && e.to !== nodeId),
  };
}

/** Merge node `drop` into `keep`: rewire edges, drop self-loops and duplicates. */
export function mergeNodes(graph: MapGraph, keep: string, drop: string): MapGraph {
  if (keep === drop) return graph;
  const keepNode = graph.nodes.find((n) => n.id === keep);
  const dropNode = graph.nodes.find((n) => n.id === drop);
  if (!keepNode || !dropNode) return graph;
  const roomIds = Array.from(new Set([...(keepNode.roomIds ?? []), ...(dropNode.roomIds ?? [])]));
  const nodes = graph.nodes
    .filter((n) => n.id !== drop)
    .map((n) => (n.id === keep ? { ...n, roomIds, exterior: false } : n));
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const e of graph.edges) {
    const from = e.from === drop ? keep : e.from;
    const to = e.to === drop ? keep : e.to;
    if (from === to) continue;
    const key = [from, to].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ ...e, from, to });
  }
  return refreshEdgeLengths({ ...graph, nodes, edges }, new Set([keep]));
}

export function nodeDisplayName(graph: MapGraph, node: GraphNode): string {
  const floor = graph.floors.find((f) => f.id === node.floorId);
  const multiFloor = graph.floors.length > 1;
  return multiFloor && floor ? `${node.label}, ${floor.name}` : node.label;
}

/** Nodes a navigator can pick as a destination. */
export function destinations(graph: MapGraph): GraphNode[] {
  return graph.nodes
    .filter((n) => n.kind === 'room' || n.kind === 'poi' || (n.kind === 'door' && n.exterior) || n.kind === 'elevator')
    .filter((n) => n.label.trim().length > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
}
