import { buildSampleMap, SAMPLE_MAP_ID, SAMPLE_MAP_NAME } from '../data/sampleMap';
import { newId } from '../lib/graph/graph';
import { emptyGraph, type MapGraph } from '../lib/graph/types';
import { validateGraph } from '../lib/graph/validate';
import type { ScanDraft } from '../lib/scan/types';
import { idb } from '../lib/util/idb';
import type { MapRepository, MapSummary, MapVersion } from './repo';

interface LocalMapRecord {
  summary: MapSummary;
  draft: MapGraph;
  versions: { meta: MapVersion; graph: MapGraph }[];
  scans: ScanDraft[];
}

const LOCAL_UID = 'local';

function unsupported(what: string): never {
  throw new Error(`${what} needs an account. Add Firebase settings to enable sharing.`);
}

/** On-device repository used when Firebase is not configured (and in tests). */
export class LocalMapRepository implements MapRepository {
  readonly kind = 'local' as const;
  private seeded = false;

  private async read(mapId: string): Promise<LocalMapRecord | null> {
    return (await idb.get<LocalMapRecord>('maps', mapId)) ?? null;
  }
  private async write(rec: LocalMapRecord) {
    await idb.set('maps', rec.summary.id, rec);
  }
  private async mutate(mapId: string, fn: (r: LocalMapRecord) => void) {
    const rec = await this.read(mapId);
    if (!rec) throw new Error('Map not found');
    fn(rec);
    rec.summary.updatedAt = Date.now();
    await this.write(rec);
  }

  private async seed() {
    if (this.seeded) return;
    this.seeded = true;
    if (await this.read(SAMPLE_MAP_ID)) return;
    const graph = buildSampleMap();
    const now = Date.now();
    await this.write({
      summary: {
        id: SAMPLE_MAP_ID,
        name: SAMPLE_MAP_NAME,
        description: 'Two-floor demo dorm',
        ownerId: LOCAL_UID,
        orgId: null,
        role: 'owner',
        latestVersion: 1,
        updatedAt: now,
      },
      draft: graph,
      versions: [
        {
          meta: {
            number: 1,
            note: 'Sample map',
            createdBy: LOCAL_UID,
            createdAt: now,
            status: 'valid',
            issues: [],
          },
          graph,
        },
      ],
      scans: [],
    });
  }

  async listMaps() {
    await this.seed();
    const recs = await idb.values<LocalMapRecord>('maps');
    return recs.map((r) => r.summary).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async getMap(mapId: string) {
    await this.seed();
    return (await this.read(mapId))?.summary ?? null;
  }
  async createMap({ name, description, graph }: { name: string; description?: string; graph?: MapGraph }) {
    const id = newId('map');
    await this.write({
      summary: {
        id,
        name,
        description,
        ownerId: LOCAL_UID,
        orgId: null,
        role: 'owner',
        latestVersion: null,
        updatedAt: Date.now(),
      },
      draft: graph ?? emptyGraph(),
      versions: [],
      scans: [],
    });
    return id;
  }
  async renameMap(mapId: string, name: string, description?: string) {
    await this.mutate(mapId, (r) => {
      r.summary.name = name;
      if (description !== undefined) r.summary.description = description;
    });
  }
  async deleteMap(mapId: string) {
    await idb.del('maps', mapId);
  }
  async setMapOrg(): Promise<void> {
    unsupported('Organizations');
  }
  async getDraft(mapId: string) {
    return (await this.read(mapId))?.draft ?? null;
  }
  async saveDraft(mapId: string, graph: MapGraph) {
    await this.mutate(mapId, (r) => (r.draft = graph));
  }
  async publishVersion(mapId: string, graph: MapGraph, note: string) {
    // Same gate the Cloud Function applies in Firebase mode.
    const result = validateGraph(graph);
    let number = 0;
    await this.mutate(mapId, (r) => {
      number = (r.versions.at(-1)?.meta.number ?? 0) + 1;
      const status = result.ok ? 'valid' : 'invalid';
      r.versions.push({
        meta: { number, note, createdBy: LOCAL_UID, createdAt: Date.now(), status, issues: result.issues },
        graph,
      });
      if (result.ok) r.summary.latestVersion = number;
    });
    if (!result.ok)
      throw new Error(
        result.issues
          .filter((i) => i.severity === 'error')
          .map((i) => i.message)
          .join(' '),
      );
    return number;
  }
  async listVersions(mapId: string) {
    return ((await this.read(mapId))?.versions ?? []).map((v) => v.meta).reverse();
  }
  async getVersion(mapId: string, number: number) {
    return (await this.read(mapId))?.versions.find((v) => v.meta.number === number)?.graph ?? null;
  }
  async getPublished(mapId: string) {
    await this.seed();
    const rec = await this.read(mapId);
    const n = rec?.summary.latestVersion;
    if (!rec || !n) return null;
    const v = rec.versions.find((x) => x.meta.number === n);
    return v ? { number: n, graph: v.graph } : null;
  }
  async saveScan(mapId: string, draft: ScanDraft) {
    const saved: ScanDraft = { ...draft, mapId, status: draft.status === 'placed' ? 'placed' : 'uploaded' };
    await this.mutate(mapId, (r) => {
      r.scans = [...r.scans.filter((s) => s.id !== draft.id), saved];
    });
    return saved;
  }
  async listScans(mapId: string) {
    return (await this.read(mapId))?.scans ?? [];
  }
  async worldMapPath(mapId: string, scanId: string) {
    const scan = (await this.listScans(mapId)).find((s) => s.result.scanId === scanId);
    return scan?.result.files.worldMap ?? null;
  }
  async listMembers() {
    return [{ uid: LOCAL_UID, role: 'owner' as const, displayName: 'You (this device)' }];
  }
  async setMemberRole(): Promise<void> {
    unsupported('Sharing');
  }
  async createInvite(): Promise<never> {
    unsupported('Inviting people');
  }
  async acceptInvite(): Promise<never> {
    unsupported('Joining a shared map');
  }
  async listOrgs() {
    return [];
  }
  async createOrg(): Promise<never> {
    unsupported('Organizations');
  }
}
