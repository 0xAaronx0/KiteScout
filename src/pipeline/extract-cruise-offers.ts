import pLimit from 'p-limit';
import { parse } from 'node-html-parser';
import { supabase } from '../lib/supabase.js';
import { anthropic, ANALYSIS_MODEL } from '../lib/anthropic.js';
import { extract as tavilyExtract } from '../lib/tavily.js';
import { fetchPageConditional } from '../lib/fetchPage.js';
import { htmlToText, collapse } from '../lib/content.js';
import { withRetry } from '../lib/retry.js';
import { countryToContinent } from '../lib/continents.js';
import { discoverImageUrls, curateAndStoreImages, slugify, type StoredImage } from '../lib/images.js';

const CONCURRENCY = 3;
const MAX_INTERNAL_PAGES = 10;         // internal pages crawled per provider (+ homepage)
const MAX_CONTENT_CHARS = 24000;       // combined page text sent to Claude
const NOMINATIM_DELAY_MS = 1200;

const VESSEL_TYPES = [
  'catamaran', 'sailing_yacht', 'motor_yacht', 'gulet', 'dhow', 'liveaboard', 'speedboat', 'other',
] as const;
const BOOKING_MODES = ['whole_boat', 'per_cabin', 'single_spot'] as const;
const LINK_KEY_RE =
  /(cruise|liveaboard|safari|trip|voyage|expedition|itinerary|sailing|boat|booking|book-now|dates|prices?|packages?|fleet|yacht)/i;

interface ItinerarySpot {
  name: string;
  country: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  order: number;
}

interface ExtractedOffer {
  title: string;
  source_page: string | null;
  page_anchor: string | null;
  country: string | null;
  region: string | null;
  countries: string[];
  departure_port: string | null;
  itinerary_spots: Array<{ name: string; country: string | null; region: string | null; order: number }>;
  vessel_name: string | null;
  vessel_type: string | null;
  booking_modes: string[];
  beginner_friendly: boolean | null;
  kite_lessons: boolean | null;
  equipment_rental: boolean | null;
  season_text: string | null;
  season_start_month: number | null;
  season_end_month: number | null;
  duration_days: number | null;
  dates: unknown;
  pricing: unknown;
  price_from_eur: number | null;
  currency: string | null;
  summary: string;
  confidence: 'high' | 'medium' | 'low';
}

interface FetchedPage {
  url: string;
  html: string | null; // raw HTML when fetched directly (needed for image discovery)
  text: string;        // readable text for the LLM
}

const EXTRACTION_PROMPT = `You are extracting structured KITE-CRUISE OFFERS from a kite travel operator's website.

A kite cruise = participants travel by boat (catamaran, gulet, sailing yacht, dhow, motor yacht, liveaboard, etc.) between kiteboarding spots, typically sleeping on board, over multiple days.

A single operator may sell SEVERAL distinct offers (different regions, vessels, durations, or seasons). Return one object per genuinely distinct offer. If the site presents a single generic cruise product, return exactly one offer. Do NOT invent offers, and do NOT include land-based camps, kite schools, fixed-base lessons, or single day-trips that return to the same harbour each night.

For each offer, extract this exact JSON shape (use null when the site does not state something — never guess):
{
  "title": "Concise offer name, e.g. 'Grenadines 8-Day Kite Cruise'",
  "source_page": "the URL (from the PAGES list below) where this offer is described",
  "page_anchor": "the heading or short link text the offer appears under, or null",
  "country": "primary country of the itinerary, or null",
  "region": "primary region / island group, or null",
  "countries": ["every country the itinerary visits"],
  "departure_port": "home/embarkation port, or null",
  "itinerary_spots": [
    { "name": "named stop/anchorage/kite spot the cruise visits", "country": "or null", "region": "or null", "order": 0 }
  ],
  "vessel_name": "boat name, or null",
  "vessel_type": one of ["catamaran","sailing_yacht","motor_yacht","gulet","dhow","liveaboard","speedboat","other"] or null,
  "booking_modes": subset of ["whole_boat","per_cabin","single_spot"] that this offer supports,
  "beginner_friendly": true | false | null,
  "kite_lessons": true | false | null,
  "equipment_rental": true | false | null,
  "season_text": "human availability window, e.g. 'June–September', or null",
  "season_start_month": 1-12 or null,
  "season_end_month": 1-12 or null,
  "duration_days": integer or null,
  "dates": [ { "start_date": "YYYY-MM-DD or null", "end_date": "YYYY-MM-DD or null", "price": number or null, "currency": "ISO code or null", "status": "available|sold_out|null" } ] or null,
  "pricing": { "per_person": number|null, "per_cabin": number|null, "whole_boat": number|null, "currency": "ISO code or null", "raw": "verbatim price phrase or null" } or null,
  "price_from_eur": "lowest per-person price as an integer in EUR; if quoted in USD multiply by ~0.92, GBP by ~1.17; null if no price",
  "currency": "the original quote currency ISO code, or null",
  "summary": "2-3 sentence neutral description of this cruise for a traveler",
  "confidence": "high" | "medium" | "low"
}

Confidence: high = explicitly sold as a kite cruise/liveaboard; medium = strongly implied multi-day boat trip; low = inferred from partial info.

Respond with ONLY a JSON array. If no kite-cruise offers exist, respond with [].`;

