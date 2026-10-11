import { Capacitor } from '@capacitor/core';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { Button, Card, ErrorBox, Field } from '../components/ui';
import { firebaseConfigured } from '../firebase/app';
import { completeEmailLink, sendEmailLink, signInWithApple } from '../firebase/auth';
import { useSession } from '../state/session';

export function SignInScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const pendingLink = params.get('link');
  const setMode = useSession((s) => s.setMode);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    setMode('cloud');
    navigate('/', { replace: true });
  };

  return (
    <Screen title="Welcome to PathSense">
      <p className="text-lg">
        Indoor directions you can follow without looking: spoken turns, distinct vibrations and simple swipes.
      </p>

      {firebaseConfigured && (
        <Card className="flex flex-col gap-4">
          <h2 className="text-xl font-bold">Sign in to share maps</h2>
          {Capacitor.getPlatform() === 'ios' && (
            <Button
              variant="primary"
              large
              block
              disabled={busy}
              onClick={() => run(async () => (await signInWithApple(), finish()))}
            >
              Sign in with Apple
            </Button>
          )}
          {pendingLink ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => (await completeEmailLink(pendingLink, email), finish()));
              }}
            >
              <Field
                label="Confirm your email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button type="submit" variant="primary" block disabled={busy}>
                Finish signing in
              </Button>
            </form>
          ) : sent ? (
            <p role="status">Check your email for a sign-in link and open it on this device.</p>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => (await sendEmailLink(email), setSent(true)));
              }}
            >
              <Field
                label="Email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                hint="We'll email you a link. No password needed."
              />
              <Button type="submit" block disabled={busy || !email}>
                Email me a sign-in link
              </Button>
            </form>
          )}
          <ErrorBox error={error} />
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Use on this device only</h2>
        <p className="text-muted">Maps stay on this phone. You can sign in later to share them.</p>
        <Button
          block
          onClick={() => {
            setMode('local');
            navigate('/', { replace: true });
          }}
        >
          Continue without an account
        </Button>
      </Card>
    </Screen>
  );
}
