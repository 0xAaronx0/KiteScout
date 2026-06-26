import pLimit from 'p-limit';
import { parse } from 'node-html-parser';
import { supabase } from '../lib/supabase.js';
import { anthropic, ANALYSIS_MODEL } from '../lib/anthropic.js';
import { extract as tavilyExtract, extractImages as tavilyExtractImages } from '../lib/tavily.js';
import { fetchPageConditional } from '../lib/fetchPage.js';
import { htmlToText, collapse, contentHash, sanitizeForPg, sanitizeDeep } from '../lib/content.js';
import { withRetry } from '../lib/retry.js';
import { countryToContinent } from '../lib/continents.js';
import { discoverImageUrls, curateAndStoreImages, slugify, type StoredImage } from '../lib/images.js';
import { discoverSiteUrls, PAGE_VALUE_RE } from '../lib/crawl.js';

const CONCURRENCY = 3;                  // providers in parallel
const PAGE_CONCURRENCY = 8;             // global page fetches in flight (across providers)
const MAX_CRAWL_PAGES = 70;             // pages crawled + stored per provider
const MAX_CONTENT_CHARS = 60000;        // ranked subset of page text sent to Claude
const NOMINATIM_DELAY_MS = 1200;

// Global limiter so a full-site crawl per provider can't blow up total fetches.
const pageLimit = pLimit(PAGE_CONCURRENCY);

const VESSEL_TYPES = [
  'catamaran', 'sailing_yacht', 'motor_yacht', 'gulet', 'dhow', 'liveaboard', 'speedboat', 'other',
] as const;
const BOOKING_MODES = ['whole_boat', 'per_cabin', 'single_spot'] as const;
const SKILL_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
const WATER_CONDITIONS = ['flat', 'choppy', 'waves'] as const;
const WIND_STRENGTHS = ['light', 'medium', 'strong'] as const;
const COMFORT_LEVELS = ['budget', 'standard', 'premium', 'luxury'] as const;
const MEAL_PLANS = ['all_inclusive', 'full_board', 'half_board', 'self_catering'] as const;
const PRICE_CONFIDENCES = ['high', 'medium', 'low'] as const;
// Pages that hold a (usually destination-tagged) photo gallery.
const GALLERY_URL_RE = /\/(gallery|galerie|galeria|galleria|photos?|fotos?|photo-gallery|media|portfolio|projects?|bilder|impress\w*)\b/i;

// Country -> adjective/demonym, so a gallery image whose only destination clue is
// alt text like "Greek Aegean" still matches the Greece offer. Best-effort; the
// country name itself (often embedded in the filename) is matched too.
const COUNTRY_ADJECTIVES: Record<string, string> = {
  greece: 'greek', italy: 'italian', spain: 'spanish', portugal: 'portuguese',
  croatia: 'croatian', france: 'french', turkey: 'turkish', egypt: 'egyptian',
  morocco: 'moroccan', tunisia: 'tunisian', brazil: 'brazilian', mexico: 'mexican',
  thailand: 'thai', philippines: 'philippine', indonesia: 'indonesian',
  'cape verde': 'verdean', 'cabo verde': 'verdean', tanzania: 'tanzanian',
  kenya: 'kenyan', madagascar: 'malagasy', oman: 'omani', maldives: 'maldivian',
  'sri lanka': 'lankan', cuba: 'cuban', 'dominican republic': 'dominican',
  grenada: 'grenadian', antigua: 'antiguan', australia: 'australian',
};

// Too generic to identify a destination — excluded from gallery-match tokens so
// e.g. "islands" in a Caribbean caption can't pull that shot into a Greece offer.
const GENERIC_GEO = new Set([
  'island', 'islands', 'beach', 'beaches', 'coast', 'waters', 'water', 'ocean',
  'sea', 'lagoon', 'bay', 'reef', 'tropical', 'kiteboarding', 'kitesurfing',
  'catamaran', 'cruise', 'safari', 'luxury', 'paradise',
]);

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
  sleeps_aboard: boolean | null;
  kite_focused: boolean | null;
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
  skill_levels: unknown;
  water_conditions: unknown;
  wind_strength: unknown;
  included_services: unknown;
  optional_services: unknown;
  comfort_level: unknown;
  suitable_for_non_kiters: unknown;
  family_friendly: unknown;
  accommodation: unknown;
  meal_plan: unknown;
  capacity_guests: unknown;
  cabin_count: unknown;
  price_confidence: unknown;
  is_reseller: boolean;
  operated_by: string | null;
  confidence: 'high' | 'medium' | 'low';
}

