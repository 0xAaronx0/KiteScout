// ---------------------------------------------------------------------------
// Cruise-offer image pipeline.
//
//   discoverImageUrls()    — context-scoped candidate URLs from a page's HTML
//   curateAndStoreImages() — download → heuristic filter → Claude-vision QC →
//                            compress to WebP → upload to a PRIVATE Supabase bucket
//
// The primary relevance signal is structural: we scope to the offer's own
// page/section and drop site chrome (header/footer/nav) + junk filenames +
// logo-shaped images. Claude vision is a final QC pass that picks the best ≤5
// (boat / spot / kiting) and rejects anything that slipped through.
//
// Stored objects are NOT public — the DB keeps the storage path; the web layer
// mints short-lived signed URLs (or proxies) when it eventually reads them.
// ---------------------------------------------------------------------------

import Anthropic from '@anthropic-ai/sdk';
import { parse, type HTMLElement } from 'node-html-parser';
import sharp from 'sharp';
import { supabase } from './supabase.js';
import { anthropic, ANALYSIS_MODEL } from './anthropic.js';
import { withRetry } from './retry.js';

export const CRUISE_IMAGE_BUCKET = 'cruise-images';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Filenames that are almost never a real offer photo.
const JUNK_RE =
  /(logo|icon|sprite|favicon|avatar|badge|placeholder|spinner|loader|pixel|tracking|1x1|blank|transparent|cookie|gdpr|banner-ad)/i;

const MAX_CANDIDATES = 16; // distinct URLs to consider per page
const MAX_DOWNLOADS = 14;  // images actually fetched + measured
const MAX_STORED = 5;      // final cap per offer
const MIN_WIDTH = 500;
const MIN_HEIGHT = 330;
const MAX_ASPECT = 3.2;    // wider than this → banner strip
const MIN_ASPECT = 0.4;    // narrower than this → sidebar/icon
const TARGET_WIDTH = 1280;
const WEBP_QUALITY = 75;
const VISION_MAX_IMAGES = 10; // images sent to the vision QC call
const USE_VISION_QC = true;

export interface StoredImage {
  path: string;
  source_url: string;
  width: number;
  height: number;
  bytes: number;
  caption: string | null;
  sort: number;
}

// ---------------------------------------------------------------------------
// slug + URL helpers
// ---------------------------------------------------------------------------
export function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'offer';
}

