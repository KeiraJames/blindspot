import { useMemo, useRef, type PointerEvent as RPointerEvent } from 'react';
import type { GraphNode, MapGraph, NodeKind, Vec2 } from '../lib/graph/types';

export interface FloorPlanProps {
  graph: MapGraph;
  floorId: string;
  /** Route to highlight (node ids). */
  route?: string[];
  pose?: { position: Vec2; heading: number } | null;
  selectedIds?: string[];
  highlightIds?: string[];
  /** Extra footprint (e.g. a scan being placed), in map frame. */
  ghost?: { footprint: Vec2[]; doors: Vec2[] } | null;
  onNodePointerDown?: (node: GraphNode, e: RPointerEvent<SVGElement>, toMap: (clientX: number, clientY: number) => Vec2) => void;
  onBackgroundPointerDown?: (p: Vec2, e: RPointerEvent<SVGSVGElement>) => void;
  onPointerMove?: (p: Vec2, e: RPointerEvent<SVGSVGElement>) => void;
  onPointerUp?: (p: Vec2, e: RPointerEvent<SVGSVGElement>) => void;
  className?: string;
  /** Accessible description; set when the plan conveys information not available as text. */
  label?: string;
  showLabels?: boolean;
  padding?: number;
}

const KIND_FILL: Record<NodeKind, string> = {
  room: 'var(--accent)',
  door: 'var(--ok)',
  junction: 'var(--muted)',
  landing: 'var(--warn)',
  elevator: 'var(--warn)',
  poi: 'var(--focus)',
};

