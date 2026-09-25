// ---------------------------------------------------------------------------
// bstoked.net listings (camps, tours, accommodation, …) → package_offers.
//
// bstoked is server-rendered: the listing page carries the structured blocks
// (kite conditions, trip characteristics, prose sections, payment/cancellation
// policy, rating, lat/lng) and lazy-loads the rest through plain GET partials
// (/listings/{images,services,accommodations,itinerary,languages,videos,
// hostdata}/?id=). No JS rendering, no login. Not public: review texts and the
// host's business identity (first name only).
//
//   pnpm cli bstoked-packages list                 # all listings with type/price
//   pnpm cli bstoked-packages scrape <id|slug> …    # dry run → JSON on stdout / --out
//   pnpm cli bstoked-packages seed <id|slug> …      # images → bucket, upsert rows
// ---------------------------------------------------------------------------
import { parse, type HTMLElement } from 'node-html-parser';
import { supabase } from '../lib/supabase.js';
import { withRetry } from '../lib/retry.js';
import { countryToContinent } from '../lib/continents.js';
import { geocodeSpot } from '../lib/geocode.js';
import { downloadImage, processAndStoreImage, slugify, type StoredImage } from '../lib/images.js';

const BASE = 'https://bstoked.net';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_IMAGES = 12; // the KCS app renders at most 12 media
// A geocoded tour stop further than this from the pickup is a homonym, not the stop.
const MAX_STOP_DISTANCE_KM = 800;

export type PackageType = 'camp' | 'tour' | 'accommodation' | 'experience' | 'course' | 'cruise';

const TYPE_BY_LABEL: Record<string, PackageType> = {
  camp: 'camp', camps: 'camp',
  tour: 'tour', tours: 'tour',
  accommodation: 'accommodation',
  experience: 'experience', experiences: 'experience',
  course: 'course', courses: 'course', 'courses & rentals': 'course',
  cruise: 'cruise', cruises: 'cruise',
};

const KITE_SERVICE_BY_TITLE: Record<string, string> = {
  'gear rental': 'gear_rental',
  'gear storage': 'gear_storage',
  'lessons or coaching': 'lessons',
  'spot guidance': 'spot_guidance',
  'rescue service': 'rescue',
};

const SUITABLE_FOR: Record<string, string> = {
  'solo traveler': 'solo', group: 'group', family: 'family', couple: 'couple', 'non-rider': 'non_rider',
};

const WIND: Record<string, string> = { light: 'light', moderate: 'medium', strong: 'strong' };

const SPOT: Record<string, string> = {
  shallow: 'shallow', flat: 'flat', 'small waves': 'small_waves', 'big waves': 'big_waves', choppy: 'choppy',
};
const WATER_FROM_SPOT: Record<string, string> = {
  flat: 'flat', choppy: 'choppy', small_waves: 'waves', big_waves: 'waves',
};

// ---------------------------------------------------------------------------
// fetch + text helpers
// ---------------------------------------------------------------------------
async function fetchHtml(path: string, partial = false): Promise<string> {
  return withRetry(async () => {
    const res = await fetch(BASE + path, {
      headers: { 'User-Agent': UA, ...(partial ? { 'X-Requested-With': 'XMLHttpRequest' } : {}) },
    });
    if (!res.ok) throw new Error(`bstoked ${res.status} for ${path}`);
    return res.text();
  }, 2, 1500);
}

/** Partials are optional sections; a failing one must not sink the listing. */
async function fetchPartial(path: string): Promise<HTMLElement | null> {
  try {
    const html = await fetchHtml(path, true);
    return html.trim() ? parse(html) : null;
  } catch (err) {
    console.warn(`  partial failed ${path}: ${(err as Error).message}`);
    return null;
  }
}

