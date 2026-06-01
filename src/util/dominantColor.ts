export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const cache = new Map<string, Rgb | null>();

/** Returns the dominant *saturated* color of an image, or null. */
export async function extractDominantColor(src: string): Promise<Rgb | null> {
  if (cache.has(src)) return cache.get(src) ?? null;

  const rgb = await sample(src).catch(() => null);
  cache.set(src, rgb);
  return rgb;
}

async function sample(src: string): Promise<Rgb | null> {
  const img = await loadImage(src);
  const W = 64;
  const H = Math.max(8, Math.round(W * (img.naturalHeight / img.naturalWidth)));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, W, H);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, W, H).data;
  } catch {
    return null; // tainted canvas
  }

  // Two-pass: prefer a saturated hue, but if the cover is near-monochrome,
  // relax the gates and accept a darker/desaturated dominant.
  const strict = bucketScan(data, {
    minL: 28,
    maxL: 235,
    minSat: 0.18,
  });
  if (strict) return enforceLuminance(strict);

  const loose = bucketScan(data, {
    minL: 18,
    maxL: 245,
    minSat: 0.04,
  });
  if (loose) return enforceLuminance(loose);

  // Last resort: weighted average of all opaque pixels in the mid-luminance
  // band. Better than nothing for a stark black-on-white cover.
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i]!, dg = data[i + 1]!, db = data[i + 2]!, da = data[i + 3]!;
    if (da < 200) continue;
    const max = Math.max(dr, dg, db);
    const min = Math.min(dr, dg, db);
    const l = (max + min) / 2;
    if (l < 24 || l > 240) continue;
    r += dr;
    g += dg;
    b += db;
    n++;
  }
  if (n === 0) return null;
  return enforceLuminance({ r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) });
}

interface ScanOpts {
  minL: number;
  maxL: number;
  minSat: number;
}

function bucketScan(data: Uint8ClampedArray, opts: ScanOpts): Rgb | null {
  const BUCKETS = 24;
  type Bucket = { r: number; g: number; b: number; n: number; satSum: number };
  const buckets: Bucket[] = Array.from({ length: BUCKETS }, () => ({
    r: 0,
    g: 0,
    b: 0,
    n: 0,
    satSum: 0,
  }));

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const a = data[i + 3]!;
    if (a < 200) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (l < opts.minL || l > opts.maxL) continue;
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat < opts.minSat) continue;

    const h = hue(r, g, b, max, min);
    const idx = Math.min(BUCKETS - 1, Math.floor((h / 360) * BUCKETS));
    const bk = buckets[idx]!;
    bk.r += r;
    bk.g += g;
    bk.b += b;
    bk.n += 1;
    bk.satSum += sat;
  }

  let best: Bucket | null = null;
  let bestScore = 0;
  for (const bk of buckets) {
    if (bk.n === 0) continue;
    if (bk.satSum > bestScore) {
      bestScore = bk.satSum;
      best = bk;
    }
  }
  if (!best) return null;
  return {
    r: Math.round(best.r / best.n),
    g: Math.round(best.g / best.n),
    b: Math.round(best.b / best.n),
  };
}

/** Keep tints out of the near-black / near-white extremes so the hero
 *  gradient always has *some* presence. */
function enforceLuminance(c: Rgb): Rgb {
  const l = luminance(c);
  if (l < 0.12) return shift(c, 0.18);
  if (l > 0.88) return shift(c, -0.18);
  return c;
}

function hue(r: number, g: number, b: number, max: number, min: number): number {
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Tauri's asset:// is treated as same-origin in the webview; no need for CORS.
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** rgb -> "r, g, b" for CSS var consumption. */
export function rgbString(c: Rgb): string {
  return `${c.r}, ${c.g}, ${c.b}`;
}

/** Perceived luminance, 0–1. */
export function luminance(c: Rgb): number {
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}

/** Foreground hex that reads cleanly against the given background. */
export function readableForeground(c: Rgb): string {
  return luminance(c) > 0.62 ? "#0a0c12" : "#ffffff";
}

/** Lighten/darken by `amount` in [-1, 1]; -1 = black, +1 = white. */
export function shift(c: Rgb, amount: number): Rgb {
  if (amount >= 0) {
    return {
      r: Math.round(c.r + (255 - c.r) * amount),
      g: Math.round(c.g + (255 - c.g) * amount),
      b: Math.round(c.b + (255 - c.b) * amount),
    };
  }
  const k = 1 + amount;
  return {
    r: Math.round(c.r * k),
    g: Math.round(c.g * k),
    b: Math.round(c.b * k),
  };
}
