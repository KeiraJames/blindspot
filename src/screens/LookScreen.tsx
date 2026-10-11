import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GestureSurface } from '../components/GestureSurface';
import { PixelArt } from '../components/PixelArt';
import { Button, cx } from '../components/ui';
import { cue, say, voice } from '../lib/feedback';
import type { Gesture } from '../lib/gestures/recognizer';
import { formatDistance } from '../lib/nav/units';
import { SurroundingsAnnouncer, tickInterval, type Alert } from '../lib/surroundings/announcer';
import { startSimulatedSurroundings, type SimulatedFeed } from '../lib/surroundings/simulated';
import { ARNav } from '../plugins/arnav';
import { Vision } from '../plugins/vision';
import { useSettings } from '../state/settings';

const INTRO =
  'Look around. Hold the phone up in front of your chest, with the back camera facing where you walk. I will tell you about things in your way, people, and doors. The faster the ticks, the closer something is ahead. Tap the screen to hear what is around you. Touch and hold to pause. This helps you notice things, but it can’t see everything, so keep using your cane.';

type Mode = 'starting' | 'live' | 'simulated';

/**
 * Quick navigation without a map: the camera and LiDAR watch the way ahead in real time and
 * the phone speaks up about obstacles, people and doors, with parking-sensor ticks for the
 * distance straight ahead.
 */
