// ---------------------------------------------------------------------------
// Freerider's Kite Tours (Sri Lanka) - "Mega Downwinder from Kalpitiya to Mannar": a guided 2-day, ~135 km downwind
// kite trip up the north-west coast, from the Dutch Bay / Kalpitiya area past the Wilpattu National Park coast
// (day 1, ~85 km) to a jungle beach camp, then ~45 km to Mannar (day 2); land support crew full-time, boat support
// part-time, all meals and camping material, transport to the launch and back to Kalpitiya. Moves between places ->
// KIND = 'tour' with itinerary stops.
//
// LIVENESS CAVEAT (read before publishing): the site looks neglected. Every page prints Drupal PHP "Deprecated
//   function" notices above the content, a sister tour ("Extreme Freeride Mannar to Jaffna") still says "Starting
//   in the 2020 season", the footer "(c) 2015 - 2026" may be generated, and the booking form offers the years
//   2025-2027 (2025 already past). The product page itself was still served with the full description and the
//   price on 2026-10-21, so the adapter is built; confidence 'low'. It throws when the page no longer shows the
//   product ("Mega Downwinder" + a euro rate), so a dead page fails the run instead of silently keeping old data.
//   Worth an e-mail to the operator before the listing goes live.
//
// Data path (checked 2026-10-21): Drupal 7 site, English, server-rendered:
//   https://www.freeriderskitetours.com/node/5
//   slots    "Our standard rate for the full trip is 250 euros" -> one undated slot, EUR per person (basis
//            inferred: "rate for the full trip", min 4 / max 10 kiters), package of 1 night (2 days). "Each season
//            will have preset tour dates but trips can be organised at any point in the season on request"; no dates
//            are printed; booking via the on-site form or WhatsApp -> 'on_request'.
//   content  the same page: "Skill level", "We provide", "You will need" lists, the trip text, photos (the
//            page's slider; the route map and icons are skipped).
// Itinerary stops (as the page names them; order = route): Dutch Bay, Kalpitiya (start) -> jungle beach camp
//   (night 1, location not named on the page: after ~85 km, i.e. north of the Wilpattu coast) -> Mannar (finish).
//   The camp stop will likely not geocode (no place name); the geocoder must not be allowed to pin it to the
//   unrelated "Jungle Beach" at Unawatuna in the south (region 'Northern Province' is set to gate that).
// robots.txt (2026-10-21): Drupal default, "Crawl-delay: 10"; /node/5 and /sites/default/files are allowed.
// Requests per run: 1 (memoised for content + slots).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse, parseAmount } from '../parse.js';
import type { ItinerarySpot, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.freeriderskitetours.com';
export const FR_MEGA_URL = `${SITE}/node/5`;

export interface FrTour {
  title: string | null;
  price: number | null;
  currency: string | null;
  priceRaw: string | null;
  days: number | null;
  distanceKm: number | null;
  dayKm: number[];
  season: string | null;
  group: { min: number; max: number } | null;
  skill: string[];
  provide: string[];
  need: string[];
  text: string;
}

// --- memoised page fetch ------------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

function lines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script,style,noscript,svg,form,.messages')) el.remove();
  return (root.querySelector('body') ?? root).structuredText.split('\n').map(s => collapse(s)).filter(Boolean);
}

function listAfter(ls: string[], head: RegExp, stops: RegExp): string[] {
  const i = ls.findIndex(l => head.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < ls.length && !stops.test(ls[j]); j++) out.push(ls[j]);
  return out;
}

// --- pure parser ----------------------------------------------------------------------------------------
export function parseFrTour(html: string): FrTour {
  const all = lines(html);
  // the product block only (nav, PHP notices, contact cards and forms around it are left out)
  const from = all.findIndex(l => /^from .+ to .+$/i.test(l) || /^Skill level$/i.test(l));
  const to = all.findIndex((l, i) => i > from && /standard rate for the full trip/i.test(l));
  const ls = from >= 0 && to > from ? all.slice(from, to + 1) : all;
  const text = ls.join('\n');
  const heads = /^(Skill level|We provide|You will need|Mega Downwinder from)/i;
  const pm = text.match(/standard rate for the full trip is\s*(?:€\s*)?([\d.,]+)\s*(euros?|EUR|€)?/i);
  const days = Number(text.match(/trip duration is\s*(\d+)\s*days?/i)?.[1] ?? NaN) || null;
  const dayKm = [...text.matchAll(/Day\s*\d+:\s*Approximately\s*(\d+)\s*km/gi)].map(m => Number(m[1]));
  const group = text.match(/min\s*(\d+)\s*and\s*max\s*(\d+)\s*kiters/i);
  return {
    title: ls.find(l => /^Mega Downwinder from/i.test(l)) ?? null,
    price: pm ? parseAmount(pm[1]) : null,
    currency: pm && (pm[2] || /€/.test(pm[0])) ? 'EUR' : null,
    priceRaw: pm?.[0] ?? null,
    days,
    distanceKm: Number(text.match(/approximate\s*(\d+)\s*km/i)?.[1] ?? NaN) || null,
    dayKm,
    season: text.match(/Main season for this downwinder:\s*([^\n]+)/i)?.[1].trim() ?? null,
    group: group ? { min: Number(group[1]), max: Number(group[2]) } : null,
    skill: listAfter(ls, /^Skill level$/i, heads),
    provide: listAfter(ls, /^We provide$/i, heads),
    need: listAfter(ls, /^You will need$/i, heads),
    text,
  };
}

/** The product is still on the page: its title and a euro rate. */
export function frIsLive(t: FrTour): boolean {
  return !!t.title && t.price !== null && t.currency === 'EUR';
}

