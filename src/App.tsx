import { App as CapApp } from '@capacitor/app';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { createHashRouter, Navigate, Outlet, RouterProvider, useNavigate } from 'react-router-dom';
import { LiveRegion } from './components/LiveRegion';
import { SafetyNotice } from './components/SafetyNotice';
import { Spinner } from './components/ui';
import { completeEmailLink, isEmailLink, useAuth } from './firebase/auth';
import { startUploadQueue } from './state/scanDrafts';
import { useSession } from './state/session';
import { useSettings } from './state/settings';
import { HomeScreen } from './screens/HomeScreen';
import { MapScreen } from './screens/MapScreen';
import { SignInScreen } from './screens/SignInScreen';

// Heavier screens load on demand (three.js lives in Studio).
const NavigateScreen = lazy(() => import('./screens/NavigateScreen'));
const ScanScreen = lazy(() => import('./screens/ScanScreen'));
const StudioScreen = lazy(() => import('./screens/studio/StudioScreen'));
const ShareScreen = lazy(() => import('./screens/ShareScreen'));
const SettingsScreen = lazy(() => import('./screens/SettingsScreen'));
const PracticeScreen = lazy(() => import('./screens/PracticeScreen'));
const AboutScreen = lazy(() => import('./screens/AboutScreen'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, networkMode: 'offlineFirst' } },
});

/** Requires a chosen account mode; cloud mode also requires a signed-in user. */
function Gate() {
  const mode = useSession((s) => s.mode);
  const { user, loading, enabled } = useAuth();
  if (mode === null) return <Navigate to="/signin" replace />;
  if (mode === 'cloud' && enabled) {
    if (loading) return <Spinner label="Signing in" />;
    if (!user) return <Navigate to="/signin" replace />;
  }
  return <Outlet />;
}

function Root() {
  const navigate = useNavigate();
  const highContrast = useSettings((s) => s.highContrast);
  const mode = useSession((s) => s.mode);

  useEffect(() => {
    document.documentElement.dataset.contrast = highContrast ? 'high' : 'normal';
  }, [highContrast]);

  useEffect(() => startUploadQueue(), [mode]);

  // Email sign-in links and invite links open the app through its associated domain.
  useEffect(() => {
    const handle = CapApp.addListener('appUrlOpen', async ({ url }) => {
      if (isEmailLink(url)) {
        try {
          await completeEmailLink(url);
          useSession.getState().setMode('cloud');
          navigate('/');
        } catch {
          navigate(`/signin?link=${encodeURIComponent(url)}`);
        }
        return;
      }
      const invite = new URL(url).searchParams.get('invite');
      if (invite) navigate(`/?invite=${encodeURIComponent(invite)}`);
    });
    return () => void handle.then((h) => h.remove());
  }, [navigate]);

  return (
    <>
      <a href="#main" className="sr-only-focusable absolute left-2 top-2 z-50 rounded bg-accent text-accent-fg px-3 py-2">
        Skip to content
      </a>
      <SafetyNotice />
      <LiveRegion />
      <Suspense fallback={<Spinner />}>
        <Outlet />
      </Suspense>
    </>
  );
}

// Hash routing: the Capacitor web view serves a single index.html.
const router = createHashRouter([
  {
    element: <Root />,
    children: [
      { path: '/signin', element: <SignInScreen /> },
      { path: '/about', element: <AboutScreen /> },
      {
        element: <Gate />,
        children: [
          { path: '/', element: <HomeScreen /> },
          { path: '/settings', element: <SettingsScreen /> },
          { path: '/practice', element: <PracticeScreen /> },
          { path: '/maps/:mapId', element: <MapScreen /> },
          { path: '/maps/:mapId/navigate', element: <NavigateScreen /> },
          { path: '/maps/:mapId/scan', element: <ScanScreen /> },
          { path: '/maps/:mapId/studio', element: <StudioScreen /> },
          { path: '/maps/:mapId/share', element: <ShareScreen /> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
