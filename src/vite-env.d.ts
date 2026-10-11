/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_SCAN_SIMULATOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
