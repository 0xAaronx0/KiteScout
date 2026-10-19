// ---------------------------------------------------------------------------
// RIDE Kitesurfing (Adelaide kite shop + school) - Troubridge Island Kitesurfing Trip, Yorke Peninsula (South
// Australia): a catered kite trip on the lighthouse island off Edithburgh: rustic accommodation in the Light House
// Keepers Cottage or a private air swag tent, all meals, on-water support and coaching with drone footage, a rescue
// boat, boat transfers from Edithburgh, access to the RIDE demo gear. One place -> KIND = 'camp'.
//
// Data path (checked 2026-10-19): Shopify storefront, two content pages (the trip is NOT a shop product: the
// storefront's own search suggest for "troubridge" returns no product -> booking by email / phone enquiry):
//   dates    /pages/trips "TRIPS & EVENTS": year headings ("2026", "2027") followed by lines like
//            "Jan 15th-20th Troubridge Island" (2027: Jan 15-20 and Feb 15-20). The detail page also prints
//            "Trip #1 Starts: 10am Sunday 11th Jan 2026 / Ends: 12pm Friday 16th Jan 2026" (2026 trips, past).
//            Both are read (any Troubridge line of the trips page, any "Trip #n Starts/Ends" pair of the detail
//            page); dates before today are dropped, so new dates appear without a code change.
//   prices   /pages/troubridge-island "Pricing": "Light House Keepers Cottage share room (2 people, Queen Bed Each)
//            per person $1999", "(3 people, ...) per person $1999", "Private Double bed Air Swag Tent ... per person
//            $1799". These are the prices printed next to the 2026 trip dates; the 2027 trips have no own price yet,
//            so the slots carry the last printed price and say so in availabilityText.
//            Currency: only "$" is printed; the shop's base currency is AUD (page data "currencyCode":"AUD"; the
//            storefront converts its own product prices by visitor country, but these are typed page text) -> AUD,
//            inferred.
//   Slots: one per future trip date x accommodation option, priceUnit 'package', priceBasis 'person' (as printed),
//   availability 'on_request' ("Limited Positions - Enquire Now" is generic sales copy, no inventory).
//   content  the detail page (inclusions, what to expect, how to get there, page photos).
// Known conflict (2026-10-19): the page says "Rustic Accommodation for 4 nights", but every printed date range spans
//   5 nights (Sunday 10am - Friday 12pm; trips page Jan 15-20) -> durationDays from the dates (6), the "4 nights"
//   line stays in sourceText.
// robots.txt (2026-10-19): Shopify defaults; /pages/* allowed. (It also carries promotional text addressed to AI
//   agents about Shopify's shopping skills; ignored.)
// Requests per run: content 2 (detail + trips page), slots 2 (memoised in the same run).
// Flags: liveAvailability / instantBooking unset (no shop product, enquiry only).
// spotCoords: none on the site; "Troubridge Island, South Australia" is left to the geocoder.
// ---------------------------------------------------------------------------
import { clean, daysInclusive, imageCandidates, iso, monthOf, parseAmount, parseDate, todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';
import { memoPage, wpLines } from './kite-republic-aitutaki-winter-escape.js';

export const RIDE_SITE = 'https://ridekitesurfing.com.au';
export const RIDE_TROUBRIDGE_URL = `${RIDE_SITE}/pages/troubridge-island`;
export const RIDE_TRIPS_URL = `${RIDE_SITE}/pages/trips`;

export const RIDE_OPERATOR: OperatorRef = {
  name: 'RIDE Kitesurfing',
  websiteUrl: RIDE_SITE,
  rootDomain: 'ridekitesurfing.com.au',
  contactEmail: 'info@ridekitesurfing.com.au',
  phone: '+61417858641',
};

export interface RideTrip { start: string; end: string; label: string; source: 'trips' | 'detail' }
export interface RidePrice { name: string; price: number; occupancy: number | null }

/** "Jan 15th-20th Troubridge Island" / "Jan 30th - Feb 4th Troubridge Island" under a "2027" heading of /pages/trips. */
export function parseRideTrips(html: string, match = /troubridge/i): RideTrip[] {
  const out: RideTrip[] = [];
  let year: number | null = null;
  for (const raw of wpLines(html)) {
    const l = raw.replace(/[–—]/g, '-');
    const y = l.match(/^(20\d{2})$/);
    if (y) { year = Number(y[1]); continue; }
    if (!year || !match.test(l)) continue;
    const m = l.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*-\s*(?:([A-Za-z]{3,9})\.?\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (!m) continue;
    const m1 = monthOf(m[1]);
    const m2 = m[3] ? monthOf(m[3]) : m1;
    if (!m1 || !m2) continue;
    const start = iso(year, m1, Number(m[2]));
    const end = iso(m2 < m1 ? year + 1 : year, m2, Number(m[4]));
    if (!out.some(t => t.start === start)) out.push({ start, end, label: clean(l), source: 'trips' });
  }
  return out;
}

/** "Trip #1 Starts: 10am Sunday 11th Jan 2026" + "Trip #1 Ends: 12pm Friday 16th Jan 2026" of the detail page. */
export function parseRideDetailTrips(html: string): RideTrip[] {
  const lines = wpLines(html);
  const out: RideTrip[] = [];
  for (const l of lines) {
    const s = l.match(/^Trip\s*#?(\d+)\s*Starts?:\s*(.+)$/i);
    if (!s) continue;
    const e = lines.find(x => new RegExp(`^Trip\\s*#?${s[1]}\\s*Ends?:`, 'i').test(x));
    const start = parseDate(s[2]);
    const end = e ? parseDate(e.replace(/^.*?Ends?:\s*/i, '')) : null;
    if (start && end && !out.some(t => t.start === start)) out.push({ start, end, label: `${clean(l)} / ${clean(e)}`, source: 'detail' });
  }
  return out;
}

/** "<option> per person $1999" lines of the Pricing block. */
export function parseRidePrices(html: string): RidePrice[] {
  const out: RidePrice[] = [];
  for (const l of wpLines(html)) {
    const m = l.match(/^(.{5,140}?)\s+per person\s*(?:AU)?\$\s?([\d,]+(?:\.\d{2})?)/i);
    if (!m) continue;
    const price = parseAmount(m[2]);
    if (price === null) continue;
    const people = Number(m[1].match(/\((\d+)\s+people/i)?.[1] ?? 0);
    // "Private Double bed Air Swag Tent" names no head count (private, double bed, priced per person) -> null
    out.push({ name: clean(m[1]), price, occupancy: people || null });
  }
  return out;
}

const unitOf = (p: RidePrice): string =>
  /cottage/i.test(p.name)
    ? `Light House Keepers Cottage, share room for ${p.occupancy}`
    : /swag/i.test(p.name) ? 'Private double-bed air swag tent' : p.name;
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Trips page dates first, then any detail-page dates it does not list. */
export function mergeRideTrips(trips: RideTrip[], detail: RideTrip[]): RideTrip[] {
  const out = [...trips];
  for (const d of detail) if (!out.some(t => t.start === d.start)) out.push(d);
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export function buildRideSlots(trips: RideTrip[], prices: RidePrice[], detailYears: number[], today: string): Slot[] {
  const out: Slot[] = [];
  const priceYears = [...new Set(detailYears)].join('/');
  for (const t of trips) {
    if (t.start < today) continue;
    const ownYear = detailYears.includes(Number(t.start.slice(0, 4)));
    for (const p of prices) {
      out.push({
        key: `${t.start}|${slug(unitOf(p))}`,
        startDate: t.start,
        endDate: t.end,
        unit: unitOf(p),
        price: p.price,
        currency: 'AUD',
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: p.occupancy,
        availability: 'on_request',
        availabilityText: ownYear
          ? 'Limited positions - enquire now (email or phone)'
          : `Limited positions - enquire now; price as last printed on the trip page (${priceYears || 'previous'} trips), not yet confirmed for this date`,
        spotsLeft: null,
      });
    }
  }
  return out;
}

export interface RidePages { detail: string; trips: string | null }

export function parseRideContent(p: RidePages, today = todayIso()): OfferContent {
  const lines = wpLines(p.detail);
  const prices = parseRidePrices(p.detail);
  if (!prices.length) throw new Error('ride-troubridge: no "per person $" price lines (layout changed?)');
  const detailTrips = parseRideDetailTrips(p.detail);
  const all = mergeRideTrips(p.trips ? parseRideTrips(p.trips) : [], detailTrips);
  const future = all.filter(t => t.start >= today);
  const ref = future[0] ?? all[all.length - 1];
  const days = ref ? daysInclusive(ref.start, ref.end) : 6;
  const cottage = prices.find(x => /cottage/i.test(x.name));
  const swag = prices.find(x => /swag/i.test(x.name));
  const priceYear = detailTrips.length ? detailTrips[0].start.slice(0, 4) : null;
  const datesText = future.length
    ? `Trip dates: ${future.map(t => `${t.start} to ${t.end}`).join(', ')}`
    : `Runs every summer; the next dates are not published yet (last: ${all.map(t => t.start).join(', ') || 'none listed'})`;

  const summary = [
    'RIDE Kitesurfing runs a catered kite trip to Troubridge Island, a sand island with an old lighthouse a few kilometres off Edithburgh on the Yorke Peninsula, South Australia, with reliable afternoon winds over kilometres of shallow, sandy-bottomed clear water.',
    'The package includes rustic accommodation with linen, all meals and non-alcoholic drinks, on-water support and coaching with drone footage, a rescue boat, boat transfers from Edithburgh and access to the RIDE demo gear; guests meet at Wool Bay, about 2 hours from Adelaide.',
    `${datesText}.`,
    `Last printed prices${priceYear ? ` (${priceYear} trips)` : ''}: AUD ${cottage ? cottage.price.toLocaleString('en-US') : '?'} per person in a shared room of the lighthouse keepers cottage${swag ? `, AUD ${swag.price.toLocaleString('en-US')} in a private double air swag tent` : ''}; booking by enquiry.`,
  ].join(' ');

  const imageUrls = imageCandidates(p.detail, RIDE_TROUBRIDGE_URL, null, 60)
    .filter(u => /cdn\.shopify\.com\/s\/files\/|\/cdn\/shop\/files\//.test(u) && !/logo|flags|icon/i.test(u))
    .map(u => u.replace(/_\d+x\d*(\.[a-z]+)(\?|$)/i, '$1$2').replace(/\?.*$/, ''));

  return {
    kind: 'camp',
    title: 'RIDE Troubridge Island Kitesurfing Trip',
    summary,
    continent: 'Oceania',
    country: 'Australia',
    region: 'Yorke Peninsula, South Australia',
    spot: 'Troubridge Island',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: days,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: null, // coaching for riders who kite already; the page says nothing about beginners
    includedServices: [
      'Rustic accommodation on Troubridge Island with all linen',
      'All meals cooked for you, non-alcoholic drinks',
      'On-water support and coaching with drone footage',
      'Rescue boat on standby while kiting and for low-wind adventures',
      'Boat transfers for you and your gear to and from the island',
      'Access to the RIDE demo gear',
      'Photos and footage, evening quiz night',
    ],
    optionalServices: [],
    accommodation: 'Light House Keepers Cottage share rooms (queen bed each) or private double air swag tents',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: prices.map(x => ({ name: unitOf(x), description: x.name, features: [] })),
    imageUrls: [...new Set(imageUrls)].slice(0, 20),
    heroVideoUrl: null,
    sourceUrl: RIDE_TROUBRIDGE_URL,
    bookingUrl: RIDE_TROUBRIDGE_URL,
    sourceText: [
      lines.slice(lines.findIndex(l => /^TROUBRIDGE ISLAND KITESURFING TRIP$/i.test(l)), lines.findIndex(l => /^SUPPORT$/.test(l))).join('\n'),
      `parsed: trips ${all.map(t => `${t.start}..${t.end} (${t.source})`).join(', ')}; prices ${prices.map(x => `${unitOf(x)}=${x.price}`).join(', ')}`,
    ].join('\n'),
  };
}

export async function fetchRideSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const detail = await memoPage(RIDE_TROUBRIDGE_URL);
  const trips = await memoPage(RIDE_TRIPS_URL);
  const prices = parseRidePrices(detail);
  if (!prices.length) throw new Error('ride-troubridge: no "per person $" price lines (layout changed?)');
  const detailTrips = parseRideDetailTrips(detail);
  const all = mergeRideTrips(parseRideTrips(trips), detailTrips);
  if (!all.length) throw new Error('ride-troubridge: no Troubridge dates on the trips or detail page (layout changed?)');
  const past = all.filter(t => t.start < today);
  if (past.length) ctx?.note(`${past.length} past trip date(s) dropped (${past.map(t => t.start).join(', ')})`);
  return buildRideSlots(all, prices, detailTrips.map(t => Number(t.start.slice(0, 4))), today);
}

export const rideKitesurfingTroubridgeIslandTrip: OfferAdapter = {
  key: 'ride-kitesurfing-troubridge-island-trip',
  name: 'RIDE Kitesurfing Troubridge Island Kitesurfing Trip',
  kind: 'camp',
  operator: RIDE_OPERATOR,
  url: RIDE_TROUBRIDGE_URL,
  slotMethod: 'html_dates',
  fetchBudget: 3,
  async fetchContent() {
    const detail = await memoPage(RIDE_TROUBRIDGE_URL);
    const trips = await memoPage(RIDE_TRIPS_URL).catch(() => null);
    return parseRideContent({ detail, trips });
  },
  fetchSlots: ctx => fetchRideSlots(todayIso(), ctx),
};
