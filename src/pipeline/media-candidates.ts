// ---------------------------------------------------------------------------
// Media curation: candidate pool + human selection + apply.
//
// The automated image curation (vision QC) picks decent images, but the final
// call on the five listing images is a human's. This module powers that flow:
//
//   1. `pnpm cli cruise-media collect`  — per offer, gather ALL image
//      candidates (offer page, homepage, gallery pages) and video candidates
//      (self-hosted mp4/webm/mov ONLY — og:video, <video>/<source>, file links;
//      no YouTube/Vimeo/platform embeds) into `offer_media_candidates`.
//      Idempotent; never touches rows the admin already worked on.
//   2. /admin/media (web) — the admin picks up to 10 images (sort 0 = hero) and
//      optionally one hero video → rows become status='selected'.
//   3. `pnpm cli cruise-media apply` — downloads the selected images,
//      compresses to WebP, uploads to the private bucket, writes
//      cruise_offers.images (+ hero_video_url), marks rows 'applied'.
//      Runs in the daily monitor cron, so selections apply within a day.
//
// Requires migration 20260709000000 (offer_media_candidates, hero_video_url).
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import pLimit from 'p-limit';
import { supabase } from '../lib/supabase.js';
import { discoverImageUrls, downloadImage, processAndStoreImage, type StoredImage } from '../lib/images.js';
import { fetchPage, type FetchedPage } from './extract-cruise-offers.js';
import { closeRenderer } from '../lib/render.js';

const CONCURRENCY = 3;
const MAX_IMAGE_CANDIDATES = 60; // per offer, keeps the admin UI usable
const MAX_SELECTED = 10;

// ---------------------------------------------------------------------------
// Video candidate extraction
// ---------------------------------------------------------------------------
interface VideoCandidate { url: string; note: string }

function normalizeVideoUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    // Direct, self-hosted video files ONLY (user decision 2026-07-09): no
    // YouTube/Vimeo/platform embeds — the app will play plain <video> sources.
    if (/\.(mp4|webm|mov)(\?|$)/i.test(u.pathname)) return u.href;
    return null;
  } catch {
    return null;
  }
}

// Signed CDN URLs that expire within days — useless as a stored hero video
// (Instagram/Facebook reels embeds are the common case).
const EPHEMERAL_HOST_RE = /(cdninstagram\.com|fbcdn\.net)/i;

