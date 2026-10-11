import { lazy, Suspense, useEffect } from 'react';
import { createHashRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom';
import { LiveRegion } from './components/LiveRegion';
import { SafetyNotice } from './components/SafetyNotice';
import { TalkButton } from './components/TalkButton';
import { Spinner } from './components/ui';
import { HomeScreen } from './screens/HomeScreen';
import { usePlace } from './state/place';
import { useSettings } from './state/settings';

const NavigateScreen = lazy(() => import('./screens/NavigateScreen'));
const ScanScreen = lazy(() => import('./screens/ScanScreen'));
const LookScreen = lazy(() => import('./screens/LookScreen'));
const RoomsScreen = lazy(() => import('./screens/RoomsScreen'));
const SettingsScreen = lazy(() => import('./screens/SettingsScreen'));
const HelpScreen = lazy(() => import('./screens/HelpScreen'));

function Root() {
  const highContrast = useSettings((s) => s.highContrast);
  const loaded = usePlace((s) => s.loaded);
  const load = usePlace((s) => s.load);

  useEffect(() => {
    document.documentElement.dataset.contrast = highContrast ? 'high' : 'normal';
  }, [highContrast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <a
        href="#main"
        className="sr-only-focusable absolute left-2 top-2 z-50 bg-accent text-accent-fg px-3 py-2"
      >
        Skip to content
      </a>
      <SafetyNotice />
      <LiveRegion />
      {loaded ? (
        <Suspense fallback={<Spinner />}>
          <Outlet />
          <TalkButton />
        </Suspense>
      ) : (
        <Spinner />
      )}
    </>
  );
}

// Hash routing: the Capacitor web view serves a single index.html.
const router = createHashRouter([
  {
    element: <Root />,
    children: [
      { path: '/', element: <HomeScreen /> },
      { path: '/go', element: <NavigateScreen /> },
      { path: '/scan', element: <ScanScreen /> },
      { path: '/look', element: <LookScreen /> },
      { path: '/rooms', element: <RoomsScreen /> },
      { path: '/settings', element: <SettingsScreen /> },
      { path: '/help', element: <HelpScreen /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
