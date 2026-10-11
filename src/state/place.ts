import { create } from 'zustand';
import { buildSampleHall } from '../data/sampleHall';
import { buildSampleHome } from '../data/sampleHome';
import { addScannedRoom, deleteRoom, emptyPlace, renameRoom } from '../lib/graph/rooms';
import type { MapGraph } from '../lib/graph/types';
import type { ScanResult } from '../lib/scan/types';
import { idb } from '../lib/util/idb';
import { useSettings, type SampleId } from './settings';

/** Everything the user has scanned, stored on this device only. */
interface SavedPlace {
  graph: MapGraph;
  /** Scan results by scanId (for each room's ARWorldMap and model files). */
  scans: Record<string, ScanResult>;
}

interface PlaceState {
  loaded: boolean;
  place: SavedPlace;
  load: () => Promise<void>;
  addRoom: (scan: ScanResult, name: string) => Promise<{ roomId: string; joinedTo: string[] }>;
  renameRoom: (roomId: string, name: string) => Promise<void>;
  deleteRoom: (roomId: string) => Promise<void>;
}

const KEY = 'my-place';

async function persist(place: SavedPlace) {
  await idb.set('maps', KEY, place);
}

export const usePlace = create<PlaceState>((set, get) => ({
  loaded: false,
  place: { graph: emptyPlace(), scans: {} },
  load: async () => {
    const saved = await idb.get<SavedPlace>('maps', KEY).catch(() => undefined);
    set({ loaded: true, place: saved ?? { graph: emptyPlace(), scans: {} } });
  },
  addRoom: async (scan, name) => {
    const { place } = get();
    const r = addScannedRoom(place.graph, scan, name);
    const next = { graph: r.graph, scans: { ...place.scans, [scan.scanId]: scan } };
    set({ place: next });
    await persist(next);
    return { roomId: r.roomId, joinedTo: r.joinedTo };
  },
  renameRoom: async (roomId, name) => {
    const { place } = get();
    const next = { ...place, graph: renameRoom(place.graph, roomId, name) };
    set({ place: next });
    await persist(next);
  },
  deleteRoom: async (roomId) => {
    const { place } = get();
    const room = place.graph.rooms.find((r) => r.id === roomId);
    const scans = { ...place.scans };
    if (room?.scanId) delete scans[room.scanId];
    const next = { graph: deleteRoom(place.graph, roomId), scans };
    set({ place: next });
    await persist(next);
  },
}));

export const SAMPLES: Record<SampleId, { name: string; graph: MapGraph }> = {
  hall: { name: 'Open hall', graph: buildSampleHall() },
  home: { name: 'Home', graph: buildSampleHome() },
};

/** The map to navigate: your scanned rooms, or a practice map until you've scanned one. */
export function useActiveMap(): {
  graph: MapGraph;
  isSample: boolean;
  sampleName: string | null;
  scans: Record<string, ScanResult>;
} {
  const place = usePlace((s) => s.place);
  const sample = useSettings((s) => s.sample);
  return place.graph.rooms.length > 0
    ? { graph: place.graph, isSample: false, sampleName: null, scans: place.scans }
    : { graph: SAMPLES[sample].graph, isSample: true, sampleName: SAMPLES[sample].name, scans: {} };
}