// ---------------------------------------------------------------------------
// Geocoding (shared throttle + cache), mirrors extract-cruise-locations
// ---------------------------------------------------------------------------
const geocodeCache = new Map<string, { lat: number; lng: number } | null>();

async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  if (!query.trim()) return null;
  if (geocodeCache.has(query)) return geocodeCache.get(query)!;
  await new Promise(r => setTimeout(r, NOMINATIM_DELAY_MS));
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'KiteScout/1.0 kite-cruise-map' } });
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (data[0]) {
      const coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      geocodeCache.set(query, coords);
      return coords;
    }
  } catch {
    // non-fatal
  }
  geocodeCache.set(query, null);
  return null;
}

// ---------------------------------------------------------------------------
// Crawl: homepage + cruise-relevant internal pages
// ---------------------------------------------------------------------------
function absolutize(src: string, baseUrl: string): string | null {
  try {
    const u = new URL(src.trim(), baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

function discoverInternalLinks(html: string, baseUrl: string, rootDomain: string): string[] {
  const root = parse(html);
  const links = new Set<string>();
  for (const a of root.querySelectorAll('a')) {
    const href = a.getAttribute('href');
    if (!href) continue;
    const abs = absolutize(href, baseUrl);
    if (!abs) continue;
    let host: string;
    try { host = new URL(abs).hostname.replace(/^www\./, ''); } catch { continue; }
    if (host !== rootDomain) continue;
    if (LINK_KEY_RE.test(abs) || LINK_KEY_RE.test(a.text)) {
      links.add(abs.split('#')[0]);
    }
  }
  return [...links];
}

/** Fetch a single page directly; fall back to Tavily text if blocked. */
async function fetchPage(url: string): Promise<FetchedPage | null> {
  const res = await fetchPageConditional(url);
  if (res.status === 'ok' && res.html) {
    const text = htmlToText(res.html);
    if (text.length > 150) return { url, html: res.html, text };
  }
  const md = await tavilyExtract(url);
  if (md) return { url, html: null, text: collapse(md) };
  return null;
}

async function crawlProvider(homeUrl: string, rootDomain: string): Promise<FetchedPage[]> {
  const home = await fetchPage(homeUrl);
  const pages: FetchedPage[] = home ? [home] : [];

  if (home?.html) {
    const candidates = discoverInternalLinks(home.html, homeUrl, rootDomain)
      .filter(u => u.split('#')[0] !== homeUrl.replace(/\/$/, '') && u !== homeUrl)
      .slice(0, MAX_INTERNAL_PAGES);
    for (const url of candidates) {
      const p = await fetchPage(url);
      if (p) pages.push(p);
    }
  } else {
    // Homepage unavailable as HTML — try the usual cruise paths directly.
    for (const path of ['/cruises', '/trips', '/kite-cruise', '/liveaboard']) {
      const p = await fetchPage(`https://${rootDomain}${path}`);
      if (p) pages.push(p);
    }
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Claude offer extraction
// ---------------------------------------------------------------------------
function buildContent(pages: FetchedPage[]): string {
  let combined = '';
  for (const p of pages) {
    const section = `=== PAGE: ${p.url} ===\n${p.text}\n\n`;
    if (combined.length + section.length > MAX_CONTENT_CHARS) {
      combined += section.slice(0, Math.max(0, MAX_CONTENT_CHARS - combined.length));
      break;
    }
    combined += section;
  }
  return combined;
}

async function extractOffers(
  content: string,
  providerName: string,
  pageUrls: string[],
): Promise<ExtractedOffer[]> {
  if (!content.trim()) return [];
  let text: string;
  try {
    const msg = await withRetry(() =>
      anthropic.messages.create({
        model: ANALYSIS_MODEL,
        max_tokens: 4096,
        system: [{ type: 'text', text: EXTRACTION_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          content: `Provider: ${providerName}\nPAGES (use these exact URLs for source_page):\n${pageUrls.join('\n')}\n\nContent:\n${content}`,
        }],
      }),
    );
    text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  } catch (err) {
    console.error(`  Claude error for ${providerName}:`, err);
    return [];
  }

  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((o): o is ExtractedOffer =>
        o && typeof o.title === 'string' && o.title.trim().length > 0 &&
        ['high', 'medium', 'low'].includes(o.confidence))
      .map(o => ({ ...o, title: o.title.trim() }));
  } catch {
    console.error(`  JSON parse failed for ${providerName}:`, json.slice(0, 200));
    return [];
  }
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------
function cleanVesselType(v: string | null): string | null {
  return v && (VESSEL_TYPES as readonly string[]).includes(v) ? v : null;
}

function cleanBookingModes(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.filter(m => (BOOKING_MODES as readonly string[]).includes(m)))] as string[];
}

function toNumber(n: unknown): number | null {
  if (typeof n === 'number' && Number.isFinite(n)) return n;
  if (typeof n === 'string') {
    const parsed = parseFloat(n.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function cleanMonth(n: unknown): number | null {
  const v = toNumber(n);
  return v !== null && v >= 1 && v <= 12 ? Math.round(v) : null;
}

function cleanInt(n: unknown): number | null {
  const v = toNumber(n);
  return v !== null ? Math.round(v) : null;
}

function cleanBool(b: unknown): boolean | null {
  return typeof b === 'boolean' ? b : null;
}

// ---------------------------------------------------------------------------
// Process one provider end-to-end
// ---------------------------------------------------------------------------
async function processProvider(cp: {
  id: string;
  name: string | null;
  root_domain: string;
  website_url: string | null;
}): Promise<number> {
  const homeUrl = cp.website_url ?? `https://${cp.root_domain}`;
  const name = cp.name ?? cp.root_domain;

  const pages = await crawlProvider(homeUrl, cp.root_domain);
  if (pages.length === 0) return 0;
  const pageByUrl = new Map(pages.map(p => [p.url, p]));

  const content = buildContent(pages);
  const offers = await extractOffers(content, name, pages.map(p => p.url));
  if (offers.length === 0) return 0;

  // Existing offers for this provider → reuse already-stored images (no re-churn).
  const { data: existing } = await supabase
    .from('cruise_offers')
    .select('slug, images')
    .eq('cruise_provider_id', cp.id);
  const existingImages = new Map<string, StoredImage[]>();
  for (const row of existing ?? []) {
    if (Array.isArray(row.images) && row.images.length > 0) {
      existingImages.set(row.slug, row.images as StoredImage[]);
    }
  }

  const usedSlugs = new Set<string>();
  let stored = 0;

  for (const offer of offers) {
    // Unique slug within the provider.
    let slug = slugify(offer.title);
    if (usedSlugs.has(slug)) {
      let i = 2;
      while (usedSlugs.has(`${slug}-${i}`)) i++;
      slug = `${slug}-${i}`;
    }
    usedSlugs.add(slug);

    const continent = countryToContinent(offer.country);

    // Itinerary spots (best-effort geocode).
    const spots: ItinerarySpot[] = [];
    const rawSpots = Array.isArray(offer.itinerary_spots) ? offer.itinerary_spots : [];
    for (let i = 0; i < rawSpots.length; i++) {
      const s = rawSpots[i];
      if (!s || typeof s.name !== 'string' || !s.name.trim()) continue;
      const country = typeof s.country === 'string' ? s.country : null;
      const region = typeof s.region === 'string' ? s.region : null;
      const coords = await geocode([s.name, region, country].filter(Boolean).join(', '));
      spots.push({
        name: s.name.trim(),
        country,
        region,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        order: typeof s.order === 'number' ? s.order : i,
      });
    }

    // Images: reuse if already stored, else discover (context-scoped) + curate.
    let images: StoredImage[] = existingImages.get(slug) ?? [];
    if (images.length === 0) {
      const srcUrl = (offer.source_page && pageByUrl.has(offer.source_page))
        ? offer.source_page
        : homeUrl;
      const srcPage = pageByUrl.get(srcUrl) ?? pages[0];
      if (srcPage?.html) {
        const candidates = discoverImageUrls(srcPage.html, srcPage.url, offer.page_anchor);
        const ctx = `${offer.title} — kite cruise${offer.country ? ' in ' + offer.country : ''}` +
          `${offer.region ? ', ' + offer.region : ''}${offer.vessel_type ? ', ' + offer.vessel_type : ''}`;
        images = await curateAndStoreImages({
          candidateUrls: candidates,
          providerId: cp.id,
          slug,
          sourceUrl: srcPage.url,
          context: ctx,
        });
      }
    }

    const row = {
      cruise_provider_id: cp.id,
      title: offer.title,
      slug,
      source_url: (offer.source_page && pageByUrl.has(offer.source_page)) ? offer.source_page : homeUrl,
      continent,
      country: offer.country ?? null,
      region: offer.region ?? null,
      countries: Array.isArray(offer.countries) ? offer.countries.filter(c => typeof c === 'string') : [],
      departure_port: offer.departure_port ?? null,
      itinerary_spots: spots,
      vessel_name: offer.vessel_name ?? null,
      vessel_type: cleanVesselType(offer.vessel_type),
      booking_modes: cleanBookingModes(offer.booking_modes),
      beginner_friendly: cleanBool(offer.beginner_friendly),
      kite_lessons: cleanBool(offer.kite_lessons),
      equipment_rental: cleanBool(offer.equipment_rental),
      season_text: offer.season_text ?? null,
      season_start_month: cleanMonth(offer.season_start_month),
      season_end_month: cleanMonth(offer.season_end_month),
      duration_days: cleanInt(offer.duration_days),
      dates: offer.dates ?? null,
      pricing: offer.pricing ?? null,
      price_from_eur: cleanInt(offer.price_from_eur),
      currency: offer.currency ?? null,
      summary: offer.summary ?? null,
      images,
      extraction_confidence: offer.confidence,
    };

    const { error } = await supabase
      .from('cruise_offers')
      .upsert(row, { onConflict: 'cruise_provider_id,slug' });
    if (error) {
      console.error(`\n  DB error for ${cp.root_domain} / ${slug}:`, error.message);
    } else {
      stored++;
    }
  }

  return stored;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export async function runExtractCruiseOffers(): Promise<{ providers: number; offers: number }> {
  const { data: cruiseProviders, error } = await supabase
    .from('cruise_providers')
    .select('id, name, root_domain, website_url')
    .in('status', ['new', 'verified']);

  if (error) throw error;
  if (!cruiseProviders || cruiseProviders.length === 0) {
    console.log('No cruise providers found.');
    return { providers: 0, offers: 0 };
  }

  console.log(`Extracting offers from ${cruiseProviders.length} cruise providers…`);

  const limit = pLimit(CONCURRENCY);
  let done = 0;
  let totalOffers = 0;

  await Promise.all(
    cruiseProviders.map(cp =>
      limit(async () => {
        try {
          const n = await processProvider(cp);
          totalOffers += n;
        } catch (err) {
          console.error(`\n  Failed ${cp.root_domain}:`, err instanceof Error ? err.message : err);
        }
        done++;
        process.stdout.write(`\r  ${done}/${cruiseProviders.length} providers  (${totalOffers} offers)`);
      }),
    ),
  );

  console.log();
  return { providers: cruiseProviders.length, offers: totalOffers };
}
