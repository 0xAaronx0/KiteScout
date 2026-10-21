// ---------------------------------------------------------------------------
// Kiteboarding Colombia (Kite Addict Colombia, Mayapo / Riohacha, in La Guajira since 2010) - "Kite Trip Wild North:
// Cabo de la Vela & Punta Gallinas": a guided 4x4 kite road trip through the La Guajira desert from Mayapo to Cabo
// de la Vela and Punta Gallinas (northernmost point of South America), with a downwinder to La Boquita and the Taroa
// dunes; 7 days / 6 nights, also sold as 5 d / 4 n and a 4 d / 3 n express trip. Three plans: "Rider" (guide,
// intermediate / advanced), "Rookie to Rockstar" (lessons with certified instructors, gear in lessons, beginners),
// "Light Traveler" (full gear rental). KIND = 'tour' (moves between places; route pins in itinerarySpots).
// This is NOT the catalog's KiteAdventure Colombia (kitesurfingcolombia.co) and not Global Kite Trips' safari.
//
// Data path (checked 2026-10-21): WordPress + Elementor, ONE page /kite-trip-cabo-de-la-vela-punta-gallinas/
//   (dateModified 2026-03-11): hero "7 days/ 6 nights or 5 days / 4 nights ... Book your spot now / JULY 16 - 20 /
//   2026", "Upcoming trips run several times per year. Private trips for groups are also available.", "What's
//   Included" list, day-by-day itinerary (Day 01 Mayapo ... Day 07 Punta Gallinas - Riohacha), "PLANS" (3 packages,
//   each "4 DAYS 3 NIGHTS or 5 DAYS 4 NIGHTS or 7 DAYS 6 NIGHTS"), photo gallery.
//   dates    every "<Month> <d> - [<Month>] <d> / <year>" on the page becomes a departure; past ones are dropped.
//            On 2026-10-21 the only printed date (16-20 July 2026) is past -> slots = [] and the summary says the
//            next dates are not published yet. New rows in the same style are picked up automatically.
//   price    none printed anywhere (no currency on the page) -> any future departure gets price null, 'on_request'.
// Booking: "Book now" / "Book your spot now" = WhatsApp (wa.me) -> 'on_request', instantBooking false.
// Doubt: meals - the icons say "BREAKFAST/SNACKS", "What's Included" says "Breakfast, lunch and dinner (optional)",
//   the plans say "Breakfast, lunch and dinner" -> mealPlan "breakfast; lunch and dinner optional".
// robots.txt (2026-10-21): Yoast "User-agent: * / Disallow:" (everything allowed). Requests per run: 1 (memoised).
// Flags: liveAvailability no (page text), instantBooking false (WhatsApp).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, daysInclusive, imageCandidates, monthOf, parse, parseRange, todayIso } from '../parse.js';
import type { FetchContext, ItinerarySpot, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kiteboardingcolombia.com';
export const KBC_TRIP_URL = `${SITE}/kite-trip-cabo-de-la-vela-punta-gallinas/`;
const WHATSAPP = '+573205281665';
/** route stops in travel order (page heading "MAYAPO - CABO DE LA VELA - PUNTA GALLINAS - LA BOQUITA DUNAS DE TAROA" + itinerary) */
const ROUTE: Array<{ name: string; re: RegExp }> = [
  { name: 'Mayapo', re: /Mayapo/i },
  { name: 'Cabo de la Vela', re: /Cabo de la Vela/i },
  { name: 'Punta Gallinas', re: /Punta Gallinas/i },
  { name: 'Dunas de Taroa', re: /Taroa/i },
  { name: 'La Boquita', re: /La Boquita/i },
];

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines of the page (scripts, styles, svg, nav menus dropped). */
export function kbcLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, template, svg, nav')) el.remove();
  const body = root.querySelector('main, #content, body') ?? root;
  return body.innerHTML.split(/<[^>]+>/).map(s => collapse(parse(`<p>${s}</p>`).text).replace(/\s*[—–]\s*/g, ' - ')).filter(Boolean);
}

export interface KbcDeparture { start: string; end: string; raw: string }

