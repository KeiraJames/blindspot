import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FloorPlan } from '../components/FloorPlan';
import { GestureSurface } from '../components/GestureSurface';
import { Screen } from '../components/Screen';
import { Button, Card, cx, ErrorBox, Field, Spinner, Toggle } from '../components/ui';
import { cue, say, voice } from '../lib/feedback';
import { DEFAULT_PREFERENCES } from '../lib/graph/astar';
import { nodeDisplayName } from '../lib/graph/graph';
import type { MapGraph } from '../lib/graph/types';
import type { Gesture } from '../lib/gestures/recognizer';
import { NavigationController, type NavOptions, type NavState } from '../lib/nav/controller';
import { stepText } from '../lib/nav/guidance';
import { PoseAdapter } from '../lib/nav/poseAdapter';
import { WalkSimulator } from '../lib/nav/simulator';
import { formatDistance } from '../lib/nav/units';
import { ARNav, type ARPose } from '../plugins/arnav';
import { Speech } from '../plugins/speech';
import { Vision } from '../plugins/vision';
import { usePublished } from '../state/queries';
import { useRepo } from '../state/session';
import { useSettings, type Settings } from '../state/settings';

function navOptions(s: Settings): NavOptions {
  return {
    phrase: { unit: s.units, stepLength: s.stepLength },
    prefs: {
      ...DEFAULT_PREFERENCES,
      avoidStairs: s.avoidStairs,
      stairPenalty: s.preferElevator ? 40 : DEFAULT_PREFERENCES.stairPenalty,
      elevatorPenalty: s.preferElevator ? 0 : DEFAULT_PREFERENCES.elevatorPenalty,
    },
    hazardAlerts: s.hazardAlerts,
    courseTicks: s.courseTicks,
    verbosity: s.verbosity,
  };
}

export default function NavigateScreen() {
  const { mapId } = useParams();
  const published = usePublished(mapId);
  if (published.isLoading) return <Spinner label="Loading map" />;
  if (!published.data)
    return (
      <Screen title="Navigate" back={`/maps/${mapId}`}>
        <ErrorBox error={published.error ?? 'This map has not been published yet. Publish it from Map Studio first.'} />
      </Screen>
    );
  return <Navigator mapId={mapId!} graph={published.data.graph} />;
}

