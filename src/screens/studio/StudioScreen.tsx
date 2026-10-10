import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Screen } from '../../components/Screen';
import { Button, Card, cx, ErrorBox, Field, Select, Spinner } from '../../components/ui';
import { emptyGraph, type EdgeKind, type NodeKind } from '../../lib/graph/types';
import { validateGraph } from '../../lib/graph/validate';
import { canEdit } from '../../firebase/repo';
import { useDraft, useMap } from '../../state/queries';
import { useRepo } from '../../state/session';
import { useStudio, type Tool } from '../../state/studio';
import { Inspector } from './Inspector';
import { IssuesPanel } from './IssuesPanel';
import { ScansPanel } from './ScansPanel';
import { StudioCanvas } from './StudioCanvas';
import { VersionsPanel } from './VersionsPanel';

const Preview3D = lazy(() => import('./Preview3D').then((m) => ({ default: m.Preview3D })));

type Panel = 'place' | 'scans' | 'checks' | 'publish' | '3d';
const PANELS: { id: Panel; label: string }[] = [
  { id: 'place', label: 'Places' },
  { id: 'scans', label: 'Scans' },
  { id: 'checks', label: 'Checks' },
  { id: 'publish', label: 'Publish' },
  { id: '3d', label: '3D' },
];

export default function StudioScreen() {
  const { mapId } = useParams();
  const map = useMap(mapId);
  const draft = useDraft(mapId);
  const repo = useRepo();
  const s = useStudio();
  const [panel, setPanel] = useState<Panel>('place');
  const [highlight, setHighlight] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (draft.isSuccess && mapId && s.mapId !== mapId) s.load(mapId, draft.data ?? emptyGraph());
  }, [draft.isSuccess, draft.data, mapId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave the draft shortly after edits.
  useEffect(() => {
    if (!s.dirty || !s.graph || !mapId || s.mapId !== mapId) return;
    const t = setTimeout(async () => {
      setSaving(true);
      try {
        await repo.saveDraft(mapId, s.graph!);
        s.markSaved();
        setSaveError(null);
      } catch (e) {
        setSaveError(e);
      } finally {
        setSaving(false);
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [s.graph, s.dirty, mapId, repo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea, select');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && s.selection.length) {
        e.preventDefault();
        s.deleteNodes(s.selection);
      } else if (!typing && s.selection.length === 1 && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const d = e.shiftKey ? 1 : 0.25;
        const [dx, dy] = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }[e.key] ?? [0, 0];
        s.nudge(s.selection[0]!, dx!, dy!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s]);

  const result = useMemo(() => (s.graph ? validateGraph(s.graph) : null), [s.graph]);

  if (map.isLoading || draft.isLoading || !s.graph || s.mapId !== mapId) return <Spinner label="Opening Map Studio" />;
  if (!map.data) return <ErrorBox error="Map not found" />;
  if (!canEdit(map.data.role)) return <ErrorBox error="You can navigate this map but not edit it." />;

  const floor = s.graph.floors.find((f) => f.id === s.floorId) ?? s.graph.floors[0]!;
  const errors = result?.issues.filter((i) => i.severity === 'error').length ?? 0;
  const warnings = (result?.issues.length ?? 0) - errors;

  return (
    <Screen
      title={`Studio: ${map.data.name}`}
      back={`/maps/${mapId}`}
      wide
      actions={
        <div className="flex gap-1 items-center">
          <span className="text-sm text-muted hidden sm:inline" role="status">
            {saving ? 'Saving…' : s.dirty ? 'Unsaved' : 'Saved'}
          </span>
          <Button variant="ghost" onClick={s.undo} disabled={s.past.length === 0}>
            Undo
          </Button>
          <Button variant="ghost" onClick={s.redo} disabled={s.future.length === 0}>
            Redo
          </Button>
        </div>
      }
    >
      <ErrorBox error={saveError} />
      <div role="tablist" aria-label="Floors" className="flex gap-2 overflow-x-auto pb-1">
        {[...s.graph.floors]
          .sort((a, b) => b.level - a.level)
          .map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={f.id === floor.id}
              onClick={() => s.setFloor(f.id)}
              className={cx('min-h-12 px-4 rounded-xl border font-semibold whitespace-nowrap', f.id === floor.id ? 'bg-accent text-accent-fg border-accent' : 'border-line bg-surface-2')}
            >
              {f.name}
            </button>
          ))}
        <Button onClick={s.addFloor}>+ Floor</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-2 min-w-0">
          <div role="toolbar" aria-label="Canvas tools" className="flex flex-wrap gap-2 items-end">
            {(['select', 'add', 'connect'] as Tool[]).map((t) => (
              <Button key={t} variant={s.tool === t ? 'primary' : 'secondary'} aria-pressed={s.tool === t} onClick={() => s.setTool(t)}>
                {{ select: 'Select / move', add: 'Add', connect: 'Connect' }[t]}
              </Button>
            ))}
            {s.tool === 'add' && (
              <Select label="Add" value={s.addKind} onChange={(e) => s.setAddKind(e.target.value as NodeKind)}>
                <option value="junction">Hallway point</option>
                <option value="room">Room</option>
                <option value="door">Door</option>
                <option value="poi">Point of interest</option>
                <option value="landing">Stair landing</option>
                <option value="elevator">Elevator stop</option>
              </Select>
            )}
            {s.tool === 'connect' && (
              <Select label="Connect by" value={s.connectKind} onChange={(e) => s.setConnectKind(e.target.value as EdgeKind)}>
                <option value="walk">Walkway</option>
                <option value="door">Through a door</option>
                <option value="ramp">Ramp</option>
              </Select>
            )}
          </div>
          <p className="text-sm text-muted">
            {s.tool === 'select' && 'Tap a place to edit it; drag to move. Arrow keys nudge the selected place.'}
            {s.tool === 'add' && 'Tap empty space to add a place.'}
            {s.tool === 'connect' && 'Tap one place, then another, to connect them. Use the Places panel for stairs and elevators between floors.'}
          </p>
          <div className="h-[55vh] lg:h-[70vh]">
            <StudioCanvas highlight={highlight} />
          </div>
          <details className="rounded-2xl border border-line p-3">
            <summary className="font-semibold min-h-12 flex items-center cursor-pointer">Floor settings</summary>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Field label="Name" value={floor.name} onChange={(e) => s.updateFloor(floor.id, { name: e.target.value })} />
              <Field label="Level" type="number" value={floor.level} onChange={(e) => s.updateFloor(floor.id, { level: Number(e.target.value) })} />
              <Field label="Height above ground (m)" type="number" step="0.1" value={floor.elevation} onChange={(e) => s.updateFloor(floor.id, { elevation: Number(e.target.value) })} />
              <div className="flex items-end">
                <Button variant="danger" block disabled={s.graph.floors.length <= 1} onClick={() => confirm(`Delete ${floor.name} and everything on it?`) && s.deleteFloor(floor.id)}>
                  Delete floor
                </Button>
              </div>
            </div>
          </details>
        </div>

        <aside className="flex flex-col gap-3 min-w-0" aria-label="Studio panels">
          <div role="tablist" aria-label="Panels" className="grid grid-cols-5 gap-1">
            {PANELS.map((p) => (
              <button
                key={p.id}
                role="tab"
                id={`tab-${p.id}`}
                aria-selected={panel === p.id}
                aria-controls={`panel-${p.id}`}
                onClick={() => setPanel(p.id)}
                className={cx('min-h-12 rounded-xl text-sm font-semibold border', panel === p.id ? 'bg-accent text-accent-fg border-accent' : 'border-line bg-surface-2')}
              >
                {p.label}
                {p.id === 'checks' && result && result.issues.length > 0 && <span className="sr-only">, {result.issues.length} issues</span>}
                {p.id === 'checks' && errors + warnings > 0 && <span aria-hidden> ({errors + warnings})</span>}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${panel}`} aria-labelledby={`tab-${panel}`}>
            {panel === 'place' && <Inspector />}
            {panel === 'scans' && <ScansPanel mapId={mapId!} />}
            {panel === 'checks' && result && <IssuesPanel result={result} onShow={setHighlight} />}
            {panel === 'publish' && result && <VersionsPanel mapId={mapId!} result={result} />}
            {panel === '3d' && (
              <Suspense fallback={<Spinner label="Loading 3D" />}>
                <Preview3D graph={s.graph} floorId={s.floorId} />
              </Suspense>
            )}
          </div>
          <Card>
            <p className="text-sm text-muted">
              {s.graph.nodes.length} places · {s.graph.edges.length} connections · {s.graph.rooms.length} scanned rooms ·{' '}
              {errors === 0 ? 'no errors' : `${errors} errors`}
            </p>
          </Card>
        </aside>
      </div>
    </Screen>
  );
}
