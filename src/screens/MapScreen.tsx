import { useParams } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { Card, ErrorBox, LinkButton, Spinner } from '../components/ui';
import { canEdit, ROLE_LABELS } from '../firebase/repo';
import { useMap, useVersions } from '../state/queries';

export function MapScreen() {
  const { mapId } = useParams();
  const map = useMap(mapId);
  const versions = useVersions(mapId);
  if (map.isLoading) return <Spinner />;
  if (!map.data) return <ErrorBox error={map.error ?? 'Map not found'} />;
  const m = map.data;
  const editor = canEdit(m.role);
  const latest = versions.data?.[0];

  return (
    <Screen title={m.name} back="/">
      <Card>
        <p>
          Your role: <strong>{ROLE_LABELS[m.role]}</strong>
        </p>
        <p className="text-muted">
          {m.latestVersion
            ? `Published version ${m.latestVersion}.`
            : 'Not published yet. Publish from Map Studio so people can navigate.'}
          {latest && latest.status === 'pending' && ' A new version is being checked.'}
          {latest && latest.status === 'invalid' && ' The newest version has errors and was not published.'}
        </p>
      </Card>
      <nav aria-label="Map actions" className="flex flex-col gap-3">
        {m.latestVersion ? (
          <LinkButton to={`/maps/${m.id}/navigate`} variant="primary" large block>
            Navigate
          </LinkButton>
        ) : null}
        {editor && (
          <>
            <LinkButton to={`/maps/${m.id}/scan`} large block>
              Scan a room
            </LinkButton>
            <LinkButton to={`/maps/${m.id}/studio`} large block>
              Map Studio
            </LinkButton>
          </>
        )}
        <LinkButton to={`/maps/${m.id}/share`} large block>
          {m.role === 'owner' ? 'Share and members' : 'Members'}
        </LinkButton>
      </nav>
    </Screen>
  );
}
