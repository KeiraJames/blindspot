import { useState } from 'react';
import { Button, Card, ErrorBox, Field } from '../../components/ui';
import { cue } from '../../lib/feedback';
import type { ValidationResult } from '../../lib/graph/validate';
import { usePublish, useVersions } from '../../state/queries';
import { useRepo } from '../../state/session';
import { useStudio } from '../../state/studio';

export function VersionsPanel({ mapId, result }: { mapId: string; result: ValidationResult }) {
  const s = useStudio();
  const repo = useRepo();
  const versions = useVersions(mapId);
  const publish = usePublish(mapId);
  const [note, setNote] = useState('');

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">Publish</h2>
      <p className="text-muted">Navigators always use the latest published version. Your draft stays private until you publish.</p>
      <form
        className="flex flex-col gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const n = await publish.mutateAsync({ graph: s.graph!, note: note.trim() || 'Update' });
          setNote('');
          void cue('confirm', repo.kind === 'firebase' ? `Version ${n} sent. It goes live once the server check passes.` : `Version ${n} published.`);
        }}
      >
        <Field label="What changed?" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Added second floor" />
        <Button type="submit" variant="primary" disabled={!result.ok || publish.isPending}>
          {result.ok ? 'Publish version' : 'Fix errors to publish'}
        </Button>
        <ErrorBox error={publish.error} />
      </form>
      <h3 className="font-semibold">History</h3>
      <ul className="flex flex-col gap-2">
        {versions.data?.map((v) => (
          <li key={v.number} className="flex items-center justify-between gap-2 border-b border-line pb-2 last:border-0">
            <span>
              <strong>v{v.number}</strong> {v.note} <span className="text-muted text-sm">· {new Date(v.createdAt).toLocaleString()} · {v.status === 'valid' ? 'live' : v.status}</span>
            </span>
            <Button
              variant="ghost"
              onClick={async () => {
                const g = await repo.getVersion(mapId, v.number);
                if (g) s.apply(() => g);
              }}
            >
              Load
            </Button>
          </li>
        ))}
        {versions.data?.length === 0 && <li className="text-muted">No versions yet.</li>}
      </ul>
    </Card>
  );
}
