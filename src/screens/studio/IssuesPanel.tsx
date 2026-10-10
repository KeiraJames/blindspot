import { Button, Card, cx } from '../../components/ui';
import type { ValidationResult } from '../../lib/graph/validate';
import { useStudio } from '../../state/studio';

export function IssuesPanel({ result, onShow }: { result: ValidationResult; onShow: (ids: string[]) => void }) {
  const s = useStudio();
  const errors = result.issues.filter((i) => i.severity === 'error').length;
  const warnings = result.issues.length - errors;
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="text-lg font-bold">
        Checks: {errors} {errors === 1 ? 'error' : 'errors'}, {warnings} {warnings === 1 ? 'warning' : 'warnings'}
      </h2>
      {result.issues.length === 0 && <p className="text-ok">Everything is connected. Ready to publish.</p>}
      <ul className="flex flex-col gap-2">
        {result.issues.map((issue, i) => (
          <li key={i} className={cx('rounded-xl border p-3 flex flex-col gap-2', issue.severity === 'error' ? 'border-danger' : 'border-warn')}>
            <p>
              <strong className={issue.severity === 'error' ? 'text-danger' : 'text-warn'}>{issue.severity === 'error' ? 'Error' : 'Warning'}:</strong> {issue.message}
            </p>
            {issue.nodeIds && issue.nodeIds.length > 0 && (
              <Button
                onClick={() => {
                  const first = s.graph!.nodes.find((n) => n.id === issue.nodeIds![0]);
                  if (first) s.setFloor(first.floorId);
                  s.select(issue.nodeIds![0]!);
                  onShow(issue.nodeIds!);
                }}
              >
                Show
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
