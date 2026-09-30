// ---------------------------------------------------------------------------
// bstoked.net listings (camps, tours, accommodation, …) → package_offers.
//
// bstoked is server-rendered: the listing page carries the structured blocks
// (kite conditions, trip characteristics, prose sections, rating, lat/lng) and
// lazy-loads the rest through plain GET partials (/listings/{images,services,
// accommodations,itinerary,languages,videos,hostdata}/?id=). No JS rendering,
// no login. Not public: review texts and the host's business identity.
//
// Rows use the cruise field set (Aaron 2026-09-29): only package_type, rooms and
// price_unit are package-specific; detail without a column goes into source_text.
//
//   pnpm cli bstoked-packages list                 # all listings with type/price
//   pnpm cli bstoked-packages scrape <id|slug> …    # dry run → JSON on stdout / --out
//   pnpm cli bstoked-packages seed <id|slug> …      # upsert rows; keeps existing images (--refresh-images)
// ---------------------------------------------------------------------------
import { parse, type HTMLElement } from 'node-html-parser';
import { supabase } from '../lib/supabase.js';
import { withRetry } from '../lib/retry.js';
import { countryToContinent } from '../lib/continents.js';
import { geocodeSpot } from '../lib/geocode.js';
import { downloadImage, processAndStoreImage, slugify, type StoredImage } from '../lib/images.js';
import { roomCaption, type PriceUnit, type Room } from '../lib/rooms.js';

export type { PriceUnit, Room, RoomPriceUnit } from '../lib/rooms.js';

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
      const price = card.querySelector('.price');
      seen.set(id, {
        id,
        path: titleA?.getAttribute('href') ?? `/listings/${id}/`,
        type: TYPE_BY_LABEL[typeLabel.toLowerCase()] ?? null,
        typeLabel,
        title: oneLine(titleA?.text),
        locationLabel: oneLine(card.querySelector('.card-loc a')?.text),
        priceLabel: price ? oneLine(`${price.text} ${price.nextElementSibling?.text ?? ''}`) : null,
      });
      added++;
    }
    if (added === 0) break;
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// listing detail → a row in the cruise field set (see migration 20260929120000)
// ---------------------------------------------------------------------------
export interface ItinerarySpot {
  name: string;
  country: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  order: number;
}

/** One package_offers row. Same names/meaning as cruise_offers, plus package_type, rooms, price_unit. */
export interface BstokedListing {
  package_type: PackageType;
  title: string;
  slug: string;
  source_listing_id: string;
  source_url: string;
  continent: string | null;
  country: string | null;
  region: string | null;
  departure_port: string | null;
  itinerary_spots: ItinerarySpot[];
  skill_levels: string[];
  wind_strength: string[];
  water_conditions: string[];
  beginner_friendly: boolean | null;
  kite_lessons: boolean | null;
  equipment_rental: boolean | null;
  suitable_for_non_kiters: boolean | null;
  family_friendly: boolean | null;
  languages: string[];
  included_services: string[];
  optional_services: string[];
  accommodation: string | null;
  meal_plan: string | null;
  rooms: Room[];
  duration_days: number | null;
  price_pp_cabin: number | null;
  price_pp_cabin_currency: string | null;
  price_from_eur: number | null;
  currency: string | null;
  price_unit: PriceUnit | null;
  price_basis_note: string | null;
  pricing: Record<string, unknown> | null;
  summary: string | null;
  bstoked_rating: number | null;
  bstoked_review_count: number | null;
  /** page text + detail without its own column (day programme, host stats, videos) for the Scout chat */
  source_text: string;
  /** full-size bstoked CDN URLs in host order (first = cover); stored to the bucket on seed */
  image_urls: string[];
}

// cruise meal_plan vocabulary (KCS mapMealPlan labels these; anything else is shown humanized)
const MEAL_PLAN: Record<string, string> = {
  breakfast: 'breakfast', 'half board': 'half_board', 'full board': 'full_board',
  'all inclusive': 'all_inclusive', 'self catering': 'self_catering',
};

interface JsonLd { '@type'?: string; [k: string]: unknown }

function readJsonLd(root: HTMLElement): JsonLd[] {
  const out: JsonLd[] = [];
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try { out.push(JSON.parse(s.text)); } catch { /* malformed block → skip */ }
  }
  return out;
}

interface StructuredItem { icon: string; label: string; value: string }

