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
import exifReader from 'exif-reader';
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
  /(logo|icon|sprite|favicon|avatar|badge|placeholder|spinner|loader|pixel|tracking|1x1|blank|transparent|cookie|gdpr|banner-ad|food|menu|recipe|breakfast|lunch|dinner|cuisine|cocktail|testimonial|headshot)/i;

const MAX_CANDIDATES = 16; // distinct URLs to consider per page
const MAX_DOWNLOADS = 24;  // images actually fetched + measured
const MAX_STORED = 12;     // final cap per offer
const MIN_WIDTH = 500;
const MIN_HEIGHT = 330;
const MAX_ASPECT = 3.2;    // wider than this → banner strip
const MIN_ASPECT = 0.4;    // narrower than this → sidebar/icon
const TARGET_WIDTH = 1280;
const WEBP_QUALITY = 75;
const VISION_MAX_IMAGES = 10; // images sent to the vision QC call
const USE_VISION_QC = true;

// Best-effort image rights/provenance. Most provider photos are web-optimized
// with EXIF/XMP stripped → `provider_site` with no copyright. The useful signals
// are the `stock` flag (rights-risky, likely-licensed third-party photos) and
// any embedded copyright/credit/license that survived.
export interface ImageRights {
  status: 'provider_site' | 'stock' | 'credited' | 'licensed';
  source_host: string | null;
  copyright: string | null;    // embedded copyright notice, if any
  credit: string | null;       // photographer / creator, if any
  license: string | null;      // stated usage terms, if any
  license_url: string | null;  // CC license URL / web statement, if any
}

const STOCK_HOST_RE =
  /(unsplash|pexels|pixabay|shutterstock|istockphoto|gettyimages|adobestock|stock\.adobe|123rf|dreamstime|depositphotos|alamy|freepik|envato)/i;

