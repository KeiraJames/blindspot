import { GraphIndex } from './graph';
import type { GraphEdge } from './types';

export interface RoutePreferences {
  /** Never route over stairs (wheelchair, cart, or user preference). */
  avoidStairs: boolean;
  /** Extra cost in "meters" added for each stair flight taken. */
  stairPenalty: number;
  /** Extra cost for each elevator ride (waiting time). */
  elevatorPenalty: number;
  /** Multiplier on stair edge length (stairs are slower than flat walking). */
  stairFactor: number;
}

export const DEFAULT_PREFERENCES: RoutePreferences = {
  avoidStairs: false,
  stairPenalty: 8,
  elevatorPenalty: 20,
  stairFactor: 2,
};

export function edgeCost(edge: GraphEdge, prefs: RoutePreferences): number {
  switch (edge.kind) {
    case 'stairs':
      return prefs.avoidStairs ? Infinity : edge.length * prefs.stairFactor + prefs.stairPenalty;
    case 'elevator':
      return edge.length + prefs.elevatorPenalty;
    default:
      return edge.length;
  }
}

export interface Route {
  nodeIds: string[];
  edges: GraphEdge[];
  /** Weighted cost used for optimization. */
  cost: number;
  /** Physical length in meters. */
  length: number;
}

/** Minimal binary min-heap keyed on priority. */
class MinHeap<T> {
  private items: { p: number; v: T }[] = [];
  get size() {
    return this.items.length;
  }
  push(v: T, p: number) {
    const a = this.items;
    a.push({ p, v });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent]!.p <= a[i]!.p) break;
      [a[parent], a[i]] = [a[i]!, a[parent]!];
      i = parent;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.p < a[m]!.p) m = l;
        if (r < a.length && a[r]!.p < a[m]!.p) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top.v;
  }
}

/**
 * A* over the navigation graph. The heuristic is 3D straight-line distance, which never
 * overestimates because every edge cost is at least its physical length.
 * Returns null when the goal is unreachable under the given preferences.
 */
export function findRoute(
  index: GraphIndex,
  start: string,
  goal: string,
  prefs: RoutePreferences = DEFAULT_PREFERENCES,
): Route | null {
  if (!index.nodes.has(start) || !index.nodes.has(goal)) return null;
  if (start === goal) return { nodeIds: [start], edges: [], cost: 0, length: 0 };

  const g = new Map<string, number>([[start, 0]]);
  const came = new Map<string, { prev: string; edge: GraphEdge }>();
  const closed = new Set<string>();
  const open = new MinHeap<string>();
  open.push(start, index.distance3d(start, goal));

  while (open.size > 0) {
    const current = open.pop()!;
    if (current === goal) break;
    if (closed.has(current)) continue;
    closed.add(current);
    const gCur = g.get(current)!;
    for (const { edge, to } of index.adjacency.get(current) ?? []) {
      if (closed.has(to)) continue;
      const c = edgeCost(edge, prefs);
      if (!Number.isFinite(c)) continue;
      const tentative = gCur + c;
      if (tentative < (g.get(to) ?? Infinity)) {
        g.set(to, tentative);
        came.set(to, { prev: current, edge });
        open.push(to, tentative + index.distance3d(to, goal));
      }
    }
  }

  if (!g.has(goal)) return null;
  const nodeIds = [goal];
  const edges: GraphEdge[] = [];
  let cur = goal;
  while (cur !== start) {
    const step = came.get(cur)!;
    edges.unshift(step.edge);
    nodeIds.unshift(step.prev);
    cur = step.prev;
  }
  return {
    nodeIds,
    edges,
    cost: g.get(goal)!,
    length: edges.reduce((s, e) => s + e.length, 0),
  };
}

/** Nearest node to a position on a floor, optionally restricted by a predicate. */
export function nearestNode(
  index: GraphIndex,
  floorId: string,
  p: { x: number; y: number },
  filter: (id: string) => boolean = () => true,
): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const n of index.graph.nodes) {
    if (n.floorId !== floorId || !filter(n.id)) continue;
    const d = Math.hypot(n.position.x - p.x, n.position.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = n.id;
    }
  }
  return best;
}

/** Nearest reachable node of a POI type (e.g. "nearest exit"). */
export function nearestOfType(
  index: GraphIndex,
  start: string,
  match: (id: string) => boolean,
  prefs: RoutePreferences = DEFAULT_PREFERENCES,
): Route | null {
  // Dijkstra from start; first matching node popped is the nearest by cost.
  const g = new Map<string, number>([[start, 0]]);
  const came = new Map<string, { prev: string; edge: GraphEdge }>();
  const closed = new Set<string>();
  const open = new MinHeap<string>();
  open.push(start, 0);
  let found: string | null = null;
  while (open.size > 0) {
    const cur = open.pop()!;
    if (closed.has(cur)) continue;
    closed.add(cur);
    if (cur !== start && match(cur)) {
      found = cur;
      break;
    }
    for (const { edge, to } of index.adjacency.get(cur) ?? []) {
      const c = edgeCost(edge, prefs);
      if (!Number.isFinite(c) || closed.has(to)) continue;
      const t = g.get(cur)! + c;
      if (t < (g.get(to) ?? Infinity)) {
        g.set(to, t);
        came.set(to, { prev: cur, edge });
        open.push(to, t);
      }
    }
  }
  if (!found) return null;
  return findRoute(index, start, found, prefs);
}
