// ---------------------------------------------------------------------------
// KiteXcite - "Stay and Play Package" (Kite Beach, Cabarete, Dominican Republic): the private kite school of
// Stefan Ruether sells one lesson + hotel package: 6 nights for 2 persons in a standard room (twin beds, cable TV,
// AC) at Kitebeach Hotels on Kite Beach plus private "VIP" lessons and supervision with equipment for one person,
// USD 989 (inferred, see below). No dates, no meals. KIND = 'camp'.
//
// Data path (checked 2026-10-21): WordPress, ONE page /kitexcite-packages/ (Yoast dateModified 2019-11-14; the site
//   itself is live: current-time widget, contact by mail / WhatsApp). Text: "Stay and Play Package", "Standard Room
//   for 2 person at KitebeachHotels / 1 person private VIP lesson. / $989", "6 Day KiteBeach Accommodation for 2
//   Person with 3 Days Lessons and Supervisions for one person.", "Includes 6 nights 2 person accommodation in
//   Kitebeach Hotels standard room ... (day's more or less $50+ or $50-)", "4 days private VIP Lesson and
//   Supervisions. Al VIP lesson are done by Stefan Ruether. (1 day more or less $140+ or $140-)", "(inc. Equipment)".
// DOUBT (recorded, not resolved): the headline says "3 Days Lessons", the inclusion list "4 days private VIP Lesson";
//   both numbers are kept in the slot text and the summary. "6 Day" accommodation vs "6 nights": nights are used
//   (durationDays = 6 + 1 = 7).
// Price: "$989" with no currency word anywhere on the page -> USD INFERRED (Dominican kite schools on Kite Beach
//   price in US dollars; the site's accommodation page prints "$" rates the same way). priceBasis 'group' with
//   occupancy 2: the price is for two persons' room plus one person's lessons, not per person.
// Booking: no cart / checkout for the package; "We can customize this package ... just let us know", contact by
//   mail / WhatsApp -> 'on_request', instantBooking false.
// Images: the page's own photos (Kitebeach restaurant, pool, hotel, a lesson); TripAdvisor and press logos dropped.
// robots.txt (2026-10-21): "User-agent: *" with no rules (everything allowed).
// Requests per run: 1 (memoised).
// Flags: liveAvailability no (static page), instantBooking false (mail / WhatsApp).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse, parseAmount } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kitexcite.com';
export const KX_URL = `${SITE}/kitexcite-packages/`;

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text of the page content (scripts, styles, nav, footer widgets dropped). */
export function kxText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, nav, header, footer')) el.remove();
  return collapse(root.querySelector('article, .entry-content, #content, main, body')?.text ?? root.text)
    .replace(/\s*[—–]\s*/g, ' - ');
}

export interface KxPackage {
  name: string; price: number; currency: string; nights: number | null; guests: number | null;
  lessonDaysHeadline: number | null; lessonDaysList: number | null; extraNight: number | null; extraLessonDay: number | null;
  coach: string | null; equipment: boolean;
}

export function parseKxPackage(html: string): KxPackage | null {
  const t = kxText(html);
  const i = t.search(/Stay and Play Package/i);
  if (i < 0) return null;
  const s = t.slice(i);
  const price = s.match(/\$\s?([\d,]+)(?!\+|-)/);
  if (!price) return null;
  const n = (re: RegExp) => { const x = s.match(re)?.[1]; return x ? Number(x) : null; };
  return {
    name: 'Stay and Play Package',
    price: parseAmount(price[1])!,
    currency: 'USD', // inferred: "$" only
    nights: n(/Includes (\d+) nights/i),
    guests: n(/(\d+) person accommodation/i) ?? n(/for (\d+) person at/i),
    lessonDaysHeadline: n(/with (\d+) Days? Lessons/i),
    lessonDaysList: n(/(\d+) days private VIP Lesson/i),
    extraNight: n(/day.s more or less \$\s?(\d+)\+/i),
    extraLessonDay: n(/1 day more or less \$\s?(\d+)\+/i),
    coach: s.match(/lessons? are done by ([A-Z][a-z]+ [A-Z][a-z]+)/i)?.[1] ?? null,
    equipment: /inc\. Equipment|including equipment/i.test(s),
  };
}

/** the headline and the inclusion list give different lesson-day counts (3 vs 4 on 2026-10-21) */
export function kxLessonDoubt(p: KxPackage): boolean {
  return !!(p.lessonDaysHeadline && p.lessonDaysList && p.lessonDaysHeadline !== p.lessonDaysList);
}

function lessonDays(p: KxPackage): string {
  const a = p.lessonDaysHeadline, b = p.lessonDaysList;
  if (a && b && a !== b) return `${a} or ${b} days`;
  return `${a ?? b ?? '?'} days`;
}

