import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  getDocsFromCache,
  getDocFromCache,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getBytes, ref, uploadBytesResumable } from 'firebase/storage';
import type { MapGraph } from '../lib/graph/types';
import type { ScanDraft, ScanResult } from '../lib/scan/types';
import { idb } from '../lib/util/idb';
import type { FirebaseHandles } from './app';
import type { Invite, MapRepository, MapSummary, MapVersion, Member, Org, Role } from './repo';

const ms = (t: Timestamp | null | undefined) => (t ? t.toMillis() : Date.now());
const pad = (n: number) => String(n).padStart(6, '0');

type MapDoc = {
  name: string;
  description?: string;
  ownerId: string;
  orgId: string | null;
  members: Record<string, Role>;
  memberUids: string[];
  orgMemberUids?: string[];
  latestVersion: number | null;
  updatedAt?: Timestamp;
};

export class FirebaseMapRepository implements MapRepository {
  readonly kind = 'firebase' as const;
  private orgRoles = new Map<string, Role>();

  constructor(private fb: FirebaseHandles) {}

  private get uid(): string {
    const u = this.fb.auth.currentUser;
    if (!u) throw new Error('Not signed in');
    return u.uid;
  }

  private toSummary(id: string, d: MapDoc): MapSummary {
    const direct = d.members?.[this.uid];
    const viaOrg = d.orgId ? this.orgRoles.get(d.orgId) : undefined;
    const orgAsMap: Role | undefined = viaOrg === 'owner' ? 'editor' : viaOrg;
    return {
      id,
      name: d.name,
      description: d.description,
      ownerId: d.ownerId,
      orgId: d.orgId ?? null,
      role: direct ?? orgAsMap ?? 'navigator',
      latestVersion: d.latestVersion ?? null,
      updatedAt: ms(d.updatedAt),
    };
  }