function clean(s: string | undefined | null): string {
  return (s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const oneLine = (s: string | undefined | null) => clean(s).replace(/\s+/g, ' ');

function splitList(s: string): string[] {
  return s.split(',').map(x => oneLine(x)).filter(Boolean);
}

function mapList(values: string[], map: Record<string, string>): string[] {
  const out: string[] = [];
  for (const v of values) {
    const m = map[v.toLowerCase()];
    if (m && !out.includes(m)) out.push(m);
  }
  return out;
}

function parsePrice(raw: string): number | null {
  const n = parseFloat(raw.replace(/[^\d.,]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const CURRENCY_BY_SYMBOL: Record<string, string> = { '€': 'EUR', '$': 'USD', '£': 'GBP' };

// ---------------------------------------------------------------------------
// search cards (the full public catalogue)
// ---------------------------------------------------------------------------
export interface BstokedCard {
  id: string;
  path: string;
  type: PackageType | null;
  typeLabel: string;
  title: string;
  locationLabel: string;
  windProbability: string | null;
  priceLabel: string | null;
}

export async function listBstokedCards(): Promise<BstokedCard[]> {
  const seen = new Map<string, BstokedCard>();
  for (let page = 1; page <= 30; page++) {
    const root = parse(await fetchHtml(`/listings/search/?page=${page}`));
    let added = 0;
    for (const card of root.querySelectorAll('div.card.card-listing')) {
      const id = card.getAttribute('data-id');
      if (!id || seen.has(id)) continue;
      const titleA = card.querySelector('.card-title a');
      const statCols = card.querySelectorAll('.stats .col-3');
      const typeLabel = oneLine(statCols[0]?.querySelector('.text')?.text);
      const windCol = statCols.find(c => c.querySelector('i.bs-wind'));
      const price = card.querySelector('.price');
      seen.set(id, {
        id,
        path: titleA?.getAttribute('href') ?? `/listings/${id}/`,
        type: TYPE_BY_LABEL[typeLabel.toLowerCase()] ?? null,
        typeLabel,
        title: oneLine(titleA?.text),
        locationLabel: oneLine(card.querySelector('.card-loc a')?.text),
        windProbability: windCol ? oneLine(windCol.querySelector('.text')?.text) || null : null,
        priceLabel: price ? oneLine(`${price.text} ${price.nextElementSibling?.text ?? ''}`) : null,
      });
      added++;
    }
    if (added === 0) break;
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// listing detail
// ---------------------------------------------------------------------------
export interface CancellationTier {
  min_days_before: number | null;
  max_days_before: number | null;
  refund_pct: number;
}

export interface BstokedListing {
  package_type: PackageType;
  title: string;
  slug: string;
  source: 'bstoked';
  source_listing_id: string;
  source_url: string;
  continent: string | null;
  country: string | null;
  region: string | null;
  location_label: string | null;
  lat: number | null;
  lng: number | null;
  pickup_location: string | null;
  itinerary_spots: unknown[];
  itineraries: { title: string; days: { title: string; text: string }[] }[];
  skill_levels: string[];
  wind_strength: string[];
  water_conditions: string[];
  spot_conditions: string[];
  wind_probability: string | null;
  kite_services: string[];
  kite_lessons: boolean | null;
  equipment_rental: boolean | null;
  conditions_text: string | null;
  suitable_for: string[];
  suitable_for_non_kiters: boolean | null;
  family_friendly: boolean | null;
  ambience: string[];
  experience_types: string[];
  meal_plan: string | null;
  dietary_options: string[];
  flight_search_assistance: boolean | null;
  languages: string[];
  included_services: string[];
  optional_services: string[];
  extra_expenses: string[];
  accommodation: string | null;
  rooms: { name: string; description: string | null; features: string[] }[];
  duration_nights: number | null;
  price_from: number | null;
  price_currency: string | null;
  price_unit: 'package' | 'per_night' | 'per_day' | 'other' | null;
  price_basis_note: string | null;
  pricing: Record<string, unknown> | null;
  payment_terms: string | null;
  deposit_pct: number | null;
  cancellation_policy: CancellationTier[];
  summary: string | null;
  description_sections: { heading: string; text: string }[];
  video_urls: string[];
  host_name: string | null;
  host_source_id: string | null;
  host_member_since: string | null;
  host_response_rate: number | null;
  host_response_time: string | null;
  host_verified: boolean | null;
  bstoked_rating: number | null;
  bstoked_review_count: number | null;
  source_text: string;
  /** full-size bstoked CDN URLs in host order (first = cover); stored to the bucket on seed */
  image_urls: string[];
}

interface JsonLd { '@type'?: string; [k: string]: unknown }

function readJsonLd(root: HTMLElement): JsonLd[] {
  const out: JsonLd[] = [];
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try { out.push(JSON.parse(s.text)); } catch { /* malformed block → skip */ }
  }
  return out;
}

interface StructuredItem { icon: string; label: string; value: string }

/** A page block = a muted label column + `.listing-structured` items + prose paragraphs. */
function readBlocks(root: HTMLElement): Map<string, { items: StructuredItem[]; prose: string[] }> {
  const blocks = new Map<string, { items: StructuredItem[]; prose: string[] }>();
  for (const b of root.querySelectorAll('div.b-b.block')) {
    const label = oneLine(b.querySelector('.col-md-3')?.text).toLowerCase();
    if (!label) continue;
    const items = b.querySelectorAll('.listing-structured > div').map(item => {
      const muted = oneLine(item.querySelector('.text-muted')?.text);
      const value = oneLine(item.text).replace(muted, '').trim();
      return {
        icon: (item.querySelector('i')?.getAttribute('title') ?? '').toLowerCase(),
        label: muted.replace(/:$/, '').toLowerCase(),
        value,
      };
    });
    const prose = b.querySelectorAll('p.line-break').map(p => clean(p.text)).filter(Boolean);
    blocks.set(label, { items, prose });
  }
  return blocks;
}

function parseCancellation(text: string): CancellationTier[] {
  const tiers: CancellationTier[] = [];
  const re =
    /(\d+)\s*%\s*refund for cancellations\s+(?:of more than\s+(\d+)\s+days|between\s+(\d+)\s+days and\s+(\d+)\s+days|less than\s+(\d+)\s+days)/gi;
  for (const m of text.matchAll(re)) {
    const pct = Number(m[1]);
    if (m[2]) tiers.push({ min_days_before: Number(m[2]), max_days_before: null, refund_pct: pct });
    else if (m[3]) tiers.push({ min_days_before: Number(m[4]), max_days_before: Number(m[3]), refund_pct: pct });
    else tiers.push({ min_days_before: 0, max_days_before: Number(m[5]), refund_pct: pct });
  }
  return tiers;
}

function youtubeWatchUrl(src: string): string | null {
  const m = src.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,})/);
  return m ? `https://www.youtube.com/watch?v=${m[1]}` : null;
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Ordered stops from a route's day titles ("Days 4-5 Delta do Parnaíba" →
 * "Delta do Parnaíba"; "Jericoacora/Macapá" → two stops). Coordinates only when
 * the geocode lands within MAX_STOP_DISTANCE_KM of the listing's anchor;
 * otherwise the name stays and lat/lng stay null (a wrong pin is worse).
 */
async function itinerarySpots(
  route: { days: { title: string }[] } | undefined,
  country: string | null,
  anchor: { lat: number; lng: number } | null,
): Promise<{ name: string; country: string | null; region: null; lat: number | null; lng: number | null; order: number }[]> {
  const names: string[] = [];
  for (const d of route?.days ?? []) {
    const place = d.title.replace(/^days?\s*\d+(\s*[-–]\s*\d+)?\s*[-–:]?\s*/i, '').trim();
    if (!place || /^(airport|departures?|arrival|transfer|kitesurfing)\b/i.test(place)) continue;
    for (const n of place.split('/').map(x => x.trim()).filter(Boolean)) if (!names.includes(n)) names.push(n);
  }
  const spots = [];
  for (const [order, name] of names.entries()) {
    const hit = await geocodeSpot(name, null, country);
    const ok = hit && (!anchor || distanceKm(anchor, hit) <= MAX_STOP_DISTANCE_KM);
    spots.push({ name, country, region: null, lat: ok ? hit.lat : null, lng: ok ? hit.lng : null, order });
  }
  return spots;
}

export async function scrapeBstokedListing(ref: string, card?: BstokedCard): Promise<BstokedListing> {
  const path = ref.startsWith('/') ? ref : `/listings/${ref.replace(/^\/+|\/+$/g, '')}/`;
  const html = await fetchHtml(path);
  const root = parse(html);
  const main = root.querySelector('main') ?? root;

  const id = root.querySelector('#bookForm')?.getAttribute('data-id') ?? (/^\d+$/.test(ref) ? ref : null);
  if (!id) throw new Error(`no listing id found on ${path}`);

  // ---- JSON-LD: product (name/price/currency) + breadcrumb (country, type) ----
  const ld = readJsonLd(root);
  const product = ld.find(d => d['@type'] === 'Product') as
    | { name?: string; offers?: { price?: string; priceCurrency?: string } }
    | undefined;
  const crumbs = ((ld.find(d => d['@type'] === 'BreadcrumbList')?.itemListElement ?? []) as {
    item: { '@id': string; name: string };
  }[]).map(c => c.item);
  const country = crumbs.find(c => c['@id'].includes('/locations/'))?.name ?? null;

  // ---- type: the "similar listings" partial carries it as a query param ----
  const typeParam = html.match(/\/listings\/similar\/\?[^"]*?type=([A-Za-z]+)/)?.[1];
  const typeCrumb = crumbs.find(c => c['@id'].includes('/listings/search'))?.name;
  const package_type =
    TYPE_BY_LABEL[(typeParam ?? '').toLowerCase()] ??
    TYPE_BY_LABEL[(typeCrumb ?? '').toLowerCase()] ??
    card?.type;
  if (!package_type) throw new Error(`unknown listing type on ${path}`);

  const title = oneLine(root.querySelector('header h1')?.text) || oneLine(product?.name);
  // the .lead line also carries the rating widget → take only the location span
  const location_label = oneLine(root.querySelector('header .lead .text-m')?.text) || card?.locationLabel || null;
  let region: string | null = null;
  if (location_label && country && location_label !== country && location_label.endsWith(`, ${country}`)) {
    region = location_label.slice(0, -(country.length + 2)).trim() || null;
  }

  // ---- coordinates (windy widget; map iframe centre as fallback) ----
  const windy = root.querySelector('[data-windywidget]');
  let lat = windy ? Number(windy.getAttribute('data-lat')) : NaN;
  let lng = windy ? Number(windy.getAttribute('data-lng')) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const c = html.match(/center=(-?\d+\.\d+),(-?\d+\.\d+)/);
    lat = c ? Number(c[1]) : NaN;
    lng = c ? Number(c[2]) : NaN;
  }

  // ---- summary + structured blocks ----
  const summaryH = main.querySelectorAll('h4').find(h => oneLine(h.text) === 'Summary');
  const summary = clean(summaryH?.parentNode?.querySelector('.line-break')?.text) || null;

  const blocks = readBlocks(main);
  const cond = [...blocks.entries()].find(([k]) => k.includes('conditions'))?.[1];
  const trip = blocks.get('trip characteristics');

  let skill_levels: string[] = [];
  let wind_strength: string[] = [];
  let spot_conditions: string[] = [];
  const kite_services: string[] = [];
  for (const it of cond?.items ?? []) {
    if (it.icon === 'skill level') skill_levels = splitList(it.value).map(s => s.toLowerCase());
    else if (it.label === 'wind') wind_strength = mapList(splitList(it.value), WIND);
    else if (it.label === 'spot') spot_conditions = mapList(splitList(it.value), SPOT);
    else if (KITE_SERVICE_BY_TITLE[it.icon]) kite_services.push(KITE_SERVICE_BY_TITLE[it.icon]);
  }
  const water_conditions = [...new Set(spot_conditions.map(s => WATER_FROM_SPOT[s]).filter(Boolean))];

  const tripValue = (label: string) => trip?.items.find(i => i.label === label)?.value ?? null;
  const suitable_for = mapList(splitList(tripValue('suitable for') ?? ''), SUITABLE_FOR);
  const lower = (s: string | null) => splitList(s ?? '').map(x => x.toLowerCase());

  // ---- prose sections (The Destination / The Experience / Accommodation / …) ----
  const sections: { heading: string; text: string }[] = [];
  for (const b of main.querySelectorAll('div.block.py-1')) {
    const h = b.querySelector('h4');
    const body = b.querySelector('.line-break');
    if (h && body) sections.push({ heading: oneLine(h.text), text: clean(body.text) });
  }
  const accSection = sections.find(s => s.heading.toLowerCase() === 'accommodation');

  // ---- policy + rating + price, from the flattened page text ----
  const pageText = clean(main.structuredText);
  const flat = pageText.replace(/\s+/g, ' ');
  const payment_terms = flat.match(/Payment Terms (.+?) Cancellation Policy/)?.[1]?.trim() ?? null;
  const deposit = payment_terms?.match(/(\d+)\s*%\s*upfront/i)?.[1];
  const ratingEl = main.querySelector('strong.pr-025');
  const reviewCount = flat.match(/\b(\d+) reviews?\b/)?.[1];

  const priceBox = main.querySelector('.d-m-none');
  const priceRaw = oneLine(priceBox?.text) || null; // "From €1279 / 7 nights"
  const unitRaw = (priceRaw?.split('/')[1] ?? '').trim().toLowerCase();
  const nights = unitRaw.match(/^(\d+)\s+nights?$/)?.[1];
  const days = unitRaw.match(/^(\d+)\s+days?$/)?.[1];
  const price_unit: BstokedListing['price_unit'] = !priceRaw
    ? null
    : nights || days ? 'package'
    : unitRaw.startsWith('per night') ? 'per_night'
    : unitRaw.startsWith('per day') ? 'per_day'
    : 'other';
  // The displayed amount is bstoked's EUR display price. JSON-LD carries the same
  // number but labels it with the host's own currency (e.g. "USD 1872.0682" next
  // to "From €1872"), so the amount is EUR and only the label is the host's.
  const symbol = priceRaw?.match(/From\s*([€$£])/)?.[1];
  const price_from = priceRaw ? parsePrice(priceRaw.split('/')[0]) : product?.offers?.price ? parsePrice(product.offers.price) : null;
  const price_currency = (symbol ? CURRENCY_BY_SYMBOL[symbol] : null) ?? product?.offers?.priceCurrency ?? null;
  const host_currency = product?.offers?.priceCurrency ?? null;

  // ---- host ----
  const hostSection = root.querySelector('section#host');
  const hostLink = hostSection?.querySelector('a[href^="/users/"]') ?? main.querySelector('a.profile-con');
  const hostName = oneLine(hostSection?.querySelector('img')?.getAttribute('alt')) || null;
  const memberSince = flat.match(/Member since ([A-Z][a-z]+ \d{4})/)?.[1] ?? null;

  // ---- partials ----
  const hostdataPath = html.match(/\/listings\/hostdata\/\?id=\d+/)?.[0];
  const [imagesP, videosP, servicesP, roomsP, itineraryP, languagesP, hostP] = await Promise.all([
    fetchPartial(`/listings/images/?id=${id}`),
    fetchPartial(`/listings/videos/?id=${id}`),
    fetchPartial(`/listings/services/?id=${id}`),
    fetchPartial(`/listings/accommodations/?id=${id}`),
    fetchPartial(`/listings/itinerary/?id=${id}`),
    fetchPartial(`/listings/languages/?id=${id}`),
    hostdataPath ? fetchPartial(hostdataPath) : Promise.resolve(null),
  ]);

  // images: host order, unique by file name (the gallery repeats thumbnails)
  const image_urls: string[] = [];
  for (const m of (imagesP?.toString() ?? '').matchAll(new RegExp(`l-${id}-[A-Za-z0-9]+\\.(?:jpe?g|png|webp)`, 'gi'))) {
    const url = `https://bstoked.azureedge.net/${m[0]}?width=1920`;
    if (!image_urls.includes(url)) image_urls.push(url);
  }

  const video_urls = (videosP?.querySelectorAll('iframe') ?? [])
    .map(f => youtubeWatchUrl(f.getAttribute('src') ?? ''))
    .filter((u): u is string => !!u);

  const serviceCard = (sel: string) =>
    (servicesP?.querySelector(sel)?.querySelectorAll('.py-05') ?? []).map(d => oneLine(d.text)).filter(Boolean);

  const rooms = (roomsP?.querySelectorAll('.card-body') ?? []).map(body => ({
    name: oneLine(body.querySelector('h5')?.text),
    description: clean(body.querySelector('.card-text p')?.text) || null,
    features: body.querySelectorAll('.card-text p.mb-0').map(p => oneLine(p.text)).filter(Boolean),
  })).filter(r => r.name);

  const itineraries = (itineraryP?.querySelectorAll('.tab-pane') ?? []).map(pane => ({
    title: oneLine(pane.querySelector('h5')?.text),
    days: pane.querySelectorAll('.mb-1').map(d => ({
      title: oneLine(d.querySelector('h6')?.text),
      text: clean(d.querySelector('p')?.text),
    })).filter(d => d.title || d.text),
  })).filter(i => i.days.length);
  // single-route listings render without tabs
  if (!itineraries.length && itineraryP) {
    const days = itineraryP.querySelectorAll('.mb-1').map(d => ({
      title: oneLine(d.querySelector('h6')?.text),
      text: clean(d.querySelector('p')?.text),
    })).filter(d => d.title || d.text);
    if (days.length) itineraries.push({ title: oneLine(itineraryP.querySelector('h5')?.text), days });
  }

  const languages = (languagesP?.querySelectorAll('.badge') ?? []).map(b => oneLine(b.text)).filter(Boolean);
  const hostText = oneLine(hostP?.structuredText);
  const responseRate = hostText.match(/Response rate:\s*(\d+)%/)?.[1];

  const pickup_location = tripValue('typical pickup');
  let coords = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  // Multi-stop tours have no map widget: pin them at the (geocoded) pickup.
  if (!coords && pickup_location) coords = await geocodeSpot(pickup_location, null, country);
  const itinerary_spots = await itinerarySpots(itineraries[0], country, coords);

  const kiteServicesKnown = cond ? true : null;
  return {
    package_type,
    title,
    slug: slugify(title),
    source: 'bstoked',
    source_listing_id: id,
    source_url: `${BASE}${card?.path ?? path}`,
    continent: countryToContinent(country),
    country,
    region,
    location_label,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    pickup_location,
    itinerary_spots,
    itineraries,
    skill_levels,
    wind_strength,
    water_conditions,
    spot_conditions,
    wind_probability: card?.windProbability ?? null,
    kite_services,
    kite_lessons: kiteServicesKnown && kite_services.includes('lessons'),
    equipment_rental: kiteServicesKnown && kite_services.includes('gear_rental'),
    conditions_text: cond?.prose.join('\n\n') || null,
    suitable_for,
    suitable_for_non_kiters: suitable_for.length ? suitable_for.includes('non_rider') : null,
    family_friendly: suitable_for.length ? suitable_for.includes('family') : null,
    ambience: lower(tripValue('ambience')),
    experience_types: lower(tripValue('experience type')),
    meal_plan: tripValue('food'),
    dietary_options: lower(tripValue('available options')),
    flight_search_assistance: trip ? trip.items.some(i => i.value.toLowerCase() === 'flight search assistance') : null,
    languages,
    included_services: serviceCard('#Included-services'),
    optional_services: serviceCard('#Optional-services'),
    extra_expenses: serviceCard('#Extra-services'),
    accommodation: accSection?.text ?? null,
    rooms,
    duration_nights: nights ? Number(nights) : null,
    price_from,
    price_currency,
    price_unit,
    price_basis_note: priceRaw
      ? `bstoked "from" price as displayed (${priceRaw})` +
        (host_currency && host_currency !== price_currency
          ? `; host prices in ${host_currency}, bstoked converts to ${price_currency} for display (original amount not exposed)`
          : '')
      : null,
    pricing: priceRaw
      ? { raw: priceRaw, card_label: card?.priceLabel ?? null, host_currency, duration_days: days ? Number(days) : null }
      : null,
    payment_terms,
    deposit_pct: deposit ? Number(deposit) : null,
    cancellation_policy: parseCancellation(flat),
    summary,
    description_sections: sections.filter(s => s !== accSection),
    video_urls,
    host_name: hostName,
    host_source_id: hostLink?.getAttribute('href')?.match(/\/users\/(\d+)/)?.[1] ?? null,
    host_member_since: memberSince,
    host_response_rate: responseRate ? Number(responseRate) : null,
    host_response_time: hostText.match(/Response time:\s*(.+?)\s*Response rate/)?.[1] ?? null,
    host_verified: hostP ? /Verified host/i.test(hostText) : null,
    bstoked_rating: ratingEl ? parsePrice(ratingEl.text) : null,
    bstoked_review_count: reviewCount ? Number(reviewCount) : ratingEl ? null : 0,
    source_text: pageText,
    image_urls,
  };
}

// ---------------------------------------------------------------------------
// seed: images → private bucket, row → package_offers (upsert on source id)
// ---------------------------------------------------------------------------
export async function seedBstokedListing(listing: BstokedListing): Promise<{ id: string; images: number }> {
  if (listing.package_type === 'cruise') {
    throw new Error(`${listing.source_listing_id} is a cruise: cruises live in cruise_offers, not package_offers`);
  }
  const dir = `packages/${listing.package_type}/${listing.slug}-${listing.source_listing_id}`;
  const images: StoredImage[] = [];
  for (const url of listing.image_urls.slice(0, MAX_IMAGES)) {
    const buf = await downloadImage(url);
    if (!buf) { console.warn(`  image download failed: ${url}`); continue; }
    const stored = await processAndStoreImage(buf, url, `${dir}/${images.length}.webp`, images.length);
    if (stored) images.push(stored);
  }

  const { image_urls: _drop, ...row } = listing;
  const { data, error } = await supabase
    .from('package_offers')
    .upsert({ ...row, images, scraped_at: new Date().toISOString() }, { onConflict: 'source,source_listing_id' })
    .select('id')
    .single();
  if (error) throw new Error(`package_offers upsert failed: ${error.message}`);
  return { id: data.id as string, images: images.length };
}

export async function packageOffersTableExists(): Promise<boolean> {
  const { error } = await supabase.from('package_offers').select('id').limit(1);
  return !error;
}
