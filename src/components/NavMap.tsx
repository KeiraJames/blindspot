import { useMemo, useState } from 'react';
import { projectOnSegment, wrapAngle } from '../lib/graph/geometry';
import type { GraphNode, MapGraph, Vec2 } from '../lib/graph/types';
import { SpriteGroup, spriteFor, SPRITES } from './PixelArt';

/** Visible width of the follow-me map, in meters. */
const VIEW_W = 12;
const VIEW_H = 16;
const RAD = 180 / Math.PI;

interface Props {
  graph: MapGraph;
  route?: string[];
  pose: { floorId: string; position: Vec2; heading: number } | null;
  destinationId: string | null;
  className?: string;
}

/**
 * The route ahead, split at the walker's position: what's already walked (faint) and what's
 * left (bold). Only covers the walker's floor; stops at stairs/elevators.
 */
export function splitRoute(
  nodes: Map<string, GraphNode>,
  route: string[],
  pose: { floorId: string; position: Vec2 },
) {
  let best: { i: number; d: number; point: Vec2 } | null = null;
  for (let i = 0; i + 1 < route.length; i++) {
    const a = nodes.get(route[i]!);
    const b = nodes.get(route[i + 1]!);
    if (!a || !b || a.floorId !== pose.floorId || b.floorId !== pose.floorId) continue;
    const p = projectOnSegment(pose.position, a.position, b.position);
    if (!best || p.distance < best.d - 0.01) best = { i, d: p.distance, point: p.point };
  }
  if (!best) return { walked: [] as Vec2[], ahead: [] as Vec2[], leavesFloor: false };
  const walked: Vec2[] = [];
  for (let k = 0; k <= best.i; k++) {
    const n = nodes.get(route[k]!)!;
    if (n.floorId === pose.floorId) walked.push(n.position);
  }
  walked.push(best.point);
  const ahead: Vec2[] = [pose.position];
  let leavesFloor = false;
  for (let k = best.i + 1; k < route.length; k++) {
    const n = nodes.get(route[k]!)!;
    if (n.floorId !== pose.floorId) {
      leavesFloor = true;
      break;
    }
    ahead.push(n.position);
  }
  return { walked, ahead, leavesFloor };
}

/**
 * Follow-me map for the navigator: the walker stays centered near the bottom and the map
 * turns so the walking direction is always up. It shows only rooms, the route ahead and the
 * destination, so it reads at a glance. Decorative for screen readers: every prompt is
 * already spoken and mirrored to the live region.
 */