function absolutize(src: string, baseUrl: string): string | null {
  try {
    const u = new URL(src.trim(), baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Pick the largest URL from a srcset / data-srcset value. */
function pickFromSrcset(srcset: string): string | null {
  const parts = srcset.split(',').map(s => s.trim()).filter(Boolean);
  let best: { url: string; w: number } | null = null;
  for (const p of parts) {
    const [url, desc] = p.split(/\s+/);
    if (!url) continue;
    let w = 0;
    if (desc?.endsWith('w')) w = parseInt(desc, 10) || 0;
    else if (desc?.endsWith('x')) w = (parseFloat(desc) || 0) * 1000;
    if (!best || w > best.w) best = { url, w };
  }
  return best?.url ?? null;
}

/**
 * On a multi-offer listing page, scope to the DOM container around the heading
 * that matches `anchorText`, so images belong to THIS offer rather than the
 * whole page. Best-effort; returns null to fall back to the page body.
 */
function findAnchorScope(root: HTMLElement, anchorText: string): HTMLElement | null {
  const needle = anchorText.toLowerCase().trim().slice(0, 40);
  if (needle.length < 4) return null;
  let match: HTMLElement | null = null;
  for (const h of root.querySelectorAll('h1, h2, h3, h4, a')) {
    if (h.text.toLowerCase().includes(needle)) { match = h; break; }
  }
  if (!match) return null;
  // Walk up to the nearest ancestor that actually contains imagery.
  let el: HTMLElement | null = match;
  for (let i = 0; i < 4 && el?.parentNode; i++) {
    el = el.parentNode as HTMLElement;
    if (el && el.querySelectorAll('img').length > 0) return el;
  }
  return el;
}

/**
 * Extract candidate image URLs from a page, scoped to the offer's content.
 * `anchorText` (an offer title/heading) narrows to that section on listing pages.
 */
export function discoverImageUrls(
  html: string,
  baseUrl: string,
  anchorText?: string | null,
): string[] {
  const root = parse(html);
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (raw?: string | null): void => {
    if (!raw) return;
    const abs = absolutize(raw, baseUrl);
    if (!abs || JUNK_RE.test(abs)) return;
    const key = abs.split('?')[0];
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(abs);
  };

  // 1. og:image / twitter:image first — usually the page's curated hero shot.
  for (const m of root.querySelectorAll('meta')) {
    const prop = (m.getAttribute('property') ?? m.getAttribute('name') ?? '').toLowerCase();
    if (prop === 'og:image' || prop === 'og:image:secure_url' || prop === 'twitter:image') {
      push(m.getAttribute('content'));
    }
  }

  // 2. Strip site chrome, then collect content imagery.
  for (const el of root.querySelectorAll('header, footer, nav')) el.remove();
  const scope =
    (anchorText ? findAnchorScope(root, anchorText) : null) ??
    root.querySelector('main') ??
    root.querySelector('article') ??
    root.querySelector('body') ??
    root;

  for (const img of scope.querySelectorAll('img')) {
    push(img.getAttribute('src'));
    push(img.getAttribute('data-src'));
    push(img.getAttribute('data-lazy-src'));
    push(img.getAttribute('data-original'));
    const ss = img.getAttribute('srcset') ?? img.getAttribute('data-srcset');
    if (ss) push(pickFromSrcset(ss));
  }
  for (const s of scope.querySelectorAll('source')) {
    const ss = s.getAttribute('srcset');
    if (ss) push(pickFromSrcset(ss));
  }
  for (const el of scope.querySelectorAll('[style]')) {
    const style = el.getAttribute('style') ?? '';
    const m = style.match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i);
    if (m?.[2]) push(m[2]);
  }

  return urls.slice(0, MAX_CANDIDATES);
}

// ---------------------------------------------------------------------------
// Storage bucket (created lazily, private)
// ---------------------------------------------------------------------------
let bucketEnsured = false;
export async function ensureCruiseImageBucket(): Promise<void> {
  if (bucketEnsured) return;
  const { data } = await supabase.storage.getBucket(CRUISE_IMAGE_BUCKET);
  if (data) { bucketEnsured = true; return; }
  const { error } = await supabase.storage.createBucket(CRUISE_IMAGE_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`Failed to ensure bucket ${CRUISE_IMAGE_BUCKET}: ${error.message}`);
  }
  bucketEnsured = true;
}

// ---------------------------------------------------------------------------
// Download + measure
// ---------------------------------------------------------------------------
interface DownloadedImage {
  sourceUrl: string;
  buf: Buffer;
  width: number;
  height: number;
}

async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (ct && !ct.startsWith('image/')) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength < 3000) return null; // too tiny to be a real photo
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Claude-vision QC: pick the best ≤5 and reject logos/UI/unrelated
// ---------------------------------------------------------------------------
async function visionSelect(
  images: DownloadedImage[],
  context: string,
): Promise<Array<{ img: DownloadedImage; caption: string | null }> | null> {
  const batch = [...images]
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, VISION_MAX_IMAGES);

  const blocks: Anthropic.ContentBlockParam[] = [];
  const used: DownloadedImage[] = [];
  for (const img of batch) {
    let small: Buffer;
    try {
      small = await sharp(img.buf).resize({ width: 512, withoutEnlargement: true }).webp({ quality: 60 }).toBuffer();
    } catch {
      continue;
    }
    blocks.push({ type: 'text', text: `Image ${used.length}:` });
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/webp', data: small.toString('base64') },
    });
    used.push(img);
  }
  if (used.length === 0) return null;

  const prompt = `You are curating photos for this kite-cruise offer:
${context}

From the numbered images above, pick up to ${MAX_STORED} that best depict the BOAT/vessel, the kite SPOTS or destination scenery, or people kiting / sailing on this trip.
REJECT: logos, icons, UI screenshots, maps or charts, text graphics, stock illustrations, headshots / portraits, payment or partner badges, and anything unrelated to this cruise.
Order them best-first. Respond with ONLY a JSON array: [{"index": <number>, "caption": "<max 8 word description>"}]. If none are suitable, respond with [].`;
  blocks.push({ type: 'text', text: prompt });

  let text: string;
  try {
    const msg = await withRetry(() =>
      anthropic.messages.create({
        model: ANALYSIS_MODEL,
        max_tokens: 512,
        messages: [{ role: 'user', content: blocks }],
      }),
    );
    text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  } catch {
    return null;
  }

  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    const out: Array<{ img: DownloadedImage; caption: string | null }> = [];
    const picked = new Set<number>();
    for (const item of parsed) {
      const idx = typeof item?.index === 'number' ? item.index : -1;
      if (idx >= 0 && idx < used.length && !picked.has(idx)) {
        picked.add(idx);
        out.push({ img: used[idx], caption: typeof item?.caption === 'string' ? item.caption : null });
      }
    }
    return out;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Orchestrator: candidate URLs → stored, compressed, curated images
