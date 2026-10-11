import { registerPlugin, WebPlugin } from '@capacitor/core';

export interface AppleSignInPlugin {
  /** Native Sign in with Apple. `nonce` must be the SHA-256 hex of the raw nonce given to Firebase. */
  authorize(options: {
    nonce: string;
  }): Promise<{ identityToken: string; givenName?: string; familyName?: string; email?: string }>;
}

class AppleSignInWeb extends WebPlugin implements AppleSignInPlugin {
  async authorize(): Promise<never> {
    throw this.unavailable('Native Sign in with Apple is only available in the iOS app.');
  }
}

export const AppleSignIn = registerPlugin<AppleSignInPlugin>('AppleSignIn', {
  web: () => new AppleSignInWeb(),
});
