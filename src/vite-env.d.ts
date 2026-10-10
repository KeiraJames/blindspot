/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_EMULATORS?: string;
  readonly VITE_FIREBASE_EMULATOR_HOST?: string;
  readonly VITE_FUNCTIONS_REGION?: string;
  readonly VITE_ELEVENLABS_VOICE_ID?: string;
  readonly VITE_EMAIL_LINK_URL?: string;
  readonly VITE_ENABLE_SCAN_SIMULATOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
