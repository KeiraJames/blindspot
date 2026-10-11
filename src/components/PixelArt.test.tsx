import { describe, expect, it } from 'vitest';
import { SPRITES, spriteFor } from './PixelArt';

describe('pixel art', () => {
  it('every sprite is a rectangle using known colors', () => {
    for (const [name, rows] of Object.entries(SPRITES)) {
      const widths = new Set(rows.map((r) => r.length));
      expect(widths.size, name).toBe(1);
      for (const r of rows) expect(r, name).toMatch(/^[.KRPpWYBbSTt]+$/);
    }
  });

  it('picks sprites for the sample places', () => {
    expect(spriteFor({ label: 'Kitchen', kind: 'room', poiType: 'kitchen' })).toBe('kitchen');
    expect(spriteFor({ label: 'Bedroom', kind: 'room' })).toBe('bedroom');
    expect(spriteFor({ label: 'Bathroom', kind: 'room', poiType: 'bathroom' })).toBe('bathroom');
    expect(spriteFor({ label: 'Closet', kind: 'room' })).toBe('closet');
    expect(spriteFor({ label: 'Hallway', kind: 'junction' })).toBeNull();
  });
});
