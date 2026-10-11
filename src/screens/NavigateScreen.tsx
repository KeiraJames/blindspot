import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FloorPlan } from '../components/FloorPlan';
import { GestureSurface } from '../components/GestureSurface';
import { MicButton } from '../components/MicButton';
import { NavMap } from '../components/NavMap';
import { PixelArt, spriteFor } from '../components/PixelArt';
import { Screen } from '../components/Screen';
import { Button, Card, cx, ErrorBox, Field } from '../components/ui';
import { announce, ask, cue, say, voice } from '../lib/feedback';
import { DEFAULT_PREFERENCES } from '../lib/graph/astar';
import { nodeDisplayName } from '../lib/graph/graph';
import type { MapGraph } from '../lib/graph/types';
import type { Gesture } from '../lib/gestures/recognizer';
import { NavigationController, type NavOptions, type NavState } from '../lib/nav/controller';
import { stepText } from '../lib/nav/guidance';
import { PoseAdapter } from '../lib/nav/poseAdapter';
import { WalkSimulator } from '../lib/nav/simulator';
import { formatDistance } from '../lib/nav/units';
import type { ScanResult } from '../lib/scan/types';
import { matchPlace, parseCommand, VOICE_HELP } from '../lib/voice/commands';
import { ARNav, type ARPose } from '../plugins/arnav';
import { Vision } from '../plugins/vision';
import { SAMPLES, useActiveMap } from '../state/place';
import { useSettings, type SampleId, type Settings } from '../state/settings';

function navOptions(s: Settings): NavOptions {
  return {
    phrase: { unit: s.units, stepLength: s.stepLength },
    prefs: DEFAULT_PREFERENCES,
    hazardAlerts: s.obstacleAlerts,
    courseTicks: true,
    verbosity: 'detailed',
  };
}

export default function NavigateScreen() {
  const { graph, scans, isSample, sampleName } = useActiveMap();
  // Remount when the map changes (e.g. after the first room is scanned).
  return (
    <Navigator
      key={sampleName ?? 'mine'}
      graph={graph}
      scans={scans}
      isSample={isSample}
      sampleName={sampleName}
    />
  );
}