export interface StoredImage {
  path: string;
  source_url: string;
  width: number;
  height: number;
  bytes: number;
  caption: string | null;
  sort: number;
  rights: ImageRights;
  /** true when this is the operator's homepage hero, used because the offer's own page had no usable image */
  fallback?: boolean;
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

/**
 * Canonical dedup key for an image URL. Collapses image-optimizer wrappers
 * (Next.js `/_next/image?url=…`, and other CDNs that pass the real image in a
 * `url` query param) to the underlying file, so the same photo served raw AND
 * through an optimizer isn't stored twice.
 */
function canonicalKey(absUrl: string): string {
  try {
    const u = new URL(absUrl);
    const inner = u.searchParams.get('url');
    if (inner) {
      try { return new URL(inner, u.origin).pathname; } catch { return inner; }
    }
    // Jetpack/Photon proxies origin images at i0–i3.wp.com/<origin-host>/<path>;
    // key on the origin path so photon- and origin-served variants of one photo
    // collapse to a single candidate.
    if (/^i[0-3]\.wp\.com$/i.test(u.hostname)) {
      const originPath = u.pathname.replace(/^\/[^/]+/, '');
      if (originPath) return originPath;
    }
    return u.pathname;
  } catch {
    return absUrl.split('?')[0];
  }
}

/**
 * Some image CDNs bake a resize transform into the URL, so the discovered URL is
 * a tiny thumbnail (e.g. Wix `…~mv2.jpg/v1/fill/w_288,h_…/file.jpg`) that fails
 * our min-size filter. Rewrite known CDNs to the full-resolution original — our
 * own pipeline downsizes to TARGET_WIDTH afterward. As a bonus this collapses
 * every size-variant of one photo to a single canonical URL, improving dedup.
 */
export function upscaleCdnUrl(absUrl: string): string {
  try {
    const u = new URL(absUrl);
    // Wix: https://static.wixstatic.com/media/<id>~mv2.<ext>/v1/<fill|crop>/…/<file>
    // → strip everything after the media id, leaving the original full-res image.
    if (/(^|\.)wixstatic\.com$/i.test(u.hostname)) {
      const m = u.pathname.match(/^\/media\/[^/]+\.(?:jpe?g|png|webp|gif|avif)/i);
      if (m) return `${u.protocol}//${u.hostname}${m[0]}`;
    }
    // WordPress media — origin-served or via the Jetpack/Photon CDN
    // (i0–i3.wp.com/<origin-host>/<path>). Two thumbnail mechanisms, often
    // combined: "-WIDTHxHEIGHT" filename suffixes and ?w=/?h=/?fit=/?resize=
    // query transforms (cbcmsailingclub served ?w=336&h=210 gallery thumbs).
    // Stripping both yields the full-resolution original.
    if (/^i[0-3]\.wp\.com$/i.test(u.hostname) || /\/wp-content\/uploads\//i.test(u.pathname)) {
      let changed = false;
      // "-WxH" thumbnails, plus theme-resizer variants like "-400x0-c-default"
      // (height 0 = auto, "-c-<mode>" = crop flag; sea-adventures.com).
      const stripped = u.pathname
        .replace(/-\d{2,4}x\d{1,4}-c-[a-z-]+(\.(?:jpe?g|png|webp|gif|avif))$/i, '$1')
        .replace(/-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp|gif|avif))$/i, '$1');
      if (stripped !== u.pathname) { u.pathname = stripped; changed = true; }
      for (const p of ['w', 'h', 'fit', 'resize', 'crop', 'zoom', 'quality']) {
        if (u.searchParams.has(p)) { u.searchParams.delete(p); changed = true; }
      }
      if (changed) return u.href;
    }
    // Tilda: lazy-load background thumbnails live on thb.tildacdn.net with a
    // transform segment (…/tild…/-/resize/20x/file.jpg — 20 px wide!); the
    // original is static.tildacdn.net/tild…/file.jpg (spiritkitecruise.com).
    if (/(^|\.)thb\.tildacdn\.(net|com)$/i.test(u.hostname)) {
      const m = u.pathname.match(/^\/(tild[^/]+)\/(?:-\/[^/]+(?:\/[^/]+)*\/)?([^/]+)$/i);
      if (m) return `https://static.tildacdn.net/${m[1]}/${m[2]}`;
    }
    return absUrl;
  } catch {
    return absUrl;
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
  max: number = MAX_CANDIDATES,
): string[] {
  const root = parse(html);
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (raw?: string | null): void => {
    if (!raw) return;
    const abs0 = absolutize(raw, baseUrl);
    if (!abs0) return;
    const abs = upscaleCdnUrl(abs0);
    if (JUNK_RE.test(abs)) return;
    const key = canonicalKey(abs);
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
    // Jetpack stamps the untouched original on every gallery <img> — push it
    // FIRST so it claims the canonical key ahead of any resized variant.
    push(img.getAttribute('data-orig-file'));
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
  // Lightbox galleries: thumbnails are JS-lazy (no usable <img src>), but each
  // <a> links the full-res photo (WP galleries — flisvos-sportclub's kite&sail
  // gallery is 27 such links). The anchor href IS the image.
  for (const a of scope.querySelectorAll('a')) {
    const href = a.getAttribute('href');
    if (href && /\.(jpe?g|png|webp|avif)(\?|$)/i.test(href)) push(href);
  }

  return urls.slice(0, max);
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

function hostOf(u: string): string | null {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; }
}

/** Best-effort rights from a (pre-compression) image buffer + its source URL. */
export async function extractImageRights(buf: Buffer, sourceUrl: string): Promise<ImageRights> {
  const host = hostOf(sourceUrl);
  let copyright: string | null = null;
  let credit: string | null = null;
  let license: string | null = null;
  let licenseUrl: string | null = null;
  try {
    const meta = await sharp(buf).metadata();
    if (meta.xmp) {
      const x = meta.xmp.toString('utf8');
      const m = (re: RegExp): string | null => x.match(re)?.[1]?.trim() || null;
      copyright = m(/<dc:rights>[\s\S]*?<rdf:li[^>]*>([^<]+)</i);
      credit = m(/<photoshop:Credit>([^<]+)</i) ?? m(/<dc:creator>[\s\S]*?<rdf:li[^>]*>([^<]+)</i);
      license = m(/<xmpRights:UsageTerms>[\s\S]*?<rdf:li[^>]*>([^<]+)</i);
      licenseUrl = m(/<xmpRights:WebStatement[^>]*>([^<]+)</i) ?? m(/<cc:license[^>]*rdf:resource="([^"]+)"/i);
    }
    if (meta.exif) {
      try {
        const t = exifReader(meta.exif) as { Image?: { Copyright?: unknown; Artist?: unknown } };
        if (!copyright && typeof t.Image?.Copyright === 'string') copyright = t.Image.Copyright.trim() || null;
        if (!credit && typeof t.Image?.Artist === 'string') credit = t.Image.Artist.trim() || null;
      } catch { /* unparseable exif */ }
    }
  } catch { /* no readable metadata */ }

  const status: ImageRights['status'] =
    license || licenseUrl ? 'licensed'
      : host && STOCK_HOST_RE.test(host) ? 'stock'
        : copyright || credit ? 'credited'
          : 'provider_site';

  return { status, source_host: host, copyright, credit, license, license_url: licenseUrl };
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
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

export async function downloadImage(url: string): Promise<Buffer | null> {
  // Wix: a bare media URL serves the untouched original (routinely 20+ MB,
  // ~15 s — timeouts). Ask Wix for a server-side bounded transform instead;
  // w_1920 is comfortably above our 1280 px target. Fall back to the bare
  // original if the transform is refused.
  try {
    const u = new URL(url);
    if (/(^|\.)wixstatic\.com$/i.test(u.hostname) && /^\/media\/[^/]+$/.test(u.pathname)) {
      const bounded = await fetchImage(`${url}/v1/fit/w_1920,h_1920,q_90/img.jpg`);
      if (bounded) return bounded;
    }
  } catch { /* fall through to the plain fetch */ }
  return fetchImage(url);
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
      5,    // ride out transient 529s — vision is the only content filter for a broad pool
      3000,
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
/**
 * Compress one already-downloaded image and upload it to the private bucket at
 * `path`. Used by the admin media-curation apply path (human-selected images
 * skip the vision QC but get the same processing as pipeline-curated ones).
 */
export async function processAndStoreImage(
  buf: Buffer,
  sourceUrl: string,
  path: string,
  sort: number,
  caption: string | null = null,
): Promise<StoredImage | null> {
  let out: Buffer;
  let outW = 0;
  let outH = 0;
  try {
    out = await sharp(buf)
      .rotate()
      .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    const m = await sharp(out).metadata();
    outW = m.width ?? 0;
    outH = m.height ?? 0;
  } catch {
    return null;
  }
  await ensureCruiseImageBucket();
  const { error } = await supabase.storage
    .from(CRUISE_IMAGE_BUCKET)
    .upload(path, out, { contentType: 'image/webp', upsert: true, cacheControl: '31536000' });
  if (error) {
    console.error(`  image upload failed (${path}): ${error.message}`);
    return null;
  }
  return {
    path,
    source_url: sourceUrl,
    width: outW,
    height: outH,
    bytes: out.byteLength,
    caption,
    sort,
    rights: await extractImageRights(buf, sourceUrl),
  };
}

export async function curateAndStoreImages(opts: {
  candidateUrls: string[];
  providerId: string;
  slug: string;
  sourceUrl: string;
  context: string;
  max?: number;
  maxDownloads?: number;
}): Promise<StoredImage[]> {
  const { candidateUrls, providerId, slug, sourceUrl, context } = opts;
  const cap = opts.max ?? MAX_STORED;
  const dlCap = opts.maxDownloads ?? MAX_DOWNLOADS;
  if (candidateUrls.length === 0) return [];

  // Merge-safe dedup + junk filter (Tavily-sourced URLs bypass discoverImageUrls,
  // so upscale CDN thumbnails here too).
  const deduped: string[] = [];
  const seenKeys = new Set<string>();
  for (const raw of candidateUrls) {
    const u = upscaleCdnUrl(raw);
    if (JUNK_RE.test(u)) continue;
    const k = canonicalKey(u);
    if (seenKeys.has(k)) continue;
    seenKeys.add(k);
    deduped.push(u);
  }

  // 1. Download (bounded), measure, heuristic-filter logos/banners/tiny.
  const downloaded: DownloadedImage[] = [];
  for (const url of deduped.slice(0, dlCap)) {
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
    selected = visionPick.slice(0, cap);
  } else {
    // Vision unavailable/failed → fall back to largest-by-area. Obvious junk
    // (logos, food, badges, etc.) is already filtered by JUNK_RE, so the
    // largest survivors are almost always the real boat/kite hero shots.
    selected = [...downloaded]
      .sort((a, b) => b.width * b.height - a.width * a.height)
      .slice(0, cap)
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
      .upload(path, out, { contentType: 'image/webp', upsert: true, cacheControl: '31536000' });
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
      rights: await extractImageRights(img.buf, img.sourceUrl),
    });
    sort++;
  }
  return stored;
}
