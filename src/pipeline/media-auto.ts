// ---------------------------------------------------------------------------
// Automatic media selection for cruise offers (Aaron 2026-11-02: "Ist da mein Input wirklich nötig oder kannst du das
// automatisiert hinbekommen? Sowohl jetzt als auch in Zukunft."). It takes the place of the human pick:
//
//   cruise-media collect  →  cruise-media auto (this file)  →  cruise-media apply   (auto + apply in the daily cron)
//
// /admin/media stays as the optional correction: a save there resets the offer's selection as before.
//
// Per offer with room (fewer than 12 media) and unjudged candidates:
//   1. The live images are the base and stay as they are (rules 1 + 2, media-selection.ts planAutoFill); offers with a
//      pending 'selected' row are left to apply first.
//   2. Free checks: provider's own site only (its domain or site-builder CDN), no stock / AI / floor-plan / screenshot /
//      Flickr or junk file names, no second copy of a live photo (same file stem, e.g. a /v2/ or -scaled copy), no file
//      name that names another destination of the provider or another country. Then download, size filter, same pixels
//      as a live photo or another one.
//   3. Vision on ANALYSIS_MODEL via OpenRouter (the cheap model; OpenRouter's usage.cost is summed):
//      - photos tied to the listing (its own page or its destination page, or the file name names the destination):
//        one call per listing, keep or not and WHERE (generic / this / other / unsure), acceptVerdict decides;
//      - site-wide photos (homepage, general pages): judged once per provider in SHARED_PASSES passes (how much land
//        they show, whether they show a particular place); acceptShared lets through only the photos every pass calls
//        placeless, so no island lands on another island's listing and no home spot of a school on its safari.
//      Both calls also name the boat; a photo of another kind of boat than the listing's vessel_type is left out.
//   4. Write: live base as applied rows, the picks as 'selected' behind it (own-page photos first, then shared ones in
//      the model's order), the rejected rows 'rejected' (still visible and pickable in /admin/media). Photos the model
//      did not see stay 'candidate' for the next run.
// ---------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';
import pLimit from 'p-limit';
import sharp from 'sharp';
import { anthropic, ANALYSIS_MODEL } from '../lib/anthropic.js';
import { dropNearDuplicates, dupFeatures, sameDupPhoto, type DupFeat } from '../lib/image-dedup.js';
import {
  CRUISE_IMAGE_BUCKET, downloadImage, imageIdentity, imageSize, isJunkImageUrl, parseJsonArray, usablePhotoSize,
  visionBatch, visionThumb, type ReserveGroup, type StoredImage,
} from '../lib/images.js';
import { withRetry } from '../lib/retry.js';
import { supabase } from '../lib/supabase.js';
import { isNotOwnPhoto } from '../offers/gallery.js';
import {
  acceptShared, acceptVerdict, boatMismatch, BOATS, cornerCutout, CUTOUT_SIZE, fileNameFlag, fileNamePlaces, foreignCountries,
  isOwnSiteImage, LANDS, listingBoat, photoStem, placeTerms, planAutoFill, PLACES, selectionImageRows, type Boat, type FillPlan, type Land,
  type Place, type SharedVerdict,
} from './media-selection.js';

const VISION_MAX = 16;         // photos per vision call (own-page photos get extra seats, see visionBatch)
// a site-wide photo needs this many agreeing judgements: with 2 the cheap model let a green island through on one run
// and not on the next (Caribbean live run 2026-11-02)
const SHARED_PASSES = 3;
const MAX_DOWNLOADS = 32;      // candidates fetched per offer and run
const DOWNLOAD_CONCURRENCY = 4;

interface OfferRow {
  id: string;
  slug: string;
  title: string;
  country: string | null;
  region: string | null;
  source_url: string | null;
  images: StoredImage[] | null;
  hero_video_url: string | null;
  itinerary_spots: Array<{ name?: string | null }> | null;
  vessel_type: string | null;
  is_active: boolean | null;
  is_reseller: boolean | null;
  cruise_provider_id: string;
  provider: { name: string | null; root_domain: string; website_url: string | null };
}

interface CandRow {
  id: string;
  cruise_offer_id: string;
  kind: string;
  url: string;
  origin: string | null;
  note: string | null;
  status: string;
  sort: number | null;
}

interface Photo {
  row: CandRow;
  /** imageIdentity of the URL: the same homepage photo is one candidate row per offer */
  key: string;
  /** on the offer's own page or its destination page, or the file name names the destination */
  tied: boolean;
  ownPage: boolean;
  sourceUrl: string;
  buf?: Buffer;
  width: number;
  height: number;
  keep?: boolean;
  place?: Place | null;
  land?: Land | null;
  boat?: Boat | null;
  caption?: string | null;
  /** judged as a site-wide photo, once per provider */
  shared?: boolean;
  /** null = accepted */
  reason?: string | null;
}

