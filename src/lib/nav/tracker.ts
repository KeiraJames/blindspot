import type { Route } from '../graph/astar';
import { bearing, dist, projectOnSegment, turnAngle } from '../graph/geometry';
import type { GraphIndex } from '../graph/graph';
import type { Vec2 } from '../graph/types';
import { classifyTurn, type RouteStep, type TurnDirection } from './guidance';

export interface MapPose {
  floorId: string;
  position: Vec2;
  /** Facing bearing in map frame (radians, CCW from +x). */
  heading: number;
  tracking: 'normal' | 'limited' | 'lost';
  timestamp: number;
}

export type TrackerEvent =
  | { type: 'approach'; step: RouteStep; metersAway: number }
  | { type: 'maneuver'; step: RouteStep }
  | { type: 'veer'; direction: TurnDirection; error: number }
  | { type: 'on_course' }
  | { type: 'off_route'; distance: number }
  | { type: 'floor_reached'; floorId: string }
  | { type: 'tracking_lost' }
  | { type: 'tracking_restored' }
  | { type: 'arrived' };

export interface TrackerConfig {
  /** Distance before a maneuver for the early "In N meters" prompt. */
  approachDistance: number;
  /** Distance at which the maneuver prompt fires. */
  maneuverDistance: number;
  /** Lateral distance from the route that counts as off-route. */
  offRouteDistance: number;
  /** Time spent beyond offRouteDistance before rerouting (ms). */
  offRouteGraceMs: number;
  /** Heading error that triggers a veer correction (radians). */
  veerThreshold: number;
  /** How long the heading error must persist (ms). */
  veerGraceMs: number;
  arrivalRadius: number;
  /** Look-ahead along the route used for the heading target. */
  lookAhead: number;
}

export const DEFAULT_TRACKER_CONFIG: TrackerConfig = {
  approachDistance: 8,
  maneuverDistance: 2,
  offRouteDistance: 3,
  offRouteGraceMs: 2500,
  veerThreshold: (40 * Math.PI) / 180,
  veerGraceMs: 1500,
  arrivalRadius: 1.5,
  lookAhead: 2.5,
};

interface Segment {
  a: Vec2;
  b: Vec2;
  floorId: string;
  vertical: boolean;
  length: number;
  /** Cumulative route distance at segment start. */
  startDistance: number;
}

/**
 * Follows a walker along a route. Feed it map-frame poses; it emits prompts at the right
 * distances, detects veering and leaving the route, and reports arrival. It never moves
 * backwards along the route, so a brief tracking glitch cannot replay old prompts.
 */
export class RouteTracker {
  readonly segments: Segment[];
  readonly totalLength: number;
  private segIndex = 0;
  private progress = 0;
  private announcedApproach = new Set<number>();
  private announcedManeuver = new Set<number>();
  private offSince: number | null = null;
  private veerSince: number | null = null;
  private veering = false;
  private lost = false;
  private arrived = false;
  private lastFloor: string | null = null;

  constructor(
    private index: GraphIndex,
    readonly route: Route,
    readonly steps: RouteStep[],
    private config: TrackerConfig = DEFAULT_TRACKER_CONFIG,
  ) {
    let acc = 0;
    this.segments = route.edges.map((_e, i) => {
      const a = index.node(route.nodeIds[i]!);
      const b = index.node(route.nodeIds[i + 1]!);
      const vertical = a.floorId !== b.floorId;
      const length = vertical ? 0 : dist(a.position, b.position);
      const s: Segment = { a: a.position, b: b.position, floorId: vertical ? b.floorId : a.floorId, vertical, length, startDistance: acc };
      acc += length;
      return s;
    });
    this.totalLength = acc;
  }

  get distanceTravelled(): number {
    return this.progress;
  }
  get remaining(): number {
    return Math.max(0, this.totalLength - this.progress);
  }
  get currentSegment(): number {
    return this.segIndex;
  }
  get hasArrived(): boolean {
    return this.arrived;
  }

  /** Route distance at which a step's maneuver happens. */
  stepDistance(step: RouteStep): number {
    if (step.nodeIndex >= this.segments.length) return this.totalLength;
    return this.segments[step.nodeIndex]!.startDistance;
  }

  /** The next maneuver (turn, floor change, or arrival) ahead of the walker. */
  nextStep(): RouteStep | undefined {
    return this.steps.find(
      (s) => (s.kind === 'turn' || s.kind === 'floor_change' || s.kind === 'arrive') && this.stepDistance(s) >= this.progress - 0.01 && !this.announcedManeuver.has(this.steps.indexOf(s)),
    );
  }

  /** Point on the route `ahead` meters past the current progress, on the walker's floor. */
  lookAheadPoint(ahead: number): Vec2 | null {
    const target = this.progress + ahead;
    for (let i = this.segIndex; i < this.segments.length; i++) {
      const s = this.segments[i]!;
      if (s.vertical) return i === this.segIndex ? null : s.a;
      const end = s.startDistance + s.length;
      if (target <= end || i === this.segments.length - 1) {
        const t = s.length === 0 ? 1 : Math.min(1, Math.max(0, (target - s.startDistance) / s.length));
        return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
      }
    }
    return null;
  }