function Navigator({ mapId, graph }: { mapId: string; graph: MapGraph }) {
  const settings = useSettings();
  const repo = useRepo();
  const controller = useMemo(
    () =>
      new NavigationController(
        graph,
        { cue: (n, t, p) => void cue(n, t, p), say: (t, p) => void say(t, p), prefetch: (t) => voice.prefetch(t), repeat: () => voice.repeat(), stopSpeech: () => voice.stop() },
        navOptions(useSettings.getState()),
      ),
    [graph],
  );
  const [state, setState] = useState<NavState>(controller.state);
  const [query, setQuery] = useState('');
  const [listening, setListening] = useState(false);
  const [arAvailable, setArAvailable] = useState(false);
  const [arError, setArError] = useState<string | null>(null);
  const [simInstance, setSimInstance] = useState<WalkSimulator | null>(null);
  const [anchored, setAnchored] = useState(false);
  const [arVisible, setArVisible] = useState(false);
  const sim = useRef<WalkSimulator | null>(null);
  const adapter = useRef<PoseAdapter | null>(null);
  const lastAR = useRef<ARPose | null>(null);
  const arHandles = useRef<PluginListenerHandle[]>([]);
  const [, force] = useState(0);

  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => controller.updateOptions(navOptions(settings)), [controller, settings]);

  useEffect(() => {
    void ARNav.isSupported()
      .then((s) => setArAvailable(Capacitor.isNativePlatform() && s.worldTracking))
      .catch(() => setArAvailable(false));
    say(`${controller.destinations.length} places on this map. Choose where you are, then where to go. Swipe left or right to browse, double-tap to choose.`);
  }, [controller]);

  const stopPoseSources = useCallback(async () => {
    sim.current?.stop();
    sim.current = null;
    arHandles.current.forEach((h) => void h.remove());
    arHandles.current = [];
    document.body.classList.remove('ar-active');
    await ARNav.stop().catch(() => undefined);
    await Vision.setEnabled({ enabled: false }).catch(() => undefined);
  }, []);

  useEffect(
    () => () => {
      void stopPoseSources();
      voice.stop();
    },
    [stopPoseSources],
  );

  const onGesture = useCallback(
    (g: Gesture) => {
      if (g === 'twoFingerUp' || g === 'twoFingerDown') {
        const landingId = controller.confirmFloorChange(g === 'twoFingerUp' ? 'up' : 'down');
        if (!landingId) return;
        const landing = controller.index.node(landingId);
        if (sim.current) sim.current.setFloor(landing.floorId, landing.position);
        else if (adapter.current && lastAR.current) {
          adapter.current.anchorAt(lastAR.current, landing.position, landing.floorId, state.pose?.heading ?? controller.initialBearing());
        }
        void cue('floorChange', `Confirmed. ${controller.index.floors.get(landing.floorId)?.name}.`);
        return;
      }
      controller.gesture(g);
    },
    [controller, state.pose?.heading],
  );

  const startAR = async () => {
    const startNode = controller.index.node(controller.state.startId!);
    const scanId = startNode.scanId;
    let worldMapPath: string | null = null;
    if (scanId) worldMapPath = await repo.worldMapPath(mapId, scanId).catch(() => null);
    const a = new PoseAdapter(graph);
    adapter.current = a;
    let reportedAnchor = false;
    arHandles.current = await Promise.all([
      ARNav.addListener('pose', (p) => {
        lastAR.current = p;
        if (!a.anchored) {
          if (worldMapPath && scanId && p.relocalized) {
            a.anchorToScan(scanId, p.y);
            void cue('confirm', 'Location found.');
          } else if (!worldMapPath && p.tracking === 'normal') {
            // No world map: assume the user stands at the start, facing the first leg.
            a.anchorAt(p, startNode.position, startNode.floorId, controller.initialBearing());
          } else return;
        }
        if (!reportedAnchor) {
          reportedAnchor = true;
          setAnchored(true);
        }
        const mp = a.toMap(p);
        if (mp) controller.onPose(mp);
      }),
      ARNav.addListener('gesture', ({ gesture }) => onGesture(gesture)),
      ARNav.addListener('interrupted', ({ interrupted }) => {
        if (interrupted) void cue('trackingLost', 'Camera interrupted.', 'high');
      }),
      Vision.addListener('hazard', (h) => controller.hazard(h)),
      Vision.addListener('text', (t) => {
        const dest = controller.label(controller.state.destinationId);
        if (dest && dest.toLowerCase().includes(t.text.toLowerCase())) void say(`Sign for ${t.text} detected.`, 'low');
      }),
    ]);
    if (settings.showCamera) {
      document.body.classList.add('ar-active');
      setArVisible(true);
    }
    await ARNav.start({ worldMapPath: worldMapPath ?? undefined, showCamera: settings.showCamera, nativeGestures: true, poseRate: 10 });
    await Vision.configure({ rate: 4, detectPeople: true, detectText: true, depthObstacles: true, obstacleDistance: 1.5, customModel: true });
    await Vision.setEnabled({ enabled: settings.hazardAlerts });
    if (worldMapPath) void say('Looking around to find your location. Slowly turn the phone.');
  };

  const startSim = () => {
    const s = new WalkSimulator(controller.index, controller.state.startId!, controller.initialBearing(), (p) => {
      controller.onPose(p);
    });
    s.followRoute(controller.state.route!.nodeIds);
    sim.current = s;
    s.start();
    setSimInstance(s);
  };

  // After a reroute, keep the simulator's autopilot on the new route.
  useEffect(() => {
    if (sim.current && state.route) sim.current.followRoute(state.route.nodeIds);
  }, [state.route]);

  useEffect(() => {
    if (state.phase === 'arrived' || state.phase === 'choose_destination' || state.phase === 'choose_start') {
      if (sim.current || arHandles.current.length)
        void stopPoseSources().then(() => {
          setSimInstance(null);
          setAnchored(false);
          setArVisible(false);
        });
    }
  }, [state.phase, stopPoseSources]);

  // Start ARKit (or the simulator) whenever guidance begins, from the Start button or a double-tap.
  const prevPhase = useRef(state.phase);
  useEffect(() => {
    if (prevPhase.current === 'preview' && state.phase === 'guiding' && !sim.current && arHandles.current.length === 0) {
      void (async () => {
        if (arAvailable) {
          try {
            await startAR();
            return;
          } catch (e) {
            setArError(e instanceof Error ? e.message : String(e));
          }
        }
        startSim();
      })();
    }
    prevPhase.current = state.phase;
  });

  // AR guide path for low-vision users.
  useEffect(() => {
    const a = adapter.current;
    if (!anchored || !a || !state.route || !settings.showCamera) return;
    const pts = state.route.nodeIds
      .map((id) => controller.index.node(id))
      .filter((n) => n.floorId === (state.pose?.floorId ?? n.floorId))
      .map((n) => a.toSession(n.position, controller.index.floors.get(n.floorId)?.elevation ?? 0))
      .filter((p): p is NonNullable<typeof p> => p !== null);
    void ARNav.setGuidePath({ points: pts }).catch(() => undefined);
  }, [state.route, state.pose?.floorId, anchored, settings.showCamera, controller]);

  const dictate = async () => {
    setListening(true);
    try {
      const { transcript } = await Speech.listen({ timeoutMs: 6000, contextualStrings: controller.destinations.map((d) => d.label) });
      setQuery(transcript);
      const hits = controller.findDestination(transcript);
      if (hits.length === 1 || (hits[0] && transcript.toLowerCase().includes(hits[0].label.toLowerCase()))) chooseDestination(hits[0]!.id);
      else if (hits.length > 1) void say(`${hits.length} matches. ${hits.slice(0, 3).map((h) => nodeDisplayName(graph, h)).join(', ')}.`);
      else void say(`No place called ${transcript}.`);
    } catch {
      void say('Voice search is not available. Type the place name instead.');
    } finally {
      setListening(false);
    }
  };

  const chooseStart = (id: string) => {
    void cue('confirm');
    controller.setStart(id);
    setQuery('');
  };
  const chooseDestination = (id: string) => {
    void cue('confirm');
    controller.setDestination(id);
    setQuery('');
  };

  const viewFloor = state.pose?.floorId ?? (state.startId ? controller.index.node(state.startId).floorId : graph.floors[0]!.id);
  const filtered = query.trim() ? controller.findDestination(query) : controller.destinations;
  const active = state.phase === 'guiding' || state.phase === 'paused' || state.phase === 'arrived';
  const choosingStart = state.phase === 'choose_start' || (!state.startId && state.phase !== 'preview');

  if (active) {
    return (
      <div className={cx('fixed inset-0 flex flex-col', !arVisible && 'bg-bg')}>
        <GestureSurface onGesture={onGesture} label="Navigation. Swipe up to repeat, tap for where am I, touch and hold to pause, swipe down to end." className="flex-1 flex flex-col safe-top px-4 gap-3">
          <div className="flex items-start justify-between gap-2 pt-2">
            <p className="text-muted font-semibold">
              {state.phase === 'arrived' ? 'Arrived' : state.phase === 'paused' ? 'Paused' : `${formatDistance(state.remaining, settings.units, settings.stepLength)} to go`}
            </p>
            <p className="text-muted text-right">{controller.label(state.destinationId)}</p>
          </div>
          <p aria-hidden className="text-3xl font-bold leading-tight bg-bg/80 rounded-2xl p-3">
            {state.lastPrompt}
          </p>
          {arError && <p className="text-warn">AR unavailable ({arError}). Using the walk simulator.</p>}
          {!arVisible && (
            <FloorPlan graph={graph} floorId={viewFloor} route={state.route?.nodeIds} pose={state.pose} className="w-full flex-1 min-h-40 rounded-2xl" showLabels />
          )}
        </GestureSurface>

        {simInstance && <SimPanel sim={simInstance} onChange={() => force((n) => n + 1)} />}

        <nav aria-label="Navigation controls" data-no-gesture className="grid grid-cols-3 gap-2 p-3 safe-bottom bg-bg/90 border-t border-line">
          <Button large onClick={() => voice.repeat()}>
            Repeat
          </Button>
          <Button large onClick={() => controller.gesture('tap')}>
            Where am I
          </Button>
          {state.phase === 'arrived' ? (
            <Button large variant="primary" onClick={() => controller.gesture('swipeBack')}>
              New trip
            </Button>
          ) : (
            <Button large onClick={() => (state.phase === 'paused' ? controller.resume() : controller.pause())}>
              {state.phase === 'paused' ? 'Resume' : 'Pause'}
            </Button>
          )}
          <Button large onClick={() => controller.routeToNearest('exit')}>
            Nearest exit
          </Button>
          {state.steps.some((s) => s.kind === 'floor_change') && (
            <Button large onClick={() => onGesture(state.steps.find((s) => s.kind === 'floor_change')!.floorChange!.direction === 'up' ? 'twoFingerUp' : 'twoFingerDown')}>
              I changed floor
            </Button>
          )}
          <Button large variant="danger" onClick={() => controller.end()} className="col-start-3">
            End
          </Button>
        </nav>
      </div>
    );
  }

  return (
    <Screen title={choosingStart ? 'Where are you?' : state.phase === 'preview' ? 'Your route' : 'Where to?'} back={`/maps/${mapId}`}>
      {state.phase === 'preview' && state.route ? (
        <>
          <Card className="flex flex-col gap-3">
            <p className="text-lg">
              From <strong>{controller.label(state.startId)}</strong> to <strong>{controller.label(state.destinationId)}</strong>, {formatDistance(state.route.length, settings.units, settings.stepLength)}.
            </p>
            <ol className="list-decimal pl-6 flex flex-col gap-1">
              {state.steps.map((s, i) => (
                <li key={i}>{stepText(s, { unit: settings.units, stepLength: settings.stepLength }, controller.label(state.destinationId))}</li>
              ))}
            </ol>
            <Toggle
              label="Avoid stairs"
              checked={settings.avoidStairs}
              onChange={(v) => {
                settings.set({ avoidStairs: v });
                controller.updateOptions(navOptions({ ...settings, avoidStairs: v }));
                controller.setDestination(state.destinationId!);
              }}
            />
          </Card>
          <Button variant="primary" large block onClick={() => controller.begin()}>
            Start
          </Button>
          <Button block onClick={() => controller.gesture('swipeBack')}>
            Change destination
          </Button>
          <FloorPlan graph={graph} floorId={controller.index.node(state.startId!).floorId} route={state.route.nodeIds} className="w-full aspect-square rounded-2xl" />
        </>
      ) : (
        <>
          {state.error && <ErrorBox error={state.error} />}
          {state.startId && !choosingStart && (
            <p className="text-muted">
              Starting from <strong>{controller.label(state.startId)}</strong>.{' '}
              <button type="button" className="underline text-accent min-h-12" onClick={() => controller.clearStart()}>
                Change
              </button>
            </p>
          )}
          <div className="flex gap-2 items-end">
            <Field label={choosingStart ? 'Search for where you are' : 'Search for a place'} type="search" className="flex-1" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
            {!choosingStart && (
              <Button onClick={() => void dictate()} disabled={listening} aria-label="Search by voice">
                {listening ? 'Listening…' : 'Speak'}
              </Button>
            )}
          </div>
          {!choosingStart && (
            <div className="grid grid-cols-3 gap-2">
              <Button onClick={() => controller.routeToNearest('exit')}>Nearest exit</Button>
              <Button onClick={() => controller.routeToNearest('bathroom')}>Bathroom</Button>
              <Button onClick={() => controller.routeToNearest('elevator')}>Elevator</Button>
            </div>
          )}
          <ul className="flex flex-col gap-2" aria-label={choosingStart ? 'Starting points' : 'Destinations'}>
            {filtered
              .filter((d) => choosingStart || d.id !== state.startId)
              .map((d) => (
                <li key={d.id}>
                  <Button block className="justify-start text-left" onClick={() => (choosingStart ? chooseStart(d.id) : chooseDestination(d.id))}>
                    {nodeDisplayName(graph, d)}
                  </Button>
                </li>
              ))}
          </ul>
          {filtered.length === 0 && <p className="text-muted">No matching places.</p>}
        </>
      )}
    </Screen>
  );
}

