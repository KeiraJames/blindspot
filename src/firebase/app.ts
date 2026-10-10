import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, indexedDBLocalPersistence, initializeAuth, type Auth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';

const env = import.meta.env;

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId);

export interface FirebaseHandles {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
  functions: Functions;
}

let handles: FirebaseHandles | null = null;

/** Lazily initialized Firebase, or null in local-only mode (no config). */
export function firebase(): FirebaseHandles | null {
  if (!firebaseConfigured) return null;
  if (handles) return handles;
  const app = initializeApp(config);
  // initializeAuth with IndexedDB persistence: getAuth() pulls in popup/redirect resolvers
  // that hang inside WKWebView (capacitor:// scheme).
  const auth = initializeAuth(app, { persistence: indexedDBLocalPersistence });
  // Persistent cache gives offline navigation on previously loaded map versions.
  const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) }) });
  const storage = getStorage(app);
  const functions = getFunctions(app, env.VITE_FUNCTIONS_REGION || 'us-central1');
  if (env.VITE_FIREBASE_EMULATORS === 'true') {
    const host = env.VITE_FIREBASE_EMULATOR_HOST || 'localhost';
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8080);
    connectStorageEmulator(storage, host, 9199);
    connectFunctionsEmulator(functions, host, 5001);
  }
  handles = { app, auth, db, storage, functions };
  return handles;
}
