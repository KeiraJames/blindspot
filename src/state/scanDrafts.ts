import { Network } from '@capacitor/network';
import { create } from 'zustand';
import type { ScanDraft } from '../lib/scan/types';
import { idb } from '../lib/util/idb';
import { getRepo, useSession } from './session';
import { useSettings } from './settings';

/**
 * Scans are saved on the device first (draft), then uploaded when allowed: on Wi-Fi by
 * default (PRD journey 1). Nothing leaves the phone until the user saves a scan.
 */
interface ScanDraftState {
  drafts: ScanDraft[];
  progress: Record<string, number>;
  errors: Record<string, string>;
  load: () => Promise<void>;
  save: (d: ScanDraft) => Promise<void>;
  remove: (id: string) => Promise<void>;
  markPlaced: (scanId: string) => Promise<void>;
}

export const useScanDrafts = create<ScanDraftState>((set, get) => ({
  drafts: [],
  progress: {},
  errors: {},
  load: async () => {
    const drafts = await idb.values<ScanDraft>('scans').catch(() => []);
    set({ drafts: drafts.sort((a, b) => b.createdAt - a.createdAt) });
  },
  save: async (d) => {
    await idb.set('scans', d.id, d);
    set({ drafts: [d, ...get().drafts.filter((x) => x.id !== d.id)] });
    void processQueue();
  },
  remove: async (id) => {
    await idb.del('scans', id);
    set({ drafts: get().drafts.filter((x) => x.id !== id) });
  },
  markPlaced: async (scanId) => {
    const d = get().drafts.find((x) => x.result.scanId === scanId);
    if (d) await get().save({ ...d, status: 'placed' });
  },
}));

let running = false;

export async function processQueue() {
  if (running) return;
  running = true;
  try {
    const status = await Network.getStatus().catch(() => ({ connected: navigator.onLine, connectionType: 'unknown' as const }));
    if (!status.connected) return;
    const wifiOnly = useSettings.getState().wifiOnlyUploads;
    const repo = getRepo(useSession.getState().mode);
    // Cellular uploads only when the user allows it; local repos have nothing to upload.
    if (repo.kind === 'firebase' && wifiOnly && status.connectionType === 'cellular') return;
    const store = useScanDrafts.getState();
    for (const d of store.drafts.filter((x) => x.status === 'draft' && x.mapId)) {
      try {
        await store.save({ ...d, status: 'uploading' });
        const saved = await repo.saveScan(d.mapId!, d, (f) => useScanDrafts.setState((s) => ({ progress: { ...s.progress, [d.id]: f } })));
        await idb.set('scans', d.id, saved);
        useScanDrafts.setState((s) => ({ drafts: s.drafts.map((x) => (x.id === d.id ? saved : x)), errors: { ...s.errors, [d.id]: '' } }));
      } catch (e) {
        await idb.set('scans', d.id, { ...d, status: 'draft' });
        useScanDrafts.setState((s) => ({
          drafts: s.drafts.map((x) => (x.id === d.id ? { ...d, status: 'draft' } : x)),
          errors: { ...s.errors, [d.id]: e instanceof Error ? e.message : String(e) },
        }));
      }
    }
  } finally {
    running = false;
  }
}

/** Load drafts and retry uploads whenever connectivity changes. Returns a cleanup. */
export function startUploadQueue(): () => void {
  void useScanDrafts.getState().load().then(processQueue);
  const handle = Network.addListener('networkStatusChange', () => void processQueue());
  return () => void handle.then((h) => h.remove());
}
