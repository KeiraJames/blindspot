import type { SurroundingItem } from '../../plugins/arnav';
import type { Cue } from '../feedback';
import { formatDistance, type DistanceUnit } from '../nav/units';
import type { Priority } from '../voice/voiceGuide';

/** What the walker should hear/feel right now. */
export interface Alert {
  cue: Cue;
  text: string;
  priority: Priority;
}

export interface Clearance {
  left?: number;
  center?: number;
  right?: number;
}

export interface AnnouncerOptions {
  unit: DistanceUnit;
  stepLength?: number;
}

/** Thresholds in meters. */
const STOP = 0.8; // something right in front of you
const AHEAD = 1.6; // obstacle ahead
const SIDE = 0.6; // brushing past something on one side
const PERSON = 2.5;
const DOOR_SEE = 5; // first mention of a door
const DOOR_AT = 1.3; // "you're at the door"
const FURNITURE = 2.5;

const NAMES: Record<SurroundingItem['kind'], string> = {
  door: 'Door',
  seat: 'Chair',
  table: 'Table',
  window: 'Window',
};

/** Spoken direction for a bearing relative to where the phone points (positive = left). */
export function direction(bearing: number): string {
  const a = Math.abs(bearing);
  if (a < 0.3) return 'ahead';
  if (a > 2.4) return 'behind you';
  const side = bearing > 0 ? 'left' : 'right';
  return a < 0.8 ? `slightly ${side}` : `on your ${side}`;
}

/** "ahead" reads as "Door ahead"; sides read as "Door on your left". */
function where(kindName: string, bearing: number): string {
  return `${kindName} ${direction(bearing)}`;
}

/**
 * Turns raw sensing (depth per third of the view, ARKit-recognized doors and furniture, people)
 * into a small number of useful alerts. It warns early about what's in your path, stays quiet
 * about what it already told you, and repeats a warning only if things got closer or some time
 * has passed. It never says that a path is clear.
 */
export class SurroundingsAnnouncer {
  private lastAt = new Map<string, number>();
  private lastDistance = new Map<string, number>();
  private doorStage = new Map<string, 'seen' | 'at'>();
  private mentioned = new Set<string>();
  /** Recognized things and when they were last seen, for "what's around me". */
  private known = new Map<string, { item: SurroundingItem; at: number }>();
  private clearance: Clearance = {};

  constructor(private opts: AnnouncerOptions) {}

  setOptions(opts: AnnouncerOptions) {
    this.opts = opts;
  }

  private d(m: number) {
    return formatDistance(m, this.opts.unit, this.opts.stepLength);
  }

  /** Allow `key` again after `cooldown` ms, or sooner if it's at least 0.5 m closer. */
  private due(key: string, now: number, cooldown: number, distance?: number): boolean {
    const at = this.lastAt.get(key);
    if (at === undefined) return true;
    const prev = this.lastDistance.get(key);
    if (distance !== undefined && prev !== undefined && prev - distance >= 0.5) return true;
    return now - at >= cooldown;
  }

  private mark(key: string, now: number, distance?: number) {
    this.lastAt.set(key, now);
    if (distance !== undefined) this.lastDistance.set(key, distance);
  }

  /** Depth per third of the view (LiDAR), or just `center` from a raycast on other phones. */
  onClearance(c: Clearance, now: number): Alert[] {
    this.clearance = c;
    const out: Alert[] = [];
    if (c.center !== undefined && c.center < STOP) {
      if (this.due('stop', now, 3000)) {
        this.mark('stop', now, c.center);
        out.push({ cue: 'hazard', text: 'Stop. Something is right in front of you.', priority: 'high' });
      }
      return out;
    }
    if (c.center !== undefined && c.center < AHEAD) {
      if (this.due('ahead', now, 6000, c.center)) {
        this.mark('ahead', now, c.center);
        out.push({ cue: 'hazard', text: `Something ahead, ${this.d(c.center)}.`, priority: 'normal' });
      }
    } else {
      // Path ahead opened up: allow a fresh warning next time.
      this.lastAt.delete('ahead');
      this.lastAt.delete('stop');
    }
    for (const side of ['left', 'right'] as const) {
      const v = c[side];
      if (v !== undefined && v < SIDE && this.due(side, now, 6000, v)) {
        this.mark(side, now, v);
        out.push({
          cue: side === 'left' ? 'turnLeft' : 'turnRight',
          text: `Something close on your ${side}.`,
          priority: 'low',
        });
      }
    }
    return out;
  }

  onPerson(distance: number | undefined, bearing: number, now: number): Alert[] {
    if (distance !== undefined && distance > PERSON) return [];
    if (!this.due('person', now, 6000, distance)) return [];
    this.mark('person', now, distance);
    const dist = distance !== undefined ? `, ${this.d(distance)}` : '';
    return [{ cue: 'hazard', text: `${where('Person', bearing)}${dist}.`, priority: 'normal' }];
  }

  onItems(items: SurroundingItem[], now: number): Alert[] {
    const out: Alert[] = [];
    for (const item of items) {
      this.known.set(item.id, { item, at: now });
      if (item.kind === 'door') {
        const stage = this.doorStage.get(item.id);
        if (item.distance <= DOOR_AT && stage !== 'at') {
          this.doorStage.set(item.id, 'at');
          out.push({
            cue: 'confirm',
            text:
              Math.abs(item.relativeBearing) < 0.5
                ? 'Door right in front of you.'
                : `You're at a door ${direction(item.relativeBearing)}.`,
            priority: 'normal',
          });
        } else if (item.distance <= DOOR_SEE && !stage) {
          this.doorStage.set(item.id, 'seen');
          out.push({
            cue: 'confirm',
            text: `${where('Door', item.relativeBearing)}, ${this.d(item.distance)}.`,
            priority: 'normal',
          });
        }
      } else if (
        (item.kind === 'seat' || item.kind === 'table') &&
        item.distance <= FURNITURE &&
        !this.mentioned.has(item.id)
      ) {
        this.mentioned.add(item.id);
        out.push({
          cue: 'straight',
          text: `${where(NAMES[item.kind], item.relativeBearing)}.`,
          priority: 'low',
        });
      }
    }
    return out;
  }

  /** Spoken answer to "what's around me?". */
  describe(now: number): string {
    const recent = [...this.known.values()]
      .filter((k) => now - k.at < 4000 && k.item.kind !== 'window')
      .map((k) => k.item)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 4);
    const parts = recent.map((i) => `${where(NAMES[i.kind], i.relativeBearing)}, ${this.d(i.distance)}.`);
    const c = this.clearance.center;
    if (c !== undefined && c < AHEAD) parts.unshift(`Something ahead, ${this.d(c)}.`);
    else parts.push("I don't detect anything close in front of you, but keep using your cane.");
    if (recent.length === 0)
      parts.unshift("I haven't recognized any doors or furniture yet. Slowly turn to look around.");
    return parts.join(' ');
  }
}

/**
 * Parking-sensor style tick interval from the distance straight ahead: faster as it gets
 * closer, silent beyond 2.5 m. Null means no ticking.
 */
export function tickInterval(distanceAhead: number | undefined): number | null {
  if (distanceAhead === undefined || distanceAhead > 2.5) return null;
  const t = Math.max(0, (distanceAhead - 0.4) / (2.5 - 0.4));
  return Math.round(150 + t * 850);
}