export const FR_ITINERARY: ItinerarySpot[] = [
  { name: 'Dutch Bay', country: 'Sri Lanka', region: 'North Western Province', order: 1 }, // OSM hamlet north of Kalpitiya; 'Dutch Bay, Kalpitiya' did not geocode
  { name: 'Jungle beach camp', country: 'Sri Lanka', region: 'Northern Province', order: 2 },
  { name: 'Mannar', country: 'Sri Lanka', region: 'Northern Province', order: 3 },
];

export function buildFrSlots(t: FrTour): Slot[] {
  if (t.price === null) return [];
  const nights = t.days ? t.days - 1 : 1;
  return [{
    key: 'mega-downwinder',
    startDate: null,
    endDate: null,
    unit: 'Mega Downwinder Kalpitiya to Mannar',
    price: t.price,
    currency: t.currency,
    priceUnit: 'package',
    priceBasis: 'person', // inferred: "standard rate for the full trip"
    occupancy: null,
    availability: 'on_request',
    availabilityText: `Preset dates per season or on request (booking form / WhatsApp)${t.group ? `; ${t.group.min}-${t.group.max} kiters` : ''}${t.season ? `; main season ${t.season}` : ''}`,
    spotsLeft: null,
    packageNights: nights,
  }];
}

export function parseFrContent(html: string): OfferContent {
  const t = parseFrTour(html);
  if (!frIsLive(t)) throw new Error('freeriders-mega-downwinder: the page no longer shows the Mega Downwinder with a euro rate (product gone?)');
  const days = t.days ?? 2;

  const imgs: string[] = [];
  for (const img of parse(html).querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? '';
    if (!/\/sites\/default\/files\/.*\.(jpe?g|webp)/i.test(src)) continue; // slider photos; /img/ = icons, logo, map
    // as printed: the 900x600 derivatives (Drupal image style; ?itok is the derivative key, not a secret)
    const u = new URL(src, SITE).toString();
    const base = u.replace(/\/styles\/[^/]+\/public\//, '/').replace(/\?.*$/, '');
    if (!imgs.some(x => x.replace(/\/styles\/[^/]+\/public\//, '/').replace(/\?.*$/, '') === base)) imgs.push(u);
  }

  const summary = [
    `Freerider's Kite Tours guides a ${days}-day downwind kite trip of about ${t.distanceKm ?? 135} km along the north-west coast of Sri Lanka, from the Dutch Bay area of Kalpitiya past the Wilpattu National Park coast to Mannar.`,
    `Day 1 covers about ${t.dayKm[0] ?? 85} km and ends at a jungle camp next to the beach, day 2 about ${t.dayKm[1] ?? 45} km to Mannar; IKO-certified guides, a full-time land support crew, part-time boat support, all meals, camping material and transport to the launch and back to Kalpitiya are included.`,
    `It is for experienced riders (strong upwind, prior downwind or ocean experience), ${t.group ? `${t.group.min} to ${t.group.max} kiters, ` : ''}main season ${t.season ?? 'June to September'}, at a standard rate of EUR ${t.price} for the full trip; dates are preset per season or on request.`,
  ].join(' ');

  return {
    kind: 'tour',
    title: 'Freerider\'s Mega Downwinder Kalpitiya to Mannar',
    summary,
    continent: 'Asia',
    country: 'Sri Lanka',
    region: 'North Western Province',
    spot: 'Dutch Bay, Kalpitiya',
    spotCoords: null,
    itinerarySpots: FR_ITINERARY,
    durationDays: days,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: false,
    equipmentRental: /rental/i.test(t.need.join(' ')),
    beginnerFriendly: false,
    includedServices: t.provide.length ? t.provide : ['IKO certified guides', 'All meals, snacks and refreshments', 'Camping material', 'Transport to the launch point', 'Return transport to Kalpitiya'],
    optionalServices: ['Kite gear rental (ask the operator)', 'Night in the Mannar area instead of returning to Kalpitiya'],
    accommodation: 'one night in a jungle beach camp (camping material provided)',
    mealPlan: 'full_board',
    languages: ['en', 'fr', 'de'],
    rooms: [],
    imageUrls: imgs.slice(0, 12),
    heroVideoUrl: null,
    sourceUrl: FR_MEGA_URL,
    bookingUrl: FR_MEGA_URL,
    sourceText: [
      t.text,
      `parsed: price ${t.price} ${t.currency}; days ${t.days}; km ${t.distanceKm} (${t.dayKm.join('+')}); season ${t.season}; group ${JSON.stringify(t.group)}`,
      `skill: ${t.skill.join('; ')}`,
      `need: ${t.need.join('; ')}`,
    ].join('\n'),
  };
}

export const freeridersMegaDownwinderKalpitiyaMannar: OfferAdapter = {
  key: 'freeriders-mega-downwinder-kalpitiya-mannar',
  name: "Freerider's Kite Tours Mega Downwinder Kalpitiya to Mannar",
  kind: 'tour',
  operator: {
    name: "Freerider's Kite Tours",
    websiteUrl: SITE,
    rootDomain: 'freeriderskitetours.com',
    contactEmail: 'keira@adventureoncommunity.lk', // "Main contact ... Info, Bookings" on the page
    whatsapp: '+94777277554',
    phone: '+94777277554',
  },
  url: FR_MEGA_URL,
  slotMethod: 'price_table',
  instantBooking: false, // request form / WhatsApp
  confidence: 'low',     // neglected site, see header
  fetchBudget: 2,
  async fetchContent() {
    return parseFrContent(await page(FR_MEGA_URL));
  },
  async fetchSlots() {
    const t = parseFrTour(await page(FR_MEGA_URL));
    if (!frIsLive(t)) throw new Error('freeriders-mega-downwinder: the page no longer shows the Mega Downwinder with a euro rate (product gone?)');
    return buildFrSlots(t);
  },
};