/** A page block = a muted label column + `.listing-structured` items. */
function readBlocks(root: HTMLElement): Map<string, StructuredItem[]> {
  const blocks = new Map<string, StructuredItem[]>();
  for (const b of root.querySelectorAll('div.b-b.block')) {
    const label = oneLine(b.querySelector('.col-md-3')?.text).toLowerCase();
    if (!label) continue;
    blocks.set(label, b.querySelectorAll('.listing-structured > div').map(item => {
      const muted = oneLine(item.querySelector('.text-muted')?.text);
      return {
        icon: (item.querySelector('i')?.getAttribute('title') ?? '').toLowerCase(),
        label: muted.replace(/:$/, '').toLowerCase(),
        value: oneLine(item.text).replace(muted, '').trim(),
      };
    }));
  }
  return blocks;
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
async function routeSpots(
  route: { days: { title: string }[] } | undefined,
  country: string | null,
  anchor: { lat: number; lng: number } | null,
): Promise<ItinerarySpot[]> {
  const names: string[] = [];
  for (const d of route?.days ?? []) {
    const place = d.title.replace(/^days?\s*\d+(\s*[-–]\s*\d+)?\s*[-–:]?\s*/i, '').trim();
    if (!place || /^(airport|departures?|arrival|transfer|kitesurfing)\b/i.test(place)) continue;
    for (const n of place.split('/').map(x => x.trim()).filter(Boolean)) if (!names.includes(n)) names.push(n);
  }
  const spots: ItinerarySpot[] = [];
  for (const [order, name] of names.entries()) {
    const hit = await geocodeSpot(name, null, country);
    const ok = hit && (!anchor || distanceKm(anchor, hit) <= MAX_STOP_DISTANCE_KM);
    spots.push({ name, country, region: null, lat: ok ? hit.lat : null, lng: ok ? hit.lng : null, order });
  }
  return spots;
}

function priceUnitOf(unitText: string): { unit: PriceUnit; nights: number | null; days: number | null } {
  const u = unitText.replace(/^\/\s*/, '').trim().toLowerCase();
  const nights = u.match(/^(\d+)\s+nights?\b/)?.[1];
  const days = u.match(/^(\d+)\s+days?\b/)?.[1];
  const unit: PriceUnit = nights || days ? 'package'
    : u.startsWith('per night') ? 'per_night'
    : u.startsWith('per day') ? 'per_day'
    : 'other';
  return { unit, nights: nights ? Number(nights) : null, days: days ? Number(days) : null };
}

interface RoomQuote { roomId: string | null; name: string; price: number | null; currency: string | null; unit: PriceUnit; photo: string | null }

/**
 * Room prices are date- and occupancy-dependent on bstoked (booking step "customize").
 * Sample the 15th of each of the next 12 months, 2 guests, `nights` long; one room's
 * "from" price is its lowest positive quote.
 */
async function sampleRoomQuotes(id: string, nights: number): Promise<Map<number, RoomQuote[]>> {
  const byMonth = new Map<number, RoomQuote[]>();
  const now = new Date();
  for (let k = 1; k <= 12; k++) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 15));
    const end = new Date(start.getTime() + nights * 86_400_000);
    const d = (x: Date) => x.toISOString().slice(0, 10);
    const part = await fetchPartial(`/listings/bookcustom/${id}/?start=${d(start)}&end=${d(end)}&Guests=2`);
    const quotes: RoomQuote[] = (part?.querySelectorAll('#book-accommodations label') ?? []).map(label => {
      const priceTxt = oneLine(label.querySelector('.w-100 .semi')?.text);
      const amount = priceTxt ? parsePrice(priceTxt) : null;
      const photo = label.toString().match(/ac-\d+-[A-Za-z0-9]+\.(?:jpe?g|png|webp)/i)?.[0];
      return {
        roomId: label.querySelector('input[name="AId"]')?.getAttribute('value') ?? null,
        name: oneLine(label.querySelector('h6')?.text),
        price: amount && amount >= 1 ? Math.round(amount) : null,
        currency: CURRENCY_BY_SYMBOL[priceTxt.match(/[€$£]/)?.[0] ?? ''] ?? null,
        unit: priceUnitOf(oneLine(label.querySelector('.w-100 small')?.text)).unit,
        photo: photo ? `https://bstoked.azureedge.net/${photo}?width=1920` : null,
      };
    }).filter(q => q.name);
    byMonth.set(start.getUTCMonth() + 1, quotes);
    await new Promise(r => setTimeout(r, 250)); // be gentle with bstoked
  }
  return byMonth;
}

