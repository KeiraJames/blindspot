import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MapGraph } from '../lib/graph/types';
import type { Role } from '../firebase/repo';
import { useRepo } from './session';

export function useMaps() {
  const repo = useRepo();
  return useQuery({ queryKey: [repo.kind, 'maps'], queryFn: () => repo.listMaps() });
}

export function useMap(mapId: string | undefined) {
  const repo = useRepo();
  return useQuery({
    queryKey: [repo.kind, 'map', mapId],
    queryFn: () => repo.getMap(mapId!),
    enabled: Boolean(mapId),
  });
}

export function usePublished(mapId: string | undefined) {
  const repo = useRepo();
  return useQuery({
    queryKey: [repo.kind, 'published', mapId],
    queryFn: () => repo.getPublished(mapId!),
    enabled: Boolean(mapId),
    networkMode: 'offlineFirst',
  });
}

export function useDraft(mapId: string | undefined) {
  const repo = useRepo();
  return useQuery({
    queryKey: [repo.kind, 'draft', mapId],
    queryFn: () => repo.getDraft(mapId!),
    enabled: Boolean(mapId),
    staleTime: Infinity,
  });
}

export function useVersions(mapId: string | undefined) {
  const repo = useRepo();
  return useQuery({
    queryKey: [repo.kind, 'versions', mapId],
    queryFn: () => repo.listVersions(mapId!),
    enabled: Boolean(mapId),
  });
}

export function useScans(mapId: string | undefined) {
  const repo = useRepo();
  return useQuery({
    queryKey: [repo.kind, 'scans', mapId],
    queryFn: () => repo.listScans(mapId!),
    enabled: Boolean(mapId),
  });
}

export function useMembers(mapId: string | undefined) {
  const repo = useRepo();
  return useQuery({
    queryKey: [repo.kind, 'members', mapId],
    queryFn: () => repo.listMembers(mapId!),
    enabled: Boolean(mapId),
  });
}

export function useOrgs() {
  const repo = useRepo();
  return useQuery({ queryKey: [repo.kind, 'orgs'], queryFn: () => repo.listOrgs() });
}

export function useCreateMap() {
  const repo = useRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string; orgId?: string | null; graph?: MapGraph }) =>
      repo.createMap(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [repo.kind, 'maps'] }),
  });
}

export function usePublish(mapId: string) {
  const repo = useRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ graph, note }: { graph: MapGraph; note: string }) =>
      repo.publishVersion(mapId, graph, note),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [repo.kind, 'versions', mapId] });
      void qc.invalidateQueries({ queryKey: [repo.kind, 'map', mapId] });
      void qc.invalidateQueries({ queryKey: [repo.kind, 'published', mapId] });
      void qc.invalidateQueries({ queryKey: [repo.kind, 'maps'] });
    },
  });
}

export function useSetRole(mapId: string) {
  const repo = useRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ uid, role }: { uid: string; role: Role | null }) => repo.setMemberRole(mapId, uid, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: [repo.kind, 'members', mapId] }),
  });
}
