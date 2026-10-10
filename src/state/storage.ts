import { Preferences } from '@capacitor/preferences';
import type { StateStorage } from 'zustand/middleware';

/**
 * Zustand storage backed by Capacitor Preferences (UserDefaults on iOS), which iOS does
 * not purge under storage pressure the way it can purge WKWebView localStorage.
 */
export const preferencesStorage: StateStorage = {
  getItem: async (name) => (await Preferences.get({ key: name })).value,
  setItem: async (name, value) => Preferences.set({ key: name, value }),
  removeItem: async (name) => Preferences.remove({ key: name }),
};
