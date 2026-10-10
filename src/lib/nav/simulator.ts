import { bearing, dist, wrapAngle } from '../graph/geometry';
import type { GraphIndex } from '../graph/graph';
import type { Vec2 } from '../graph/types';
import type { MapPose } from './tracker';

/**
 * Walk simulator for browsers and the iOS simulator (no ARKit). It emits map-frame poses
 * at 5 Hz. Autopilot follows the current route at walking speed; manual mode moves with
 * arrow keys or on-screen buttons. "Wander" deliberately drifts off the route to exercise
 * rerouting.
 */
export class WalkSimulator {
  pose: MapPose;
  autopilot = false;
  wander = false;
  speed = 1.2;
  private timer: ReturnType<typeof setInterval> | null = null;
  private path: { floorId: string; p: Vec2 }[] = [];
  private pathIndex = 0;
  private wanderAt = 0;

  constructor(
    private index: GraphIndex,
    startNodeId: string,
    heading: number,
    private emit: (p: MapPose) => void,
  ) {
    const n = index.node(startNodeId);
    this.pose = { floorId: n.floorId, position: { ...n.position }, heading, tracking: 'normal', timestamp: Date.now() };
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(0.2), 200);
    this.emit(this.pose);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  followRoute(nodeIds: string[]) {
    this.path = nodeIds.map((id) => {
      const n = this.index.node(id);
      return { floorId: n.floorId, p: n.position };
    });
    this.pathIndex = 0;
    let best = Infinity;
    // Resume from the closest waypoint on our floor (after reroutes).
    this.path.forEach((w, i) => {
      if (w.floorId !== this.pose.floorId) return;
      const d = dist(w.p, this.pose.position);
      if (d < best) {
        best = d;
        this.pathIndex = i;
      }
    });
  }

  step(meters: number) {
    const h = this.pose.heading;
    this.move({ x: this.pose.position.x + Math.cos(h) * meters, y: this.pose.position.y + Math.sin(h) * meters });
  }

  turn(radians: number) {
    this.pose = { ...this.pose, heading: wrapAngle(this.pose.heading + radians), timestamp: Date.now() };
    this.emit(this.pose);
  }

  setFloor(floorId: string, at?: Vec2) {
    this.pose = { ...this.pose, floorId, position: at ? { ...at } : this.pose.position, timestamp: Date.now() };
    this.emit(this.pose);
  }

  setTracking(tracking: MapPose['tracking']) {
    this.pose = { ...this.pose, tracking, timestamp: Date.now() };
    this.emit(this.pose);
  }

  private move(p: Vec2) {
    this.pose = { ...this.pose, position: p, timestamp: Date.now() };
    this.emit(this.pose);
  }

  private tick(dt: number) {
    if (!this.autopilot || this.path.length === 0) {
      this.pose = { ...this.pose, timestamp: Date.now() };
      this.emit(this.pose);
      return;
    }
    if (this.wander) {
      this.wanderAt += dt;
      // Head off at 70° to the route for a few seconds.
      if (this.wanderAt < 0.25) this.pose = { ...this.pose, heading: wrapAngle(this.pose.heading + 1.2) };
      this.step(this.speed * dt);
      return;
    }
    this.wanderAt = 0;
    let budget = this.speed * dt;
    while (budget > 0 && this.pathIndex < this.path.length) {
      const target = this.path[this.pathIndex]!;
      if (target.floorId !== this.pose.floorId) {
        // Take the stairs/elevator: jump floors at the landing.
        this.pose = { ...this.pose, floorId: target.floorId, position: { ...target.p } };
        this.pathIndex++;
        break;
      }
      const d = dist(this.pose.position, target.p);
      if (d <= budget) {
        this.pose = { ...this.pose, position: { ...target.p } };
        budget -= d;
        this.pathIndex++;
        continue;
      }
      const h = bearing(this.pose.position, target.p);
      this.pose = {
        ...this.pose,
        heading: h,
        position: { x: this.pose.position.x + Math.cos(h) * budget, y: this.pose.position.y + Math.sin(h) * budget },
      };
      budget = 0;
    }
    if (this.pathIndex >= this.path.length) this.autopilot = false;
    this.pose = { ...this.pose, timestamp: Date.now() };
    this.emit(this.pose);
  }
}