/** SVG floor plan. Map y points up; SVG y points down, so y is negated when drawing. */
export function FloorPlan({
  graph,
  floorId,
  route,
  pose,
  selectedIds = [],
  highlightIds = [],
  ghost,
  onNodePointerDown,
  onBackgroundPointerDown,
  onPointerMove,
  onPointerUp,
  className,
  label,
  showLabels = true,
  padding = 3,
}: FloorPlanProps) {
  const nodes = useMemo(() => graph.nodes.filter((n) => n.floorId === floorId), [graph, floorId]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const rooms = graph.rooms.filter((r) => r.floorId === floorId && r.footprint && r.footprint.length >= 3);

  const box = useMemo(() => {
    const pts: Vec2[] = [...nodes.map((n) => n.position), ...rooms.flatMap((r) => r.footprint!), ...(ghost?.footprint ?? [])];
    if (pose) pts.push(pose.position);
    if (pts.length === 0) return { x: -10, y: -10, w: 20, h: 20 };
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => -p.y);
    const minX = Math.min(...xs) - padding;
    const minY = Math.min(...ys) - padding;
    return { x: minX, y: minY, w: Math.max(8, Math.max(...xs) + padding - minX), h: Math.max(8, Math.max(...ys) + padding - minY) };
  }, [nodes, rooms, ghost, pose, padding]);

  const edges = graph.edges.filter((e) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    return a && b && (a.floorId === floorId || b.floorId === floorId);
  });

  const routeEdges = new Set<string>();
  if (route) for (let i = 0; i + 1 < route.length; i++) routeEdges.add([route[i], route[i + 1]].sort().join('|'));

  const scale = Math.max(box.w, box.h) / 40; // label/marker size relative to plan size
  const svgRef = useRef<SVGSVGElement>(null);
  const toMap = (clientX: number, clientY: number): Vec2 => {
    const svgEl = svgRef.current;
    if (!svgEl) return { x: 0, y: 0 };
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const m = svgEl.getScreenCTM();
    const p = m ? pt.matrixTransform(m.inverse()) : pt;
    return { x: p.x, y: -p.y };
  };

  const poly = (pts: Vec2[]) => pts.map((p) => `${p.x},${-p.y}`).join(' ');

  return (
    <svg
      ref={svgRef}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || (e.target as Element).getAttribute('data-bg')) onBackgroundPointerDown?.(toMap(e.clientX, e.clientY), e);
      }}
      onPointerMove={(e) => onPointerMove?.(toMap(e.clientX, e.clientY), e)}
      onPointerUp={(e) => onPointerUp?.(toMap(e.clientX, e.clientY), e)}
    >
      <rect data-bg="1" x={box.x} y={box.y} width={box.w} height={box.h} fill="var(--surface)" />
      {/* 1 m grid */}
      <g stroke="var(--line)" strokeWidth={0.02} opacity={0.5}>
        {Array.from({ length: Math.ceil(box.w) + 1 }, (_, i) => Math.floor(box.x) + i).map((x) => (
          <line key={`gx${x}`} x1={x} x2={x} y1={box.y} y2={box.y + box.h} data-bg="1" />
        ))}
        {Array.from({ length: Math.ceil(box.h) + 1 }, (_, i) => Math.floor(box.y) + i).map((y) => (
          <line key={`gy${y}`} y1={y} y2={y} x1={box.x} x2={box.x + box.w} data-bg="1" />
        ))}
      </g>
      {rooms.map((r) => (
        <polygon key={r.id} points={poly(r.footprint!)} fill="var(--surface-2)" stroke="var(--fg)" strokeWidth={0.08} />
      ))}
      {ghost && (
        <g opacity={0.8}>
          <polygon points={poly(ghost.footprint)} fill="none" stroke="var(--accent)" strokeWidth={0.1} strokeDasharray="0.3 0.2" />
          {ghost.doors.map((d, i) => (
            <circle key={i} cx={d.x} cy={-d.y} r={0.3} fill="var(--accent)" />
          ))}
        </g>
      )}
      {edges.map((e) => {
        const a = byId.get(e.from)!;
        const b = byId.get(e.to)!;
        const onRoute = routeEdges.has([e.from, e.to].sort().join('|'));
        if (a.floorId !== b.floorId) {
          const here = a.floorId === floorId ? a : b;
          return (
            <text key={e.id} x={here.position.x + 0.4} y={-here.position.y - 0.4} fontSize={scale * 1.1} fill="var(--warn)">
              {e.kind === 'elevator' ? '⇅' : '↕'}
            </text>
          );
        }
        return (
          <line
            key={e.id}
            x1={a.position.x}
            y1={-a.position.y}
            x2={b.position.x}
            y2={-b.position.y}
            stroke={onRoute ? 'var(--accent)' : 'var(--muted)'}
            strokeWidth={onRoute ? 0.35 : 0.1}
            strokeDasharray={e.kind === 'door' ? '0.25 0.15' : undefined}
            strokeLinecap="round"
          />
        );
      })}
      {nodes.map((n) => {
        const selected = selectedIds.includes(n.id);
        const highlighted = highlightIds.includes(n.id);
        const r = (n.kind === 'room' ? 0.45 : n.kind === 'junction' ? 0.25 : 0.35) * Math.max(1, scale * 0.8);
        return (
          <g key={n.id} onPointerDown={onNodePointerDown ? (e) => (e.stopPropagation(), onNodePointerDown(n, e, toMap)) : undefined} style={{ cursor: onNodePointerDown ? 'pointer' : undefined }}>
            <circle cx={n.position.x} cy={-n.position.y} r={r * 2.2} fill="transparent" />
            <circle
              cx={n.position.x}
              cy={-n.position.y}
              r={r}
              fill={KIND_FILL[n.kind]}
              stroke={selected ? 'var(--fg)' : highlighted ? 'var(--danger)' : 'none'}
              strokeWidth={selected || highlighted ? 0.15 * Math.max(1, scale) : 0}
            />
            {showLabels && (n.kind !== 'junction' || selected) && (
              <text x={n.position.x + r + 0.15} y={-n.position.y + r * 0.4} fontSize={scale * 0.9} fill="var(--fg)" style={{ pointerEvents: 'none' }}>
                {n.label}
              </text>
            )}
          </g>
        );
      })}
      {pose && (
        <g transform={`translate(${pose.position.x} ${-pose.position.y}) rotate(${(-pose.heading * 180) / Math.PI})`}>
          <circle r={0.6 * Math.max(1, scale * 0.8)} fill="var(--danger)" stroke="var(--fg)" strokeWidth={0.1} />
          <path d={`M 0 0 L ${1.6 * Math.max(1, scale * 0.8)} 0`} stroke="var(--fg)" strokeWidth={0.2} />
        </g>
      )}
    </svg>
  );
}
