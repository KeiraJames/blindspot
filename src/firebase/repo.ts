import type { MapGraph } from '../lib/graph/types';
import type { ValidationIssue } from '../lib/graph/validate';
import type { ScanDraft } from '../lib/scan/types';

export type Role = 'owner' | 'editor' | 'navigator';

export interface MapSummary {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  orgId: string | null;
  role: Role;
  latestVersion: number | null;
  updatedAt: number;
}

export interface MapVersion {
  number: number;
  note: string;
  createdBy: string;
  createdAt: number;
  status: 'pending' | 'valid' | 'invalid';
  issues?: ValidationIssue[];
}

export interface Member {
  uid: string;
  role: Role;
  displayName?: string;
}

export interface Org {
  id: string;
  name: string;
  role: Role;
}

export interface Invite {
  code: string;
  role: Role;
  expiresAt: number;
}

/** Storage abstraction: Firebase when configured, otherwise on-device only. */
export interface MapRepository {
  readonly kind: 'firebase' | 'local';
  listMaps(): Promise<MapSummary[]>;
  getMap(mapId: string): Promise<MapSummary | null>;
  createMap(input: { name: string; description?: string; orgId?: string | null; graph?: MapGraph }): Promise<string>;
  renameMap(mapId: string, name: string, description?: string): Promise<void>;
  deleteMap(mapId: string): Promise<void>;

  getDraft(mapId: string): Promise<MapGraph | null>;
  saveDraft(mapId: string, graph: MapGraph): Promise<void>;

  publishVersion(mapId: string, graph: MapGraph, note: string): Promise<number>;
  listVersions(mapId: string): Promise<MapVersion[]>;
  getVersion(mapId: string, number: number): Promise<MapGraph | null>;
  /** Latest validated version, served from cache when offline. */
  getPublished(mapId: string): Promise<{ number: number; graph: MapGraph } | null>;

  saveScan(mapId: string, draft: ScanDraft, onProgress?: (fraction: number) => void): Promise<ScanDraft>;
  listScans(mapId: string): Promise<ScanDraft[]>;
  /** Local path of a scan's ARWorldMap, downloading it if needed. */
  worldMapPath(mapId: string, scanId: string): Promise<string | null>;

  listMembers(mapId: string): Promise<Member[]>;
  setMemberRole(mapId: string, uid: string, role: Role | null): Promise<void>;
  createInvite(target: { mapId?: string; orgId?: string }, role: Role): Promise<Invite>;
  acceptInvite(code: string): Promise<{ mapId?: string; orgId?: string }>;

  listOrgs(): Promise<Org[]>;
  createOrg(name: string): Promise<string>;
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  editor: 'Editor',
  navigator: 'Navigator only',
};

export function canEdit(role: Role | undefined | null): boolean {
  return role === 'owner' || role === 'editor';
}
