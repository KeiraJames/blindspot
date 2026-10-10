import { useRef } from 'react';
import { FloorPlan } from '../../components/FloorPlan';
import { useStudio } from '../../state/studio';
import { ghostFor, usePlacement } from './placement';

/** Pointer editing on the floor plan. Every action here also exists in the Inspector for keyboard and VoiceOver users. */
export function StudioCanvas({ highlight }: { highlight: string[] }) {
  const s = useStudio();
  const placement = usePlacement();
  const dragging = useRef<string | null>(null);
  const moved = useRef(false);
  if (!s.graph || !s.floorId) return null;

  return (
    <FloorPlan
      graph={s.graph}
      floorId={s.floorId}
      selectedIds={s.selection}
      highlightIds={highlight}
      ghost={ghostFor(placement.draft, placement.transform)}
      className="w-full h-full min-h-80 rounded-2xl border border-line bg-surface"
      onNodePointerDown={(node, e) => {
        if (s.tool === 'connect') {
          const first = s.selection[0];
          if (first && first !== node.id) {
            s.connectNodes(first, node.id);
            s.select(node.id);
          } else s.select(node.id);
          return;
        }
        s.select(node.id, e.shiftKey || e.metaKey);
        if (s.tool === 'select') {
          (e.currentTarget.ownerSVGElement ?? (e.currentTarget as unknown as SVGSVGElement)).setPointerCapture?.(e.pointerId);
          dragging.current = node.id;
          moved.current = false;
          s.beginDrag();
        }
      }}
      onBackgroundPointerDown={(p) => {
        if (s.tool === 'add') s.addNode(p);
        else s.select(null);
      }}
      onPointerMove={(p) => {
        if (!dragging.current) return;
        moved.current = true;
        s.dragNode(dragging.current, p);
      }}
      onPointerUp={() => {
        if (dragging.current) s.endDrag();
        dragging.current = null;
      }}
    />
  );
}