export default function LookScreen() {
  const navigate = useNavigate();
  const settings = useSettings();
  // One announcer for the whole session (it remembers what it already said); units update below.
  const [announcer] = useState(
    () => new SurroundingsAnnouncer({ unit: settings.units, stepLength: settings.stepLength }),
  );
  const [mode, setMode] = useState<Mode>('starting');
  const [paused, setPaused] = useState(false);
  const [lastText, setLastText] = useState('Starting…');
  const [ahead, setAhead] = useState<number | undefined>(undefined);
  const pausedRef = useRef(false);
  const handles = useRef<PluginListenerHandle[]>([]);
  const sim = useRef<SimulatedFeed | null>(null);

  useEffect(
    () => announcer.setOptions({ unit: settings.units, stepLength: settings.stepLength }),
    [announcer, settings.units, settings.stepLength],
  );

  const emit = useCallback((alerts: Alert[]) => {
    if (pausedRef.current) return;
    for (const a of alerts) {
      void cue(a.cue, a.text, a.priority);
      setLastText(a.text);
    }
  }, []);

  const describe = useCallback(() => {
    const text = announcer.describe(Date.now());
    setLastText(text);
    void say(text);
  }, [announcer]);

  const togglePause = useCallback(() => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    voice.stop();
    void cue(
      pausedRef.current ? 'cancel' : 'confirm',
      pausedRef.current ? 'Paused. Touch and hold to start again.' : 'Watching again.',
    );
  }, []);

  const onGesture = useCallback(
    (g: Gesture) => {
      if (g === 'tap' || g === 'doubleTap') describe();
      else if (g === 'longPress') togglePause();
      else if (g === 'swipeForward') voice.repeat();
      else if (g === 'swipeBack') navigate('/');
    },
    [describe, togglePause, navigate],
  );

  // Start sensing: ARKit + Vision on a real iPhone, a scripted walk elsewhere.
  useEffect(() => {
    let cancelled = false;
    const onClearance = (c: { left?: number; center?: number; right?: number }) => {
      setAhead(c.center);
      emit(announcer.onClearance(c, Date.now()));
    };
    (async () => {
      void say(INTRO);
      const supported =
        Capacitor.isNativePlatform() && (await ARNav.isSupported().catch(() => null))?.worldTracking;
      if (cancelled) return;
      if (!supported) {
        setMode('simulated');
        sim.current = startSimulatedSurroundings({
          clearance: onClearance,
          items: (items) => emit(announcer.onItems(items, Date.now())),
          person: (d, b) => emit(announcer.onPerson(d, b, Date.now())),
        });
        return;
      }
      handles.current = await Promise.all([
        ARNav.addListener('surroundings', (e) => {
          emit(announcer.onItems(e.items, Date.now()));
          if (e.ahead !== undefined) onClearance({ center: e.ahead });
        }),
        Vision.addListener('clearance', onClearance),
        Vision.addListener('hazard', (h) => {
          if (h.kind === 'person') emit(announcer.onPerson(h.distance, h.relativeBearing, Date.now()));
        }),
        ARNav.addListener('gesture', ({ gesture }) => onGesture(gesture)),
        ARNav.addListener('interrupted', ({ interrupted }) => {
          if (interrupted) void cue('trackingLost', 'Camera interrupted.', 'high');
        }),
      ]);
      if (cancelled) return;
      document.body.classList.add('ar-active');
      await ARNav.start({ showCamera: true, nativeGestures: true, poseRate: 5, surroundings: true });
      await Vision.configure({
        rate: 6,
        detectPeople: true,
        detectText: false,
        depthObstacles: true,
        obstacleDistance: 1.6,
        customModel: true,
      });
      await Vision.setEnabled({ enabled: true });
      setMode('live');
    })().catch((e) => void say(`Look around couldn't start. ${e instanceof Error ? e.message : ''}`));
    return () => {
      cancelled = true;
      sim.current?.stop();
      handles.current.forEach((h) => void h.remove());
      handles.current = [];
      document.body.classList.remove('ar-active');
      void ARNav.stop().catch(() => undefined);
      void Vision.setEnabled({ enabled: false }).catch(() => undefined);
      voice.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Parking-sensor ticks for the distance straight ahead.
  useEffect(() => {
    const interval = paused ? null : tickInterval(ahead);
    if (interval === null) return;
    const t = setInterval(() => void cue('straight'), interval);
    return () => clearInterval(t);
  }, [ahead, paused]);

  const aheadText =
    ahead === undefined
      ? 'Measuring…'
      : ahead > 4
        ? 'Nothing close ahead'
        : `${formatDistance(ahead, settings.units, settings.stepLength)} ahead`;
  const close = ahead !== undefined && ahead < 1.6;

  return (
    <div className={cx('fixed inset-0 h-dvh flex flex-col overflow-hidden', mode !== 'live' && 'bg-bg')}>
      <GestureSurface
        onGesture={onGesture}
        label="Look around. Tap to hear what's around you, touch and hold to pause, swipe up to repeat, swipe down to leave."
        className="flex-1 min-h-0 flex flex-col safe-top px-3 gap-3"
      >
        <div className="flex items-center justify-between pt-1">
          <h1 className="font-pixel text-2xl font-bold flex items-center gap-2">
            <PixelArt name="eye" size={28} /> Look around
          </h1>
          <span className="text-muted font-semibold">
            {paused
              ? 'Paused'
              : mode === 'simulated'
                ? 'Simulated'
                : mode === 'live'
                  ? 'Watching'
                  : 'Starting'}
          </span>
        </div>
        <p aria-hidden className="pixel-frame text-2xl font-bold leading-snug bg-surface px-3 py-3">
          {lastText}
        </p>
        <div
          aria-hidden
          className={cx(
            'pixel-frame mt-auto mb-3 px-3 py-6 text-center font-pixel text-3xl font-bold',
            close ? 'bg-danger text-danger-fg' : 'bg-surface',
          )}
        >
          {aheadText}
        </div>
        {mode === 'simulated' && (
          <p className="text-warn text-sm mb-2">
            No camera sensing here (browser or Simulator), so a pretend walk is playing.
          </p>
        )}
      </GestureSurface>
      <nav
        aria-label="Look around controls"
        data-no-gesture
        className="grid grid-cols-3 gap-2 px-3 pt-2 pb-1 safe-bottom bg-bg border-t-[3px] border-line"
      >
        <Button variant="primary" className="px-2" onClick={describe}>
          What’s around?
        </Button>
        <Button className="px-2" onClick={togglePause}>
          {paused ? 'Resume' : 'Pause'}
        </Button>
        <Button className="px-2" variant="danger" onClick={() => navigate('/')}>
          Stop
        </Button>
      </nav>
    </div>
  );
}
