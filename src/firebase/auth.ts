import {
  isSignInWithEmailLink,
  OAuthProvider,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithCredential,
  signInWithEmailLink,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { useEffect, useState } from 'react';
import { AppleSignIn } from '../plugins/appleSignIn';
import { firebase } from './app';

const EMAIL_KEY = 'pathsense.emailForSignIn';

function randomNonce(length = 32): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sign in with Apple via the native sheet, then exchange the token with Firebase. */
export async function signInWithApple(): Promise<User> {
  const fb = firebase();
  if (!fb) throw new Error('Firebase is not configured');
  const rawNonce = randomNonce();
  const res = await AppleSignIn.authorize({ nonce: await sha256Hex(rawNonce) });
  const credential = new OAuthProvider('apple.com').credential({ idToken: res.identityToken, rawNonce });
  const { user } = await signInWithCredential(fb.auth, credential);
  const name = [res.givenName, res.familyName].filter(Boolean).join(' ');
  if (name && !user.displayName) await updateProfile(user, { displayName: name });
  return user;
}

/** Email link sign-in. The link opens the app through its associated domain. */
export async function sendEmailLink(email: string): Promise<void> {
  const fb = firebase();
  if (!fb) throw new Error('Firebase is not configured');
  const url =
    import.meta.env.VITE_EMAIL_LINK_URL || `https://${import.meta.env.VITE_FIREBASE_AUTH_DOMAIN}/signin`;
  await sendSignInLinkToEmail(fb.auth, email, {
    url,
    handleCodeInApp: true,
    iOS: { bundleId: 'app.pathsense.ios' },
  });
  localStorage.setItem(EMAIL_KEY, email);
}

export function isEmailLink(link: string): boolean {
  const fb = firebase();
  return Boolean(fb && isSignInWithEmailLink(fb.auth, link));
}

export async function completeEmailLink(link: string, email?: string): Promise<User> {
  const fb = firebase();
  if (!fb) throw new Error('Firebase is not configured');
  const addr = email ?? localStorage.getItem(EMAIL_KEY);
  if (!addr) throw new Error('Enter the email address you used.');
  const { user } = await signInWithEmailLink(fb.auth, addr, link);
  localStorage.removeItem(EMAIL_KEY);
  return user;
}

export async function signOut() {
  const fb = firebase();
  if (fb) await fbSignOut(fb.auth);
}

export function useAuth(): { user: User | null; loading: boolean; enabled: boolean } {
  const fb = firebase();
  const [state, setState] = useState<{ user: User | null; loading: boolean }>({
    user: fb?.auth.currentUser ?? null,
    loading: Boolean(fb),
  });
  useEffect(() => {
    if (!fb) return;
    return onAuthStateChanged(fb.auth, (user) => setState({ user, loading: false }));
  }, [fb]);
  return { ...state, enabled: Boolean(fb) };
}