  async listMaps() {
    await this.listOrgs();
    const maps = collection(this.fb.db, 'maps');
    const [mine, viaOrg] = await Promise.all([
      getDocs(query(maps, where('memberUids', 'array-contains', this.uid))),
      getDocs(query(maps, where('orgMemberUids', 'array-contains', this.uid))),
    ]);
    const out = new Map<string, MapSummary>();
    for (const d of [...mine.docs, ...viaOrg.docs]) out.set(d.id, this.toSummary(d.id, d.data() as MapDoc));
    return [...out.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getMap(mapId: string) {
    const snap = await getDoc(doc(this.fb.db, 'maps', mapId)).catch(() => getDocFromCache(doc(this.fb.db, 'maps', mapId)));
    if (!snap.exists()) return null;
    const d = snap.data() as MapDoc;
    if (d.orgId && !this.orgRoles.has(d.orgId)) await this.listOrgs();
    return this.toSummary(snap.id, d);
  }

  async createMap({ name, description, orgId = null, graph }: { name: string; description?: string; orgId?: string | null; graph?: MapGraph }) {
    const ref_ = doc(collection(this.fb.db, 'maps'));
    const batch = writeBatch(this.fb.db);
    batch.set(ref_, {
      name,
      description: description ?? '',
      ownerId: this.uid,
      orgId,
      members: { [this.uid]: 'owner' },
      memberUids: [this.uid],
      latestVersion: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (graph) batch.set(doc(this.fb.db, 'maps', ref_.id, 'draft', 'current'), { graphJson: JSON.stringify(graph), updatedBy: this.uid, updatedAt: serverTimestamp() });
    await batch.commit();
    return ref_.id;
  }

  async renameMap(mapId: string, name: string, description?: string) {
    await updateDoc(doc(this.fb.db, 'maps', mapId), { name, ...(description !== undefined ? { description } : {}), updatedAt: serverTimestamp() });
  }

  async deleteMap(mapId: string) {
    // Subcollections are removed by the onMapDeleted function.
    const batch = writeBatch(this.fb.db);
    batch.delete(doc(this.fb.db, 'maps', mapId));
    await batch.commit();
  }

  async getDraft(mapId: string) {
    const snap = await getDoc(doc(this.fb.db, 'maps', mapId, 'draft', 'current'));
    if (snap.exists()) return JSON.parse(snap.data().graphJson as string) as MapGraph;
    const pub = await this.getPublished(mapId);
    return pub?.graph ?? null;
  }

  async saveDraft(mapId: string, graph: MapGraph) {
    await setDoc(doc(this.fb.db, 'maps', mapId, 'draft', 'current'), {
      graphJson: JSON.stringify(graph),
      updatedBy: this.uid,
      updatedAt: serverTimestamp(),
    });
  }

  async publishVersion(mapId: string, graph: MapGraph, note: string) {
    // Versions are immutable. The validateVersion function marks them valid/invalid and
    // only then moves maps/{id}.latestVersion, so navigators never load a broken graph.
    const mapRef = doc(this.fb.db, 'maps', mapId);
    const number = await runTransaction(this.fb.db, async (tx) => {
      const map = await tx.get(mapRef);
      const n = ((map.data()?.versionCounter as number | undefined) ?? 0) + 1;
      tx.update(mapRef, { versionCounter: n, updatedAt: serverTimestamp() });
      tx.set(doc(this.fb.db, 'maps', mapId, 'versions', pad(n)), {
        number: n,
        note,
        graphJson: JSON.stringify(graph),
        createdBy: this.uid,
        createdAt: serverTimestamp(),
        status: 'pending',
      });
      return n;
    });
    return number;
  }

  async listVersions(mapId: string) {
    const snap = await getDocs(query(collection(this.fb.db, 'maps', mapId, 'versions'), orderBy('number', 'desc'), limit(50)));
    return snap.docs.map((d) => {
      const v = d.data();
      return { number: v.number, note: v.note, createdBy: v.createdBy, createdAt: ms(v.createdAt), status: v.status, issues: v.issues } as MapVersion;
    });
  }

  async getVersion(mapId: string, number: number) {
    const snap = await getDoc(doc(this.fb.db, 'maps', mapId, 'versions', pad(number)));
    return snap.exists() ? (JSON.parse(snap.data().graphJson as string) as MapGraph) : null;
  }

  async getPublished(mapId: string) {
    const cacheKey = `published:${mapId}`;
    try {
      const map = await this.getMap(mapId);
      if (!map?.latestVersion) return null;
      const graph = await this.getVersion(mapId, map.latestVersion);
      if (!graph) return null;
      const result = { number: map.latestVersion, graph };
      await idb.set('kv', cacheKey, result).catch(() => undefined);
      return result;
    } catch (err) {
      // Offline: fall back to the last version we loaded (PRD: offline navigate if cached).
      const cached = await idb.get<{ number: number; graph: MapGraph }>('kv', cacheKey).catch(() => undefined);
      if (cached) return cached;
      const fromFs = await getDocsFromCache(query(collection(this.fb.db, 'maps', mapId, 'versions'), orderBy('number', 'desc'), limit(1))).catch(() => null);
      const d = fromFs?.docs[0]?.data();
      if (d) return { number: d.number as number, graph: JSON.parse(d.graphJson as string) as MapGraph };
      throw err;
    }
  }

  async saveScan(mapId: string, draft: ScanDraft, onProgress?: (fraction: number) => void) {
    const files = Object.entries(draft.result.files).filter(([, p]) => Boolean(p)) as [keyof ScanResult['files'], string][];
    const uploaded: ScanDraft['uploadedPaths'] = { ...draft.uploadedPaths };
    let done = 0;
    for (const [kind, localPath] of files) {
      if (uploaded[kind]) {
        done++;
        continue;
      }
      const blob = await (await fetch(Capacitor.convertFileSrc(localPath))).blob();
      const ext = localPath.split('.').pop() ?? 'bin';
      const path = `maps/${mapId}/scans/${draft.result.scanId}/${kind}.${ext}`;
      const task = uploadBytesResumable(ref(this.fb.storage, path), blob, { contentType: blob.type || 'application/octet-stream' });
      await new Promise<void>((resolve, reject) =>
        task.on(
          'state_changed',
          (s) => onProgress?.((done + s.bytesTransferred / Math.max(1, s.totalBytes)) / files.length),
          reject,
          () => resolve(),
        ),
      );
      uploaded[kind] = path;
      done++;
    }
    const { files: _localFiles, ...resultWithoutFiles } = draft.result;
    const saved: ScanDraft = { ...draft, mapId, status: draft.status === 'placed' ? 'placed' : 'uploaded', uploadedPaths: uploaded };
    await setDoc(doc(this.fb.db, 'maps', mapId, 'scans', draft.result.scanId), {
      name: draft.name,
      floorId: draft.floorId,
      status: saved.status,
      createdBy: this.uid,
      createdAt: serverTimestamp(),
      resultJson: JSON.stringify({ ...resultWithoutFiles, files: {} }),
      storagePaths: uploaded,
      summary: {
        openings: draft.result.openings.length,
        stairs: draft.result.stairs.length,
        quality: draft.result.quality,
      },
    });
    onProgress?.(1);
    return saved;
  }

  async listScans(mapId: string) {
    const snap = await getDocs(query(collection(this.fb.db, 'maps', mapId, 'scans'), orderBy('createdAt', 'desc')));
    return snap.docs.map((d) => {
      const v = d.data();
      return {
        id: d.id,
        mapId,
        name: v.name,
        floorId: v.floorId ?? null,
        result: JSON.parse(v.resultJson as string) as ScanResult,
        status: v.status,
        uploadedPaths: v.storagePaths,
        createdAt: ms(v.createdAt),
      } satisfies ScanDraft;
    });
  }

  async worldMapPath(mapId: string, scanId: string) {
    const local = `worldmaps/${mapId}_${scanId}.arexperience`;
    try {
      const st = await Filesystem.stat({ path: local, directory: Directory.Cache });
      return st.uri;
    } catch {
      /* not cached yet */
    }
    const snap = await getDoc(doc(this.fb.db, 'maps', mapId, 'scans', scanId));
    const remote = (snap.data()?.storagePaths as Record<string, string> | undefined)?.worldMap;
    if (!remote) return null;
    const bytes = new Uint8Array(await getBytes(ref(this.fb.storage, remote)));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const res = await Filesystem.writeFile({ path: local, directory: Directory.Cache, data: btoa(bin), recursive: true });
    return res.uri;
  }

  async listMembers(mapId: string) {
    const snap = await getDoc(doc(this.fb.db, 'maps', mapId));
    const d = snap.data() as MapDoc | undefined;
    if (!d) return [];
    const names = await Promise.all(
      Object.keys(d.members).map(async (uid) => {
        const u = await getDoc(doc(this.fb.db, 'users', uid)).catch(() => null);
        return [uid, (u?.data()?.displayName as string | undefined) ?? undefined] as const;
      }),
    );
    const nameOf = new Map(names);
    return Object.entries(d.members).map(([uid, role]) => ({ uid, role, displayName: uid === this.uid ? 'You' : nameOf.get(uid) })) as Member[];
  }

  async setMemberRole(mapId: string, uid: string, role: Role | null) {
    const ref_ = doc(this.fb.db, 'maps', mapId);
    await runTransaction(this.fb.db, async (tx) => {
      const d = (await tx.get(ref_)).data() as MapDoc;
      const members = { ...d.members };
      if (role) members[uid] = role;
      else delete members[uid];
      tx.update(ref_, { members, memberUids: Object.keys(members), updatedAt: serverTimestamp() });
    });
  }

  async createInvite(target: { mapId?: string; orgId?: string }, role: Role): Promise<Invite> {
    const call = httpsCallable<{ mapId?: string; orgId?: string; role: Role }, Invite>(this.fb.functions, 'createInvite');
    return (await call({ ...target, role })).data;
  }

  async acceptInvite(code: string) {
    const call = httpsCallable<{ code: string }, { mapId?: string; orgId?: string }>(this.fb.functions, 'acceptInvite');
    const res = (await call({ code: code.trim().toUpperCase() })).data;
    if (res.orgId) await this.listOrgs();
    return res;
  }

  async listOrgs(): Promise<Org[]> {
    const snap = await getDocs(query(collection(this.fb.db, 'orgs'), where('memberUids', 'array-contains', this.uid)));
    const orgs = snap.docs.map((d) => ({ id: d.id, name: d.data().name as string, role: (d.data().members as Record<string, Role>)[this.uid]! }));
    this.orgRoles = new Map(orgs.map((o) => [o.id, o.role]));
    return orgs;
  }

  async createOrg(name: string) {
    const ref_ = doc(collection(this.fb.db, 'orgs'));
    await setDoc(ref_, { name, ownerId: this.uid, members: { [this.uid]: 'owner' }, memberUids: [this.uid], createdAt: serverTimestamp() });
    await updateDoc(doc(this.fb.db, 'users', this.uid), { orgIds: arrayUnion(ref_.id) }).catch(() => undefined);
    return ref_.id;
  }
}
