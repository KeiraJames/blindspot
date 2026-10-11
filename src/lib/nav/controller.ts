import {
  DEFAULT_PREFERENCES,
  findRoute,
  nearestNode,
  nearestOfType,
  type Route,
  type RoutePreferences,
} from '../graph/astar';
import { bearing } from '../graph/geometry';
import { destinations, GraphIndex, nodeDisplayName } from '../graph/graph';
import type { GraphNode, MapGraph } from '../graph/types';
import type { Gesture } from '../gestures/recognizer';
import type { HazardEvent } from '../../plugins/vision';
import {
  approachText,
  buildSteps,
  isLeft,
  isRight,
  nowText,
  routeSummary,
  stepText,
  turnPhrase,
  type PhraseOptions,
  type RouteStep,
} from './guidance';
import { RouteTracker, type MapPose, type TrackerEvent } from './tracker';
import { formatDistance } from './units';
import type { Cue } from '../feedback';
import type { Priority } from '../voice/voiceGuide';

export type NavPhase = 'choose_start' | 'choose_destination' | 'preview' | 'guiding' | 'paused' | 'arrived';

export interface NavState {
  phase: NavPhase;
  startId: string | null;
  destinationId: string | null;
  /** Index into the destination list while browsing with swipes. */
  browseIndex: number;
  route: Route | null;
  steps: RouteStep[];
  /** Step being previewed with left/right swipes. */
  previewIndex: number;
  pose: MapPose | null;
  lastPrompt: string;
  /** Action waiting for a double-tap confirmation. */
  pendingConfirm: 'end' | null;
  rerouteCount: number;
  remaining: number;
  error: string | null;
}

export interface NavOutput {
  cue(name: Cue, speech?: string, priority?: Priority): void;
  say(text: string, priority?: Priority): void;
  repeat(): void;
  stopSpeech(): void;
}

export interface NavOptions {
  phrase: PhraseOptions;
  prefs: RoutePreferences;
  hazardAlerts: boolean;
  courseTicks: boolean;
  verbosity: 'brief' | 'detailed';
}

const HAZARD_COOLDOWN_MS = 5000;
const TICK_INTERVAL_MS = 3000;

/**
 * Navigator brain: picks routes with live A*, follows the walker with RouteTracker, maps
 * gestures to actions and turns events into speech + haptics + earcons. It has no UI and
 * no plugin dependencies, so it is driven the same way by ARKit poses and by the simulator.
 */
export class NavigationController {
  readonly index: GraphIndex;
  readonly destinations: GraphNode[];
  private tracker: RouteTracker | null = null;
  private listeners = new Set<(s: NavState) => void>();
  private hazardAt = new Map<string, number>();
  private lastTickAt = 0;
  private onCourse = true;
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;
  state: NavState;

  constructor(
    readonly graph: MapGraph,
    private out: NavOutput,
    private opts: NavOptions,
  ) {
    this.index = new GraphIndex(graph);
    this.destinations = destinations(graph);
    this.state = {
      phase: 'choose_start',
      startId: null,
      destinationId: null,
      browseIndex: 0,
      route: null,
      steps: [],
      previewIndex: 0,
      pose: null,
      lastPrompt: '',
      pendingConfirm: null,
      rerouteCount: 0,
      remaining: 0,
      error: null,
    };
  }

