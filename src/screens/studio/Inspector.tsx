import { useState } from 'react';
import { Button, Card, Field, Select, Toggle } from '../../components/ui';
import { POI_LABELS, type EdgeKind, type NodeKind, type PoiType } from '../../lib/graph/types';
import { useStudio } from '../../state/studio';

const KIND_LABELS: Record<NodeKind, string> = {
  room: 'Room',
  door: 'Door or opening',
  junction: 'Hallway point',
  landing: 'Stair landing',
  elevator: 'Elevator stop',
  poi: 'Point of interest',
};

const EDGE_LABELS: Record<EdgeKind, string> = {
  walk: 'Walkway',
  door: 'Through a door',
  stairs: 'Stairs',
  elevator: 'Elevator',
  ramp: 'Ramp',
};

/** Form-based editor for the selected place; also the keyboard/VoiceOver path for all canvas edits. */
export function Inspector() {
  const s = useStudio();
  const [target, setTarget] = useState('');
  const [edgeKind, setEdgeKind] = useState<EdgeKind>('walk');
  const g = s.graph!;
  const id = s.selection[0];
  const node = g.nodes.find((n) => n.id === id);

  if (!node) {
    const onFloor = g.nodes
      .filter((n) => n.floorId === s.floorId)
      .sort((a, b) => a.label.localeCompare(b.label));
    return (
      <Card className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">Places on this floor ({onFloor.length})</h2>
        <Button variant="primary" onClick={() => s.addNode({ x: 0, y: 0 }, 'room')}>
          Add a place
        </Button>
        <ul className="flex flex-col gap-1 max-h-96 overflow-auto">
          {onFloor.map((n) => (
            <li key={n.id}>
              <Button block className="justify-between text-left" onClick={() => s.select(n.id)}>
                <span>{n.label}</span>
                <span className="text-muted text-sm font-normal">{KIND_LABELS[n.kind]}</span>
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  const edges = g.edges.filter((e) => e.from === node.id || e.to === node.id);
  const other = (eid: string) => {
    const e = g.edges.find((x) => x.id === eid)!;
    return g.nodes.find((n) => n.id === (e.from === node.id ? e.to : e.from));
  };
  const floorName = (fid: string) => g.floors.find((f) => f.id === fid)?.name ?? '';
  const candidates = g.nodes.filter(
    (n) => n.id !== node.id && !edges.some((e) => e.from === n.id || e.to === n.id),
  );

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold">Edit place</h2>
        <Button variant="ghost" onClick={() => s.select(null)}>
          Done
        </Button>
      </div>
      <Field
        label="Name"
        value={node.label}
        onChange={(e) => s.updateNode(node.id, { label: e.target.value })}
      />
      <Select
        label="Type"
        value={node.kind}
        onChange={(e) => s.updateNode(node.id, { kind: e.target.value as NodeKind })}
      >
        {Object.entries(KIND_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
      <Select
        label="Point of interest"
        value={node.poiType ?? ''}
        onChange={(e) =>
          s.updateNode(node.id, { poiType: (e.target.value || undefined) as PoiType | undefined })
        }
      >
        <option value="">None</option>
        {Object.entries(POI_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
      {node.kind === 'door' && (
        <Toggle
          label="Leads outside"
          description="Exterior doors count as exits and don't need a matching room."
          checked={Boolean(node.exterior)}
          onChange={(v) => s.updateNode(node.id, { exterior: v })}
        />
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="font-semibold">
          Position: {node.position.x.toFixed(2)} m east, {node.position.y.toFixed(2)} m north
        </legend>
        <div className="grid grid-cols-4 gap-2">
          <Button onClick={() => s.nudge(node.id, -0.5, 0)} aria-label="Move west half a meter">
            ←
          </Button>
          <Button onClick={() => s.nudge(node.id, 0, 0.5)} aria-label="Move north half a meter">
            ↑
          </Button>
          <Button onClick={() => s.nudge(node.id, 0, -0.5)} aria-label="Move south half a meter">
            ↓
          </Button>
          <Button onClick={() => s.nudge(node.id, 0.5, 0)} aria-label="Move east half a meter">
            →
          </Button>
        </div>
      </fieldset>

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Connections ({edges.length})</h3>
        <ul className="flex flex-col gap-1">
          {edges.map((e) => {
            const o = other(e.id);
            return (
              <li key={e.id} className="flex items-center justify-between gap-2">
                <span>
                  {EDGE_LABELS[e.kind]} to {o?.label}
                  {o && o.floorId !== node.floorId ? ` (${floorName(o.floorId)})` : ''}, {e.length.toFixed(1)}{' '}
                  m
                </span>
                <Button
                  variant="ghost"
                  onClick={() => s.disconnect(e.id)}
                  aria-label={`Remove connection to ${o?.label}`}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
        <Select label="Connect to" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Choose a place…</option>
          {candidates.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
              {n.floorId !== node.floorId ? ` (${floorName(n.floorId)})` : ''}
            </option>
          ))}
        </Select>
        <Select label="By" value={edgeKind} onChange={(e) => setEdgeKind(e.target.value as EdgeKind)}>
          {Object.entries(EDGE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Button
          disabled={!target}
          onClick={() => {
            s.connectNodes(node.id, target, edgeKind);
            setTarget('');
          }}
        >
          Connect
        </Button>
        {node.kind === 'door' && target && g.nodes.find((n) => n.id === target)?.kind === 'door' && (
          <Button onClick={() => (s.merge(node.id, target), setTarget(''))}>
            Snap doors together (same doorway)
          </Button>
        )}
      </section>

      <Button variant="danger" onClick={() => s.deleteNodes([node.id])}>
        Delete place
      </Button>
    </Card>
  );
}