/** All video candidates in a page's HTML (og:video, <video>/<source>, embeds, links). */
function discoverVideoUrls(html: string, baseUrl: string, pageNote: string): VideoCandidate[] {
  const out = new Map<string, VideoCandidate>();
  const add = (raw: string | undefined | null, how: string) => {
    if (!raw) return;
    // Regexes run on raw HTML → decode entities (&amp; in query strings).
    const decoded = raw.trim().replace(/&amp;/g, '&').replace(/&#38;/g, '&');
    let abs: string;
    try { abs = new URL(decoded, baseUrl).href; } catch { return; }
    if (EPHEMERAL_HOST_RE.test(abs)) return;
    const norm = normalizeVideoUrl(abs);
    if (norm && !out.has(norm)) out.set(norm, { url: norm, note: `${pageNote}: ${how}` });
  };

  for (const m of html.matchAll(/<meta[^>]+property=["']og:video(?::(?:secure_)?url)?["'][^>]+content=["']([^"']+)["']/gi)) add(m[1], 'og:video');
  for (const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::(?:secure_)?url)?["']/gi)) add(m[1], 'og:video');
  for (const m of html.matchAll(/<video[^>]*\ssrc=["']([^"']+)["']/gi)) add(m[1], '<video>');
  for (const m of html.matchAll(/<source[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi)) add(m[1], '<video><source>');
  for (const m of html.matchAll(/<a[^>]*\shref=["']([^"']+\.(?:mp4|webm|mov)(?:\?[^"']*)?)["']/gi)) add(m[1], 'link');
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Collect
// ---------------------------------------------------------------------------
interface OfferRow {
  id: string;
  slug: string;
  title: string;
  source_url: string | null;
  images: StoredImage[] | null;
  cruise_provider_id: string;
  provider: { root_domain: string; website_url: string | null };
}

async function collectForOffer(offer: OfferRow, pageCache: Map<string, FetchedPage | null>): Promise<{ images: number; videos: number }> {
  const homeUrl = offer.provider.website_url ?? `https://${offer.provider.root_domain}`;

  // Pages to scan: offer source page, provider homepage, known gallery pages.
  const pageUrls = new Map<string, string>(); // url → note
  if (offer.source_url) pageUrls.set(offer.source_url.replace(/\/$/, ''), 'offer page');
  pageUrls.set(homeUrl.replace(/\/$/, ''), 'homepage');
  const { data: pgs } = await supabase.from('provider_pages').select('url').eq('cruise_provider_id', offer.cruise_provider_id);
  for (const r of pgs ?? []) {
    const u = (r.url as string).replace(/\/$/, '');
    if (/galer|gallery|fotos|photos|impression|media|video/i.test(u) && !pageUrls.has(u)) pageUrls.set(u, 'gallery page');
  }

  const rows: Array<{ kind: 'image' | 'video'; url: string; origin: string | null; note: string }> = [];

  // Currently-live images first — lets the admin keep/reorder them, and lets
  // apply reuse the already-bucketed file instead of re-downloading.
  for (const img of offer.images ?? []) {
    if (img?.source_url) rows.push({ kind: 'image', url: img.source_url, origin: offer.source_url, note: 'currently live' });
  }

  for (const [url, note] of pageUrls) {
    const cached = pageCache.has(url) ? pageCache.get(url)! : await fetchPage(url);
    pageCache.set(url, cached);
    if (!cached?.html) continue;
    for (const img of discoverImageUrls(cached.html, cached.url).slice(0, MAX_IMAGE_CANDIDATES)) {
      if (EPHEMERAL_HOST_RE.test(img)) continue; // signed IG/FB CDN URLs expire in days
      rows.push({ kind: 'image', url: img, origin: url, note });
    }
    for (const v of discoverVideoUrls(cached.html, cached.url, note)) {
      rows.push({ kind: 'video', url: v.url, origin: url, note: v.note });
    }
  }

  // Dedup by url, cap images.
  const seen = new Set<string>();
  const unique = rows.filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true; });
  const images = unique.filter(r => r.kind === 'image').slice(0, MAX_IMAGE_CANDIDATES);
  const videos = unique.filter(r => r.kind === 'video');

  const toInsert = [...images, ...videos].map(r => ({
    cruise_offer_id: offer.id,
    kind: r.kind,
    url: r.url.slice(0, 2000),
    origin: r.origin,
    note: r.note,
  }));
  // ignoreDuplicates keeps existing rows (and their admin status) untouched.
  for (let i = 0; i < toInsert.length; i += 200) {
    const { error } = await supabase
      .from('offer_media_candidates')
      .upsert(toInsert.slice(i, i + 200), { onConflict: 'cruise_offer_id,url', ignoreDuplicates: true });
    if (error) console.error(`\n  candidates upsert failed (${offer.slug}): ${error.message}`);
  }
  return { images: images.length, videos: videos.length };
}

export async function runCollectMediaCandidates(opts: { domain?: string; limit?: number } = {}): Promise<void> {
  const probe = await supabase.from('offer_media_candidates').select('id').limit(1);
  if (probe.error) {
    console.error('⚠ offer_media_candidates missing — run migration 20260709000000 first.');
    return;
  }

  let q = supabase
    .from('cruise_offers')
    .select('id, slug, title, source_url, images, cruise_provider_id, provider:cruise_providers!inner(root_domain, website_url)');
  if (opts.domain) q = q.eq('cruise_providers.root_domain', opts.domain);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  const offers = (data ?? []) as unknown as OfferRow[];
  console.log(`Collecting media candidates for ${offers.length} offer(s)…`);

  // Share fetched pages per provider (homepage/gallery reused across offers).
  const cacheByProvider = new Map<string, Map<string, FetchedPage | null>>();
  const limit = pLimit(CONCURRENCY);
  let done = 0, ti = 0, tv = 0;
  await Promise.all(offers.map(o => limit(async () => {
    try {
      const cache = cacheByProvider.get(o.cruise_provider_id) ?? new Map();
      cacheByProvider.set(o.cruise_provider_id, cache);
      const { images, videos } = await collectForOffer(o, cache);
      ti += images; tv += videos;
    } catch (err) {
      console.error(`\n  Failed ${o.slug}:`, err instanceof Error ? err.message : err);
    }
    done++;
    process.stdout.write(`\r  ${done}/${offers.length} offers  (${ti} image / ${tv} video candidates)`);
  })));
  console.log();
  await closeRenderer();
}

// ---------------------------------------------------------------------------
// Apply: selected candidates → bucket + cruise_offers.images / hero_video_url
// ---------------------------------------------------------------------------
const hash8 = (s: string) => createHash('md5').update(s).digest('hex').slice(0, 8);

export async function runApplySelectedMedia(opts: { domain?: string } = {}): Promise<void> {
  const probe = await supabase.from('offer_media_candidates').select('id').limit(1);
  if (probe.error) {
    console.error('⚠ offer_media_candidates missing — run migration 20260709000000 first.');
    return;
  }

  // Offers with a pending selection.
  const { data: sel, error } = await supabase
    .from('offer_media_candidates')
    .select('id, cruise_offer_id, kind, url, hero, sort')
    .eq('status', 'selected')
    .order('sort', { ascending: true, nullsFirst: false });
  if (error) throw error;
  if (!sel || sel.length === 0) { console.log('No selected media queued.'); return; }

  const byOffer = new Map<string, typeof sel>();
  for (const s of sel) (byOffer.get(s.cruise_offer_id as string) ?? byOffer.set(s.cruise_offer_id as string, [] as typeof sel).get(s.cruise_offer_id as string)!).push(s);

  console.log(`Applying admin media selection for ${byOffer.size} offer(s)…`);

  for (const [offerId, rows] of byOffer) {
    const { data: offer } = await supabase
      .from('cruise_offers')
      .select('id, slug, images, cruise_provider_id, provider:cruise_providers!inner(root_domain)')
      .eq('id', offerId)
      .single();
    if (!offer) continue;
    const domain = (offer as unknown as { provider: { root_domain: string } }).provider.root_domain;
    if (opts.domain && domain !== opts.domain) continue;

    const current = new Map<string, StoredImage>(
      ((offer.images as StoredImage[] | null) ?? []).filter(i => i?.source_url).map(i => [i.source_url as string, i]),
    );

    const imgRows = rows.filter(r => r.kind === 'image').sort((a, b) => (a.sort ?? 99) - (b.sort ?? 99)).slice(0, MAX_SELECTED);
    const videoRow = rows.find(r => r.kind === 'video' && r.hero) ?? rows.find(r => r.kind === 'video');

    const newImages: StoredImage[] = [];
    const appliedIds: string[] = [];
    let failed = 0;

    for (let i = 0; i < imgRows.length; i++) {
      const r = imgRows[i];
      const reuse = current.get(r.url as string);
      if (reuse) {
        newImages.push({ ...reuse, sort: i });
        appliedIds.push(r.id as string);
        continue;
      }
      const buf = await downloadImage(r.url as string);
      if (!buf) { failed++; console.error(`  download failed: ${(r.url as string).slice(0, 90)}`); continue; }
      const path = `cruise-offers/${offer.cruise_provider_id}/${offer.slug}/a${i}-${hash8(r.url as string)}.webp`;
      const storedImg = await processAndStoreImage(buf, r.url as string, path, i);
      if (!storedImg) { failed++; continue; }
      newImages.push(storedImg);
      appliedIds.push(r.id as string);
    }

    if (imgRows.length > 0 && newImages.length === 0) {
      console.error(`  ✗ ${offer.slug}: every selected image failed — offer left unchanged`);
      continue;
    }

    const patch: Record<string, unknown> = {};
    if (newImages.length > 0) patch.images = newImages.map((img, i) => ({ ...img, sort: i }));
    if (videoRow) { patch.hero_video_url = videoRow.url; appliedIds.push(videoRow.id as string); }

    const { error: upErr } = await supabase.from('cruise_offers').update(patch).eq('id', offerId);
    if (upErr) { console.error(`  ✗ ${offer.slug}: ${upErr.message}`); continue; }
    if (appliedIds.length) {
      await supabase.from('offer_media_candidates').update({ status: 'applied' }).in('id', appliedIds);
    }
    console.log(`  ✓ ${offer.slug}: ${newImages.length} image(s)${videoRow ? ' + hero video' : ''}${failed ? ` (${failed} failed, stay selected)` : ''}`);
  }
}