function Navigator({
  graph,
  scans,
  isSample,
  sampleName,
}: {
  graph: MapGraph;
  scans: Record<string, ScanResult>;
  isSample: boolean;
  sampleName: string | null;
}) {
  const settings = useSettings();
  const controller = useMemo(
    () =>
      new NavigationController(
        graph,
        {
          cue: (n, t, p) => void cue(n, t, p),
          say: (t, p) => void say(t, p),
          repeat: () => voice.repeat(),
          stopSpeech: () => voice.stop(),
        },
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
  const [mapMode, setMapMode] = useState<'follow' | 'overview'>('follow');
  const sim = useRef<WalkSimulator | null>(null);
  const adapter = useRef<PoseAdapter | null>(null);
  const lastAR = useRef<ARPose | null>(null);
  const arHandles = useRef<PluginListenerHandle[]>([]);
  const [, force] = useState(0);
  const places = useMemo(
    () => controller.destinations.map((d) => ({ id: d.id, label: d.label })),
    [controller],
  );
  const roomList = places.map((p) => p.label).join(', ');

  useEffect(() => controller.subscribe(setState), [controller]);
  // Warm the natural-voice cache with this route's sentences before they're needed.
  useEffect(() => {
    const phrase = { unit: settings.units, stepLength: settings.stepLength };
    voice.prefetch(state.steps.map((st) => stepText(st, phrase, controller.label(state.destinationId))));
  }, [state.steps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => controller.updateOptions(navOptions(settings)), [controller, settings]);

  useEffect(() => {
    void ARNav.isSupported()
      .then((s) => setArAvailable(Capacitor.isNativePlatform() && s.worldTracking))
      .catch(() => setArAvailable(false));
    const intro =
      sampleName === 'Open hall'
        ? `Go somewhere, using the open hall practice map. Stand at the entrance, facing into the hall. Then press the big button and say Entrance. The places are: ${roomList}.`
        : `Go somewhere${isSample ? `, using the ${sampleName} practice map` : ''}. Where are you? Press the big button and say the room you're in, or pick it from the list. The places are: ${roomList}.`;
    void announce(intro);
  }, [controller]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const onGesture = useCallback((g: Gesture) => controller.gesture(g), [controller]);

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

  /** Spoken answer to "where are you" / "where to". */
  const onPlaceHeard = (heard: string, pick: (id: string) => void) => {
    if (!heard) return void say("I didn't hear anything. Press the big button and try again.");
    const place = matchPlace(heard, places);
    if (place) pick(place.id);
    else void say(`I couldn't find ${heard}. The rooms are: ${roomList}. Try again.`);
  };

  /** Spoken command while walking. */
  const speakCommand = async () => {
    setListening(true);
    try {
      const heard = await ask('Say a command.', [
        'where am I',
        'repeat',
        'pause',
        'resume',
        'stop',
        ...places.map((p) => p.label),
      ]);
      const cmd = parseCommand(heard, places);
      switch (cmd.type) {
        case 'where':
          controller.gesture('tap');
          break;
        case 'repeat':
          voice.repeat();
          break;
        case 'pause':
          controller.pause();
          break;
        case 'resume':
          controller.resume();
          break;
        case 'end':
          controller.end();
          break;
        case 'help':
          void say(VOICE_HELP);
          break;
        case 'place':
          controller.goTo(cmd.id);
          break;
        default:
          void say(
            heard
              ? `I heard ${heard}, but I don't know that command. ${VOICE_HELP}`
              : "I didn't hear anything.",
          );
      }
    } catch {
      void say('Listening is not available right now.');
    } finally {
      setListening(false);
    }
  };

  const startAR = async () => {
    const startNode = controller.index.node(controller.state.startId!);
    const scanId = startNode.scanId;
    const worldMapPath = (scanId && scans[scanId]?.files.worldMap) || null;
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
    ]);
    document.body.classList.add('ar-active');
    setArVisible(true);
    await ARNav.start({
      worldMapPath: worldMapPath ?? undefined,
      showCamera: true,
      nativeGestures: true,
      poseRate: 10,
    });
    await Vision.configure({
      rate: 4,
      detectPeople: true,
      detectText: false,
      depthObstacles: true,
      obstacleDistance: 1.5,
      customModel: true,
    });
    await Vision.setEnabled({ enabled: settings.obstacleAlerts });
    if (worldMapPath) void say('Finding your location. Slowly turn the phone around.');
    else
      void say(
        `Stand in ${startNode.label}, hold the phone upright, and face the way the first instruction points. Tap the screen any time to hear where you are.`,
      );
  };

  const startSim = () => {
    const s = new WalkSimulator(
      controller.index,
      controller.state.startId!,
      controller.initialBearing(),
      (p) => controller.onPose(p),
    );
    s.followRoute(controller.state.route!.nodeIds);
    // Walk automatically so the demo moves without extra taps; the strip can stop it.
    s.setAutopilot(true);
    sim.current = s;
    s.start();
    setSimInstance(s);
  };

  // Pausing guidance also stops the simulated walker; resuming starts it again.
  const lastPhase = useRef(state.phase);
  useEffect(() => {
    const was = lastPhase.current;
    lastPhase.current = state.phase;
    const s = sim.current;
    if (!s) return;
    if (state.phase === 'paused' && was === 'guiding') s.setAutopilot(false);
    else if (state.phase === 'guiding' && was === 'paused') s.setAutopilot(true);
    else return;
    force((n) => n + 1);
  }, [state.phase]);

  // After a reroute, keep the simulator's autopilot on the new route.
  useEffect(() => {
    if (sim.current && state.route) {
      sim.current.followRoute(state.route.nodeIds);
      sim.current.setAutopilot(state.phase === 'guiding');
    }
  }, [state.route]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Start ARKit (or the simulator) whenever guidance begins.
  const prevPhase = useRef(state.phase);
  useEffect(() => {
    if (
      prevPhase.current === 'preview' &&
      state.phase === 'guiding' &&
      !sim.current &&
      arHandles.current.length === 0
    ) {
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
    if (!anchored || !a || !state.route) return;
    const pts = state.route.nodeIds
      .map((id) => controller.index.node(id))
      .map((n) => a.toSession(n.position, 0))
      .filter((p): p is NonNullable<typeof p> => p !== null);
    void ARNav.setGuidePath({ points: pts }).catch(() => undefined);
  }, [state.route, anchored, controller]);

  const filtered = query.trim() ? controller.findDestination(query) : controller.destinations;
  const active = state.phase === 'guiding' || state.phase === 'paused' || state.phase === 'arrived';
  const choosingStart = state.phase === 'choose_start' || (!state.startId && state.phase !== 'preview');

  if (active) {
    const dest = state.destinationId ? controller.index.nodes.get(state.destinationId) : undefined;
    const destSprite = dest ? spriteFor(dest) : null;
    // Show what's next with a live distance; the last spoken prompt can already be stale.
    const liveInstruction = (state.phase === 'guiding' && controller.nextInstruction()) || state.lastPrompt;
    return (
      // Locked to the screen height: the map absorbs whatever space is left, nothing scrolls.
      <div className={cx('fixed inset-0 h-dvh flex flex-col overflow-hidden', !arVisible && 'bg-bg')}>
        <GestureSurface
          onGesture={onGesture}
          label="Navigation. Tap to hear where you are, swipe up to repeat, touch and hold to pause."
          className="flex-1 min-h-0 flex flex-col safe-top px-3 gap-2"
        >
          <div className="flex items-center justify-between gap-2 pt-1">
            <p className="font-pixel font-bold text-lg">
              {state.phase === 'arrived'
                ? 'Arrived!'
                : state.phase === 'paused'
                  ? 'Paused'
                  : `${formatDistance(state.remaining, settings.units, settings.stepLength)} to go`}
            </p>
            <p className="text-muted flex items-center gap-2 min-w-0">
              {destSprite && <PixelArt name={destSprite} size={24} />}
              <span className="truncate">{controller.label(state.destinationId)}</span>
            </p>
          </div>
          <p
            aria-hidden
            className="pixel-frame text-xl sm:text-2xl font-bold leading-snug bg-surface px-3 py-2"
          >
            {liveInstruction}
          </p>
          {arError && (
            <p className="text-warn text-sm">AR unavailable ({arError}). Using the walk simulator.</p>
          )}
          {!arVisible && (
            <div className="relative flex-1 min-h-0 border-[3px] border-line overflow-hidden mb-2">
              {mapMode === 'follow' ? (
                <NavMap
                  graph={graph}
                  route={state.route?.nodeIds}
                  pose={state.pose}
                  destinationId={state.destinationId}
                  className="absolute inset-0 w-full h-full"
                />
              ) : (
                <FloorPlan
                  graph={graph}
                  floorId={state.pose?.floorId ?? graph.floors[0]!.id}
                  route={state.route?.nodeIds}
                  pose={state.pose}
                  className="absolute inset-0 w-full h-full"
                  simple
                />
              )}
              <button
                type="button"
                data-no-gesture
                onClick={() => setMapMode((m) => (m === 'follow' ? 'overview' : 'follow'))}
                className="pixel-frame pixel-press absolute left-2 bottom-2 bg-surface px-3 min-h-11 text-sm font-semibold"
              >
                {mapMode === 'follow' ? 'Whole route' : 'Follow me'}
              </button>
            </div>
          )}
        </GestureSurface>

        {simInstance && <SimPanel sim={simInstance} onChange={() => force((n) => n + 1)} />}

        <nav
          aria-label="Navigation controls"
          data-no-gesture
          className="grid grid-cols-4 gap-2 px-3 pt-2 pb-1 safe-bottom bg-bg border-t-[3px] border-line"
        >
          <Button className="px-2" variant="primary" disabled={listening} onClick={() => void speakCommand()}>
            {listening ? '…' : 'Speak'}
          </Button>
          <Button className="px-2" onClick={() => voice.repeat()}>
            Repeat
          </Button>
          {state.phase === 'arrived' ? (
            <Button className="px-2" onClick={() => controller.gesture('swipeBack')}>
              New trip
            </Button>
          ) : (
            <Button
              className="px-2"
              onClick={() => (state.phase === 'paused' ? controller.resume() : controller.pause())}
            >
              {state.phase === 'paused' ? 'Resume' : 'Pause'}
            </Button>
          )}
          <Button className="px-2" variant="danger" onClick={() => controller.end()}>
            End
          </Button>
        </nav>
      </div>
    );
  }

  if (state.phase === 'preview' && state.route) {
    return (
      <Screen title="Your route" back="/">
        <Button
          variant="primary"
          large
          block
          className="min-h-24 text-2xl"
          onClick={() => controller.begin()}
        >
          Start
        </Button>
        <Card className="flex flex-col gap-3">
          <p className="text-lg">
            From <strong>{controller.label(state.startId)}</strong> to{' '}
            <strong>{controller.label(state.destinationId)}</strong>,{' '}
            {formatDistance(state.route.length, settings.units, settings.stepLength)}.
          </p>
          <ol className="list-decimal pl-6 flex flex-col gap-1 text-lg">
            {state.steps.map((s, i) => (
              <li key={i}>
                {stepText(
                  s,
                  { unit: settings.units, stepLength: settings.stepLength },
                  controller.label(state.destinationId),
                )}
              </li>
            ))}
          </ol>
          <Button onClick={() => voice.repeat()}>Hear the route again</Button>
        </Card>
        <FloorPlan
          graph={graph}
          floorId={controller.index.node(state.startId!).floorId}
          route={state.route.nodeIds}
          className="w-full aspect-[4/3] border-[3px] border-line"
          simple
        />
        <Button block onClick={() => controller.gesture('swipeBack')}>
          Choose a different place
        </Button>
      </Screen>
    );
  }

  return (
    <Screen title={choosingStart ? 'Where are you?' : 'Where to?'} back="/">
      {isSample && (
        <Card className="flex flex-col gap-2">
          <p id="practice-map-label" className="font-semibold">
            Practice map
          </p>
          <div role="group" aria-labelledby="practice-map-label" className="grid grid-cols-2 gap-2">
            {(Object.keys(SAMPLES) as SampleId[]).map((id) => (
              <Button
                key={id}
                variant={settings.sample === id ? 'primary' : 'secondary'}
                aria-pressed={settings.sample === id}
                onClick={() => settings.set({ sample: id })}
              >
                {SAMPLES[id].name}
              </Button>
            ))}
          </div>
          {sampleName === 'Open hall' && (
            <p>Stand at the entrance of the hall, facing in. Then say “Entrance”.</p>
          )}
          <p className="text-muted text-sm">Add a room to make your own map.</p>
        </Card>
      )}
      {state.error && <ErrorBox error={state.error} />}
      {choosingStart ? (
        <MicButton
          label="Say where you are"
          prompt="Where are you? Say the room you're in."
          contextualStrings={places.map((p) => p.label)}
          onHeard={(heard) => onPlaceHeard(heard, chooseStart)}
        />
      ) : (
        <>
          <p className="text-lg">
            Starting from <strong>{controller.label(state.startId)}</strong>.{' '}
            <button
              type="button"
              className="underline text-accent min-h-12"
              onClick={() => controller.clearStart()}
            >
              Change
            </button>
          </p>
          <MicButton
            label="Say where to go"
            prompt="Where do you want to go?"
            contextualStrings={places.map((p) => p.label)}
            onHeard={(heard) => onPlaceHeard(heard, chooseDestination)}
          />
        </>
      )}

      <h2 className="text-xl font-bold mt-2">
        {choosingStart ? 'Or pick where you are' : 'Or pick a place'}
      </h2>
      {controller.destinations.length > 6 && (
        <Field
          label="Find a room"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      )}
      <ul
        className="flex flex-col gap-2"
        aria-label={choosingStart ? 'Rooms you can start from' : 'Places to go'}
      >
        {filtered
          .filter((d) => choosingStart || d.id !== state.startId)
          .map((d) => {
            const sprite = spriteFor(d);
            return (
              <li key={d.id}>
                <Button
                  block
                  className="justify-start text-left min-h-16 text-lg"
                  onClick={() => (choosingStart ? chooseStart(d.id) : chooseDestination(d.id))}
                >
                  {sprite && <PixelArt name={sprite} size={36} />}
                  {nodeDisplayName(graph, d)}
                </Button>
              </li>
            );
          })}
      </ul>
      {filtered.length === 0 && <p className="text-muted">No rooms match.</p>}
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
  const small = 'flex-1 px-2 min-h-11 text-sm whitespace-nowrap';
  return (
    <section
      data-no-gesture
      aria-label="Walk simulator. ARKit isn't available here."
      className="mx-3 mb-2 border-[3px] border-dashed border-warn bg-surface px-2 py-1.5 flex items-center gap-2"
    >
      <span className="font-pixel text-warn text-xs leading-tight shrink-0" aria-hidden>
        SIM
      </span>
      <Button
        className={small}
        variant={sim.autopilot ? 'primary' : 'secondary'}
        onClick={() => toggle('autopilot')}
        aria-pressed={sim.autopilot}
      >
        {sim.autopilot ? 'Walking' : 'Walk'}
      </Button>
      <Button className={small} onClick={() => toggle('wander')} aria-pressed={sim.wander}>
        {sim.wander ? 'Go back' : 'Wander'}
      </Button>
      <Button
        className={small}
        onClick={() => sim.setTracking(sim.pose.tracking === 'lost' ? 'normal' : 'lost')}
        aria-pressed={sim.pose.tracking === 'lost'}
      >
        {sim.pose.tracking === 'lost' ? 'Fix AR' : 'Lose AR'}
      </Button>
    </section>
  );
}