function SimPanel({ sim, onChange }: { sim: WalkSimulator; onChange: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') sim.step(0.7);
      else if (e.key === 'ArrowLeft') sim.turn(Math.PI / 8);
      else if (e.key === 'ArrowRight') sim.turn(-Math.PI / 8);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [sim]);
  const toggle = (k: 'autopilot' | 'wander') => {
    if (k === 'autopilot') sim.setAutopilot(!sim.autopilot);
    else sim.setWander(!sim.wander);
    onChange();
  };
  return (
    <section data-no-gesture aria-label="Walk simulator" className="mx-3 mb-2 rounded-2xl border border-warn p-2 bg-bg/90 flex flex-wrap gap-2 items-center">
      <span className="text-warn text-sm font-semibold w-full">Walk simulator (no ARKit). Arrow keys move.</span>
      <Button onClick={() => toggle('autopilot')} aria-pressed={sim.autopilot}>
        {sim.autopilot ? 'Stop walking' : 'Auto-walk'}
      </Button>
      <Button onClick={() => toggle('wander')} aria-pressed={sim.wander}>
        {sim.wander ? 'Return' : 'Wander off'}
      </Button>
      <Button onClick={() => sim.step(1)}>Step</Button>
      <Button onClick={() => sim.turn(Math.PI / 4)} aria-label="Turn left 45 degrees">
        ↺
      </Button>
      <Button onClick={() => sim.turn(-Math.PI / 4)} aria-label="Turn right 45 degrees">
        ↻
      </Button>
      <Button onClick={() => sim.setTracking(sim.pose.tracking === 'lost' ? 'normal' : 'lost')}>{sim.pose.tracking === 'lost' ? 'Restore tracking' : 'Lose tracking'}</Button>
    </section>
  );
}
