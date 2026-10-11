import { describe, expect, it, vi } from 'vitest';
import { buildMapleHall } from '../../test/fixtures/mapleHall';
import { NavigationController, type NavOutput } from './controller';
import { WalkSimulator } from './simulator';

function make() {
  const said: string[] = [];
  const cues: string[] = [];
  const out: NavOutput = {
    cue: (name, speech) => {
      cues.push(name);
      if (speech) said.push(speech);
    },
    say: (t) => said.push(t),
    repeat: () => said.push('<repeat>'),
    stopSpeech: () => undefined,
  };
  const c = new NavigationController(buildMapleHall(), out, NavigationController.defaultOptions());
  return { c, said, cues };
}

describe('NavigationController', () => {
  it('plans a route and previews it', () => {
    const { c, said } = make();
    c.setStart('g-entrance');
    c.setDestination('g-kit');
    expect(c.state.phase).toBe('preview');
    expect(said.at(-1)).toMatch(/^Route to Kitchen, Ground floor: .*Press Start when you're ready\.$/);
  });

  it('finds destinations by spoken text', () => {
    const { c } = make();
    expect(c.findDestination('take me to the kitchen')[0]?.id).toBe('g-kit');
    expect(c.findDestination('room 202')[0]?.id).toBe('f1-202');
    expect(c.findDestination('bathroom').map((d) => d.id)).toEqual(
      expect.arrayContaining(['g-bath', 'f1-bath']),
    );
  });

  it('browses and selects with gestures', () => {
    const { c, said } = make();
    c.gesture('swipeRight');
    expect(said.at(-1)).toMatch(/2 of \d+\.$/);
    c.gesture('doubleTap'); // choose start
    expect(c.state.startId).not.toBeNull();
    c.gesture('swipeRight');
    c.gesture('doubleTap'); // choose destination
    expect(c.state.phase).toBe('preview');
    c.gesture('doubleTap'); // start
    expect(c.state.phase).toBe('guiding');
  });

  it('requires confirmation to end and supports pause', () => {
    const { c } = make();
    c.setStart('g-entrance', false);
    c.setDestination('g-kit');
    c.begin();
    c.gesture('longPress');
    expect(c.state.phase).toBe('paused');
    c.gesture('longPress');
    expect(c.state.phase).toBe('guiding');
    c.gesture('swipeBack');
    expect(c.state.pendingConfirm).toBe('end');
    c.gesture('swipeForward'); // anything else cancels the confirmation
    expect(c.state.pendingConfirm).toBeNull();
    c.gesture('swipeBack');
    c.gesture('doubleTap');
    expect(c.state.phase).toBe('choose_destination');
  });

  it('guides a simulated walk to arrival with turn cues', () => {
    vi.useFakeTimers();
    const { c, cues, said } = make();
    c.setStart('g-entrance', false);
    c.setDestination('f1-202');
    c.begin();
    const sim = new WalkSimulator(c.index, 'g-entrance', c.initialBearing(), (p) => c.onPose(p));
    sim.followRoute(c.state.route!.nodeIds);
    sim.autopilot = true;
    sim.start();
    vi.advanceTimersByTime(120_000);
    sim.stop();
    vi.useRealTimers();
    expect(c.state.phase).toBe('arrived');
    expect(cues).toContain('turnRight');
    expect(cues).toContain('floorChange');
    expect(cues.at(-1)).toBe('arrival');
    expect(said.at(-1)).toBe('You have arrived at Room 202, Floor 1.');
    expect(c.state.rerouteCount).toBe(0);
  });

  it('reroutes when the walker leaves the route', () => {
    vi.useFakeTimers();
    const { c, cues } = make();
    c.setStart('g-entrance', false);
    c.setDestination('g-bath');
    c.begin();
    const sim = new WalkSimulator(c.index, 'g-entrance', c.initialBearing(), (p) => c.onPose(p));
    sim.followRoute(c.state.route!.nodeIds);
    sim.autopilot = true;
    sim.start();
    vi.advanceTimersByTime(8000);
    sim.wander = true;
    vi.advanceTimersByTime(8000);
    sim.stop();
    vi.useRealTimers();
    expect(cues).toContain('offRoute');
    expect(c.state.rerouteCount).toBeGreaterThan(0);
  });

  it('routes to the nearest exit', () => {
    const { c } = make();
    c.setStart('g-bath', false);
    c.routeToNearest('exit');
    expect(c.state.destinationId).toBe('g-side');
  });

  it('announces hazards with cooldown and never says "clear"', () => {
    const { c, said } = make();
    c.setStart('g-entrance', false);
    c.setDestination('g-kit');
    c.begin();
    c.hazard({ kind: 'obstacle', distance: 1.1, relativeBearing: 0, confidence: 0.9, source: 'lidar' });
    c.hazard({ kind: 'obstacle', distance: 1.0, relativeBearing: 0, confidence: 0.9, source: 'lidar' });
    const hazards = said.filter((s) => s.startsWith('Caution'));
    expect(hazards).toEqual(['Caution. Obstacle ahead, 1 meter.']);
    expect(said.join(' ')).not.toMatch(/clear|no obstacles/i);
  });

  it('changes destination mid-walk from the current position', () => {
    const { c, said } = make();
    c.setStart('g-entrance', false);
    c.setDestination('g-kit');
    c.begin();
    c.onPose({
      floorId: 'g',
      position: { x: 0, y: 9.5 },
      heading: Math.PI / 2,
      tracking: 'normal',
      timestamp: 0,
    });
    c.goTo('g-101');
    expect(c.state.destinationId).toBe('g-101');
    expect(c.state.phase).toBe('guiding');
    expect(c.state.route!.nodeIds[0]).toBe('g-j1');
    expect(said.at(-1)).toMatch(/^Going to Room 101, Ground floor instead\. New route\./);
  });
});
