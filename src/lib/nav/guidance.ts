import type { Route } from '../graph/astar';
import { bearing, turnAngle } from '../graph/geometry';
import type { GraphIndex } from '../graph/graph';
import type { EdgeKind } from '../graph/types';
import { formatDistance, type DistanceUnit } from './units';

export type TurnDirection =
  | 'straight'
  | 'slight_left'
  | 'left'
  | 'sharp_left'
  | 'slight_right'
  | 'right'
  | 'sharp_right'
  | 'u_turn';

/** Classify a signed turn angle (radians, positive = left). */
export function classifyTurn(angle: number): TurnDirection {
  const deg = (angle * 180) / Math.PI;
  const a = Math.abs(deg);
  if (a < 25) return 'straight';
  if (a >= 160) return 'u_turn';
  const left = deg > 0;
  if (a < 60) return left ? 'slight_left' : 'slight_right';
  if (a < 125) return left ? 'left' : 'right';
  return left ? 'sharp_left' : 'sharp_right';
}

export function turnPhrase(t: TurnDirection): string {
  switch (t) {
    case 'straight':
      return 'Continue straight';
    case 'slight_left':
      return 'Bear left';
    case 'slight_right':
      return 'Bear right';
    case 'left':
      return 'Turn left';
    case 'right':
      return 'Turn right';
    case 'sharp_left':
      return 'Turn sharply left';
    case 'sharp_right':
      return 'Turn sharply right';
    case 'u_turn':
      return 'Turn around';
  }
}

export function isLeft(t: TurnDirection): boolean {
  return t === 'slight_left' || t === 'left' || t === 'sharp_left';
}
export function isRight(t: TurnDirection): boolean {
  return t === 'slight_right' || t === 'right' || t === 'sharp_right';
}

export type StepKind = 'depart' | 'turn' | 'floor_change' | 'continue' | 'arrive';

export interface RouteStep {
  kind: StepKind;
  /** Index into route.nodeIds where this maneuver happens. */
  nodeIndex: number;
  nodeId: string;
  turn?: TurnDirection;
  floorChange?: { via: Extract<EdgeKind, 'stairs' | 'elevator' | 'ramp'>; direction: 'up' | 'down'; floors: number; toFloorName: string };
  /** Meters to walk after this maneuver until the next one. */
  distanceAfter: number;
  /** Doors passed during the walk after this maneuver. `through` = a doorway joining two rooms. */
  landmarks: { label: string; through: boolean }[];
  /** Label of the place reached at the end of this step's walk. */
  towardLabel: string;
}

const isVertical = (k: EdgeKind) => k === 'stairs' || k === 'elevator';

/**
 * Turn a node route into spoken maneuvers. A maneuver is created at a node when the walk
 * bends by 25° or more, when the next edge changes floor, and at the destination. Doors on
 * straight stretches become landmarks ("through the door") instead of separate steps.
 */
export function buildSteps(index: GraphIndex, route: Route): RouteStep[] {
  const ids = route.nodeIds;
  if (ids.length === 0) return [];
  const node = (i: number) => index.node(ids[i]!);
  const steps: RouteStep[] = [];

  const open = (kind: StepKind, i: number, extra: Partial<RouteStep> = {}): RouteStep => {
    const s: RouteStep = { kind, nodeIndex: i, nodeId: ids[i]!, distanceAfter: 0, landmarks: [], towardLabel: '', ...extra };
    steps.push(s);
    return s;
  };

  let current = open('depart', 0);
  for (let i = 0; i < route.edges.length; i++) {
    const edge = route.edges[i]!;
    const a = node(i);
    const b = node(i + 1);

    if (isVertical(edge.kind) || (edge.kind === 'ramp' && a.floorId !== b.floorId)) {
      // Close the running walk at a, emit the floor change, then continue on the new floor.
      if (current.kind !== 'floor_change') current.towardLabel ||= a.label;
      const fa = index.floors.get(a.floorId);
      const fb = index.floors.get(b.floorId);
      const up = (fb?.elevation ?? 0) >= (fa?.elevation ?? 0);
      open('floor_change', i, {
        floorChange: {
          via: edge.kind as 'stairs' | 'elevator' | 'ramp',
          direction: up ? 'up' : 'down',
          floors: Math.max(1, Math.abs((fb?.level ?? 0) - (fa?.level ?? 0))),
          toFloorName: fb?.name ?? 'the next floor',
        },
        towardLabel: b.label,
      });
      current = open('continue', i + 1);
      continue;
    }

    current.distanceAfter += edge.length;
    // Doors passed along the way are landmarks; the destination itself is not.
    if (b.kind === 'door' && i + 1 < ids.length - 1) current.landmarks.push({ label: b.label, through: (b.roomIds?.length ?? 0) >= 2 });

    if (i + 1 === ids.length - 1) {
      current.towardLabel = b.label;
      break;
    }
    const nextEdge = route.edges[i + 1]!;
    if (isVertical(nextEdge.kind)) continue; // handled on next iteration
    const c = node(i + 2);
    if (b.floorId !== c.floorId) continue;
    const turn = classifyTurn(turnAngle(bearing(a.position, b.position), bearing(b.position, c.position)));
    if (turn !== 'straight') {
      current.towardLabel = b.label;
      // Remove the decision node itself from the landmark list; it's where we turn.
      current.landmarks = current.landmarks.filter((l) => l.label !== b.label);
      current = open('turn', i + 1, { turn });
    }
  }
  open('arrive', ids.length - 1, { towardLabel: node(ids.length - 1).label });

  // Drop empty "continue" steps created right before another floor change or arrival.
  return steps.filter((s, k) => !(s.kind === 'continue' && s.distanceAfter === 0 && k < steps.length - 1));
}