/** "JULY 16 – 20 / 2026", "July 30 - August 3, 2026", "16 - 20 julio 2026" style departures, in page order, deduplicated. */
export function parseKbcDepartures(text: string): KbcDeparture[] {
  const out: KbcDeparture[] = [];
  const t = text.replace(/[–—]/g, '-');
  const re = /\b([A-Za-z]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*-\s*(?:([A-Za-z]{3,10})\.?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s*[/,]?\s*(20\d{2})\b/g;
  for (const m of t.matchAll(re)) {
    if (!monthOf(m[1]) || (m[3] && !monthOf(m[3]))) continue;
    const r = parseRange(`${m[1]} ${m[2]} - ${m[3] ? `${m[3]} ` : ''}${m[4]} ${m[5]}`);
    if (r && !out.some(d => d.start === r.start)) out.push({ ...r, raw: m[0] });
  }
  const re2 = /\b(\d{1,2})\s*-\s*(\d{1,2})\s+([A-Za-z]{3,10})\.?\s*[/,]?\s*(20\d{2})\b/g;
  for (const m of t.matchAll(re2)) {
    if (!monthOf(m[3])) continue;
    const r = parseRange(`${m[1]}-${m[2]} ${m[3]} ${m[4]}`);
    if (r && !out.some(d => d.start === r.start)) out.push({ ...r, raw: m[0] });
  }
  return out;
}

/** "7 days/ 6 nights", "4 DAYS 3 NIGHTS" ... -> the trip lengths sold, longest first. */
export function parseKbcLengths(text: string): Array<{ days: number; nights: number }> {
  const out: Array<{ days: number; nights: number }> = [];
  for (const m of text.matchAll(/(\d+)\s*days?\s*\/?\s*(\d+)\s*nights?/gi)) {
    const v = { days: Number(m[1]), nights: Number(m[2]) };
    if (v.days === v.nights + 1 && !out.some(x => x.days === v.days)) out.push(v);
  }
  return out.sort((a, b) => b.days - a.days);
}

export function buildKbcSlots(deps: KbcDeparture[], today: string): Slot[] {
  return deps.filter(d => d.start >= today).map(d => ({
    key: d.start,
    startDate: d.start,
    endDate: d.end,
    unit: `${daysInclusive(d.start, d.end)} days / ${daysInclusive(d.start, d.end) - 1} nights`,
    price: null,             // no price printed on the page
    currency: null,
    priceUnit: null,
    priceBasis: null,
    occupancy: null,
    availability: 'on_request', // WhatsApp booking, no inventory
    availabilityText: null,
    spotsLeft: null,
  }));
}

/** "Next dates ..." sentence: future departures, or the last printed (past) one. */
export function kbcDatesSentence(deps: KbcDeparture[], today: string): string {
  const fmt = (d: KbcDeparture) => {
    const s = new Date(`${d.start}T00:00:00Z`), e = new Date(`${d.end}T00:00:00Z`);
    const mon = (x: Date) => x.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
    return s.getUTCMonth() === e.getUTCMonth()
      ? `${s.getUTCDate()}-${e.getUTCDate()} ${mon(e)} ${e.getUTCFullYear()}`
      : `${s.getUTCDate()} ${mon(s)} - ${e.getUTCDate()} ${mon(e)} ${e.getUTCFullYear()}`;
  };
  const future = deps.filter(d => d.start >= today);
  if (future.length) return `Next departures: ${future.map(fmt).join(', ')}.`;
  const last = deps[deps.length - 1];
  return `Trips run several times a year; the next dates are not published yet${last ? ` (last printed: ${fmt(last)})` : ''}.`;
}

function section(lines: string[], from: RegExp, to: RegExp): string[] {
  const a = lines.findIndex(l => from.test(l));
  if (a < 0) return [];
  const out: string[] = [];
  for (let i = a + 1; i < lines.length && !to.test(lines[i]); i++) out.push(lines[i]);
  return out;
}

export function parseKbcContent(html: string, today: string): OfferContent {
  const lines = kbcLines(html);
  const text = lines.join(' ');
  const deps = parseKbcDepartures(text);
  const lengths = parseKbcLengths(text);
  const longest = lengths[0] ?? { days: 7, nights: 6 };
  const included = section(lines, /^What.s Included$/i, /^Itinerary$/i).filter(l => !/^Use this space/i.test(l));
  const route = ROUTE.filter(r => r.re.test(text));
  const itinerarySpots: ItinerarySpot[] = route.map((r, i) => ({ name: r.name, country: 'Colombia', region: 'La Guajira', order: i + 1 }));
  const since = text.match(/operating in La Guajira since (\d{4})/i)?.[1];
  const summary = [
    `Kiteboarding Colombia (Kite Addict Colombia, in La Guajira${since ? ` since ${since}` : ''}) runs the Wild North kite trip, a guided 4x4 road trip through the La Guajira desert from Mayapo to Cabo de la Vela and Punta Gallinas, the northernmost point of South America, with a downwinder to La Boquita and a sunset at the Taroa dunes.`,
    `It is sold as ${lengths.map(l => `${l.days} days / ${l.nights} nights`).join(', ').replace(/, ([^,]*)$/, ' or $1') || '7 days / 6 nights'} with accommodation, 4x4 transport, a kite guide, organized downwinders, boat support and photos; plans for independent riders, for beginners with lessons and gear, or with full gear rental.`,
    `No price is printed (on request via WhatsApp). ${kbcDatesSentence(deps, today)}`,
  ].join(' ');
  const imgs = imageCandidates(html, KBC_TRIP_URL, null, 60).map(u => u.replace(/^http:\/\/(?:www\.)?kiteboardingcolombia\.com/, SITE));
  const imageUrls = [...new Set([...imgs.filter(u => /KiteSafari/i.test(u)), ...imgs])].filter(u => !/logo|icon/i.test(u)).slice(0, 30);
  return {
    kind: 'tour',
    title: 'Kite Trip Wild North: Cabo de la Vela & Punta Gallinas (Kiteboarding Colombia)',
    summary,
    continent: 'South America',
    country: 'Colombia',
    region: 'La Guajira',              // as kiteadventure-colombia-course-stay-mayapo.ts / global-kite-trips-kite-safari-colombia.ts
    spot: 'Mayapo',                    // start point (transfer from Riohacha to Mayapo on day 1)
    itinerarySpots,
    durationDays: longest.days,
    skillLevels: ['beginner', 'intermediate', 'advanced'], // "All levels welcome"; Rookie to Rockstar = beginners
    kiteLessons: /Kite lessons with certified instructors/i.test(text),
    equipmentRental: /Full kitesurf equipment rental/i.test(text) || null,
    beginnerFriendly: /All levels welcome|BEGINNERS/i.test(text),
    includedServices: included,
    optionalServices: [
      ...(/ROO?CKIE TO ROCKSTAR/i.test(text) ? ['Plan "Rookie to Rockstar": kite lessons with certified instructors, gear during lessons'] : []),
      ...(/LIGHT TRAVELER/i.test(text) ? ['Plan "Light Traveler": full kitesurf equipment rental'] : []),
      ...(/Private trips for groups/i.test(text) ? ['Private trips for groups, custom routes and extra days'] : []),
    ],
    accommodation: 'Lodging along the route (Mayapo, Cabo de la Vela, Punta Gallinas)',
    mealPlan: 'breakfast; lunch and dinner optional',
    languages: ['en', 'es'],
    rooms: [],
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: KBC_TRIP_URL,
    bookingUrl: `https://wa.me/${WHATSAPP.slice(1)}`,
    sourceText: text,
  };
}

export async function fetchKbcSlots(ctx: FetchContext, today: string): Promise<Slot[]> {
  const deps = parseKbcDepartures(kbcLines(await page(KBC_TRIP_URL)).join(' '));
  if (deps.length === 0) ctx.note('no dated departure printed on the page');
  const past = deps.filter(d => d.start < today);
  if (past.length) ctx.note(`${past.length} past departure(s) dropped (${past.map(d => d.start).join(', ')})`);
  return buildKbcSlots(deps, today);
}

export const kiteboardingColombiaWildNorthKiteTrip: OfferAdapter = {
  key: 'kiteboarding-colombia-wild-north-kite-trip',
  name: 'Kiteboarding Colombia - Kite Trip Wild North: Cabo de la Vela & Punta Gallinas',
  kind: 'tour',
  operator: {
    name: 'Kiteboarding Colombia',
    websiteUrl: `${SITE}/`,
    rootDomain: 'kiteboardingcolombia.com',
    whatsapp: WHATSAPP,
    phone: WHATSAPP,
  },
  url: KBC_TRIP_URL,
  slotMethod: 'html_dates',
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() {
    return parseKbcContent(await page(KBC_TRIP_URL), todayIso());
  },
  fetchSlots: ctx => fetchKbcSlots(ctx, todayIso()),
};
