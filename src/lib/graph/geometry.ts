import type { Transform2D, Vec2 } from './types';

export const TAU = Math.PI * 2;

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Bearing from a to b in radians, CCW from +x. */
export function bearing(a: Vec2, b: Vec2): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Wrap an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  if (r > Math.PI) r -= TAU;
  return r;
}

/** Signed turn from heading `from` to heading `to`. Positive = left (CCW). */
export function turnAngle(from: number, to: number): number {
  return wrapAngle(to - from);
}

export function applyTransform(t: Transform2D, p: Vec2): Vec2 {
  const c = Math.cos(t.theta);
  const s = Math.sin(t.theta);
  return { x: c * p.x - s * p.y + t.tx, y: s * p.x + c * p.y + t.ty };
}

export function composeTransforms(outer: Transform2D, inner: Transform2D): Transform2D {
  const p = applyTransform(outer, { x: inner.tx, y: inner.ty });
  return { theta: wrapAngle(outer.theta + inner.theta), tx: p.x, ty: p.y };
}

export function invertTransform(t: Transform2D): Transform2D {
  const c = Math.cos(-t.theta);
  const s = Math.sin(-t.theta);
  return { theta: -t.theta, tx: -(c * t.tx - s * t.ty), ty: -(s * t.tx + c * t.ty) };
}

export const IDENTITY: Transform2D = { theta: 0, tx: 0, ty: 0 };

/** Closest point on segment ab to p, with the parameter t in [0, 1]. */
export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, t, distance: dist(p, point) };
}

export function centroid(points: Vec2[]): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/** Area-weighted centroid of a simple polygon; falls back to the vertex mean when degenerate. */
export function polygonCentroid(poly: Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-9) return centroid(poly);
  return { x: cx / (3 * a), y: cy / (3 * a) };
}