export interface OfferOutcome {
  offer: OfferRow;
  live: Array<{ url: string; buf: Buffer | null; caption: string | null }>;
  hasVideo: boolean;
  plan: FillPlan | null;
  picked: Photo[];
  spare: Photo[];
  rejected: Photo[];
  unjudged: Photo[];
  costUsd: number;
  note: string | null;
  written: boolean;
}

interface Prepared {
  out: OfferOutcome;
  rows: CandRow[];
  /** judged per listing */
  tied: Photo[];
  /** site-wide photos, judged once per provider */
  shared: Photo[];
  others: OfferRow[];
}

const liveImagesOf = (images: StoredImage[] | null) => [...(images ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
async function isCutout(buf: Buffer): Promise<boolean> {
  try {
    const rgb = await sharp(buf).rotate().resize(CUTOUT_SIZE, CUTOUT_SIZE, { fit: 'fill' }).flatten({ background: '#ffffff' })
      .removeAlpha().raw().toBuffer();
    return cornerCutout(rgb);
  } catch { return false; }
}

const destKey = (o: OfferRow) => `${(o.country ?? '').toLowerCase()}|${(o.region ?? '').toLowerCase()}`;
const destLabel = (o: OfferRow) => (o.region && o.region !== o.country ? `${o.region} (${o.country})` : o.country ?? o.title);
const spotNames = (o: OfferRow) => (o.itinerary_spots ?? []).map(s => s?.name).filter((n): n is string => !!n);
const placeOf = (o: OfferRow) => ({ country: o.country, region: o.region, title: o.title, spots: spotNames(o) });
const termsOf = (o: OfferRow) => placeTerms(placeOf(o));
const hostOf = (u: string | null | undefined) => { try { return u ? new URL(u).hostname : ''; } catch { return ''; } };
const fileOf = (u: string) => { try { return decodeURIComponent(new URL(u).pathname.split('/').pop() ?? u); } catch { return u; } };

// page kinds collect() writes into `note`; the offer's own page and its destination page come first
const NOTE_ORDER = ['offer page', 'destination page', 'gallery page', 'homepage', 'provider page'];
const noteRank = (n: string | null) => { const i = NOTE_ORDER.indexOf(n ?? ''); return i < 0 ? NOTE_ORDER.length : i; };

const KEEP_RULE = `"keep": true for a real, sharp photo that fits a kite-cruise listing: the boat, its cabins or deck, people kiting, foiling, sailing or relaxing on board, or the scenery of the trip. false for logos, icons, badges, maps, text graphics, screenshots, product cut-outs, collages, stock-looking or AI-generated images, portraits, headshots or selfies as the subject, team or staff photos, video stills with a play button, food.`;
const BOAT_RULE = `"boat": the boat in the photo, also when only its deck or cabin shows and you can tell: "catamaran" (two hulls), "monohull" (a sailing yacht with one hull), "motor" (a motor yacht or liveaboard without sails), "traditional" (a wooden gulet or dhow), "other" (a dinghy, RIB or small support boat), "none" (no boat, or too small to tell).`;
const boatOf = (item: Record<string, unknown>) => BOATS.find(b => b === item.boat) ?? null;

async function bucketImage(path: string): Promise<Buffer | null> {
  const { data, error } = await supabase.storage.from(CRUISE_IMAGE_BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

async function featuresOf(buf: Buffer | null | undefined): Promise<DupFeat | null> {
  if (!buf) return null;
  try { return await dupFeatures(buf); } catch { return null; }
}

/** One vision call over `photos` (in this order) with `prompt` after them; the parsed items by photo, and the price. */
async function visionCall(photos: Photo[], label: (p: Photo, i: number) => string, prompt: string):
  Promise<{ items: Map<Photo, Record<string, unknown>>; order: Photo[]; costUsd: number } | null> {
  const blocks: Anthropic.ContentBlockParam[] = [];
  const used: Photo[] = [];
  for (const p of photos) {
    let small: Buffer;
    try { small = await visionThumb(p.buf!); } catch { continue; }
    blocks.push({ type: 'text', text: label(p, used.length) });
    blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/webp', data: small.toString('base64') } });
    used.push(p);
  }
  if (used.length === 0) return { items: new Map(), order: [], costUsd: 0 };
  blocks.push({ type: 'text', text: prompt });

  let costUsd = 0;
  let parsed: Array<Record<string, unknown> | null> | null = null;
  // an empty answer now and then (3 of ~150 calls, 2026-11-10) left a whole provider unjudged: ask once more
  for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
    let text = '';
    try {
      const msg = await withRetry(() =>
        anthropic.messages.create({
          model: ANALYSIS_MODEL,
          max_tokens: 3000,
          // DeepSeek's thinking counts against max_tokens and left no JSON (images.ts visionSelect, 2026-11-02)
          thinking: { type: 'disabled' },
          messages: [{ role: 'user', content: blocks }],
        }),
        4,
        3000,
      );
      text = msg.content.map(b => (b.type === 'text' ? b.text : '')).join('');
      // OpenRouter reports the call's price in usage.cost (USD)
      costUsd += Number((msg.usage as unknown as { cost?: number }).cost ?? 0) || 0;
    } catch (err) {
      console.error(`  vision call failed: ${err instanceof Error ? err.message.slice(0, 160) : err}`);
      return null;
    }
    parsed = parseJsonArray(text) as Array<Record<string, unknown> | null> | null;
    if (!parsed) console.error(`  vision answer without a JSON array (attempt ${attempt}): ${text.slice(0, 160)}`);
  }
  if (!parsed) return null;
  const items = new Map<Photo, Record<string, unknown>>();
  const order: Photo[] = [];
  for (const item of parsed) {
    const i = typeof item?.index === 'number' ? item.index : -1;
    if (i < 0 || i >= used.length || items.has(used[i])) continue;
    items.set(used[i], item!);
    order.push(used[i]);
  }
  return { items, order, costUsd };
}

const captionOf = (item: Record<string, unknown>) => (typeof item.caption === 'string' ? item.caption.slice(0, 80) : null);

// ---------------------------------------------------------------------------
// Per listing: free checks, downloads, duplicates
// ---------------------------------------------------------------------------
async function prepareOffer(o: OfferRow, rows: CandRow[], siblings: OfferRow[], rowsOf: (id: string) => CandRow[]): Promise<Prepared> {
  const live = liveImagesOf(o.images);
  const liveUrls = live.map(i => i.source_url);
  const hasVideo = !!o.hero_video_url;
  const out: OfferOutcome = {
    offer: o, live: live.map(i => ({ url: i.source_url, buf: null, caption: i.caption })), hasVideo, plan: null,
    picked: [], spare: [], rejected: [], unjudged: [], costUsd: 0, note: null, written: false,
  };
  const prepared: Prepared = { out, rows, tied: [], shared: [], others: [] };
  if (live.some(i => !i.source_url)) { out.note = 'a live image has no source_url'; return prepared; }
  out.plan = planAutoFill({ liveUrls, rows, hasVideo, picks: [] });
  if (out.plan.skip) { out.note = out.plan.skip; return prepared; }

  // destinations of the same provider, and every photo they use (same URL or same file)
  const others = siblings.filter(s => s.id !== o.id && destKey(s) !== destKey(o));
  prepared.others = others;
  const ownTerms = termsOf(o);
  const otherTerms = [...new Set(others.flatMap(termsOf))];
  const elsewhere = new Set<string>();
  for (const s of others) {
    for (const u of [...rowsOf(s.id).map(r => r.url), ...liveImagesOf(s.images).map(i => i.source_url)]) {
      elsewhere.add(imageIdentity(u));
      const st = photoStem(u);
      if (st) elsewhere.add(`stem:${st}`);
    }
  }
  const siteHosts = [o.provider.root_domain, hostOf(o.provider.website_url), hostOf(o.source_url)];
  const liveIds = new Set(liveUrls.map(imageIdentity));
  const liveStems = new Set(liveUrls.map(photoStem).filter((s): s is string => !!s));

  const pool: Photo[] = [];
  const poolKeys = new Set<string>();
  const cands = rows.filter(r => r.kind === 'image' && r.status === 'candidate' && !liveUrls.includes(r.url))
    .sort((a, b) => noteRank(a.note) - noteRank(b.note));
  for (const r of cands) {
    const key = imageIdentity(r.url);
    const stem = photoStem(r.url);
    const named = fileNamePlaces(r.url, ownTerms, otherTerms);
    const namedOther = [...named.other, ...foreignCountries(r.url, placeOf(o))];
    const namesOwn = named.own.length > 0;
    const nameFlag = fileNameFlag(r.url);
    const ownPage = (r.note === 'offer page' || r.note === 'destination page') && !elsewhere.has(key) && !(stem && elsewhere.has(`stem:${stem}`));
    const p: Photo = { row: r, key, sourceUrl: r.url, width: 0, height: 0, ownPage, tied: ownPage || namesOwn };
    p.reason =
      !isOwnSiteImage(r.url, siteHosts) ? "not on the provider's own site"
        : isNotOwnPhoto(r.url) ? 'stock / AI / floor-plan file name'
          : nameFlag ? nameFlag
          : isJunkImageUrl(r.url) ? 'logo / icon / food file name'
            : liveIds.has(key) || (stem && liveStems.has(stem)) ? 'same file as a live photo'
              : poolKeys.has(key) || (stem && poolKeys.has(`stem:${stem}`)) ? 'same file as another candidate'
                : namedOther.length && !namesOwn ? `file name names ${namedOther.join(', ')}`
                  : undefined;
    if (p.reason) { out.rejected.push(p); continue; }
    poolKeys.add(key);
    if (stem) poolKeys.add(`stem:${stem}`);
    pool.push(p);
  }

  out.unjudged.push(...pool.splice(MAX_DOWNLOADS));
  const limit = pLimit(DOWNLOAD_CONCURRENCY);
  await Promise.all(pool.map(p => limit(async () => {
    const buf = await downloadImage(p.sourceUrl);
    const size = buf ? await imageSize(buf) : null;
    if (!buf || !size) { p.reason = 'download failed'; return; }
    p.buf = buf;
    p.width = size.width;
    p.height = size.height;
    if (!usablePhotoSize(size.width, size.height)) p.reason = `too small or banner-shaped (${size.width}x${size.height})`;
    else if (await isCutout(buf)) p.reason = 'cut-out on white (product, round portrait or graphic)';
  })));
  await Promise.all(live.map((img, i) => limit(async () => { out.live[i].buf = await bucketImage(img.path); })));
  const liveFeats = await Promise.all(out.live.map(l => featuresOf(l.buf)));
  for (const p of pool) {
    if (p.reason) continue;
    const f = await featuresOf(p.buf);
    const k = f ? liveFeats.findIndex(lf => lf && sameDupPhoto(lf, f)) : -1;
    if (k >= 0) p.reason = `same photo as live #${k + 1}`;
  }
  out.rejected.push(...pool.filter(p => p.reason));
  const dedup = await dropNearDuplicates(pool.filter(p => !p.reason), p => p.buf!);
  for (const d of dedup.dropped) { d.reason = 'same photo as another candidate'; out.rejected.push(d); }

  // a site-wide photo is judged like one shared with other destinations, also for a provider with one listing: a kite
  // school's homepage shows its home spot, not its Red Sea safari (2026-11-02)
  for (const p of dedup.kept) (p.tied ? prepared.tied : prepared.shared).push(p);
  return prepared;
}

// ---------------------------------------------------------------------------
// Vision: photos tied to one listing
// ---------------------------------------------------------------------------
async function judgeTied(prep: Prepared): Promise<Photo[] | null> {
  const o = prep.out.offer;
  const dest = destLabel(o);
  const photos = prep.tied;
  const reserve: ReserveGroup[] = photos.filter(p => p.ownPage).map(p => ({ label: 'own page', urls: [p.sourceUrl] }));
  const batch = visionBatch(photos, reserve, VISION_MAX).map(b => b.img);
  prep.out.unjudged.push(...photos.filter(p => !batch.includes(p)));
  const spots = spotNames(o);
  const otherNames = [...new Set(prep.others.map(destLabel))].join('; ');
  const prompt = `You are choosing extra photos for the listing of this kite cruise:
"${o.title}" by ${o.provider.name ?? o.provider.root_domain}, sailing in ${dest}${spots.length ? ` (stops: ${spots.join(', ')})` : ''}.
${otherNames ? `The same provider also runs cruises in: ${otherNames}.\n` : ''}
The numbered images above are photos from the provider's own website, each with its file name, which often names the place.
Judge EVERY image:
- ${KEEP_RULE}
- "place": WHERE it was taken, judged from the picture AND the file name:
  "generic" = nothing identifies a particular place (deck, cabin, sails, a kiter on open water, sea or sand without a recognisable island, coastline, town or landmark)
  "this" = recognisably ${dest} or one of its stops
  "other" = recognisably somewhere else: the file name or the picture names or shows another island, country or spot${otherNames ? ` (for example ${otherNames})` : ''}
  "unsure" = a particular island, coastline, town or landmark you cannot place
- ${BOAT_RULE}
- "caption": what it shows, at most 8 words.
Respond with ONLY a JSON array, one object per image, the kept photos first and best first:
[{"index": <number>, "keep": <true|false>, "place": "generic|this|other|unsure", "boat": "none|catamaran|monohull|motor|traditional|other", "caption": "..."}]`;
  const label = (p: Photo, i: number) =>
    `Image ${i}: file "${fileOf(p.sourceUrl)}", ${p.ownPage ? `from the ${dest} trip's own page` : "from another page of the provider's site"}`;
  const res = await visionCall(batch, label, prompt);
  if (!res) { prep.out.unjudged.push(...batch); return null; }
  prep.out.costUsd += res.costUsd;
  prep.out.unjudged.push(...batch.filter(p => !res.items.has(p)));
  const accepted: Photo[] = [];
  for (const p of res.order) {
    const item = res.items.get(p)!;
    p.keep = item.keep === true;
    p.place = PLACES.find(x => x === item.place) ?? null;
    p.boat = boatOf(item);
    p.caption = captionOf(item);
    p.reason = acceptVerdict({ keep: p.keep, place: p.place }, { tied: p.tied }) ?? boatMismatch([p.boat], listingBoat(o.vessel_type));
    (p.reason ? prep.out.rejected : accepted).push(p);
  }
  return accepted; // best first, as the model listed them
}

// ---------------------------------------------------------------------------
// Vision: site-wide photos (homepage, general pages), once per provider
// ---------------------------------------------------------------------------
type SharedResult = { reason: string | null; land: Land | null; boats: Array<Boat | null>; caption: string | null };

async function judgeShared(preps: Prepared[]): Promise<{ order: string[]; verdict: Map<string, SharedResult>; judged: Set<string>; costUsd: number }> {
  const result = { order: [] as string[], verdict: new Map<string, SharedResult>(), judged: new Set<string>(), costUsd: 0 };
  // one photo per key (the same homepage photo is a row on every listing)
  const byKey = new Map<string, Photo>();
  for (const prep of preps) for (const p of prep.shared) if (!byKey.has(p.key)) byKey.set(p.key, p);
  if (byKey.size === 0) return result;
  const dedup = await dropNearDuplicates([...byKey.values()], p => p.buf!);
  for (const d of dedup.dropped) result.verdict.set(d.key, { reason: 'same photo as another candidate', land: null, boats: [], caption: null });
  const batch = visionBatch(dedup.kept, [], VISION_MAX).map(b => b.img);
  for (const d of dedup.dropped) result.judged.add(d.key);

  const o = preps[0].out.offer;
  const offers = preps.flatMap(pr => [pr.out.offer, ...pr.others]);
  const destinations = new Set(offers.map(destKey)).size;
  const dests = [...new Set(offers.map(destLabel))].join('; ');
  const prompt = `These photos come from the website of ${o.provider.name ?? o.provider.root_domain}: its homepage and general pages, not the page of a particular trip. It runs kite cruises in: ${dests}.
Such site-wide photos often show another trip, the provider's home spot or its school, so a photo may go on a trip's listing only when nothing in it shows WHERE it was taken.
Judge EVERY image:
- ${KEEP_RULE}
- "land": how much land or shore the photo shows: "none" = only water, sky, the boat or people (a thin line of far-away coast at the horizon counts as none); "background" = some coast, hills or palms behind the main subject, small and not the point of the photo; "prominent" = an island, beach, lagoon, reef, hills, town or landmark fills a large part of the photo or is its subject.
- "place": the island, spot or country that the file name names or that the photo recognisably shows, else null.
- ${BOAT_RULE}
- "caption": what it shows, at most 8 words.
Respond with ONLY a JSON array, one object per image, the kept photos first and best first:
[{"index": <number>, "keep": <true|false>, "land": "none|background|prominent", "place": "<name>" or null, "boat": "none|catamaran|monohull|motor|traditional|other", "caption": "..."}]`;
  const label = (p: Photo, i: number) => `Image ${i}: file "${fileOf(p.sourceUrl)}"`;

  const passes: Array<Map<Photo, SharedVerdict & { boat: Boat | null; caption: string | null }>> = [];
  for (let pass = 0; pass < SHARED_PASSES; pass++) {
    // a different order each pass, so a position effect cannot carry a photo through
    const res = await visionCall(pass % 2 ? [...batch].reverse() : batch, label, prompt);
    if (!res) break;
    result.costUsd += res.costUsd;
    const m = new Map<Photo, SharedVerdict & { boat: Boat | null; caption: string | null }>();
    for (const [p, item] of res.items) {
      const place = typeof item.place === 'string' && item.place.trim() && !/^(null|none|unknown|n\/a)$/i.test(item.place.trim()) ? item.place.trim() : null;
      m.set(p, { keep: item.keep === true, land: LANDS.find(x => x === item.land) ?? null, place, boat: boatOf(item), caption: captionOf(item) });
    }
    if (pass === 0) result.order = res.order.map(p => p.key);
    passes.push(m);
  }
  if (passes.length < SHARED_PASSES) return result; // a failed pass: nothing judged, all stay 'candidate'
  for (const p of batch) {
    const vs = passes.map(m => m.get(p) ?? null);
    if (vs.every(v => !v)) continue; // the model skipped it: next run
    result.judged.add(p.key);
    result.verdict.set(p.key, { reason: acceptShared(vs, { destinations }), land: vs[0]?.land ?? null, boats: vs.map(v => v?.boat ?? null), caption: vs[0]?.caption ?? null });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------
async function writeOutcome(out: OfferOutcome): Promise<string | null> {
  const o = out.offer;
  const plan = out.plan!;
  const liveUrls = out.live.map(l => l.url);

  // An admin save or apply in between wins: re-read the live set and the pending selection.
  const { data: now, error } = await supabase.from('cruise_offers').select('images, hero_video_url').eq('id', o.id).single();
  if (error || !now) return `re-read failed: ${error?.message}`;
  if (JSON.stringify(liveImagesOf(now.images as StoredImage[] | null).map(i => i.source_url)) !== JSON.stringify(liveUrls)
    || !!now.hero_video_url !== out.hasVideo) return 'live set changed meanwhile';
  const { data: pend, error: pErr } = await supabase.from('offer_media_candidates').select('id').eq('cruise_offer_id', o.id).eq('status', 'selected').limit(1);
  if (pErr) return `re-read failed: ${pErr.message}`;
  if (pend?.length) return 'selection pending meanwhile';

  // 1. the live set as applied rows, BEFORE any pick: apply rebuilds from every selected/applied row (rule 1)
  for (const b of plan.base) {
    const res = b.id
      ? await supabase.from('offer_media_candidates').update({ status: 'applied', sort: b.sort, hero: b.hero }).eq('id', b.id)
      : await supabase.from('offer_media_candidates').insert({
        cruise_offer_id: o.id, kind: 'image', url: b.url, origin: o.source_url, note: 'currently live', status: 'applied', sort: b.sort, hero: b.hero,
      });
    if (res.error) return `base write failed: ${res.error.message}`;
  }
  // 2. applied rows that are not live any more leave the set, or apply would bring them back
  if (plan.stale.length) {
    const { error: e } = await supabase.from('offer_media_candidates').update({ status: 'rejected', sort: null, hero: false }).in('id', plan.stale);
    if (e) return `stale write failed: ${e.message}`;
  }
  // 3. the applied set must now BE the live set, in live order; else no pick is written
  const { data: sel, error: sErr } = await supabase.from('offer_media_candidates')
    .select('id, kind, url, status, sort').eq('cruise_offer_id', o.id).in('status', ['selected', 'applied']).not('sort', 'is', null);
  if (sErr) return `base check failed: ${sErr.message}`;
  const base = selectionImageRows((sel ?? []) as CandRow[]).map(r => r.url);
  if (JSON.stringify(base) !== JSON.stringify(liveUrls)) return `base check failed: applied rows ${base.length} != live ${liveUrls.length}`;
  // 4. the picks, behind the live set
  for (const p of plan.picks) {
    const { error: e } = await supabase.from('offer_media_candidates').update({ status: 'selected', sort: p.sort, hero: false }).eq('id', p.id).eq('status', 'candidate');
    if (e) return `pick write failed: ${e.message}`;
  }
  // 5. the rejected ones (still visible and pickable in /admin/media)
  const ids = out.rejected.map(p => p.row.id);
  for (let i = 0; i < ids.length; i += 100) {
    const { error: e } = await supabase.from('offer_media_candidates').update({ status: 'rejected', sort: null, hero: false })
      .in('id', ids.slice(i, i + 100)).eq('status', 'candidate');
    if (e) return `reject write failed: ${e.message}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Contact sheet (dry-run preview for a human)
// ---------------------------------------------------------------------------
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

async function thumb(buf: Buffer | null | undefined, url: string): Promise<string> {
  if (buf) {
    try {
      const t = await sharp(buf, { failOn: 'none' }).rotate().resize({ width: 240, height: 170, fit: 'cover' }).webp({ quality: 62 }).toBuffer();
      return `data:image/webp;base64,${t.toString('base64')}`;
    } catch { /* fall back to the remote file */ }
  }
  return url;
}

const how = (p: Photo) => (p.shared ? `geteilt, Land: ${p.land ?? '?'}` : `${p.place ?? '?'}${p.ownPage ? ', eigene Seite' : p.tied ? ', Dateiname' : ''}`)
  + (p.boat && p.boat !== 'none' ? `, Boot: ${p.boat}` : '');

async function writeSheet(path: string, outcomes: OfferOutcome[], dryRun: boolean, totalUsd: number): Promise<void> {
  const card = (src: string, top: string, sub: string, cls = '') =>
    `<figure class="${cls}"><img loading="lazy" src="${esc(src)}"><figcaption><b>${esc(top)}</b><br>${esc(sub)}</figcaption></figure>`;
  const parts: string[] = [];
  for (const r of outcomes) {
    const o = r.offer;
    const after = r.live.length + r.picked.length + (r.hasVideo ? 1 : 0);
    parts.push(`<section><h2>${esc(o.title)}</h2><p class="meta">${esc(o.id.slice(0, 8))} · ${esc(destLabel(o))} · live ${r.live.length} Bilder${r.hasVideo ? ' + Video' : ''} → <b>${after} Medien</b> · Kosten USD ${r.costUsd.toFixed(4)}${r.note ? ` · ${esc(r.note)}` : ''}</p>`);
    parts.push('<h3>Bleibt (live, unverändert)</h3><div class="row">');
    for (const [i, l] of r.live.entries()) parts.push(card(await thumb(l.buf, l.url), i === 0 ? 'Hero' : `#${i + 1}`, fileOf(l.url), 'live'));
    parts.push('</div><h3>Neu (automatisch, hinten angehängt)</h3><div class="row">');
    for (const [i, p] of r.picked.entries()) parts.push(card(await thumb(p.buf, p.sourceUrl), `#${r.live.length + i + 1} · ${how(p)}`, `${p.caption ?? ''} · ${fileOf(p.sourceUrl)}`, 'pick'));
    if (!r.picked.length) parts.push('<p class="none">keine</p>');
    parts.push('</div>');
    if (r.spare.length) {
      parts.push('<h3>Auch gut, aber kein Platz mehr</h3><div class="row">');
      for (const p of r.spare) parts.push(card(await thumb(p.buf, p.sourceUrl), how(p), `${p.caption ?? ''} · ${fileOf(p.sourceUrl)}`, 'spare'));
      parts.push('</div>');
    }
    parts.push('<h3>Verworfen</h3><div class="row small">');
    // the provider's own file, not embedded: keeps a sheet over many listings small
    for (const p of r.rejected) parts.push(card(p.sourceUrl, p.reason ?? '', `${p.caption ? `${p.caption} · ` : ''}${fileOf(p.sourceUrl)}`, 'rej'));
    parts.push('</div>');
    if (r.unjudged.length) parts.push(`<p class="meta">${r.unjudged.length} Kandidat(en) nicht geprüft (bleiben für den nächsten Lauf)</p>`);
    parts.push('</section>');
  }
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Medien-Auswahl Vorschau</title><style>
:root{--bg:#fff;--fg:#1d2329;--mut:#66707a;--line:#dde2e7;--pick:#1f8a4c}
@media (prefers-color-scheme:dark){:root{--bg:#14181c;--fg:#e6e9ec;--mut:#9aa4ad;--line:#2c333a;--pick:#4cc27f}}
body{background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif;margin:0 16px 40px}
h1{font-size:20px}h2{font-size:17px;margin:28px 0 2px}h3{font-size:13px;color:var(--mut);margin:14px 0 6px;text-transform:uppercase;letter-spacing:.04em}
.meta{color:var(--mut);margin:2px 0}.row{display:flex;flex-wrap:wrap;gap:8px}.none{color:var(--mut)}
figure{margin:0;width:240px;max-width:100%;border:1px solid var(--line);border-radius:6px;overflow:hidden}figure img{display:block;width:100%;height:170px;object-fit:cover}
figcaption{padding:4px 6px;font-size:12px;word-break:break-word}.pick{border:2px solid var(--pick)}.rej{opacity:.75}
.small figure{width:150px}.small figure img{height:106px}section{border-top:1px solid var(--line)}
</style></head><body><h1>Medien-Auswahl ${dryRun ? 'Vorschau (Dry-Run, nichts geschrieben)' : 'Lauf'}</h1>
<p class="meta">${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · Modell ${esc(ANALYSIS_MODEL)} · Kosten gesamt USD ${totalUsd.toFixed(4)}</p>
${parts.join('\n')}</body></html>`;
  writeFileSync(path, html);
  console.log(`  contact sheet: ${path}`);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------
export async function runAutoSelectMedia(opts: {
  domain?: string;
  /** offer id prefixes, comma-separated */
  offer?: string;
  limit?: number;
  dryRun?: boolean;
  sheet?: string;
  /** stop starting new providers after this many minutes (the cron job has a 30-min timeout) */
  maxMinutes?: number;
} = {}): Promise<OfferOutcome[]> {
  const started = Date.now();
  const { data, error } = await supabase
    .from('cruise_offers')
    .select('id, slug, title, country, region, source_url, images, hero_video_url, itinerary_spots, vessel_type, is_active, is_reseller, cruise_provider_id, provider:cruise_providers!inner(name, root_domain, website_url)');
  if (error) throw error;
  const all = ((data ?? []) as unknown as OfferRow[]).filter(o => o.is_active !== false && !o.is_reseller);
  const prefixes = opts.offer?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
  const targets = all.filter(o =>
    (!opts.domain || o.provider.root_domain === opts.domain) && (!prefixes.length || prefixes.some(p => o.id.startsWith(p))));

  const providers = new Set(targets.map(o => o.cruise_provider_id));
  const ids = all.filter(o => providers.has(o.cruise_provider_id)).map(o => o.id);
  const rows: CandRow[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    for (let from = 0; ; from += 1000) {
      const { data: page, error: e } = await supabase.from('offer_media_candidates')
        .select('id, cruise_offer_id, kind, url, origin, note, status, sort')
        .in('cruise_offer_id', ids.slice(i, i + 50)).order('id').range(from, from + 999);
      if (e) throw e;
      rows.push(...((page ?? []) as CandRow[]));
      if (!page || page.length < 1000) break;
    }
  }
  const byOffer = new Map<string, CandRow[]>();
  for (const r of rows) (byOffer.get(r.cruise_offer_id) ?? byOffer.set(r.cruise_offer_id, []).get(r.cruise_offer_id)!).push(r);
  const rowsOf = (id: string) => byOffer.get(id) ?? [];

  // room left and something new to judge; the emptiest listings first, a provider's listings together
  const media = (o: OfferRow) => (o.images?.length ?? 0) + (o.hero_video_url ? 1 : 0);
  let queue = targets.filter(o => media(o) < 12 && rowsOf(o.id).some(r => r.kind === 'image' && r.status === 'candidate'))
    .sort((a, b) => media(a) - media(b) || a.slug.localeCompare(b.slug));
  if (opts.limit) queue = queue.slice(0, opts.limit);
  const groups = new Map<string, OfferRow[]>();
  for (const o of queue) (groups.get(o.cruise_provider_id) ?? groups.set(o.cruise_provider_id, []).get(o.cruise_provider_id)!).push(o);
  console.log(`Auto-selecting media for ${queue.length} offer(s) of ${groups.size} provider(s)${opts.dryRun ? ' (dry run)' : ''}…`);

  const outcomes: OfferOutcome[] = [];
  let cost = 0;
  for (const group of groups.values()) {
    if (opts.maxMinutes && Date.now() - started > opts.maxMinutes * 60_000) {
      console.log(`  time budget of ${opts.maxMinutes} min used, the rest waits for the next run`);
      break;
    }
    const siblings = all.filter(s => s.cruise_provider_id === group[0].cruise_provider_id);
    const preps: Prepared[] = [];
    for (const o of group) {
      try {
        preps.push(await prepareOffer(o, rowsOf(o.id), siblings, rowsOf));
      } catch (err) {
        console.error(`  ✗ ${o.slug}: ${err instanceof Error ? err.message.slice(0, 160) : err}`);
      }
    }
    const open = preps.filter(p => !p.out.plan?.skip && !p.out.note);
    const shared = await judgeShared(open);
    cost += shared.costUsd;
    for (const prep of open) {
      const out = prep.out;
      const tiedAccepted = prep.tied.length ? await judgeTied(prep) : [];
      if (tiedAccepted === null) out.note = 'vision failed for the listing photos';
      cost += out.costUsd;
      out.costUsd += shared.costUsd / open.length; // the provider's shared calls, split over its listings
      const sharedAccepted: Photo[] = [];
      for (const p of prep.shared) {
        p.shared = true;
        if (!shared.judged.has(p.key)) { out.unjudged.push(p); continue; }
        const v = shared.verdict.get(p.key)!;
        // the boat rule is per listing: one provider may sail a catamaran here and a motor yacht there
        p.reason = v.reason ?? boatMismatch(v.boats, listingBoat(out.offer.vessel_type));
        p.land = v.land;
        p.boat = v.boats.find(b => b && b !== 'none') ?? v.boats[0] ?? null;
        p.caption = v.caption;
        (p.reason ? out.rejected : sharedAccepted).push(p);
      }
      sharedAccepted.sort((a, b) => shared.order.indexOf(a.key) - shared.order.indexOf(b.key));
      // listing photos first, then the shared ones; one copy of each photo
      const dd = await dropNearDuplicates([...(tiedAccepted ?? []), ...sharedAccepted], p => p.buf!);
      for (const d of dd.dropped) { d.reason = 'same photo as another pick'; out.rejected.push(d); }
      out.plan = planAutoFill({ liveUrls: out.live.map(l => l.url), rows: prep.rows, hasVideo: out.hasVideo, picks: dd.kept.map(p => p.row.id) });
      const chosen = new Set(out.plan.picks.map(x => x.id));
      out.picked = dd.kept.filter(p => chosen.has(p.row.id));
      out.spare = dd.kept.filter(p => !chosen.has(p.row.id));
    }
    for (const prep of preps) {
      const out = prep.out;
      if (!opts.dryRun && out.plan && !out.plan.skip && (out.plan.picks.length || out.rejected.length)) {
        const err = await writeOutcome(out);
        if (err) out.note = `not written: ${err}`;
        else out.written = true;
      }
      outcomes.push(out);
      const n = out.live.length + (out.hasVideo ? 1 : 0);
      console.log(`  ${out.written || opts.dryRun ? '✓' : '·'} ${out.offer.slug}: ${n} → ${n + out.picked.length} media (+${out.picked.length}, ${out.rejected.length} rejected, ${out.unjudged.length} left)` +
        ` USD ${out.costUsd.toFixed(4)}${out.note ? ` [${out.note}]` : ''}`);
    }
  }
  console.log(`Done: ${outcomes.reduce((s, r) => s + r.picked.length, 0)} photo(s) picked for ${outcomes.filter(r => r.picked.length).length} offer(s), vision USD ${cost.toFixed(4)}` +
    `${opts.dryRun ? ' (dry run: nothing written)' : ' (stored by `cruise-media apply`)'}`);
  if (opts.sheet) await writeSheet(opts.sheet, outcomes, !!opts.dryRun, cost);
  return outcomes;
}