  subscribe(fn: (s: NavState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  updateOptions(opts: Partial<NavOptions>) {
    this.opts = { ...this.opts, ...opts };
  }

  private set(patch: Partial<NavState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private speak(text: string, priority: Priority = 'normal') {
    this.set({ lastPrompt: text });
    this.out.say(text, priority);
  }

  private cue(name: Cue, text?: string, priority: Priority = 'normal') {
    if (text) this.set({ lastPrompt: text });
    this.out.cue(name, text, priority);
  }

  label(id: string | null): string {
    if (!id) return '';
    const n = this.index.nodes.get(id);
    return n ? nodeDisplayName(this.graph, n) : '';
  }

  // ---- Setup -------------------------------------------------------------------------

  setStart(nodeId: string, announce = true) {
    this.set({ startId: nodeId, phase: this.state.destinationId ? 'preview' : 'choose_destination' });
    if (announce) this.speak(`Starting from ${this.label(nodeId)}. Where do you want to go?`);
    if (this.state.destinationId) this.planRoute();
  }

  clearStart() {
    this.tracker = null;
    this.set({ startId: null, phase: 'choose_start', route: null, steps: [] });
  }

  /** Called when ARKit relocalizes: the start is the nearest node to where the user stands. */
  setStartFromPose(pose: MapPose) {
    const id = nearestNode(this.index, pose.floorId, pose.position);
    if (id) this.setStart(id, false);
    this.set({ pose });
  }

  setDestination(nodeId: string) {
    this.set({
      destinationId: nodeId,
      browseIndex: Math.max(
        0,
        this.destinations.findIndex((d) => d.id === nodeId),
      ),
    });
    if (!this.state.startId) {
      this.set({ phase: 'choose_start' });
      this.speak(`Destination ${this.label(nodeId)}. Now choose where you are starting from.`);
      return;
    }
    this.planRoute();
  }

  /** Destination search by spoken or typed text. */
  findDestination(text: string): GraphNode[] {
    const q = text
      .trim()
      .toLowerCase()
      .replace(/^(take me to|go to|navigate to|find)\s+/, '')
      .replace(/^the\s+/, '');
    if (!q) return [];
    const words = q.split(/\s+/);
    const scored = this.destinations
      .map((d) => {
        const name = nodeDisplayName(this.graph, d).toLowerCase();
        let score = 0;
        if (name === q) score = 100;
        else if (name.startsWith(q)) score = 50;
        else if (name.includes(q)) score = 30;
        else score = words.filter((w) => name.includes(w)).length * 10;
        if (d.poiType && q.includes(d.poiType.replace('_', ' '))) score += 15;
        return { d, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.map((x) => x.d);
  }

  private planRoute(fromId = this.state.startId, announce = true): boolean {
    const dest = this.state.destinationId;
    if (!fromId || !dest) return false;
    const route = findRoute(this.index, fromId, dest, this.opts.prefs);
    if (!route) {
      const why = this.opts.prefs.avoidStairs ? ' without stairs' : '';
      this.set({ route: null, steps: [], error: `No route found to ${this.label(dest)}${why}.` });
      this.cue('cancel', `No route found to ${this.label(dest)}${why}. Try a different place.`, 'normal');
      return false;
    }
    const steps = buildSteps(this.index, route);
    this.tracker = new RouteTracker(this.index, route, steps);
    this.set({
      route,
      steps,
      previewIndex: 0,
      error: null,
      remaining: route.length,
      phase: this.state.phase === 'guiding' ? 'guiding' : 'preview',
    });
    if (announce && this.state.phase === 'preview') {
      const summary = routeSummary(steps, route, this.opts.phrase, this.label(dest));
      this.speak(`${summary} ${stepText(steps[0]!, this.opts.phrase)} Say start when you're ready.`);
    }
    return true;
  }

  /** Change destination mid-walk (spoken "take me to …"): reroute from where the walker is now. */
  goTo(nodeId: string) {
    if (this.state.phase !== 'guiding' && this.state.phase !== 'paused') {
      this.setDestination(nodeId);
      return;
    }
    const from = this.state.pose
      ? nearestNode(this.index, this.state.pose.floorId, this.state.pose.position)
      : this.state.startId;
    if (!from) return;
    this.set({ startId: from, destinationId: nodeId, phase: 'guiding' });
    if (this.planRoute(from, false)) this.announceRerouted(`Going to ${this.label(nodeId)} instead.`);
  }

  routeToNearest(kind: 'exit' | 'bathroom' | 'elevator') {
    const from = this.state.pose
      ? nearestNode(this.index, this.state.pose.floorId, this.state.pose.position)
      : this.state.startId;
    if (!from) {
      this.speak('Choose where you are first.');
      return;
    }
    const match = (id: string) => {
      const n = this.index.node(id);
      if (kind === 'exit') return n.poiType === 'exit' || (n.kind === 'door' && Boolean(n.exterior));
      if (kind === 'elevator') return n.kind === 'elevator';
      return n.poiType === kind;
    };
    const r = nearestOfType(this.index, from, match, this.opts.prefs);
    if (!r) {
      this.speak(`No ${kind} is marked on this map.`);
      return;
    }
    const wasGuiding = this.state.phase === 'guiding';
    this.set({ startId: from, destinationId: r.nodeIds.at(-1)! });
    this.planRoute(from, !wasGuiding);
    if (wasGuiding) this.announceRerouted(`Nearest ${kind} is ${this.label(r.nodeIds.at(-1)!)}.`);
  }

  // ---- Guidance ----------------------------------------------------------------------

  begin() {
    if (!this.state.route || !this.tracker) return;
    this.set({ phase: 'guiding' });
    const first = this.state.steps[0]!;
    this.cue('confirm', stepText(first, this.opts.phrase));
  }

  pause() {
    if (this.state.phase !== 'guiding') return;
    this.set({ phase: 'paused' });
    this.out.stopSpeech();
    this.cue('cancel', 'Paused. Touch and hold to resume.');
  }

  resume() {
    if (this.state.phase !== 'paused') return;
    this.set({ phase: 'guiding' });
    this.cue('confirm', `Resumed. ${this.nextInstruction()}`);
  }

  end(announce = true) {
    this.tracker = null;
    this.out.stopSpeech();
    this.set({
      phase: this.state.startId ? 'choose_destination' : 'choose_start',
      route: null,
      steps: [],
      destinationId: null,
      pendingConfirm: null,
    });
    if (announce) this.cue('cancel', 'Navigation ended.');
  }

  /** Current progress + next maneuver, for "where am I" and repeat. */
  nextInstruction(): string {
    const t = this.tracker;
    if (!t) return '';
    const next = t.nextStep();
    if (!next) return '';
    const away = Math.max(0, t.stepDistance(next) - t.distanceTravelled);
    if (next.kind === 'arrive')
      return `${this.label(this.state.destinationId)} in ${formatDistance(away, this.opts.phrase.unit, this.opts.phrase.stepLength)}.`;
    return approachText(next, Math.max(1, away), this.opts.phrase);
  }

  whereAmI(): string {
    const pose = this.state.pose;
    const parts: string[] = [];
    if (pose) {
      const floor = this.index.floors.get(pose.floorId);
      const near = nearestNode(this.index, pose.floorId, pose.position);
      parts.push(
        `You are${floor && this.graph.floors.length > 1 ? ` on ${floor.name},` : ''} near ${near ? this.index.node(near).label : 'an unknown place'}.`,
      );
    } else if (this.state.startId) {
      parts.push(`You are at ${this.label(this.state.startId)}.`);
    }
    if (this.tracker && (this.state.phase === 'guiding' || this.state.phase === 'paused')) {
      parts.push(this.nextInstruction());
      parts.push(
        `${formatDistance(this.tracker.remaining, this.opts.phrase.unit, this.opts.phrase.stepLength)} to ${this.label(this.state.destinationId)}.`,
      );
    }
    return parts.join(' ');
  }

  onPose(pose: MapPose) {
    this.set({ pose });
    if (this.state.phase !== 'guiding' || !this.tracker) return;
    const events = this.tracker.update(pose);
    for (const e of events) this.handle(e, pose);
    this.set({ remaining: this.tracker?.remaining ?? 0 });
    if (
      this.opts.courseTicks &&
      this.onCourse &&
      this.state.phase === 'guiding' &&
      pose.timestamp - this.lastTickAt >= TICK_INTERVAL_MS
    ) {
      this.lastTickAt = pose.timestamp;
      this.out.cue('straight');
    }
  }

  private handle(e: TrackerEvent, pose: MapPose) {
    const p = this.opts.phrase;
    switch (e.type) {
      case 'approach':
        this.speak(approachText(e.step, e.metersAway, p));
        break;
      case 'maneuver': {
        const text = nowText(e.step, p);
        if (e.step.kind === 'floor_change')
          this.cue(
            'floorChange',
            `${text} Two-finger swipe ${e.step.floorChange!.direction} when you reach ${e.step.floorChange!.toFloorName}.`,
          );
        else if (e.step.turn && isLeft(e.step.turn)) this.cue('turnLeft', text);
        else if (e.step.turn && isRight(e.step.turn)) this.cue('turnRight', text);
        else this.cue('confirm', text);
        break;
      }
      case 'veer':
        this.onCourse = false;
        this.cue(
          isLeft(e.direction) ? 'turnLeft' : 'turnRight',
          this.opts.verbosity === 'brief'
            ? undefined
            : `${turnPhrase(e.direction === 'u_turn' ? 'u_turn' : isLeft(e.direction) ? 'slight_left' : 'slight_right')}.`,
          'low',
        );
        break;
      case 'on_course':
        this.onCourse = true;
        this.out.cue('straight');
        break;
      case 'off_route':
        this.reroute(pose);
        break;
      case 'floor_reached': {
        // Speak the walk that follows the stairs/elevator; it has no maneuver of its own.
        const cont = this.state.steps.find(
          (s) => s.kind === 'continue' && this.index.node(s.nodeId).floorId === e.floorId,
        );
        const next = cont ? ` ${stepText(cont, p)}` : '';
        this.cue('confirm', `Now on ${this.index.floors.get(e.floorId)?.name ?? 'a new floor'}.${next}`);
        break;
      }
      case 'tracking_lost':
        this.cue(
          'trackingLost',
          'Tracking lost. Stand still and slowly move the phone side to side.',
          'high',
        );
        break;
      case 'tracking_restored':
        this.cue('confirm', 'Tracking restored.');
        break;
      case 'arrived':
        this.set({ phase: 'arrived', remaining: 0, startId: this.state.destinationId });
        this.cue('arrival', `You have arrived at ${this.label(this.state.destinationId)}.`, 'high');
        break;
    }
  }

  private reroute(pose: MapPose) {
    const from = nearestNode(this.index, pose.floorId, pose.position);
    if (!from) return;
    this.cue('offRoute', 'Off route. Finding a new route.', 'high');
    this.set({ startId: from, rerouteCount: this.state.rerouteCount + 1 });
    if (this.planRoute(from, false)) {
      // Walk toward the nearest graph node first: aim the heading cue at it.
      this.announceRerouted();
    }
  }

  private announceRerouted(prefix = '') {
    const first = this.state.steps[0];
    if (!first) return;
    const node = this.index.node(this.state.route!.nodeIds[0]!);
    let lead = '';
    if (this.state.pose) {
      const d = Math.hypot(
        node.position.x - this.state.pose.position.x,
        node.position.y - this.state.pose.position.y,
      );
      if (d > 1.5)
        lead = `Head to ${node.label}, ${formatDistance(d, this.opts.phrase.unit, this.opts.phrase.stepLength)} away. `;
    }
    this.speak(`${prefix ? `${prefix} ` : ''}New route. ${lead}${stepText(first, this.opts.phrase)}`);
  }

  /** Manual floor confirmation (elevators break ARKit height tracking). */
  confirmFloorChange(direction: 'up' | 'down'): string | null {
    const steps = this.state.steps;
    const t = this.tracker;
    if (!t) return null;
    const next = steps.find((s) => s.kind === 'floor_change' && t.stepDistance(s) >= t.distanceTravelled - 1);
    if (!next || next.floorChange!.direction !== direction) {
      this.speak(`No floor change ${direction} is coming up.`);
      return null;
    }
    const landing = this.state.route!.nodeIds[next.nodeIndex + 1]!;
    return landing;
  }

  hazard(h: HazardEvent) {
    if (!this.opts.hazardAlerts || (this.state.phase !== 'guiding' && this.state.phase !== 'paused')) return;
    const key = h.kind;
    const now = Date.now();
    if (now - (this.hazardAt.get(key) ?? 0) < HAZARD_COOLDOWN_MS) return;
    this.hazardAt.set(key, now);
    const side =
      h.relativeBearing > 0.35 ? ' on your left' : h.relativeBearing < -0.35 ? ' on your right' : ' ahead';
    const dist =
      h.distance !== undefined
        ? `, ${formatDistance(h.distance, this.opts.phrase.unit, this.opts.phrase.stepLength)}`
        : '';
    const what = { obstacle: 'Obstacle', person: 'Person', stairs: 'Stairs', door: 'Door', drop: 'Drop-off' }[
      h.kind
    ];
    // Never claim a path is clear; only report what was detected.
    this.cue('hazard', `Caution. ${what}${side}${dist}.`, 'high');
  }

  // ---- Gestures ----------------------------------------------------------------------

  gesture(g: Gesture) {
    const s = this.state;
    if (s.pendingConfirm && g !== 'doubleTap') {
      this.set({ pendingConfirm: null });
    }
    switch (g) {
      case 'swipeForward':
        this.out.repeat();
        break;
      case 'swipeBack':
        if (s.phase === 'guiding' || s.phase === 'paused') {
          this.set({ pendingConfirm: 'end' });
          this.speak('End navigation? Double-tap to confirm.');
          if (this.confirmTimer) clearTimeout(this.confirmTimer);
          this.confirmTimer = setTimeout(() => this.set({ pendingConfirm: null }), 5000);
        } else if (s.phase === 'preview') {
          this.set({ phase: 'choose_destination', destinationId: null, route: null, steps: [] });
          this.cue('cancel', 'Route cancelled. Swipe left or right to choose a destination.');
        } else if (s.phase === 'arrived') {
          this.end(false);
          this.speak('Choose a new destination.');
        }
        break;
      case 'swipeLeft':
      case 'swipeRight': {
        const dir = g === 'swipeRight' ? 1 : -1;
        if (s.phase === 'choose_destination' || s.phase === 'choose_start' || s.phase === 'arrived') {
          const list = this.destinations;
          if (list.length === 0) return this.speak('This map has no destinations yet.');
          const i = (s.browseIndex + dir + list.length) % list.length;
          this.set({ browseIndex: i });
          this.speak(`${nodeDisplayName(this.graph, list[i]!)}. ${i + 1} of ${list.length}.`, 'normal');
        } else if (s.steps.length > 0) {
          const i = Math.min(s.steps.length - 1, Math.max(0, s.previewIndex + dir));
          this.set({ previewIndex: i });
          this.speak(
            `Step ${i + 1} of ${s.steps.length}. ${stepText(s.steps[i]!, this.opts.phrase, this.label(s.destinationId))}`,
          );
        }
        break;
      }
      case 'doubleTap':
        if (s.pendingConfirm === 'end') {
          if (this.confirmTimer) clearTimeout(this.confirmTimer);
          this.end();
        } else if (s.phase === 'choose_start' || s.phase === 'choose_destination' || s.phase === 'arrived') {
          const d = this.destinations[s.browseIndex];
          if (!d) return;
          if (s.phase === 'choose_start' && !s.startId) {
            this.out.cue('confirm');
            this.setStart(d.id);
          } else {
            this.out.cue('confirm');
            if (s.phase === 'arrived') this.set({ phase: 'choose_destination' });
            this.setDestination(d.id);
          }
        } else if (s.phase === 'preview') {
          this.begin();
        }
        break;
      case 'longPress':
        if (s.phase === 'guiding') this.pause();
        else if (s.phase === 'paused') this.resume();
        else this.out.stopSpeech();
        break;
      case 'tap':
        this.speak(this.whereAmI() || 'Swipe left or right to browse destinations, then double-tap.');
        break;
      case 'twoFingerUp':
      case 'twoFingerDown':
        // Handled by the screen, which owns the pose source (it re-anchors on the landing).
        break;
    }
  }

  /** Bearing of the first route segment, used to anchor dead-reckoning sessions. */
  initialBearing(): number {
    const r = this.state.route;
    if (!r || r.nodeIds.length < 2) return Math.PI / 2;
    return bearing(this.index.node(r.nodeIds[0]!).position, this.index.node(r.nodeIds[1]!).position);
  }

  static defaultOptions(): NavOptions {
    return {
      phrase: { unit: 'meters' },
      prefs: DEFAULT_PREFERENCES,
      hazardAlerts: true,
      courseTicks: true,
      verbosity: 'detailed',
    };
  }
}
