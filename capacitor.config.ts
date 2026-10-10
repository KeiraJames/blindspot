import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.pathsense.ios',
  appName: 'PathSense',
  webDir: 'dist',
  ios: {
    // The AR camera view sits behind a transparent webview; see ARNavPlugin.swift.
    backgroundColor: '#000000',
    contentInset: 'never',
    scrollEnabled: false,
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
