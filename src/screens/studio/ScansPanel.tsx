import { useEffect } from 'react';
import { Button, Card } from '../../components/ui';
import { cue } from '../../lib/feedback';
import { placeScan } from '../../lib/graph/stitch';
import type { ScanDraft } from '../../lib/scan/types';
import { useScans } from '../../state/queries';
import { useScanDrafts } from '../../state/scanDrafts';
import { useStudio } from '../../state/studio';
import { usePlacement } from './placement';

export function ScansPanel({ mapId }: { mapId: string }) {
  const s = useStudio();
  const p = usePlacement();
  const remote = useScans(mapId);
  const allDrafts = useScanDrafts((x) => x.drafts);
  const local = allDrafts.filter((d) => d.mapId === mapId);
  const markPlaced = useScanDrafts((x) => x.markPlaced);
  useEffect(() => () => p.cancel(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const placed = new Set(s.graph!.placements.map((pl) => pl.scanId));
  const byId = new Map<string, ScanDraft>();
  for (const d of [...(remote.data ?? []), ...local]) byId.set(d.result.scanId, d);
  const unplaced = [...byId.values()].filter((d) => !placed.has(d.result.scanId));

  if (p.draft) {
    const c = p.candidates[p.index];
    const door = c && s.graph!.nodes.find((n) => n.id === c.placedDoorId);
    const opening = c && p.draft.result.openings.findIndex((o) => o.id === c.scanOpeningId);
    return (
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">Placing {p.draft.name}</h2>
        {c ? (
          <p aria-live="polite">
            Option {p.index + 1} of {p.candidates.length}: join its {p.draft.result.openings[opening!]?.category ?? 'door'} {opening! + 1} to <strong>{door?.label}</strong>.
            {c.extraMatches.length > 0 && ` ${c.extraMatches.length} more doors line up.`}
            {c.overlap > 0.05 && ` Warning: overlaps another room by ${Math.round(c.overlap * 100)}%.`}
          </p>
        ) : (
          <p>No open doors on this floor to join to. The room will be placed on its own; connect it later.</p>
        )}
        {p.candidates.length > 1 && (
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => p.choose((p.index - 1 + p.candidates.length) % p.candidates.length)}>Previous option</Button>
            <Button onClick={() => p.choose((p.index + 1) % p.candidates.length)}>Next option</Button>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <Button onClick={() => p.rotate(Math.PI / 2)} aria-label="Rotate 90 degrees left">↺ 90°</Button>
          <Button onClick={() => p.move(0, 0.25)} aria-label="Move north">↑</Button>
          <Button onClick={() => p.rotate(-Math.PI / 2)} aria-label="Rotate 90 degrees right">↻ 90°</Button>
          <Button onClick={() => p.move(-0.25, 0)} aria-label="Move west">←</Button>
          <Button onClick={() => p.move(0, -0.25)} aria-label="Move south">↓</Button>
          <Button onClick={() => p.move(0.25, 0)} aria-label="Move east">→</Button>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            const pairs = c && p.transform === c.transform ? [{ placedDoorId: c.placedDoorId, scanOpeningId: c.scanOpeningId }, ...c.extraMatches] : [];
            s.apply((g) => placeScan(g, p.draft!.result, { floorId: s.floorId!, name: p.draft!.name, transform: p.transform!, doorPairs: pairs }));
            void markPlaced(p.draft!.result.scanId);
            void cue('confirm', pairs.length ? `${p.draft!.name} joined at ${door?.label}.` : `${p.draft!.name} placed.`);
            p.cancel();
          }}
        >
          {c && p.transform === c.transform ? 'Join here' : 'Place here (no join)'}
        </Button>
        <Button onClick={() => p.cancel()}>Cancel</Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-2">
      <h2 className="text-lg font-bold">Scans to place ({unplaced.length})</h2>
      {unplaced.length === 0 && <p className="text-muted">All scans are on the map. Scan another room from the map screen.</p>}
      <ul className="flex flex-col gap-2">
        {unplaced.map((d) => (
          <li key={d.result.scanId} className="flex justify-between items-center gap-2">
            <span>
              {d.name}{' '}
              <span className="text-muted text-sm">
                · {d.result.openings.length} doors{d.result.stairs.length ? ` · ${d.result.stairs.length} stairs` : ''}
              </span>
            </span>
            <Button onClick={() => p.start(s.graph!, s.floorId!, d)}>Place</Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