export interface PhraseOptions {
  unit: DistanceUnit;
  stepLength?: number;
}

function walkClause(step: RouteStep, opts: PhraseOptions): string {
  if (step.distanceAfter <= 0) return '';
  const d = formatDistance(step.distanceAfter, opts.unit, opts.stepLength);
  const lm = step.landmarks.find((l) => l.through) ?? step.landmarks[0];
  const via = lm ? ` ${lm.through ? 'through' : 'past'} ${lm.label}` : '';
  const toward = step.towardLabel ? ` to ${step.towardLabel}` : '';
  return `walk ${d}${via}${toward}`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Full sentence for a step, as spoken in the route preview and when it begins. */
export function stepText(step: RouteStep, opts: PhraseOptions, destinationLabel?: string): string {
  switch (step.kind) {
    case 'depart': {
      const w = walkClause(step, opts);
      return w ? `${capital(w)}.` : 'Start walking.';
    }
    case 'continue': {
      const w = walkClause(step, opts);
      return w ? `Then ${w}.` : 'Continue.';
    }
    case 'turn': {
      const w = walkClause(step, opts);
      return `${turnPhrase(step.turn!)}${w ? `, then ${w}` : ''}.`;
    }
    case 'floor_change': {
      const fc = step.floorChange!;
      const how = fc.via === 'elevator' ? 'Take the elevator' : fc.via === 'ramp' ? 'Take the ramp' : 'Take the stairs';
      const n = fc.floors > 1 ? ` ${fc.floors} floors` : '';
      return `${how} ${fc.direction}${n} to ${fc.toFloorName}.`;
    }
    case 'arrive':
      return `You have arrived at ${destinationLabel ?? step.towardLabel}.`;
  }
}

/** Short pre-maneuver prompt, e.g. "In 5 meters, turn left." */
export function approachText(step: RouteStep, metersAway: number, opts: PhraseOptions): string {
  const d = formatDistance(metersAway, opts.unit, opts.stepLength);
  switch (step.kind) {
    case 'turn':
      return `In ${d}, ${turnPhrase(step.turn!).toLowerCase()}.`;
    case 'floor_change': {
      const fc = step.floorChange!;
      const what = fc.via === 'elevator' ? 'Elevator' : fc.via === 'ramp' ? 'Ramp' : 'Stairs';
      return `${what} in ${d}. Going ${fc.direction} to ${fc.toFloorName}.`;
    }
    case 'arrive':
      return `${step.towardLabel} in ${d}.`;
    default:
      return `Continue for ${d}.`;
  }
}

/** Prompt at the maneuver point itself. */
export function nowText(step: RouteStep, opts: PhraseOptions): string {
  switch (step.kind) {
    case 'turn': {
      const w = walkClause(step, opts);
      return `${turnPhrase(step.turn!)} now${w ? `, then ${w}` : ''}.`;
    }
    case 'floor_change':
      return stepText(step, opts);
    case 'arrive':
      return stepText(step, opts);
    default:
      return stepText(step, opts);
  }
}

export function routeSummary(steps: RouteStep[], route: Route, opts: PhraseOptions, destination: string): string {
  const turns = steps.filter((s) => s.kind === 'turn').length;
  const floors = steps.filter((s) => s.kind === 'floor_change').length;
  const parts = [`Route to ${destination}: ${formatDistance(route.length, opts.unit, opts.stepLength)}`];
  parts.push(turns === 0 ? 'no turns' : `${turns} ${turns === 1 ? 'turn' : 'turns'}`);
  if (floors > 0) parts.push(`${floors} floor ${floors === 1 ? 'change' : 'changes'}`);
  return `${parts.join(', ')}.`;
}
