import type { ScanResult } from './types';

/**
 * Plausible RoomPlan-like output for development in a browser: a rectangular room with a
 * door on the south wall and sometimes a second opening, in its own arbitrary frame.
 */
export function syntheticScan(scanId: string, seed = Date.now()): ScanResult {
  let s = seed % 2147483647;
  const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
  const w = 3 + Math.round(rnd() * 3);
  const d = 3 + Math.round(rnd() * 3);
  const poly = [
    { x: -w / 2, y: -d / 2 },
    { x: w / 2, y: -d / 2 },
    { x: w / 2, y: d / 2 },
    { x: -w / 2, y: d / 2 },
  ];
  const openings: ScanResult['openings'] = [
    {
      id: `${scanId}-o1`,
      category: 'door',
      position: { x: (rnd() - 0.5) * (w - 1.2), y: -d / 2 },
      width: 0.9,
      normal: -Math.PI / 2,
      confidence: 'high',
    },
  ];
  if (rnd() > 0.5) {
    openings.push({
      id: `${scanId}-o2`,
      category: 'opening',
      position: { x: w / 2, y: (rnd() - 0.5) * (d - 1.2) },
      width: 1.2,
      normal: 0,
      confidence: 'medium',
    });
  }
  return {
    scanId,
    capturedAt: Date.now(),
    floorPolygon: poly,
    walls: poly.map((p, i) => ({ start: p, end: poly[(i + 1) % poly.length]!, height: 2.6 })),
    openings,
    windows: [{ position: { x: 0, y: d / 2 }, width: 1.2 }],
    stairs: [],
    objects: [
      {
        id: `${scanId}-bed`,
        category: 'bed',
        position: { x: w / 4, y: d / 4 },
        size: { w: 1, d: 2, h: 0.5 },
      },
    ],
    landmarks: [{ kind: 'room_number', text: '214', confidence: 0.92 }],
    floorHeight: -1.4,
    quality: 0.86,
    files: {},
  };
}