/** Room cards (descriptions + photos) merged with the sampled quotes; keyed by bstoked room id. */
function buildRooms(roomsP: HTMLElement | null, quotesByMonth: Map<number, RoomQuote[]>): Room[] {
  const rooms = new Map<string, Room>();
  for (const card of roomsP?.querySelectorAll('div.card') ?? []) {
    const body = card.querySelector('.card-body');
    const name = oneLine(body?.querySelector('h5')?.text);
    if (!name) continue;
    const roomId = card.querySelector('[id^="accommodation-c-"]')?.getAttribute('id')?.replace('accommodation-c-', '');
    const photo = card.toString().match(/ac-\d+-[A-Za-z0-9]+\.(?:jpe?g|png|webp)/i)?.[0];
    rooms.set(roomId ?? `name:${name.toLowerCase()}`, {
      name,
      description: clean(body?.querySelector('.card-text p')?.text) || null,
      features: body?.querySelectorAll('.card-text p.mb-0').map(p => oneLine(p.text)).filter(Boolean) ?? [],
      price_from: null, price_currency: null, price_unit: null, priced_months: [], image_sort: null,
      photo_url: photo ? `https://bstoked.azureedge.net/${photo}?width=1920` : null,
    });
  }
  for (const [month, quotes] of quotesByMonth) {
    for (const q of quotes) {
      const key = q.roomId && rooms.has(q.roomId) ? q.roomId
        : [...rooms.keys()].find(k => rooms.get(k)!.name.toLowerCase() === q.name.toLowerCase()) ?? q.roomId ?? `name:${q.name.toLowerCase()}`;
      const room = rooms.get(key) ?? {
        name: q.name, description: null, features: [],
        price_from: null, price_currency: null, price_unit: null, priced_months: [], image_sort: null, photo_url: null,
      };
      room.photo_url ??= q.photo;
      if (q.price !== null) {
        if (!room.priced_months.includes(month)) room.priced_months.push(month);
        if (room.price_from === null || q.price < room.price_from) {
          room.price_from = q.price;
          room.price_currency = q.currency;
          room.price_unit = q.unit;
        }
      }
      rooms.set(key, room);
    }
  }
  // Hosts list identical units separately ("Double bedroom", "Double bedroom 2", …): keep one.
  const unique = new Map<string, Room>();
  for (const r of rooms.values()) {
    const base = r.name.replace(/\s+\d+$/, '');
    const key = `${base.toLowerCase()}|${r.price_from}|${r.price_unit}`;
    if (!unique.has(key)) unique.set(key, { ...r, name: base });
  }
  return [...unique.values()]
    .map(r => ({ ...r, priced_months: r.priced_months.sort((a, b) => a - b) }))
    .sort((a, b) => (a.price_from ?? Infinity) - (b.price_from ?? Infinity));
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
  const locationLabel = oneLine(root.querySelector('header .lead .text-m')?.text) || card?.locationLabel || null;
  let region: string | null = null;
  if (locationLabel && country && locationLabel !== country && locationLabel.endsWith(`, ${country}`)) {
    region = locationLabel.slice(0, -(country.length + 2)).trim() || null;
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
  let spot: string[] = [];
  const kiteServices: string[] = [];
  for (const it of cond ?? []) {
    if (it.icon === 'skill level') skill_levels = splitList(it.value).map(s => s.toLowerCase());
    else if (it.label === 'wind') wind_strength = mapList(splitList(it.value), WIND);
    else if (it.label === 'spot') spot = mapList(splitList(it.value), SPOT);
    else if (KITE_SERVICE_BY_TITLE[it.icon]) kiteServices.push(KITE_SERVICE_BY_TITLE[it.icon]);
  }
  const water_conditions = [...new Set(spot.map(s => WATER_FROM_SPOT[s]).filter(Boolean))];

  const tripValue = (label: string) => trip?.find(i => i.label === label)?.value ?? null;
  const suitableFor = mapList(splitList(tripValue('suitable for') ?? ''), SUITABLE_FOR);
  const food = tripValue('food')?.toLowerCase() ?? null;

  // ---- accommodation prose section ----
  const accBlock = main.querySelectorAll('div.block.py-1')
    .find(b => oneLine(b.querySelector('h4')?.text).toLowerCase() === 'accommodation');

  // ---- rating + price ----
  const pageText = clean(main.structuredText);
  const flat = pageText.replace(/\s+/g, ' ');
  const ratingEl = main.querySelector('strong.pr-025');
  const reviewCount = flat.match(/\b(\d+) reviews?\b/)?.[1];

  const priceRaw = oneLine(main.querySelector('.d-m-none')?.text) || null; // "From €1279 / 7 nights"
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
  const amount = priceRaw ? parsePrice(priceRaw.split('/')[0]) : product?.offers?.price ? parsePrice(product.offers.price) : null;
  const price = amount && amount >= 1 ? Math.round(amount) : null; // the app expects positive integers
  const currency = (symbol ? CURRENCY_BY_SYMBOL[symbol] : null) ?? product?.offers?.priceCurrency ?? null;
  const hostCurrency = product?.offers?.priceCurrency ?? null;

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

  const serviceCard = (sel: string) =>
    (servicesP?.querySelector(sel)?.querySelectorAll('.py-05') ?? []).map(d => oneLine(d.text)).filter(Boolean);

  // room prices: 12 monthly samples of the booking step, as long as the package (else a week)
  const rooms = buildRooms(roomsP, await sampleRoomQuotes(id, nights ? Number(nights) : days ? Number(days) : 7));

  const readDays = (el: HTMLElement) => el.querySelectorAll('.mb-1').map(d => ({
    title: oneLine(d.querySelector('h6')?.text),
    text: clean(d.querySelector('p')?.text),
  })).filter(d => d.title || d.text);
  const itineraries = (itineraryP?.querySelectorAll('.tab-pane') ?? [])
    .map(pane => ({ title: oneLine(pane.querySelector('h5')?.text), days: readDays(pane) }))
    .filter(i => i.days.length);
  // single-route listings render without tabs
  if (!itineraries.length && itineraryP) {
    const d = readDays(itineraryP);
    if (d.length) itineraries.push({ title: oneLine(itineraryP.querySelector('h5')?.text), days: d });
  }

  const languages = (languagesP?.querySelectorAll('.badge') ?? []).map(b => oneLine(b.text)).filter(Boolean);
  const videoUrls = (videosP?.querySelectorAll('iframe') ?? [])
    .map(f => youtubeWatchUrl(f.getAttribute('src') ?? ''))
    .filter((u): u is string => !!u);

  // ---- map pins: tours get their route stops; everything else one location spot ----
  const departure_port = tripValue('typical pickup');
  let coords = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  // Multi-stop tours have no map widget: anchor them at the (geocoded) pickup.
  if (!coords && departure_port) coords = await geocodeSpot(departure_port, null, country);
  let itinerary_spots = await routeSpots(itineraries[0], country, coords);
  if (coords && !itinerary_spots.some(s => s.lat !== null)) {
    const name = region ?? locationLabel ?? country ?? title;
    itinerary_spots = [
      { name, country, region, lat: coords.lat, lng: coords.lng, order: 0 },
      ...itinerary_spots.map(s => ({ ...s, order: s.order + 1 })),
    ];
  }

  // detail without a column of its own stays readable for the Scout chat
  const hostText = oneLine(hostP?.structuredText);
  const source_text = [
    pageText,
    ...itineraries.map(i => `Itinerary: ${i.title}\n\n${i.days.map(d => `${d.title}\n${d.text}`).join('\n\n')}`),
    hostText ? `Host: ${hostText}` : '',
    videoUrls.length ? `Videos: ${videoUrls.join(' ')}` : '',
  ].filter(Boolean).join('\n\n');

  const kiteServicesKnown = cond ? true : null;
  return {
    package_type,
    title,
    slug: slugify(title),
    source_listing_id: id,
    source_url: `${BASE}${card?.path ?? path}`,
    continent: countryToContinent(country),
    country,
    region,
    departure_port,
    itinerary_spots,
    skill_levels,
    wind_strength,
    water_conditions,
    beginner_friendly: skill_levels.length ? skill_levels.includes('beginner') : null,
    kite_lessons: kiteServicesKnown && kiteServices.includes('lessons'),
    equipment_rental: kiteServicesKnown && kiteServices.includes('gear_rental'),
    suitable_for_non_kiters: suitableFor.length ? suitableFor.includes('non_rider') : null,
    family_friendly: suitableFor.length ? suitableFor.includes('family') : null,
    languages,
    included_services: serviceCard('#Included-services'),
    // "extra expenses" (not included, paid locally) are optional costs too
    optional_services: [...new Set([...serviceCard('#Optional-services'), ...serviceCard('#Extra-services')])],
    accommodation: clean(accBlock?.querySelector('.line-break')?.text) || null,
    meal_plan: food ? MEAL_PLAN[food] ?? food.replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '') : null,
    rooms,
    // cruise convention: duration_days = nights + 1 (the app shows duration_days - 1 nights)
    duration_days: nights ? Number(nights) + 1 : days ? Number(days) : null,
    price_pp_cabin: price,
    price_pp_cabin_currency: price ? currency : null,
    // sortable trip price only; a per-night or per-lesson rate is not comparable to a trip
    price_from_eur: price && price_unit === 'package' && currency === 'EUR' ? price : null,
    currency,
    price_unit,
    price_basis_note: priceRaw
      ? `bstoked "from" price as displayed (${priceRaw})` +
        (hostCurrency && hostCurrency !== currency
          ? `; host prices in ${hostCurrency}, bstoked converts to ${currency} for display (original amount not exposed)`
          : '')
      : null,
    pricing: priceRaw ? { raw: priceRaw, currency, host_currency: hostCurrency } : null,
    summary,
    bstoked_rating: ratingEl ? parsePrice(ratingEl.text) : null,
    bstoked_review_count: reviewCount ? Number(reviewCount) : ratingEl ? null : 0,
    source_text,
    image_urls,
  };
}

