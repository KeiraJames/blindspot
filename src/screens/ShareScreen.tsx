import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { Button, Card, ErrorBox, Field, Select, Spinner } from '../components/ui';
import { ROLE_LABELS, type Invite, type Role } from '../firebase/repo';
import { useMap, useMembers, useOrgs, useSetRole } from '../state/queries';
import { useRepo } from '../state/session';

export default function ShareScreen() {
  const { mapId } = useParams();
  const repo = useRepo();
  const qc = useQueryClient();
  const map = useMap(mapId);
  const members = useMembers(mapId);
  const orgs = useOrgs();
  const setRole = useSetRole(mapId!);
  const [inviteRole, setInviteRole] = useState<Role>('navigator');
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [orgName, setOrgName] = useState('');

  if (map.isLoading) return <Spinner />;
  const m = map.data;
  if (!m) return <ErrorBox error="Map not found" />;
  const owner = m.role === 'owner';
  const local = repo.kind === 'local';

  const share = async (inv: Invite) => {
    const text = `Join "${m.name}" on PathSense with code ${inv.code}`;
    if (navigator.share) await navigator.share({ title: 'PathSense invite', text }).catch(() => undefined);
    else await navigator.clipboard?.writeText(inv.code);
  };

  return (
    <Screen title="Share" back={`/maps/${mapId}`}>
      {local && (
        <Card>
          <p>This map is stored on this device only. Sign in from Settings to share maps with a roommate or your campus.</p>
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Members</h2>
        {members.isLoading && <Spinner />}
        <ul className="flex flex-col gap-3">
          {members.data?.map((mem) => (
            <li key={mem.uid} className="flex flex-col gap-2 border-b border-line pb-3 last:border-0">
              <span className="font-semibold">{mem.displayName ?? `Member ${mem.uid.slice(0, 6)}`}</span>
              {owner && !local && mem.role !== 'owner' ? (
                <div className="flex gap-2 items-end">
                  <Select label={`Role for ${mem.displayName ?? 'member'}`} className="flex-1" value={mem.role} onChange={(e) => setRole.mutate({ uid: mem.uid, role: e.target.value as Role })}>
                    <option value="editor">{ROLE_LABELS.editor}</option>
                    <option value="navigator">{ROLE_LABELS.navigator}</option>
                  </Select>
                  <Button variant="danger" onClick={() => setRole.mutate({ uid: mem.uid, role: null })} aria-label={`Remove ${mem.displayName ?? 'member'}`}>
                    Remove
                  </Button>
                </div>
              ) : (
                <span className="text-muted">{ROLE_LABELS[mem.role]}</span>
              )}
            </li>
          ))}
        </ul>
        <ErrorBox error={setRole.error} />
      </Card>

      {!local && (owner || m.role === 'editor') && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">Invite someone</h2>
          <Select label="They can" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
            <option value="navigator">Navigate only</option>
            {owner && <option value="editor">Scan and edit the map</option>}
          </Select>
          <Button
            variant="primary"
            onClick={async () => {
              setError(null);
              try {
                setInvite(await repo.createInvite({ mapId }, inviteRole));
              } catch (e) {
                setError(e);
              }
            }}
          >
            Create invite code
          </Button>
          {invite && (
            <div role="status" className="flex flex-col gap-2">
              <p>
                Invite code: <strong className="text-2xl tracking-widest" aria-label={invite.code.split('').join(' ')}>{invite.code}</strong>
              </p>
              <p className="text-muted text-sm">Expires {new Date(invite.expiresAt).toLocaleDateString()}.</p>
              <Button onClick={() => void share(invite)}>Share code</Button>
            </div>
          )}
          <ErrorBox error={error} />
        </Card>
      )}

      {!local && owner && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">Organization</h2>
          <p className="text-muted">Publish a campus building to your organization so all its members can navigate it.</p>
          <Select
            label="Belongs to"
            value={m.orgId ?? ''}
            onChange={async (e) => {
              try {
                await repo.setMapOrg(m.id, e.target.value || null);
                await qc.invalidateQueries();
              } catch (err) {
                setError(err);
              }
            }}
          >
            <option value="">No organization</option>
            {orgs.data?.filter((o) => o.role !== 'navigator').map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <form
            className="flex gap-2 items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              await repo.createOrg(orgName.trim());
              setOrgName('');
              await qc.invalidateQueries();
            }}
          >
            <Field label="New organization" className="flex-1" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. Northside Residence Life" />
            <Button type="submit" disabled={!orgName.trim()}>
              Create
            </Button>
          </form>
          {orgs.data?.filter((o) => o.role === 'owner').map((o) => (
            <Button
              key={o.id}
              onClick={async () => {
                const inv = await repo.createInvite({ orgId: o.id }, 'navigator');
                setInvite(inv);
              }}
            >
              Invite navigators to {o.name}
            </Button>
          ))}
        </Card>
      )}
    </Screen>
  );
}
