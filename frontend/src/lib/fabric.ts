import type { CSSProperties } from 'react';

/**
 * Every domain is a quilt patch: a base colour plus a woven pattern drawn
 * with CSS gradients (no images, scales crisply, costs nothing to load).
 * Text never sits directly on a fabric, so contrast is always ink-on-paper.
 */
export type Weave =
  | 'gingham'
  | 'stripes'
  | 'pinstripe'
  | 'dots'
  | 'checker'
  | 'zigzag'
  | 'cross'
  | 'plaid'
  | 'waves'
  | 'diamonds'
  | 'herringbone';

export interface Fabric {
  id: string;
  /** Base cloth colour. */
  color: string;
  weave: Weave;
  /** Pattern thread: light threads on dark cloth, dark threads on light cloth. */
  thread: 'light' | 'dark';
}

const f = (id: string, color: string, weave: Weave, thread: Fabric['thread'] = 'light'): Fabric => ({
  id,
  color,
  weave,
  thread,
});

export const FABRICS: Record<string, Fabric> = {
  databases: f('databases', '#3E5C9A', 'gingham'),
  ml: f('ml', '#8A4B8F', 'dots'),
  'data-science': f('data-science', '#2E8582', 'stripes'),
  frontend: f('frontend', '#DD6B4D', 'zigzag'),
  backend: f('backend', '#4D6B8C', 'pinstripe'),
  devops: f('devops', '#4C97C4', 'checker'),
  security: f('security', '#3F7650', 'cross'),
  gamedev: f('gamedev', '#C03E5E', 'plaid'),
  blockchain: f('blockchain', '#D6A23A', 'diamonds', 'dark'),
  mobile: f('mobile', '#E88B3E', 'dots', 'dark'),
  compilers: f('compilers', '#8E3140', 'herringbone'),
  cli: f('cli', '#34574A', 'pinstripe'),
  accessibility: f('accessibility', '#E8B83C', 'gingham', 'dark'),
  'docs-tooling': f('docs-tooling', '#5B78A8', 'stripes'),
  testing: f('testing', '#86A87F', 'checker', 'dark'),
  networking: f('networking', '#2C7DB5', 'waves'),
  embedded: f('embedded', '#B45A31', 'cross'),
  systems: f('systems', '#5A5E74', 'plaid'),
  graphics: f('graphics', '#AE4C9B', 'zigzag'),
  devtools: f('devtools', '#C28D42', 'dots', 'dark'),
  observability: f('observability', '#3D9A7E', 'stripes'),
  science: f('science', '#7E6DB6', 'waves'),
};

const EXTRA: Fabric[] = [
  f('x-rose', '#C4566B', 'gingham'),
  f('x-moss', '#6E8B4B', 'stripes'),
  f('x-denim', '#46618F', 'cross'),
  f('x-saffron', '#E3A33B', 'checker', 'dark'),
  f('x-teal', '#2F7F86', 'dots'),
  f('x-clay', '#B8654A', 'herringbone'),
  f('x-plum', '#7A4A7E', 'pinstripe'),
];

const ALL = [...Object.values(FABRICS), ...EXTRA];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Stable fabric for any string (repo owner, repo name…), so the list reads as a quilt. */
export function fabricFor(key: string): Fabric {
  return ALL[hash(key.toLowerCase()) % ALL.length];
}

export function domainFabric(id: string): Fabric {
  return FABRICS[id] ?? fabricFor(id);
}

/** CSS background for a patch of `fabric`. `scale` multiplies the weave size. */
export function fabricStyle(fabric: Fabric, scale = 1): CSSProperties {
  const t = fabric.thread === 'light' ? 'rgb(255 250 240 / 0.34)' : 'rgb(30 20 10 / 0.2)';
  const t2 = fabric.thread === 'light' ? 'rgb(255 250 240 / 0.18)' : 'rgb(30 20 10 / 0.11)';
  const s = (n: number) => `${Math.round(n * scale * 10) / 10}px`;
  let backgroundImage: string;
  let backgroundSize: string;
  let backgroundPosition: string | undefined;

  switch (fabric.weave) {
    case 'gingham':
      backgroundImage = `linear-gradient(90deg, ${t2} 50%, transparent 50%), linear-gradient(${t2} 50%, transparent 50%)`;
      backgroundSize = `${s(12)} ${s(12)}`;
      break;
    case 'stripes':
      backgroundImage = `repeating-linear-gradient(45deg, ${t} 0 ${s(3)}, transparent ${s(3)} ${s(8)})`;
      backgroundSize = 'auto';
      break;
    case 'pinstripe':
      backgroundImage = `repeating-linear-gradient(90deg, ${t} 0 ${s(1.2)}, transparent ${s(1.2)} ${s(6)})`;
      backgroundSize = 'auto';
      break;
    case 'dots':
      backgroundImage = `radial-gradient(${t} 22%, transparent 24%), radial-gradient(${t} 22%, transparent 24%)`;
      backgroundSize = `${s(10)} ${s(10)}`;
      backgroundPosition = `0 0, ${s(5)} ${s(5)}`;
      break;
    case 'checker':
      backgroundImage = `conic-gradient(${t2} 25%, transparent 0 50%, ${t2} 0 75%, transparent 0)`;
      backgroundSize = `${s(10)} ${s(10)}`;
      break;
    case 'zigzag':
      backgroundImage = `linear-gradient(135deg, ${t} 25%, transparent 25%), linear-gradient(225deg, ${t} 25%, transparent 25%), linear-gradient(315deg, ${t} 25%, transparent 25%), linear-gradient(45deg, ${t} 25%, transparent 25%)`;
      backgroundSize = `${s(10)} ${s(10)}`;
      backgroundPosition = `${s(-5)} 0, ${s(-5)} 0, 0 0, 0 0`;
      break;
    case 'cross':
      backgroundImage = `repeating-linear-gradient(45deg, ${t} 0 ${s(1.2)}, transparent ${s(1.2)} ${s(7)}), repeating-linear-gradient(-45deg, ${t} 0 ${s(1.2)}, transparent ${s(1.2)} ${s(7)})`;
      backgroundSize = 'auto';
      break;
    case 'plaid':
      backgroundImage = `repeating-linear-gradient(90deg, ${t2} 0 ${s(5)}, transparent ${s(5)} ${s(16)}), repeating-linear-gradient(0deg, ${t2} 0 ${s(5)}, transparent ${s(5)} ${s(16)}), repeating-linear-gradient(90deg, transparent 0 ${s(10)}, ${t} ${s(10)} ${s(11)}, transparent ${s(11)} ${s(16)})`;
      backgroundSize = 'auto';
      break;
    case 'waves':
      backgroundImage = `radial-gradient(circle at 50% 0, transparent 42%, ${t} 44% 56%, transparent 58%)`;
      backgroundSize = `${s(14)} ${s(8)}`;
      break;
    case 'diamonds':
      backgroundImage = `linear-gradient(45deg, ${t} 25%, transparent 25% 75%, ${t} 75%), linear-gradient(-45deg, ${t} 25%, transparent 25% 75%, ${t} 75%)`;
      backgroundSize = `${s(12)} ${s(12)}`;
      break;
    case 'herringbone':
    default:
      backgroundImage = `linear-gradient(45deg, ${t} 12%, transparent 12% 50%, ${t} 50% 62%, transparent 62%), linear-gradient(-45deg, ${t2} 12%, transparent 12% 50%, ${t2} 50% 62%, transparent 62%)`;
      backgroundSize = `${s(10)} ${s(10)}`;
      break;
  }
  return { backgroundColor: fabric.color, backgroundImage, backgroundSize, backgroundPosition };
}