export function NavMap({ graph, route, pose, destinationId, className }: Props) {
  const nodes = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  // Keep rotation continuous so crossing ±180° doesn't spin the map the long way round.
  // (React's "adjust state while rendering" pattern: remember the previous unwrapped angle.)
  const target = pose ? pose.heading - Math.PI / 2 : null;
  const [rot, setRot] = useState<{ target: number | null; value: number }>({ target, value: target ?? 0 });
  let rotation = rot.value;
  if (target !== null && target !== rot.target) {
    rotation = rot.target === null ? target : rot.value + wrapAngle(target - rot.value);
    setRot({ target, value: rotation });
  }

  if (!pose) return <div className={className} aria-hidden />;

  const floorId = pose.floorId;
  const rooms = graph.rooms.filter((r) => r.floorId === floorId && r.footprint && r.footprint.length >= 3);
  const places = graph.nodes.filter(
    (n) =>
      n.floorId === floorId &&
      (n.kind === 'room' ||
        n.kind === 'poi' ||
        n.kind === 'elevator' ||
        n.kind === 'landing' ||
        (n.kind === 'door' && n.exterior)),
  );
  const { walked, ahead, leavesFloor } = route
    ? splitRoute(nodes, route, pose)
    : { walked: [], ahead: [], leavesFloor: false };
  const destination = destinationId ? nodes.get(destinationId) : undefined;
  const destRoomIds = new Set(destination?.roomIds ?? []);

  const rotDeg = rotation * RAD;
  const transition = reduceMotion ? undefined : 'transform 0.35s linear';
  // Counter-rotation keeps labels and sprites upright while the map turns, animated in step.
  const upright = { transform: `rotate(${-rotDeg}deg)`, transition };
  const line = (pts: Vec2[]) => pts.map((p) => `${p.x},${-p.y}`).join(' ');
  const gridR = 24;
  const gx = Math.round(pose.position.x);
  const gy = Math.round(pose.position.y);

  return (
    <svg
      viewBox={`${-VIEW_W / 2} ${-VIEW_H * 0.7} ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid slice"
      className={className}
      aria-hidden
      style={{ background: 'var(--surface)' }}
    >
      <g
        style={{
          transform: `rotate(${rotDeg}deg) translate(${-pose.position.x}px, ${pose.position.y}px)`,
          transition,
        }}
      >
        <g stroke="var(--grid)" strokeWidth={0.04}>
          {Array.from({ length: gridR * 2 + 1 }, (_, i) => i - gridR).map((k) => (
            <g key={k}>
              <line x1={gx + k} x2={gx + k} y1={-(gy - gridR)} y2={-(gy + gridR)} />
              <line y1={-(gy + k)} y2={-(gy + k)} x1={gx - gridR} x2={gx + gridR} />
            </g>
          ))}
        </g>

        {rooms.map((r) => (
          <polygon
            key={r.id}
            points={line(r.footprint!)}
            fill={destRoomIds.has(r.id) ? 'var(--surface-2)' : 'var(--bg)'}
            stroke={destRoomIds.has(r.id) ? 'var(--accent)' : 'var(--line)'}
            strokeWidth={destRoomIds.has(r.id) ? 0.18 : 0.1}
            strokeLinejoin="miter"
          />
        ))}

        {walked.length > 1 && (
          <polyline
            points={line(walked)}
            fill="none"
            stroke="var(--grid)"
            strokeWidth={0.25}
            strokeLinecap="square"
          />
        )}
        {ahead.length > 1 && (
          <polyline
            points={line(ahead)}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={0.35}
            strokeLinecap="square"
            strokeLinejoin="miter"
            strokeDasharray="0.5 0.25"
          />
        )}

        {places.map((n) => {
          const sprite = spriteFor(n);
          const isDest = n.id === destinationId;
          const size = isDest ? 1.6 : 1.2;
          return (
            <g key={n.id} transform={`translate(${n.position.x} ${-n.position.y})`}>
              <g style={upright}>
                {isDest && (
                  <rect
                    x={-size / 2 - 0.15}
                    y={-size / 2 - 0.15}
                    width={size + 0.3}
                    height={size + 0.3}
                    fill="var(--surface)"
                    stroke="var(--accent)"
                    strokeWidth={0.12}
                  />
                )}
                {sprite ? (
                  <SpriteGroup name={sprite} x={-size / 2} y={-size / 2} pixel={size / 12} />
                ) : (
                  <rect x={-0.2} y={-0.2} width={0.4} height={0.4} fill="var(--muted)" />
                )}
                <text
                  y={size / 2 + 0.55}
                  textAnchor="middle"
                  fontSize={isDest ? 0.6 : 0.48}
                  fontFamily="var(--font-pixel)"
                  fontWeight={isDest ? 700 : 500}
                  fill={isDest ? 'var(--accent)' : 'var(--fg)'}
                  stroke="var(--surface)"
                  strokeWidth={0.12}
                  paintOrder="stroke"
                >
                  {n.label}
                </text>
              </g>
            </g>
          );
        })}
        {leavesFloor && ahead.length > 0 && (
          <g transform={`translate(${ahead.at(-1)!.x} ${-ahead.at(-1)!.y})`}>
            <text
              style={upright}
              y={-0.7}
              textAnchor="middle"
              fontSize={0.5}
              fontFamily="var(--font-pixel)"
              fill="var(--warn)"
            >
              Change floor here
            </text>
          </g>
        )}
      </g>

      {/* The walker: fixed at the origin, always facing up. */}
      <circle r={0.75} fill="var(--surface)" stroke="var(--line)" strokeWidth={0.08} opacity={0.9} />
      <SpriteGroup name="arrow" x={-0.54} y={-0.54} pixel={1.08 / SPRITES.arrow.length} />

      {/* North indicator so sighted helpers can relate the map to the building. */}
      <g transform={`translate(${VIEW_W / 2 - 0.9} ${-VIEW_H * 0.7 + 0.9})`}>
        <circle r={0.6} fill="var(--surface)" stroke="var(--line)" strokeWidth={0.08} />
        <g style={{ transform: `rotate(${rotDeg}deg)`, transition }}>
          <path d="M0 -0.45 L0.2 0 L-0.2 0 Z" fill="var(--accent)" />
          <path d="M0 0.45 L0.2 0 L-0.2 0 Z" fill="var(--muted)" />
        </g>
      </g>
    </svg>
  );
}
