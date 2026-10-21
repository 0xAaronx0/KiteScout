// ---------------------------------------------------------------------------
// Kite Buen Hombre - "7-Day Special" kite stay package (Playa Buen Hombre, Monte Cristi, Dominican Republic):
// 6 nights in the school's beach bungalows, three meals a day, bottled water, kite equipment and either the
// 11-hour beginner course (10 + 1 bonus hour) or the 10-hour advanced course, plus camp services. Sold per person,
// year-round. KIND = 'camp'. Second listing next to the 10-Day Special (kite-buen-hombre-10-day-special.ts, whose
// helpers are imported); the provider's lodge itself is kite-buen-hombre-eco-lodge.ts (not edited).
//
// Data path (checked 2026-10-21): the same single Wix page /kite-stay-packages-dominican-republic.
//   prices   visible "7-Day Special: $1,333 beginner · $1,433 advanced per person (save $27)". The JSON-LD
//            OfferCatalog carries only the beginner price (1333 USD "per person") -> the visible line is read for
//            both variants, the JSON-LD gives the currency (USD) and the nights ("6 nights accommodation ...").
//   season   the visible "Season special. Six nights free." block: "Stay any week from 1 November to 15 December
//            2026: book the 10-hour kite course ($850) and get up to 6 nights free in Buen Hombre. Meals and service
//            are $55 a day, so the 7-day stay is $1,235 in total, plus airport transfer. Reserve with a $425 deposit
//            by 15 November. Only 10 places a week." This is the same 7-day / 6-night stay with course and meals at
//            a lower price, so it becomes a dated band slot of this listing (2026-11-01..2026-12-15,
//            priceValidUntil = the deposit deadline). It is sold in the Wix Stores shop as a product
//            (/product-page/season-special-6-nights-free: "Deposit - $425 now, $810 on arrival" / "Pay in full -
//            $1,235") -> availability 'available' for that slot. The slot disappears once the deposit deadline or
//            the window end has passed. A coming "spring special" (May-June) has no price yet: ignored.
// Booking: "Book the 7-Day Special" links to the shop's kite-lessons category (course products only, no stay);
//   the package itself is booked on request (/book, WhatsApp) -> 'on_request', instantBooking false for the listing.
// robots.txt (2026-10-21): Wix default, the page is allowed. Requests per run: 1 (memoised, shared with the 10-Day).
// Doubts: the Season Special is assumed to include gear (the course products include it) but the page does not
//   list kite equipment / camp services for it like it does for the 7-Day Special.
// Flags: liveAvailability no (static page), instantBooking false (package on request).
// ---------------------------------------------------------------------------
import { todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';
import {
  KBH_BOOK_URL, KBH_COORDS, KBH_OPERATOR, KBH_PACKAGES_PAGE, kbhExtras, kbhImages, kbhInclusions, kbhOffer, kbhPage,
  kbhText, parseKbhOffers, parseKbhSeasonSpecial, usd, type KbhSeasonSpecial,
} from './kite-buen-hombre-10-day-special.js';

export interface Kbh7Day { beginner: number; advanced: number | null; currency: string; nights: number; description: string }

/** "7-Day Special: $1,333 beginner · $1,433 advanced per person" (+ JSON-LD currency / nights). */
export function parseKbh7Day(html: string): Kbh7Day | null {
  const text = kbhText(html);
  const offer = kbhOffer(parseKbhOffers(html), /^7-Day/i);
  const m = text.match(/7-Day Special:\s*\$\s?([\d,]+)\s*beginner\s*[·,/]?\s*(?:\$\s?([\d,]+)\s*advanced)?/i);
  const beginner = m ? Number(m[1].replace(/,/g, '')) : offer?.price ?? null;
  if (!beginner) return null;
  return {
    beginner,
    advanced: m?.[2] ? Number(m[2].replace(/,/g, '')) : null,
    currency: offer?.currency ?? 'USD',
    nights: offer?.nights ?? Number(text.match(/(\d+) nights accommodation · 3 meals daily · bottled water · kite equipment · 11-hour beginner course \(10/i)?.[1] ?? 6),
    description: offer?.description ?? '',
  };
}

export function buildKbh7DaySlots(p: Kbh7Day, season: KbhSeasonSpecial | null, today: string): Slot[] {
  const base = {
    startDate: null, endDate: null, currency: p.currency, priceUnit: 'package' as const, priceBasis: 'person' as const,
    occupancy: 1, availability: 'on_request' as const, availabilityText: 'Regular Kite Stay Packages are available year-round',
    spotsLeft: null, packageNights: p.nights,
  };
  const slots: Slot[] = [
    { ...base, key: '7-day-special|beginner', unit: '7-Day Special, 11-hour beginner course', price: p.beginner },
  ];
  if (p.advanced) slots.push({ ...base, key: '7-day-special|advanced', unit: '7-Day Special, 10-hour advanced course', price: p.advanced });
  if (season && season.end >= today && (!season.depositBy || season.depositBy >= today)) {
    slots.push({
      key: `season-special|${season.start}`,
      startDate: season.start,
      endDate: season.end,
      unit: 'Season Special: 10-hour kite course + 6 nights free, meals included',
      price: season.total,
      currency: 'USD',
      priceUnit: 'package',
      priceBasis: 'person', // "all package prices shown on this page are per person"
      occupancy: 1,
      availability: 'available', // sold in the Wix Stores shop with a deposit
      availabilityText: [
        season.deposit && season.depositBy ? `Reserve with a $${season.deposit} deposit by ${season.depositBy}` : null,
        season.placesPerWeek ? `only ${season.placesPerWeek} places a week` : null,
        'plus airport transfer',
      ].filter(Boolean).join('; '),
      spotsLeft: null,
      packageNights: season.days ? season.days - 1 : 6,
      priceValidUntil: season.depositBy,
    });
  }
  return slots;
}

export function parseKbh7DayContent(html: string, today: string): OfferContent {
  const text = kbhText(html);
  const p = parseKbh7Day(html);
  if (!p) throw new Error('kite-buen-hombre-7-day: "7-Day Special" price not found');
  const season = parseKbhSeasonSpecial(text);
  const seasonLive = season && season.end >= today && (!season.depositBy || season.depositBy >= today);
  const summary = [
    `The 7-Day Special is Kite Buen Hombre's one-week kite camp package at Playa Buen Hombre (Monte Cristi, north-west Dominican Republic), on the shallow flat-water lagoon beside the school's own beach lodge.`,
    `It covers ${p.nights} nights in a beach bungalow, three meals a day, bottled water, kite equipment and camp services plus either the 11-hour beginner course or the 10-hour advanced course.`,
    `It costs ${usd(p.beginner)} per person with the beginner course${p.advanced ? ` or ${usd(p.advanced)} with the advanced course` : ''}, year-round and on request; airport transfers are extra.`,
    seasonLive && season
      ? `For stays between ${season.start} and ${season.end} a Season Special (10-hour course plus 6 free nights, meals at USD ${season.mealsPerDay ?? 55} a day) brings the week to ${usd(season.total)} per person, bookable online with a deposit${season.depositBy ? ` until ${season.depositBy}` : ''}.`
      : '',
  ].filter(Boolean).join(' ');
  return {
    kind: 'camp',
    title: 'Kite Buen Hombre 7-Day Special Kite Camp',
    summary,
    continent: 'North America',
    country: 'Dominican Republic',
    region: 'Monte Cristi',          // as kite-buen-hombre-eco-lodge.ts
    spot: 'Playa Buen Hombre',
    spotCoords: KBH_COORDS,
    itinerarySpots: [],
    durationDays: p.nights + 1,
    skillLevels: p.advanced ? ['beginner', 'intermediate', 'advanced'] : ['beginner'],
    kiteLessons: true,
    equipmentRental: /kite equipment/i.test(p.description) || null,
    beginnerFriendly: true,
    includedServices: kbhInclusions(html, p.nights),
    optionalServices: kbhExtras(text),
    accommodation: /upgrade to a loft room/i.test(text) ? 'Beach bungalow at the school, loft room upgrade available' : 'Beach bungalow at the school',
    mealPlan: 'full_board', // "3 meals daily"
    languages: ['en', 'es'],
    rooms: [],
    imageUrls: kbhImages(html),
    heroVideoUrl: null,
    sourceUrl: KBH_PACKAGES_PAGE,
    bookingUrl: KBH_BOOK_URL,
    sourceText: [`7-day: ${JSON.stringify(p)}`, `season special: ${JSON.stringify(season)}`, `page: ${text}`].join('\n'),
  };
}

export const kiteBuenHombre7DaySpecial: OfferAdapter = {
  key: 'kite-buen-hombre-7-day-special',
  name: 'Kite Buen Hombre - 7-Day Special kite camp, Buen Hombre',
  kind: 'camp',
  operator: KBH_OPERATOR,
  url: KBH_PACKAGES_PAGE,
  slotMethod: 'price_table',
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() {
    return parseKbh7DayContent(await kbhPage(), todayIso());
  },
  async fetchSlots(ctx) {
    const html = await kbhPage();
    const p = parseKbh7Day(html);
    if (!p) throw new Error('kite-buen-hombre-7-day: "7-Day Special" price not found');
    const season = parseKbhSeasonSpecial(kbhText(html));
    if (!season) ctx.note('season special block not found (ended or rewritten)');
    return buildKbh7DaySlots(p, season, todayIso());
  },
};