interface FetchedPage {
  url: string;
  html: string | null; // raw HTML when fetched directly (needed for image discovery)
  text: string;        // readable text for the LLM / stored corpus
  title: string | null;
}

// A title is a stale past-year edition only when EVERY year it names is in the
// past (so "Kitesurf 2018 Cruise" → drop, but "2026 Season" / "2025-2026" stay).
function isStalePastYear(title: string): boolean {
  const years = [...title.matchAll(/\b(20\d{2})\b/g)].map(m => Number(m[1]));
  return years.length > 0 && years.every(y => y < new Date().getFullYear());
}

// Deterministic land-based catch for titles the model wrongly marks sleeps_aboard:
// you can't road-trip on a boat. (Other land trips are caught by sleeps_aboard.)
function isLandByTitle(title: string): boolean {
  return /\broad[\s-]?trip\b/i.test(title);
}

const EXTRACTION_PROMPT = `You are extracting structured KITE-CRUISE OFFERS from a kite travel operator's website.

A kite cruise = participants SLEEP ABOARD a boat (catamaran, gulet, sailing yacht, dhow, motor yacht, liveaboard, etc.) that carries them between kiteboarding spots over multiple days. The boat IS the moving accommodation.

CRITICAL — what is NOT a kite cruise (exclude these, even if the page calls it a "safari" or "trip" and even if it visits several spots over many days):
- Land-based trips/holidays/road-trips where guests sleep in HOTELS, apartments, resorts, or fixed camps on shore (e.g. a "14-day trip along the coast visiting 3 spots" with hotel accommodation, or a "kitesurfing holiday" at one beach).
- Pure sightseeing/sailing cruises or wave-surf-only (non-kite) trips, unless kiteboarding is genuinely a core activity of the trip.
If guests do not sleep on the boat, it is NOT a cruise — leave it out.

The website may be in ANY language (e.g. Spanish "cruceros", German "Kreuzfahrt", French "croisière", Italian "crociera", Portuguese "cruzeiro") — read and extract offers regardless of language, and write all output fields in English.

A single operator may sell SEVERAL distinct offers (different regions, vessels, durations, or seasons). Return one object per genuinely distinct offer. If the site presents a single generic cruise product, return exactly one offer. The SAME boat and itinerary offered both as scheduled/cabin departures AND as a private whole-boat charter is ONE offer — record both ways to book in booking_modes; do NOT split it into separate offers. Offers are distinct only when they differ by region, vessel, or itinerary — not merely by booking mode, departure type, or year. Do NOT invent offers, and do NOT include land-based camps, kite schools, fixed-base lessons, or single day-trips that return to the same harbour each night.

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
  "sleeps_aboard": true if guests sleep ON the boat between spots | false if they stay in land accommodation (hotels/apartments/resorts/camps) | null if genuinely unclear,
  "kite_focused": true if KITEBOARDING is a core activity of THIS trip | false if it is a non-kite trip (pure wave-surfing, sightseeing/leisure, sailing-only, diving-only) | null if unclear,
  "beginner_friendly": true | false | null,
  "kite_lessons": true | false | null,
  "equipment_rental": true | false | null,
  "skill_levels": subset of ["beginner","intermediate","advanced"] this trip suits (from stated difficulty / coaching), or [],
  "water_conditions": subset of ["flat","choppy","waves"] ONLY if the page describes the water at the spots, else [],
  "wind_strength": subset of ["light","medium","strong"] ONLY if the page describes the wind, else [],
  "included_services": short labels of what's included (e.g. "accommodation","all meals","kite instruction","equipment","airport transfers"), or [],
  "optional_services": short labels of paid add-ons, or [],
  "comfort_level": one of ["budget","standard","premium","luxury"] or null,
  "suitable_for_non_kiters": true | false | null,
  "family_friendly": true | false | null,
  "accommodation": "short description of sleeping arrangements (cabin type, ensuite, AC), or null",
  "meal_plan": one of ["all_inclusive","full_board","half_board","self_catering"] or null,
  "capacity_guests": integer max guests, or null,
  "cabin_count": integer number of cabins, or null,
  "price_confidence": one of ["high","medium","low"] — high = explicit per-tier prices on the page, low = vague/"from"/derived; or null,
  "season_text": "the kite / best-season window, e.g. 'April–October', or null",
  "season_start_month": 1-12 or null,
  "season_end_month": 1-12 or null,
  "duration_days": integer or null,
  "dates": [ { "start_date": "YYYY-MM-DD or null", "end_date": "YYYY-MM-DD or null", "price": number or null, "currency": "ISO code or null", "status": "available|sold_out|null" } ] or null,
  "pricing": {
    "options": [ { "label": "tier name, e.g. 'Shared Cabin (Solo Traveler)', 'Private Cabin (2 guests)', 'Whole Boat (6 guests)'", "price": number, "currency": "ISO code", "basis": "per_person|per_cabin|whole_boat|other" } ],
    "per_person": number|null, "per_cabin": number|null, "whole_boat": number|null,
    "currency": "ISO code or null", "raw": "verbatim price phrase or null"
  } or null,
  "price_from_eur": "the LOWEST genuine PER-PERSON price as an integer in EUR (convert USD×0.92, GBP×1.17). Use a real per-person rate only — never divide a per-cabin/whole-boat price to fabricate one. null if no per-person price is shown",
  "currency": "the original quote currency ISO code, or null",
  "summary": "2-3 sentence neutral description of this cruise for a traveler",
  "is_reseller": true | false — true if THIS site merely resells the cruise and it is operated by a THIRD PARTY (e.g. "operated by a trusted partner, not by us", "in cooperation with", "we earn a commission"); false if this operator runs the cruise itself,
  "operated_by": "the actual operator / partner name if the page names them (only when is_reseller is true), else null",
  "confidence": "high" | "medium" | "low"
}

PRICING: capture EVERY pricing tier shown — solo/shared cabin, private cabin, whole boat, etc. — in pricing.options, each with its amount, currency and basis. Prices often live on a dedicated pricing/rates page included in the content below; apply a price block only to the specific offer it belongs to (a pricing page that names a destination or duration applies only to that offer). Report only amounts actually shown — never invent or divide to fabricate a number.

SEASON: for the availability window use the offer's stated best / kite season (e.g. a 'Best Season: Apr–Oct' fact, or 'from April to October'). Do NOT report a generic 'year-round' / 'all year' / 'open all year' phrase as the season when a specific best-season window is given.

CONDITIONS: only fill water_conditions / wind_strength when the page actually describes the spots' water or wind — do NOT guess from the destination; leave [] otherwise (a separate region-level step infers conditions). Infer skill_levels from difficulty / coaching wording. Other attributes (services, comfort_level, meal_plan, accommodation, capacity) — extract only when stated; null / [] otherwise.

RESELLER: many sites resell other operators' cruises as affiliates. If the page indicates the trip is operated by a third party / partner and this site merely books it or earns a commission, set is_reseller=true (and operated_by to the partner's name if stated). Set is_reseller=false only when this operator clearly runs the boat itself.

Confidence: high = explicitly sold as a kite cruise/liveaboard; medium = strongly implied multi-day boat trip; low = inferred from partial info.

Respond with ONLY the JSON array — no preamble, no explanation, no markdown fences. Begin your reply with [ and end with ]. If no kite-cruise offers exist, respond with [].`;

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
// Tavily image candidates per page (cached so offers sharing a source page
// don't trigger duplicate Tavily calls within one provider run).
const tavilyImageCache = new Map<string, string[]>();
async function getTavilyImages(url: string): Promise<string[]> {
  const cached = tavilyImageCache.get(url);
  if (cached) return cached;
  const imgs = await tavilyExtractImages(url);
  tavilyImageCache.set(url, imgs);
  return imgs;
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

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

/** Fetch a page directly; fall back to Tavily text only when allowed (cost control). */
async function fetchPage(url: string, allowTavily = true): Promise<FetchedPage | null> {
  const res = await fetchPageConditional(url);
  if (res.status === 'ok' && res.html) {
    const text = htmlToText(res.html);
    if (text.length > 150) return { url, html: res.html, text, title: extractTitle(res.html) };
  }
  if (allowTavily) {
    const md = await tavilyExtract(url);
    if (md) return { url, html: null, text: collapse(md), title: null };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Destination-tagged gallery images
// ---------------------------------------------------------------------------
/** Lowercased tokens that identify an offer's destination (country + adjective, region, spots). */
function destinationTokens(
  country: string | null,
  region: string | null,
  spots: Array<{ name?: unknown }>,
): string[] {
  const out = new Set<string>();
  const add = (s: unknown): void => {
    if (typeof s !== 'string') return;
    const n = s.toLowerCase().trim();
    if (n.length >= 4 && !GENERIC_GEO.has(n)) out.add(n);
    for (const w of n.split(/[^a-z]+/)) if (w.length >= 5 && !GENERIC_GEO.has(w)) out.add(w);
  };
  if (country) {
    const c = country.toLowerCase().trim();
    if (c.length >= 4) out.add(c);
    if (COUNTRY_ADJECTIVES[c]) out.add(COUNTRY_ADJECTIVES[c]);
  }
  add(region);
  for (const s of spots ?? []) add(s?.name);
  return [...out].filter(t => t.length >= 4);
}

/** Collect candidate images (with their alt/filename label) from a provider's gallery pages. */
async function collectGalleryCandidates(galleryPages: FetchedPage[]): Promise<Array<{ url: string; label: string }>> {
  const out: Array<{ url: string; label: string }> = [];
  const seen = new Set<string>();
  for (const p of galleryPages) {
    if (p.html) {
      for (const img of parse(p.html).querySelectorAll('img')) {
        const raw = img.getAttribute('src') ?? img.getAttribute('data-src') ?? img.getAttribute('data-lazy-src');
        const abs = raw ? absolutize(raw, p.url) : null;
        if (!abs || seen.has(abs)) continue;
        seen.add(abs);
        out.push({ url: abs, label: img.getAttribute('alt') ?? '' });
      }
    }
    // Tavily renders the gallery and surfaces images the static HTML lazy-loads;
    // their filenames frequently carry the destination (e.g. "greece:img-...").
    for (const u of await getTavilyImages(p.url)) {
      if (seen.has(u)) continue;
      seen.add(u);
      out.push({ url: u, label: '' });
    }
  }
  return out;
}

/** Gallery image URLs whose filename or alt text matches the offer's destination tokens. */
function galleryUrlsForOffer(gallery: Array<{ url: string; label: string }>, tokens: string[]): string[] {
  if (tokens.length === 0) return [];
  const matched: string[] = [];
  for (const g of gallery) {
    let hay = g.label.toLowerCase();
    try { hay += ' ' + decodeURIComponent(g.url).toLowerCase(); } catch { hay += ' ' + g.url.toLowerCase(); }
    if (tokens.some(t => hay.includes(t))) matched.push(g.url);
  }
  return matched;
}

async function crawlProvider(homeUrl: string, rootDomain: string): Promise<FetchedPage[]> {
  const { urls } = await discoverSiteUrls(homeUrl, rootDomain, MAX_CRAWL_PAGES);
  const norm = (u: string): string => u.replace(/\/$/, '');
  // Belt-and-suspenders: a few high-value paths in case the sitemap omits them.
  const probes = ['/pricing', '/prices', '/rates', '/gallery', '/destinations/gallery', '/photos']
    .map(p => `https://${rootDomain}${p}`);
  const all = [...new Set([norm(homeUrl), ...urls.map(norm), ...probes])];

  const pages: FetchedPage[] = [];
  await Promise.all(all.map(u => pageLimit(async () => {
    // Reserve the paid Tavily fallback for the homepage + traveller-relevant pages.
    const allowTavily = norm(u) === norm(homeUrl) || PAGE_VALUE_RE.test(u);
    const p = await fetchPage(u, allowTavily);
    if (p) pages.push(p);
  })));
  return pages;
}

/** Persist the full crawled text as the per-provider corpus (provider_pages). */
async function storeCorpus(providerId: string, pages: FetchedPage[]): Promise<void> {
  const rows = pages
    .filter(p => p.text && p.text.length > 0)
    .map(p => ({
      cruise_provider_id: providerId,
      url: p.url,
      title: p.title ? sanitizeForPg(p.title) : null,
      text: sanitizeForPg(p.text),
      content_hash: contentHash(p.text),
      fetched_at: new Date().toISOString(),
    }));
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('provider_pages')
    .upsert(rows, { onConflict: 'cruise_provider_id,url' });
  if (error) console.error(`\n  corpus error (${providerId}):`, error.message);
}

// ---------------------------------------------------------------------------
// Claude offer extraction
// ---------------------------------------------------------------------------
const PRICING_URL_RE = /\/(pricing|prices|rates|fares?|booking)\b/i;
// Genuine cruise/boat pages (any language) — ranked ABOVE broader trip/safari
// pages so the real boat-cruise page is never truncated out by, e.g., a pile of
// land-based "safari" pages competing for the content budget.
const CRUISE_PAGE_RE = /(cruise|crucero|cruzeiro|kreuzfahrt|croisi|crociera|liveaboard|catamar|[\s/-]sail|segel)/i;
// Pages that actually define offers — ranked just after pricing so every
// destination/trip page survives the content budget, ahead of about/contact/faq.
// Multilingual cruise/trip stems so non-English sites (ES "cruceros", DE
// "kreuzfahrt", FR "croisière", IT "crociera", PT "cruzeiro", "viaje"/"reise"…)
// rank their cruise pages high instead of getting truncated out of the budget.
const OFFER_PAGE_RE =
  /(destination|trip|cruise|crucero|cruzeiro|kreuzfahrt|croisi|crociera|safari|liveaboard|itinerar|package|tour|viaje|viagg|viagem|reise|voyage|oferta|velero|segel|camp|[\s/-]sail)/i;

function buildContent(pages: FetchedPage[], homeUrl: string): string {
  // Fit the most relevant pages into the LLM budget: homepage, then pricing,
  // then other traveller-relevant pages, then the rest. The FULL crawl is stored
  // in provider_pages regardless of what makes it into this subset.
  const home = homeUrl.replace(/\/$/, '');
  const rank = (p: FetchedPage): number => {
    if (p.url.replace(/\/$/, '') === home) return 0;
    if (PRICING_URL_RE.test(p.url)) return 1;
    if (CRUISE_PAGE_RE.test(p.url)) return 2;   // genuine cruise pages first (any language)
    if (OFFER_PAGE_RE.test(p.url)) return 3;
    if (PAGE_VALUE_RE.test(p.url)) return 4;
    return 5;
  };
  const ordered = [...pages].sort((a, b) => rank(a) - rank(b));

  let combined = '';
  for (const p of ordered) {
    const section = `=== PAGE: ${p.url} ===\n${p.text}\n\n`;
    if (combined.length + section.length > MAX_CONTENT_CHARS) {
      combined += section.slice(0, Math.max(0, MAX_CONTENT_CHARS - combined.length));
      break;
    }
    combined += section;
  }
  return combined;
}

export async function extractOffers(
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
        max_tokens: 16000,  // multi-offer providers with rich fields exceed 8192 → truncated JSON
        system: [{ type: 'text', text: EXTRACTION_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [
          {
            role: 'user',
            content: `Provider: ${providerName}\nPAGES (use these exact URLs for source_page):\n${pageUrls.join('\n')}\n\nContent:\n${content}`,
          },
        ],
      }),
      5,    // more patient retries: ride out sporadic 529 overloads during a sweep
      3000,
    );
    text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  } catch (err) {
    console.error(`  Claude error for ${providerName}:`, err);
    return [];
  }

  const parsed = parseOfferArray(text);
  if (parsed.length === 0 && text.includes('{')) {
    console.error(`  JSON parse salvaged 0 offers for ${providerName}:`, text.slice(0, 160));
  }
  return parsed
    .filter((o): o is ExtractedOffer =>
      !!o && typeof (o as ExtractedOffer).title === 'string' && (o as ExtractedOffer).title.trim().length > 0 &&
      ['high', 'medium', 'low'].includes((o as ExtractedOffer).confidence))
    // Drop land-based trips/holidays the model flagged as not sleeping aboard,
    // and archived past-year editions (e.g. "Kitesurf 2018 Cruise").
    .filter(o => {
      if (o.sleeps_aboard === false || isLandByTitle(o.title)) {
        console.log(`  ↷ skip (land-based, not a cruise): ${o.title.trim()}`);
        return false;
      }
      if (o.kite_focused === false) {
        console.log(`  ↷ skip (non-kite cruise): ${o.title.trim()}`);
        return false;
      }
      if (isStalePastYear(o.title)) {
        console.log(`  ↷ skip (archived past-year edition): ${o.title.trim()}`);
        return false;
      }
      return true;
    })
    .map(o => ({ ...o, title: o.title.trim() }));
}

/**
 * Parse the model's JSON array of offers, tolerating two failure modes seen in
 * the wild: (1) the array wrapped in prose/markdown fences, and (2) the response
 * truncated at max_tokens mid-array. On a strict-parse failure we salvage every
 * COMPLETE top-level {...} object (scanning balanced braces outside strings) and
 * drop the trailing incomplete one — so one cut-off offer never zeroes the rest.
 */
function parseOfferArray(raw: string): unknown[] {
  const cleaned = raw.replace(/```/g, '');
  const start = cleaned.indexOf('[');
  if (start < 0) return [];
  const end = cleaned.lastIndexOf(']');
  const sliced = end > start ? cleaned.slice(start, end + 1) : cleaned.slice(start);
  try {
    const p = JSON.parse(sliced);
    return Array.isArray(p) ? p : [];
  } catch {
    const objs: unknown[] = [];
    let depth = 0, objStart = -1, inStr = false, esc = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') { if (depth === 0) objStart = i; depth++; }
      else if (ch === '}') {
        if (depth > 0 && --depth === 0 && objStart >= 0) {
          try { objs.push(JSON.parse(cleaned.slice(objStart, i + 1))); } catch { /* skip incomplete */ }
          objStart = -1;
        }
      }
    }
    return objs;
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

function cleanStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/** Filter to non-empty strings; when `allowed` is given, normalize + keep only allowed values. */
function cleanStrArray(arr: unknown, allowed?: readonly string[]): string[] {
  if (!Array.isArray(arr)) return [];
  const vals = arr
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map(s => (allowed ? s.toLowerCase().trim().replace(/[\s-]+/g, '_') : s.trim()));
  const kept = allowed ? vals.filter(v => (allowed as readonly string[]).includes(v)) : vals;
  return [...new Set(kept)];
}

function cleanEnum(v: unknown, allowed: readonly string[]): string | null {
  if (typeof v !== 'string') return null;
  const n = v.toLowerCase().trim().replace(/[\s-]+/g, '_');
  return (allowed as readonly string[]).includes(n) ? n : null;
}

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_PAT =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

function monthToNum(m: string): number | null {
  const map: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  return map[m.toLowerCase().slice(0, 3)] ?? null;
}

/**
 * Deterministic season from a page's "Best Season: Apr - Oct"-style fact, so the
 * stored season doesn't flip run-to-run on the LLM's whim. Prefers an explicit
 * best/kite season label; falls back to a wind-season range. Null if none found.
 */
export function parseBestSeason(text: string): { text: string; start: number; end: number } | null {
  for (const label of ['best\\s*season', 'kite\\s*season', 'riding\\s*season', 'wind\\s*season']) {
    const re = new RegExp(
      `${label}[\\s:>\\-]{0,8}${MONTH_PAT}\\s*(?:-|to|through|[\\u2013\\u2014])\\s*${MONTH_PAT}`,
      'i',
    );
    const m = text.match(re);
    const a = m ? monthToNum(m[1]) : null;
    const b = m ? monthToNum(m[2]) : null;
    if (a && b) return { text: `${MONTH_NAMES[a]}–${MONTH_NAMES[b]}`, start: a, end: b };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Process one provider end-to-end
// ---------------------------------------------------------------------------
async function processProvider(cp: {
  id: string;
  name: string | null;
  root_domain: string;
  website_url: string | null;
}, dryRun = false): Promise<number> {
  const homeUrl = cp.website_url ?? `https://${cp.root_domain}`;
  const name = cp.name ?? cp.root_domain;

  const pages = await crawlProvider(homeUrl, cp.root_domain);
  if (pages.length === 0) return 0;
  const pageByUrl = new Map(pages.map(p => [p.url, p]));

  // Persist the full crawled corpus (independent of how many offers we find).
  if (!dryRun) await storeCorpus(cp.id, pages);

  const content = buildContent(pages, homeUrl);
  const offers = await extractOffers(content, name, pages.map(p => p.url));
  if (offers.length === 0) return 0;

  // Dry run: print what would be stored (pricing / season / source text), no writes.
  if (dryRun) {
    for (const offer of offers) {
      const srcUrl = (offer.source_page && pageByUrl.has(offer.source_page)) ? offer.source_page : homeUrl;
      const src = pageByUrl.get(srcUrl);
      const bs = src?.text ? parseBestSeason(src.text) : null;
      const pricing = (offer.pricing && typeof offer.pricing === 'object')
        ? (offer.pricing as Record<string, unknown>) : null;
      console.log(`\n• ${offer.title}  [${offer.confidence}]${offer.is_reseller ? `  ⚠ RESELLER (operated by: ${offer.operated_by ?? '?'})` : ''}`);
      const sText = bs ? bs.text : (offer.season_text ?? '-');
      const sMonths = bs ? `${bs.start}-${bs.end}` : `${offer.season_start_month}-${offer.season_end_month}`;
      console.log(`   season  : ${sText}  (${sMonths})${bs ? ' [from page]' : ''}`);
      console.log(`   from EUR: ${offer.price_from_eur ?? '-'}  | currency: ${offer.currency ?? '-'}`);
      console.log(`   options : ${JSON.stringify(pricing?.options ?? [])}  priceConf=${cleanEnum(offer.price_confidence, PRICE_CONFIDENCES)}`);
      console.log(`   attrs   : skill=${JSON.stringify(cleanStrArray(offer.skill_levels, SKILL_LEVELS))} water=${JSON.stringify(cleanStrArray(offer.water_conditions, WATER_CONDITIONS))} wind=${JSON.stringify(cleanStrArray(offer.wind_strength, WIND_STRENGTHS))} comfort=${cleanEnum(offer.comfort_level, COMFORT_LEVELS)} meal=${cleanEnum(offer.meal_plan, MEAL_PLANS)} cap=${cleanInt(offer.capacity_guests)} nonKiter=${cleanBool(offer.suitable_for_non_kiters)} family=${cleanBool(offer.family_friendly)}`);
      console.log(`   services: incl=${JSON.stringify(cleanStrArray(offer.included_services))} opt=${JSON.stringify(cleanStrArray(offer.optional_services))} | accom=${cleanStr(offer.accommodation) ? '"' + cleanStr(offer.accommodation)!.slice(0, 40) + '"' : '-'}`);
      console.log(`   source  : ${srcUrl}  (text ${src?.text?.length ?? 0} chars)`);
    }
    return offers.length;
  }

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

  // Destination-tagged gallery images (collected once, matched per offer).
  const galleryPages = pages.filter(p => GALLERY_URL_RE.test(p.url));
  let galleryCands: Array<{ url: string; label: string }> | null = null;
  const getGallery = async (): Promise<Array<{ url: string; label: string }>> => {
    if (galleryCands === null) galleryCands = await collectGalleryCandidates(galleryPages);
    return galleryCands;
  };

  // Whole-site image pool (lazy) — used for single-location providers, where every
  // kite/boat photo on the site belongs to the one offer. Static images from every
  // crawled page + Tavily-rendered images from the homepage and gallery pages.
  let siteImagesCache: string[] | null = null;
  const getSiteImages = async (): Promise<string[]> => {
    if (siteImagesCache) return siteImagesCache;
    const urls: string[] = [];
    const seen = new Set<string>();
    const push = (u: string): void => { if (!seen.has(u)) { seen.add(u); urls.push(u); } };
    for (const p of pages) if (p.html) for (const u of discoverImageUrls(p.html, p.url)) push(u);
    for (const t of new Set<string>([homeUrl, ...galleryPages.map(p => p.url)])) {
      for (const u of await getTavilyImages(t)) push(u);
    }
    siteImagesCache = urls;
    return urls;
  };

  // Lazily-curated homepage hero, reused as a fallback so a provider's offers are
  // never left completely imageless when their own page yields nothing usable.
  let homepageFallback: StoredImage[] | null = null;
  const getHomepageFallback = async (): Promise<StoredImage | null> => {
    if (homepageFallback === null) {
      // pages[] is in crawl-completion order, so pages[0] is not necessarily the
      // homepage — find it explicitly (fall back to the first crawled page).
      const home = pages.find(p => p.url.replace(/\/$/, '') === homeUrl.replace(/\/$/, '')) ?? pages[0];
      const candidates = [
        ...(home?.html ? discoverImageUrls(home.html, home.url) : []),
        ...(await getTavilyImages(home.url)),
      ];
      homepageFallback = candidates.length > 0
        ? await curateAndStoreImages({
            candidateUrls: candidates,
            providerId: cp.id,
            slug: '_homepage',
            sourceUrl: home.url,
            context: `${name} — homepage header / main hero image (kite cruise operator)`,
            max: 1,
          })
        : [];
    }
    return homepageFallback[0] ?? null;
  };

  // Single-location provider → use the whole site's kite/boat imagery for its offer.
  const singleOffer = offers.length === 1;
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

    // Resolve the offer's source page (used for images + the stored source_text).
    const srcUrl = (offer.source_page && pageByUrl.has(offer.source_page))
      ? offer.source_page
      : homeUrl;
    const srcPage = pageByUrl.get(srcUrl) ?? pages[0];

    // Deterministic best-season from the offer's page overrides the flaky LLM guess.
    const bestSeason = srcPage?.text ? parseBestSeason(srcPage.text) : null;

    // Images: reuse if already stored, else discover (gallery + own page + Tavily) + curate.
    let images: StoredImage[] = existingImages.get(slug) ?? [];
    const imgCtx = `${offer.title} — kite cruise${offer.country ? ' in ' + offer.country : ''}` +
      `${offer.region ? ', ' + offer.region : ''}${offer.vessel_type ? ', ' + offer.vessel_type : ''}`;
    if (images.length === 0) {
      // Destination-tagged gallery shots first — they're the most location-specific.
      const tokens = destinationTokens(offer.country ?? null, offer.region ?? null, rawSpots);
      const galleryCandidates = galleryUrlsForOffer(await getGallery(), tokens);
      const staticCandidates = srcPage?.html
        ? discoverImageUrls(srcPage.html, srcPage.url, offer.page_anchor)
        : [];
      const tavilyCandidates = await getTavilyImages(srcUrl);
      // Single-location provider: widen to the whole site (vision keeps only the
      // boat/kiting shots). Multi-offer providers stay destination-scoped.
      const candidates = singleOffer
        ? [...(await getSiteImages()), ...tavilyCandidates]
        : [...galleryCandidates, ...staticCandidates, ...tavilyCandidates];
      if (candidates.length > 0) {
        images = await curateAndStoreImages({
          candidateUrls: candidates,
          providerId: cp.id,
          slug,
          sourceUrl: srcUrl,
          context: imgCtx,
          maxDownloads: singleOffer ? 24 : undefined,
        });
      }
    }

    // Multi-offer provider whose destination-scoped pool came up empty (e.g. a
    // JS/Wix site whose offer page exposes no usable image): widen to the whole
    // site's boat/location imagery — vision keeps only the relevant shots — so the
    // offer still gets nice boat + location pics rather than nothing.
    if (images.length === 0 && !singleOffer) {
      const wide = [...(await getSiteImages()), ...(await getTavilyImages(srcUrl))];
      if (wide.length > 0) {
        images = await curateAndStoreImages({
          candidateUrls: wide,
          providerId: cp.id,
          slug,
          sourceUrl: srcUrl,
          context: imgCtx,
          maxDownloads: 24,
        });
      }
    }

    // Never leave an offer completely imageless: fall back to the operator's
    // homepage hero when its own page yielded nothing usable.
    if (images.length === 0) {
      const fb = await getHomepageFallback();
      if (fb) images = [{ ...fb, sort: 0, fallback: true }];
    }

    const row = {
      cruise_provider_id: cp.id,
      title: offer.title,
      slug,
      source_url: srcUrl,
      source_text: srcPage?.text ? sanitizeForPg(srcPage.text) : null,
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
      season_text: bestSeason ? bestSeason.text : (offer.season_text ?? null),
      season_start_month: bestSeason ? bestSeason.start : cleanMonth(offer.season_start_month),
      season_end_month: bestSeason ? bestSeason.end : cleanMonth(offer.season_end_month),
      duration_days: cleanInt(offer.duration_days),
      dates: offer.dates ?? null,
      pricing: offer.pricing ?? null,
      price_from_eur: cleanInt(offer.price_from_eur),
      currency: offer.currency ?? null,
      summary: offer.summary ?? null,
      skill_levels: cleanStrArray(offer.skill_levels, SKILL_LEVELS),
      water_conditions: cleanStrArray(offer.water_conditions, WATER_CONDITIONS),
      wind_strength: cleanStrArray(offer.wind_strength, WIND_STRENGTHS),
      included_services: cleanStrArray(offer.included_services),
      optional_services: cleanStrArray(offer.optional_services),
      comfort_level: cleanEnum(offer.comfort_level, COMFORT_LEVELS),
      suitable_for_non_kiters: cleanBool(offer.suitable_for_non_kiters),
      family_friendly: cleanBool(offer.family_friendly),
      accommodation: cleanStr(offer.accommodation),
      meal_plan: cleanEnum(offer.meal_plan, MEAL_PLANS),
      capacity_guests: cleanInt(offer.capacity_guests),
      cabin_count: cleanInt(offer.cabin_count),
      price_confidence: cleanEnum(offer.price_confidence, PRICE_CONFIDENCES),
      is_reseller: offer.is_reseller === true,
      operated_by: typeof offer.operated_by === 'string' ? offer.operated_by : null,
      images,
      extraction_confidence: offer.confidence,
    };

    const { error } = await supabase
      .from('cruise_offers')
      // Deep-sanitize so a NUL/control char in ANY field (incl. jsonb: images
      // rights, pricing, dates, itinerary_spots) can't fail the upsert.
      .upsert(sanitizeDeep(row), { onConflict: 'cruise_provider_id,slug' });
    if (error) {
      console.error(`\n  DB error for ${cp.root_domain} / ${slug}:`, error.message);
    } else {
      stored++;
    }
  }

  // Prune this provider's offers from earlier runs whose title (slug) changed,
  // so re-running the sweep doesn't accumulate duplicate offers. Only runs when
  // we successfully extracted at least one offer (we never wipe on a failed run).
  if (usedSlugs.size > 0) {
    const list = [...usedSlugs].map(s => `"${s}"`).join(',');
    const { error: pruneErr } = await supabase
      .from('cruise_offers')
      .delete()
      .eq('cruise_provider_id', cp.id)
      .not('slug', 'in', `(${list})`);
    if (pruneErr) console.error(`\n  prune error for ${cp.root_domain}:`, pruneErr.message);
  }

  return stored;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export async function runExtractCruiseOffers(
  opts: { domain?: string; limit?: number; dryRun?: boolean } = {},
): Promise<{ providers: number; offers: number }> {
  let pq = supabase
    .from('cruise_providers')
    .select('id, name, root_domain, website_url')
    .in('status', ['new', 'verified']);
  if (opts.domain) pq = pq.eq('root_domain', opts.domain);
  if (opts.limit) pq = pq.limit(opts.limit);
  const { data: cruiseProviders, error } = await pq;

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
          const n = await processProvider(cp, opts.dryRun);
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
