import type { GraphNode } from '../lib/graph/types';

/** One character per pixel; '.' is transparent. */
const PALETTE: Record<string, string> = {
  K: '#3d0f2a', // outline (plum)
  R: '#c2185b', // hot pink
  P: '#ff8fb8', // pink
  p: '#ffd6e7', // pale pink
  W: '#ffffff',
  Y: '#ffd166', // gold
  B: '#8ecae6', // water
  b: '#4f8fb5',
  S: '#cfd4dc', // steel
  T: '#c98b5e', // wood
  t: '#8a5a3b',
};

export const SPRITES = {
  house: [
    '.....KK.....',
    '....KRRK....',
    '...KRRRRK...',
    '..KRRPRRRK..',
    '.KRRPPPRRRK.',
    'KKKKKKKKKKKK',
    '.KppppppppK.',
    '.KpWWpKKKpK.',
    '.KpWWpKPKpK.',
    '.KppppKPKpK.',
    '.KppppKYKpK.',
    '.KKKKKKKKKK.',
  ],
  kitchen: [
    '...p..p..p..',
    '....p..p..p.',
    '...p..p..p..',
    '....KKKKK...',
    '..KKRRRRRKK.',
    '.KKRRRRRRRKK',
    '..KRRRWRRRK.',
    '..KRRPPRRRK.',
    '..KRRRRRRRK.',
    '...KKKKKKK..',
    '..KSSSSSSSK.',
    '..KKKKKKKKK.',
  ],
  bedroom: [
    '............',
    'K...........',
    'KK..........',
    'KtK.........',
    'KtKKKKKKKKKK',
    'KtWWWKPPPPPK',
    'KtWWWKPpPpPK',
    'KtKKKKKKKKKK',
    'KttttttttttK',
    'KKKKKKKKKKKK',
    'K..........K',
    'K..........K',
  ],
  bathroom: [
    '..KK........',
    '.KSSK.......',
    '.KS..B......',
    '.KS.........',
    'KKKKKKKKKKKK',
    'KWWWWWWWWWWK',
    'KWBBBBBBBBWK',
    'KWBbBBBbBBWK',
    '.KWWWWWWWWK.',
    '..KKKKKKKK..',
    '..K......K..',
    '............',
  ],
  closet: [
    'KKKKKKKKKKKK',
    'KPPPPPKPPPPK',
    'KPppPPKPPppK',
    'KPPPPPKPPPPK',
    'KPPPPYKYPPPK',
    'KPPPPPKPPPPK',
    'KPPPPPKPPPPK',
    'KPPPPPKPPPPK',
    'KPPPPPKPPPPK',
    'KKKKKKKKKKKK',
    '.K........K.',
    '............',
  ],
  heart: [
    '.KK...KK.',
    'KPPK.KRRK',
    'KPWPKRRRK',
    'KPPRRRRRK',
    '.KRRRRRK.',
    '..KRRRK..',
    '...KRK...',
    '....K....',
  ],
  sparkle: ['...K...', '...Y...', '..YWY..', 'KYWWWYK', '..YWY..', '...Y...', '...K...'],
} satisfies Record<string, string[]>;

export type SpriteName = keyof typeof SPRITES;

/** Horizontal runs of same-colored pixels, so a sprite is a handful of rects. */
function runs(sprite: readonly string[]) {
  const out: { x: number; y: number; w: number; color: string }[] = [];
  sprite.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      let w = 1;
      while (row[x + w] === ch) w++;
      if (ch !== '.' && PALETTE[ch]) out.push({ x, y, w, color: PALETTE[ch] });
      x += w;
    }
  });
  return out;
}

/** Sprite as SVG rects at (x, y) with `pixel` units per pixel, for embedding in another SVG. */
export function SpriteGroup({
  name,
  x,
  y,
  pixel,
}: {
  name: SpriteName;
  x: number;
  y: number;
  pixel: number;
}) {
  return (
    <g shapeRendering="crispEdges" style={{ pointerEvents: 'none' }}>
      {runs(SPRITES[name]).map((r, i) => (
        <rect
          key={i}
          x={x + r.x * pixel}
          y={y + r.y * pixel}
          width={r.w * pixel + 0.001}
          height={pixel + 0.001}
          fill={r.color}
        />
      ))}
    </g>
  );
}

/** Standalone pixel-art image. Decorative unless a `label` is given. */
export function PixelArt({
  name,
  size = 48,
  label,
  className,
}: {
  name: SpriteName;
  size?: number;
  label?: string;
  className?: string;
}) {
  const sprite = SPRITES[name];
  const w = sprite[0]!.length;
  const h = sprite.length;
  return (
    <svg
      width={size}
      height={(size * h) / w}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ imageRendering: 'pixelated', flexShrink: 0 }}
    >
      <SpriteGroup name={name} x={0} y={0} pixel={1} />
    </svg>
  );
}

/** Which sprite (if any) represents a place, from its point-of-interest type or name. */
export function spriteFor(node: Pick<GraphNode, 'label' | 'poiType' | 'kind'>): SpriteName | null {
  const label = node.label.toLowerCase();
  if (node.poiType === 'kitchen' || /kitchen|kitchenette/.test(label)) return 'kitchen';
  if (node.poiType === 'bathroom' || /bath|toilet|restroom|washroom/.test(label)) return 'bathroom';
  if (/closet|wardrobe|storage/.test(label)) return 'closet';
  if (/bed|dorm room/.test(label)) return 'bedroom';
  if (node.kind === 'room') return 'house';
  return null;
}
