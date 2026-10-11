import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { Button, Card, ErrorBox, Field, LinkButton, Select, Spinner } from '../components/ui';
import { ROLE_LABELS } from '../firebase/repo';
import { useCreateMap, useMaps, useOrgs } from '../state/queries';
import { useRepo } from '../state/session';

export function HomeScreen() {
  const maps = useMaps();
  const orgs = useOrgs();
  const repo = useRepo();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const createMap = useCreateMap();
  const [params, setParams] = useSearchParams();
  const [name, setName] = useState('');
  const [orgId, setOrgId] = useState('');
  const [code, setCode] = useState(params.get('invite') ?? '');
  const [joinError, setJoinError] = useState<unknown>(null);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    if (params.get('invite')) setParams({}, { replace: true });
  }, [params, setParams]);

  return (
    <Screen
      title="Your maps"
      actions={
        <Link
          to="/settings"
          className="min-h-12 min-w-12 flex items-center justify-center rounded-xl font-semibold text-accent"
        >
          Settings
        </Link>
      }
    >
      {maps.isLoading && <Spinner label="Loading maps" />}
      <ErrorBox error={maps.error} />
      <ul className="flex flex-col gap-3" aria-label="Maps">
        {maps.data?.map((m) => (
          <Card as="li" key={m.id} className="flex flex-col gap-3">
            <div>
              <h2 className="text-xl font-bold">{m.name}</h2>
              <p className="text-muted text-sm">
                {ROLE_LABELS[m.role]}
                {m.latestVersion ? ` · version ${m.latestVersion}` : ' · not published yet'}
                {m.orgId ? ' · organization map' : ''}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <LinkButton
                to={`/maps/${m.id}/navigate`}
                variant="primary"
                aria-label={`Navigate in ${m.name}`}
                aria-disabled={!m.latestVersion}
                onClick={(e) => !m.latestVersion && e.preventDefault()}
              >
                Navigate
              </LinkButton>
              <LinkButton to={`/maps/${m.id}`} aria-label={`Open ${m.name}`}>
                Open
              </LinkButton>
            </div>
          </Card>
        ))}
      </ul>
      {maps.data?.length === 0 && (
        <p className="text-muted">
          No maps yet. Create one, or join with a code from someone who shared a map.
        </p>
      )}

      {showNew ? (
        <Card>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const id = await createMap.mutateAsync({ name: name.trim(), orgId: orgId || null });
              navigate(`/maps/${id}`);
            }}
          >
            <h2 className="text-xl font-bold">New map</h2>
            <Field
              label="Building or home name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Maple Hall"
            />
            {(orgs.data?.length ?? 0) > 0 && (
              <Select label="Owner" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                <option value="">Just me</option>
                {orgs
                  .data!.filter((o) => o.role !== 'navigator')
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </Select>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button type="submit" variant="primary" disabled={!name.trim() || createMap.isPending}>
                Create
              </Button>
              <Button onClick={() => setShowNew(false)}>Cancel</Button>
            </div>
            <ErrorBox error={createMap.error} />
          </form>
        </Card>
      ) : (
        <Button variant="secondary" large block onClick={() => setShowNew(true)}>
          New map
        </Button>
      )}

      {repo.kind === 'firebase' && (
        <Card>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setJoinError(null);
              try {
                const res = await repo.acceptInvite(code);
                await qc.invalidateQueries();
                setCode('');
                if (res.mapId) navigate(`/maps/${res.mapId}`);
              } catch (err) {
                setJoinError(err);
              }
            }}
          >
            <h2 className="text-xl font-bold">Join a shared map</h2>
            <Field
              label="Invite code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoComplete="off"
            />
            <Button type="submit" disabled={code.trim().length < 6}>
              Join
            </Button>
            <ErrorBox error={joinError} />
          </form>
        </Card>
      )}

      <nav aria-label="More" className="grid grid-cols-2 gap-2">
        <LinkButton to="/practice">Practice gestures</LinkButton>
        <LinkButton to="/about">Safety and help</LinkButton>
      </nav>
    </Screen>
  );
}
