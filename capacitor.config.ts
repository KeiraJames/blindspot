import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.keirajames.pathsense',
  appName: 'BlindSpöt',
  webDir: 'dist',
  ios: {
    // The AR camera view sits behind a transparent webview; see ARNavPlugin.swift.
    backgroundColor: '#fff0f6',
    contentInset: 'never',
    // Pages scroll; the navigation screen locks itself to the viewport.
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