export function buildKxSlots(p: KxPackage): Slot[] {
  return [{
    key: 'stay-and-play',
    startDate: null,
    endDate: null,
    unit: `Standard room for ${p.guests ?? 2} + private VIP lessons for 1, ${lessonDays(p)}${kxLessonDoubt(p) ? ' (page says both)' : ''}`,
    price: p.price,
    currency: p.currency,
    priceUnit: 'package',
    priceBasis: 'group',  // two persons' room + one person's lessons
    occupancy: p.guests ?? 2,
    availability: 'on_request',
    availabilityText: null,
    spotsLeft: null,
    packageNights: p.nights,
  }];
}

const JUNK = /tripadvisor|globe|times|logo|icon|press|badge/i;
export function kxImages(html: string): string[] {
  const out: string[] = [];
  for (const img of parse(html).querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? img.getAttribute('data-src');
    if (!src || !/wp-content\/uploads\//.test(src) || JUNK.test(src)) continue;
    const u = new URL(src.replace(/^http:\/\//, 'https://'), SITE).toString();
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export function parseKxContent(html: string): OfferContent {
  const p = parseKxPackage(html);
  if (!p) throw new Error('kitexcite: "Stay and Play Package" with a $ price not found');
  const nights = p.nights ?? 6;
  const summary = [
    `KiteXcite, the private kite school of ${p.coach ?? 'Stefan Ruether'} on Kite Beach in Cabarete (north coast of the Dominican Republic), sells a Stay and Play package of ${nights} nights for two persons in a standard room with twin beds, cable TV and air conditioning at Kitebeach Hotels plus private VIP kite lessons and supervision for one person, equipment included.`,
    `The page gives ${lessonDays(p)} of lessons${kxLessonDoubt(p) ? ' (it names both numbers)' : ''} and the price as $${p.price.toLocaleString('en-US')} (US dollars assumed) for the whole package${p.extraNight || p.extraLessonDay ? `; each night more or less changes it by $${p.extraNight ?? '?'}, each lesson day by $${p.extraLessonDay ?? '?'}` : ''}.`,
    `Meals are not included, there are no fixed dates and the package is arranged on request by mail or WhatsApp.`,
  ].join(' ');
  return {
    kind: 'camp',
    title: 'KiteXcite Stay and Play Kite Package, Kite Beach Cabarete',
    summary,
    continent: 'North America',
    country: 'Dominican Republic',
    region: 'Puerto Plata',            // as cabarete-boutique-kite-hotel.ts / kite-beach-inn-cabarete.ts
    spot: 'Kite Beach, Cabarete',
    spotCoords: { lat: 19.76256, lng: -70.42241 }, // same beach pin as kite-beach-inn-cabarete (the geocoder finds no 'Kite Beach, Cabarete'), set by the lead 2026-10-21
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'], // private lessons and supervision, level not restricted
    kiteLessons: true,
    equipmentRental: p.equipment || null,
    beginnerFriendly: true,
    includedServices: [
      `${nights} nights for ${p.guests ?? 2} persons in a Kitebeach Hotels standard room (twin beds, cable TV, AC)`,
      `Private VIP kite lessons and supervision for one person, ${lessonDays(p)}, by ${p.coach ?? 'Stefan Ruether'}`,
      ...(p.equipment ? ['Kite equipment during lessons'] : []),
      'Free Wi-Fi',
      'Access to the online teaching video library',
    ],
    optionalServices: [
      ...(p.extraNight ? [`Extra night or one night less: +/- $${p.extraNight}`] : []),
      ...(p.extraLessonDay ? [`Extra lesson day or one day less: +/- $${p.extraLessonDay}`] : []),
    ],
    accommodation: 'Standard room with twin beds at Kitebeach Hotels on Kite Beach (restaurant, pool)',
    mealPlan: null,
    languages: ['en'],                 // English-only site
    rooms: [],
    imageUrls: kxImages(html),
    heroVideoUrl: null,
    sourceUrl: KX_URL,
    bookingUrl: `${SITE}/kitexcite-contact/`,
    sourceText: kxText(html),
  };
}

export const kitexciteStayAndPlayCabarete: OfferAdapter = {
  key: 'kitexcite-stay-and-play-cabarete',
  name: 'KiteXcite - Stay and Play Package, Kite Beach Cabarete',
  kind: 'camp',
  operator: {
    name: 'KiteXcite',
    websiteUrl: `${SITE}/`,
    rootDomain: 'kitexcite.com',
    contactEmail: 'kitexcite@gmail.com',
    whatsapp: '+18299624556',
    phone: '+18299624556',
  },
  url: KX_URL,
  slotMethod: 'price_table',
  instantBooking: false,
  confidence: 'medium',               // 2019 page, inferred currency, 3 vs 4 lesson days
  fetchBudget: 2,
  async fetchContent() {
    return parseKxContent(await page(KX_URL));
  },
  async fetchSlots() {
    const p = parseKxPackage(await page(KX_URL));
    if (!p) throw new Error('kitexcite: "Stay and Play Package" with a $ price not found');
    return buildKxSlots(p);
  },
};
