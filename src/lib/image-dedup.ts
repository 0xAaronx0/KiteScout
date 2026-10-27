// ---------------------------------------------------------------------------
// Near-duplicate photos: the same picture as another crop, zoom or size (Aaron 2026-10-26: Kite Club Hatteras showed
// one house photo twice, once zoomed). A small grayscale copy of each image is slid over the others at several scales;
// a normalised cross-correlation >= NCC_MIN (re-checked at W2 >= NCC2_MIN) plus a similar colour histogram counts as the
// same photo. Calibrated on the 59 pairs reviewed by eye in the 2026-10-26 scan of all 484 listings: 36 of 47 real
// duplicates caught, all 11 different photos kept except one burst shot (same snow scene, kite moved), which is fine
// to drop from a gallery. Real duplicates exist below the threshold (down to ~0.95), so the pipeline stays cautious.
// ---------------------------------------------------------------------------
import sharp from 'sharp';

const W = 64;                  // reference width of the grayscale search image
const W2 = 128;                // second, finer check for pairs that pass at W (low-texture scenes like snow fool W)
export const NCC_MIN = 0.985;
export const NCC2_MIN = 0.95;
export const HIST_MIN = 0.6;

interface Gray { w: number; h: number; px: Float32Array }
export interface DupFeat extends Gray { hist: Float32Array; fine: Gray }

export async function dupFeatures(buf: Buffer): Promise<DupFeat> {
  const g = await sharp(buf).rotate().resize({ width: W }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const g2 = await sharp(buf).rotate().resize({ width: W2 }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const c = await sharp(buf).rotate().resize(32, 32, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const hist = new Float32Array(512);
  for (let i = 0; i < c.length; i += 3) hist[(c[i] >> 5) * 64 + (c[i + 1] >> 5) * 8 + (c[i + 2] >> 5)]++;
  for (let i = 0; i < 512; i++) hist[i] /= c.length / 3;
  return { w: g.info.width, h: g.info.height, px: Float32Array.from(g.data), hist,
    fine: { w: g2.info.width, h: g2.info.height, px: Float32Array.from(g2.data) } };
}

function histIntersection(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i]);
  return s;
}

function resample(f: Gray, w: number): Gray {
  const h = Math.max(1, Math.round(f.h * w / f.w));
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(f.w - 1, (x + 0.5) * f.w / w - 0.5), sy = Math.min(f.h - 1, (y + 0.5) * f.h / h - 0.5);
    const x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy));
    const x1 = Math.min(f.w - 1, x0 + 1), y1 = Math.min(f.h - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
    out[y * w + x] = f.px[y0 * f.w + x0] * (1 - fx) * (1 - fy) + f.px[y0 * f.w + x1] * fx * (1 - fy)
      + f.px[y1 * f.w + x0] * (1 - fx) * fy + f.px[y1 * f.w + x1] * fx * fy;
  }
  return { w, h, px: out };
}

/** Best normalised cross-correlation of `small` (scaled to `from`-`to` of the width) slid over `big`. */
export function containment(big: Gray, small: Gray, from = 0.35, to = 1, step = 0.025): { ncc: number; scale: number } {
  let best = -1, bestScale = 0;
  for (let s = from; s <= to + 1e-4; s += step) {
    const t = resample(small, Math.round(big.w * s));
    if (t.h > big.h || t.w > big.w || t.w * t.h < 200) continue;
    let tm = 0; for (const v of t.px) tm += v; tm /= t.px.length;
    let ts = 0; for (const v of t.px) ts += (v - tm) ** 2; ts = Math.sqrt(ts);
    if (ts < 1e-3) continue;
    for (let oy = 0; oy + t.h <= big.h; oy++) for (let ox = 0; ox + t.w <= big.w; ox++) {
      let am = 0;
      for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) am += big.px[(oy + y) * big.w + ox + x];
      am /= t.px.length;
      let num = 0, as = 0;
      for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
        const d = big.px[(oy + y) * big.w + ox + x] - am;
        num += d * (t.px[y * t.w + x] - tm); as += d * d;
      }
      const ncc = num / (Math.sqrt(as) * ts + 1e-6);
      if (ncc > best) { best = ncc; bestScale = s; }
    }
  }
  return { ncc: best, scale: bestScale };
}

/** Score of `small` inside `big`: coarse search at W, then the same scale (+-2.5 %) re-checked at W2. */
export function dupScore(big: DupFeat, small: DupFeat): { coarse: number; fine: number } {
  const c = containment(big, small);
  if (c.ncc < NCC_MIN) return { coarse: c.ncc, fine: -1 };
  const f = containment(big.fine, small.fine, Math.max(0.35, c.scale - 0.025), Math.min(1, c.scale + 0.025), 0.0125);
  return { coarse: c.ncc, fine: f.ncc };
}

/** True when a and b are the same photo (one may be a crop / zoom / resize of the other). */
export function sameDupPhoto(a: DupFeat, b: DupFeat): boolean {
  if (histIntersection(a.hist, b.hist) < HIST_MIN) return false;
  return [dupScore(a, b), dupScore(b, a)].some(s => s.coarse >= NCC_MIN && s.fine >= NCC2_MIN);
}

/**
 * Drops later items that repeat an earlier photo; when the later one shows MORE (the earlier is a crop of it), the
 * wider one takes the earlier one's place, so the order (best-first) is kept and the zoomed copy goes.
 */
export async function dropNearDuplicates<T>(items: T[], buf: (t: T) => Buffer): Promise<{ kept: T[]; dropped: T[] }> {
  const feats: DupFeat[] = [];
  const kept: T[] = [], dropped: T[] = [];
  for (const it of items) {
    let f: DupFeat;
    try { f = await dupFeatures(buf(it)); } catch { kept.push(it); feats.push(null as unknown as DupFeat); continue; }
    const j = feats.findIndex(k => k && sameDupPhoto(k, f));
    if (j < 0) { kept.push(it); feats.push(f); continue; }
    // the wider view wins: if the kept one fits inside the new one better than the other way round, swap
    if (containment(f, feats[j]).ncc > containment(feats[j], f).ncc) { dropped.push(kept[j]); kept[j] = it; feats[j] = f; }
    else dropped.push(it);
  }
  return { kept, dropped };
}