// ---------------------------------------------------------------------------
export async function curateAndStoreImages(opts: {
  candidateUrls: string[];
  providerId: string;
  slug: string;
  sourceUrl: string;
  context: string;
}): Promise<StoredImage[]> {
  const { candidateUrls, providerId, slug, sourceUrl, context } = opts;
  if (candidateUrls.length === 0) return [];

  // 1. Download (bounded), measure, heuristic-filter logos/banners/tiny.
  const downloaded: DownloadedImage[] = [];
  for (const url of candidateUrls.slice(0, MAX_DOWNLOADS)) {
    const buf = await downloadImage(url);
    if (!buf) continue;
    let width = 0;
    let height = 0;
    try {
      const meta = await sharp(buf).metadata();
      width = meta.width ?? 0;
      height = meta.height ?? 0;
    } catch {
      continue;
    }
    if (width < MIN_WIDTH || height < MIN_HEIGHT) continue;
    const aspect = width / height;
    if (aspect > MAX_ASPECT || aspect < MIN_ASPECT) continue;
    downloaded.push({ sourceUrl: url, buf, width, height });
  }
  if (downloaded.length === 0) return [];

  // 2. Select the keepers.
  let selected: Array<{ img: DownloadedImage; caption: string | null }>;
  const visionPick = USE_VISION_QC ? await visionSelect(downloaded, context) : null;
  if (visionPick && visionPick.length > 0) {
    selected = visionPick.slice(0, MAX_STORED);
  } else {
    selected = [...downloaded]
      .sort((a, b) => b.width * b.height - a.width * a.height)
      .slice(0, MAX_STORED)
      .map(img => ({ img, caption: null }));
  }

  // 3. Compress + upload to the private bucket.
  await ensureCruiseImageBucket();
  const stored: StoredImage[] = [];
  let sort = 0;
  for (const { img, caption } of selected) {
    let out: Buffer;
    let outW = img.width;
    let outH = img.height;
    try {
      out = await sharp(img.buf)
        .rotate()
        .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
      const m = await sharp(out).metadata();
      outW = m.width ?? outW;
      outH = m.height ?? outH;
    } catch {
      continue;
    }
    const path = `cruise-offers/${providerId}/${slug}/${sort}.webp`;
    const { error } = await supabase.storage
      .from(CRUISE_IMAGE_BUCKET)
      .upload(path, out, { contentType: 'image/webp', upsert: true });
    if (error) {
      console.error(`  image upload failed (${path}): ${error.message}`);
      continue;
    }
    stored.push({
      path,
      source_url: img.sourceUrl,
      width: outW,
      height: outH,
      bytes: out.byteLength,
      caption,
      sort,
    });
    sort++;
  }
  return stored;
}
