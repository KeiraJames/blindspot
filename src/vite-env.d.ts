/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_SCAN_SIMULATOR?: string;
  readonly VITE_ELEVENLABS_API_KEY?: string;
  readonly VITE_ELEVENLABS_VOICE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