// ---------------------------------------------------------------------------
// seed: images → private bucket, row → package_offers (upsert on source_listing_id)
// ---------------------------------------------------------------------------
const MIN_GENERAL_IMAGES = 2; // the slider opens with the place, then one captioned photo per room

type PackageImage = StoredImage & { room?: string };


async function storeImage(url: string, path: string, sort: number): Promise<PackageImage | null> {
  const buf = await downloadImage(url);
  if (!buf) { console.warn(`  image download failed: ${url}`); return null; }
  return processAndStoreImage(buf, url, path, sort);
}

export async function seedBstokedListing(
  listing: BstokedListing,
  opts: { refreshImages?: boolean } = {},
): Promise<{ id: string; images: number; roomImages: number; generalKept: boolean }> {
  if (listing.package_type === 'cruise') {
    throw new Error(`${listing.source_listing_id} is a cruise: cruises live in cruise_offers, not package_offers`);
  }
  const { data: existing, error: readErr } = await supabase
    .from('package_offers')
    .select('images')
    .eq('source_listing_id', listing.source_listing_id)
    .maybeSingle();
  if (readErr) throw new Error(`package_offers read failed: ${readErr.message}`);
  const before = (existing?.images as PackageImage[] | undefined) ?? [];
  const dir = `packages/${listing.package_type}/${listing.slug}-${listing.source_listing_id}`;

  const withPhoto = listing.rooms.filter(r => r.photo_url).slice(0, MAX_IMAGES - MIN_GENERAL_IMAGES);
  const generalSlots = MAX_IMAGES - withPhoto.length;

  // General photos are curated state (hero, order): keep them unless asked to refresh.
  const keptGeneral = before.filter(i => !i.room).sort((a, b) => a.sort - b.sort);
  const generalKept = keptGeneral.length > 0 && !opts.refreshImages;
  let general: PackageImage[] = generalKept ? keptGeneral.slice(0, generalSlots) : [];
  if (!generalKept) {
    for (const url of listing.image_urls.slice(0, generalSlots)) {
      const img = await storeImage(url, `${dir}/${general.length}.webp`, general.length);
      if (img) general.push(img);
    }
  }

  // One captioned photo per room; reuse an already stored copy of the same source photo.
  const roomImages: PackageImage[] = [];
  const rooms: Room[] = listing.rooms.map(r => ({ ...r, image_sort: null }));
  for (const r of withPhoto) {
    const url = r.photo_url!;
    const file = url.match(/(ac-\d+-[A-Za-z0-9]+)\./)?.[1] ?? `room-${roomImages.length}`;
    const img = before.find(i => i.source_url === url) ?? (await storeImage(url, `${dir}/${file}.webp`, 0));
    if (!img) continue;
    roomImages.push({ ...img, room: r.name, caption: roomCaption(r) });
  }
  const images: PackageImage[] = [...general, ...roomImages].map((img, sort) => ({ ...img, sort }));
  for (const room of rooms) {
    room.image_sort = images.find(i => i.room === room.name)?.sort ?? null;
    delete room.photo_url;
  }

  const { image_urls: _drop, ...row } = listing;
  const { data, error } = await supabase
    .from('package_offers')
    .upsert({ ...row, rooms, images }, { onConflict: 'source_listing_id' })
    .select('id')
    .single();
  if (error) throw new Error(`package_offers upsert failed: ${error.message}`);
  return { id: data.id as string, images: images.length, roomImages: roomImages.length, generalKept };
}

export async function packageOffersTableExists(): Promise<boolean> {
  const { error } = await supabase.from('package_offers').select('id').limit(1);
  return !error;
}
