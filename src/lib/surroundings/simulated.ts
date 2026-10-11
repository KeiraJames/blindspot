import type { SurroundingItem } from '../../plugins/arnav';
import type { Clearance } from './announcer';

export interface SimulatedFeed {
  stop(): void;
}

/**
 * A scripted 24-second walk for places without ARKit (browser, iOS Simulator): a door comes
 * up slightly left, a chair passes on the right, a person crosses, and finally something
 * blocks the way. It loops, so the screen can be shown off anywhere.
 */
export function startSimulatedSurroundings(handlers: {
  clearance: (c: Clearance) => void;
  items: (items: SurroundingItem[]) => void;
  person: (distance: number, bearing: number) => void;
}): SimulatedFeed {
  const period = 24;
  const started = Date.now();
  const timer = setInterval(() => {
    const t = ((Date.now() - started) / 1000) % period;
    // Walking at about 0.5 m/s toward a door that's 5 m away.
    const doorDistance = 5 - t * 0.5;
    const items: SurroundingItem[] = [];
    if (doorDistance > 0.6 && t < 10) {
      items.push({
        id: `door-${Math.floor((Date.now() - started) / 1000 / period)}`,
        kind: 'door',
        distance: doorDistance,
        relativeBearing: 0.45,
        width: 0.9,
      });
    }
    if (t > 3 && t < 9) {
      items.push({
        id: 'chair',
        kind: 'seat',
        distance: 2.2 - (t - 3) * 0.3,
        relativeBearing: -1.1,
        width: 0.5,
      });
    }
    handlers.items(items);
    if (t > 11 && t < 11.6) handlers.person(1.9, -0.4);
    // Something in the path from 14 s on, getting closer.
    const center = t < 14 ? 4 : Math.max(0.5, 2.6 - (t - 14) * 0.35);
    handlers.clearance({ center, left: t > 5 && t < 6.5 ? 0.45 : 2.5, right: 2.5 });
  }, 500);
  return { stop: () => clearInterval(timer) };
}
