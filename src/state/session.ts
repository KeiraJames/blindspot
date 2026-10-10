import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { firebase, firebaseConfigured } from '../firebase/app';
import { FirebaseMapRepository } from '../firebase/firebaseRepo';
import { LocalMapRepository } from '../firebase/localRepo';
import type { MapRepository } from '../firebase/repo';
import { preferencesStorage } from './storage';

/**
 * Account mode. "cloud" uses Firebase (sign-in required, sharing works); "local" keeps
 * everything on this device. Without Firebase config the app is always local.
 */
interface SessionState {
  mode: 'cloud' | 'local' | null;
  setMode: (m: 'cloud' | 'local') => void;
}

export const useSession = create<SessionState>()(
  persist((set) => ({ mode: firebaseConfigured ? null : 'local', setMode: (mode) => set({ mode }) }), {
    name: 'pathsense.session',
    storage: createJSONStorage(() => preferencesStorage),
  }),
);

const local = new LocalMapRepository();
let cloud: FirebaseMapRepository | null = null;

export function getRepo(mode: 'cloud' | 'local' | null): MapRepository {
  const fb = firebase();
  if (mode === 'cloud' && fb) {
    cloud ??= new FirebaseMapRepository(fb);
    return cloud;
  }
  return local;
}

export function useRepo(): MapRepository {
  const mode = useSession((s) => s.mode);
  return getRepo(mode);
}