  update(pose: MapPose): TrackerEvent[] {
    const out: TrackerEvent[] = [];
    if (this.arrived) return out;

    if (pose.tracking === 'lost') {
      if (!this.lost) out.push({ type: 'tracking_lost' });
      this.lost = true;
      return out;
    }
    if (this.lost) {
      this.lost = false;
      out.push({ type: 'tracking_restored' });
    }

    if (this.lastFloor !== null && pose.floorId !== this.lastFloor) out.push({ type: 'floor_reached', floorId: pose.floorId });
    this.lastFloor = pose.floorId;

    // On a different floor than the current segment: jump to the stairs/elevator leading there.
    const cur = this.segments[this.segIndex];
    if (cur && !cur.vertical && cur.floorId !== pose.floorId) {
      for (let i = this.segIndex + 1; i < this.segments.length; i++) {
        const s = this.segments[i]!;
        if (s.vertical && s.floorId === pose.floorId) {
          this.segIndex = i;
          break;
        }
      }
    }

    // Skip past vertical segments once the walker is on the destination floor of that segment.
    while (this.segIndex < this.segments.length && this.segments[this.segIndex]!.vertical) {
      const s = this.segments[this.segIndex]!;
      if (pose.floorId !== s.floorId) break;
      this.markManeuversUpTo(this.segIndex + 1);
      this.segIndex++;
      this.progress = s.startDistance;
    }

    // Match against the current and a few upcoming segments on this floor.
    let best: { i: number; d: number; along: number } | null = null;
    for (let i = this.segIndex; i < Math.min(this.segments.length, this.segIndex + 4); i++) {
      const s = this.segments[i]!;
      if (s.vertical) break;
      if (s.floorId !== pose.floorId) continue;
      const proj = projectOnSegment(pose.position, s.a, s.b);
      if (!best || proj.distance < best.d - 0.25) best = { i, d: proj.distance, along: s.startDistance + proj.t * s.length };
    }

    if (!best) {
      // Waiting at stairs/elevator for the floor to change: stay quiet.
      return out;
    }

    // Off-route detection with a grace period.
    if (best.d > this.config.offRouteDistance) {
      this.offSince ??= pose.timestamp;
      if (pose.timestamp - this.offSince >= this.config.offRouteGraceMs) {
        this.offSince = null;
        out.push({ type: 'off_route', distance: best.d });
        return out;
      }
    } else {
      this.offSince = null;
    }

    if (best.along > this.progress) {
      this.progress = best.along;
      this.segIndex = best.i;
    }

    // Arrival.
    const last = this.segments[this.segments.length - 1];
    const dest = last ? last.b : this.index.node(this.route.nodeIds[0]!).position;
    const destFloor = this.index.node(this.route.nodeIds[this.route.nodeIds.length - 1]!).floorId;
    if (pose.floorId === destFloor && (dist(pose.position, dest) <= this.config.arrivalRadius || this.remaining < 0.5)) {
      this.arrived = true;
      out.push({ type: 'arrived' });
      return out;
    }

    // Upcoming maneuver prompts.
    const next = this.nextStep();
    if (next) {
      const k = this.steps.indexOf(next);
      const away = this.stepDistance(next) - this.progress;
      if (away <= this.config.maneuverDistance && next.kind !== 'arrive') {
        this.announcedManeuver.add(k);
        this.announcedApproach.add(k);
        out.push({ type: 'maneuver', step: next });
      } else if (away <= this.config.approachDistance && !this.announcedApproach.has(k) && away > this.config.maneuverDistance + 1) {
        this.announcedApproach.add(k);
        out.push({ type: 'approach', step: next, metersAway: away });
      }
    }

    // Heading guidance toward a look-ahead point.
    const target = this.lookAheadPoint(this.config.lookAhead);
    if (target && dist(pose.position, target) > 0.5) {
      const err = turnAngle(pose.heading, bearing(pose.position, target));
      if (Math.abs(err) > this.config.veerThreshold) {
        this.veerSince ??= pose.timestamp;
        if (!this.veering && pose.timestamp - this.veerSince >= this.config.veerGraceMs) {
          this.veering = true;
          out.push({ type: 'veer', direction: classifyTurn(err), error: err });
        }
      } else {
        this.veerSince = null;
        if (this.veering) {
          this.veering = false;
          out.push({ type: 'on_course' });
        }
      }
    }
    return out;
  }

  private markManeuversUpTo(nodeIndex: number) {
    this.steps.forEach((s, k) => {
      if (s.nodeIndex < nodeIndex && s.kind !== 'arrive') {
        this.announcedManeuver.add(k);
        this.announcedApproach.add(k);
      }
    });
  }

  /** Heading error to the route, for continuous haptic/AR cues. Null when not applicable. */
  headingError(pose: MapPose): number | null {
    const target = this.lookAheadPoint(this.config.lookAhead);
    if (!target) return null;
    return turnAngle(pose.heading, bearing(pose.position, target));
  }
}
