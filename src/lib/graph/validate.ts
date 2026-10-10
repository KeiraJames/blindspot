import { GraphIndex } from './graph';
import type { MapGraph } from './types';

export type IssueSeverity = 'error' | 'warning';

export type IssueCode =
  | 'dangling_edge'
  | 'duplicate_id'
  | 'unknown_floor'
  | 'unmatched_door'
  | 'disconnected'
  | 'isolated_node'
  | 'unnamed_destination'
  | 'bad_length'
  | 'vertical_edge_same_floor'
  | 'cross_floor_walk_edge'
  | 'no_exit'
  | 'empty';

export interface ValidationIssue {
  severity: IssueSeverity;
  code: IssueCode;
  message: string;
  nodeIds?: string[];
  edgeIds?: string[];
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** Connected components, largest first. */
  components: string[][];
}

/** Undirected connected components. */
export function components(index: GraphIndex): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const id of index.nodes.keys()) {
    if (seen.has(id)) continue;
    const comp: string[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const { to } of index.adjacency.get(cur) ?? []) {
        if (!seen.has(to)) {
          seen.add(to);
          stack.push(to);
        }
      }
    }
    out.push(comp);
  }
  // One-way edges only appear on one adjacency list; add reverse reachability.
  return mergeOneWay(index, out).sort((a, b) => b.length - a.length);
}

function mergeOneWay(index: GraphIndex, comps: string[][]): string[][] {
  const owner = new Map<string, number>();
  comps.forEach((c, i) => c.forEach((id) => owner.set(id, i)));
  const parent = comps.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (const e of index.graph.edges) {
    const a = owner.get(e.from);
    const b = owner.get(e.to);
    if (a === undefined || b === undefined) continue;
    parent[find(a)] = find(b);
  }
  const merged = new Map<number, string[]>();
  comps.forEach((c, i) => {
    const r = find(i);
    merged.set(r, [...(merged.get(r) ?? []), ...c]);
  });
  return [...merged.values()];
}

/**
 * Structural checks run in Map Studio (live warnings) and in the Cloud Function that
 * gates publishing. Errors block publishing; warnings are shown to the editor.
 */
export function validateGraph(graph: MapGraph): ValidationResult {
  const issues: ValidationIssue[] = [];
  const index = new GraphIndex(graph);

  if (graph.nodes.length === 0) {
    issues.push({ severity: 'error', code: 'empty', message: 'The map has no places yet.' });
    return { ok: false, issues, components: [] };
  }

  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (ids.has(n.id)) {
      issues.push({ severity: 'error', code: 'duplicate_id', message: `Duplicate id ${n.id}.`, nodeIds: [n.id] });
    }
    ids.add(n.id);
    if (!index.floors.has(n.floorId)) {
      issues.push({
        severity: 'error',
        code: 'unknown_floor',
        message: `${n.label || n.id} is on a floor that no longer exists.`,
        nodeIds: [n.id],
      });
    }
  }

  for (const e of graph.edges) {
    const a = index.nodes.get(e.from);
    const b = index.nodes.get(e.to);
    if (!a || !b) {
      issues.push({
        severity: 'error',
        code: 'dangling_edge',
        message: 'A path points to a place that was deleted.',
        edgeIds: [e.id],
      });
      continue;
    }
    if (!(e.length > 0) || !Number.isFinite(e.length)) {
      issues.push({ severity: 'error', code: 'bad_length', message: 'A path has an invalid length.', edgeIds: [e.id] });
    }
    const vertical = e.kind === 'stairs' || e.kind === 'elevator';
    if (vertical && a.floorId === b.floorId) {
      issues.push({
        severity: 'warning',
        code: 'vertical_edge_same_floor',
        message: `${e.kind === 'stairs' ? 'Stairs' : 'Elevator'} between ${a.label} and ${b.label} stay on one floor.`,
        edgeIds: [e.id],
        nodeIds: [a.id, b.id],
      });
    }
    if (!vertical && e.kind !== 'ramp' && a.floorId !== b.floorId) {
      issues.push({
        severity: 'error',
        code: 'cross_floor_walk_edge',
        message: `${a.label} and ${b.label} are on different floors but joined by a flat path. Use stairs, elevator, or ramp.`,
        edgeIds: [e.id],
        nodeIds: [a.id, b.id],
      });
    }
  }

  for (const n of graph.nodes) {
    const deg = index.degree(n.id);
    if (deg === 0) {
      issues.push({
        severity: 'warning',
        code: 'isolated_node',
        message: `${n.label || 'An unnamed place'} is not connected to anything.`,
        nodeIds: [n.id],
      });
    }
    if (n.kind === 'door' && !n.exterior && (n.roomIds?.length ?? 0) < 2 && deg <= 1) {
      issues.push({
        severity: 'warning',
        code: 'unmatched_door',
        message: `${n.label || 'A door'} leads nowhere yet. Snap it to a door in another scan, or mark it as an exterior door.`,
        nodeIds: [n.id],
      });
    }
    if ((n.kind === 'room' || n.kind === 'poi') && n.label.trim() === '') {
      issues.push({
        severity: 'warning',
        code: 'unnamed_destination',
        message: 'A room or point of interest has no name, so navigators cannot pick it.',
        nodeIds: [n.id],
      });
    }
  }

  const comps = components(index);
  if (comps.length > 1) {
    for (const comp of comps.slice(1)) {
      if (comp.length === 1 && index.degree(comp[0]!) === 0) continue; // already reported as isolated
      const labels = comp
        .map((id) => index.nodes.get(id)?.label)
        .filter(Boolean)
        .slice(0, 3)
        .join(', ');
      issues.push({
        severity: 'warning',
        code: 'disconnected',
        message: `Some places (${labels || `${comp.length} places`}) cannot be reached from the rest of the map.`,
        nodeIds: comp,
      });
    }
  }

  const hasExit = graph.nodes.some((n) => n.poiType === 'exit' || (n.kind === 'door' && n.exterior));
  if (!hasExit) {
    issues.push({
      severity: 'warning',
      code: 'no_exit',
      message: 'No exit is marked. "Nearest exit" will not work until you mark one.',
    });
  }

  return { ok: !issues.some((i) => i.severity === 'error'), issues, components: comps };
}
