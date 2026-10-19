// ---------------------------------------------------------------------------
// Shark Bay Kitesurfing + KiteWest - "Kite Tours One Week Progression", Denham (Shark Bay, Western Australia):
// a dated 7-day progression camp from the school's 6-bedroom beach house in Denham: 12-hour IKO/KA beginner
// course or a 12-hour progression package, accommodation, all meals (breakfast, morning tea, lunch, dinner),
// kite equipment, free pick-up at Monkey Mia airport. One base -> KIND = 'camp' (the school calls it a "tour").
//
// Data path (checked 2026-10-19): WordPress + WooCommerce variable product, one page:
//   https://sharkbaykitesurfing.com/product/progression/
//   dates    the page's "PROGRESSION CAMP / 7 days In SHARK BAY" list: "08-15 February 2026", "08-15 November 2026",
//            "06-13 December 2026", "07-14 February 2027" (any "dd-dd Month yyyy" line is read, so new dates
//            appear without a code change; dates before today are dropped).
//   prices   the add-to-cart form's own variation data (`data-product_variations`, shared WooCommerce helper in
//            kite-republic-aitutaki-winter-escape.ts): "Shared room 2 beds" 2,995, "Room Queens bed" 3,195,
//            "Master room Queens bed" 3,295 - the same as the page's "* Shared room 2 beds $2995/pers" list.
//            AUD: Product JSON-LD `priceCurrency` + the printed "From AU$ 2995*".
//   Slots: one per future date x room type, AUD per person (package, "Prices are per person in an all included
//   package"). The shop's variations have NO date attribute, so the checkout (50% deposit or full payment) does
//   not pick the week; the stock flag is per room type, not per date -> availability 'unknown' when the room type
//   is in stock (sold_out when the shop marks it out of stock), liveAvailability not set; instantBooking left
//   unset (a paid checkout exists, but a week cannot be chosen in it - unsure, see the report).
//   content  the same page + the LocalBusiness JSON-LD (address "Nicholson Point, Denham - Shark Bay", geo);
//            photos also from the home page slider (the product page has two).
// Known conflicts on the page (2026-10-19): the package box says "12 hours" of lessons, the conditions list says
//   "6 hours kite lessons included"; "Kite equipment provided" vs "Rental Gear" under optional. Kept as printed in
//   the summary ("12-hour course or progression package"; the 6 h line is in sourceText).
// robots.txt (2026-10-19): WooCommerce defaults; product pages allowed.
// Requests per run: content 2 (product + home page), slots 1 (product page memoised).
// ---------------------------------------------------------------------------
import { clean, daysInclusive, ldOfType, parseRange, todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';
import { memoPage, parseWooVariations, wooCurrency, wpImages, wpLines, type WooVariation } from './kite-republic-aitutaki-winter-escape.js';

export const SBK_SITE = 'https://sharkbaykitesurfing.com';
export const SBK_PROGRESSION_URL = `${SBK_SITE}/product/progression/`;
/** logos, the author photo, the spot map graphic and partner badges are not listing photos */
const SBK_IMAGE_SKIP = /kitewest|action-sport|accredit|partner|author|Map_|SharkBayKiteSurfing-Logo/i;

export const SBK_OPERATOR: OperatorRef = {
  name: 'Shark Bay Kitesurfing',
  websiteUrl: SBK_SITE,
  rootDomain: 'sharkbaykitesurfing.com',
  contactEmail: 'info@sharkbaykitesurfing.com',
  phone: '+61407896453',
};

export interface SbkWeek { start: string; end: string; label: string }
export interface SbkCamp { weeks: SbkWeek[]; rooms: WooVariation[]; currency: string | null; lines: string[] }

/** Every "08-15 November 2026" / "28 Nov - 05 Dec 2026" line of the page (short lines with a year). */
export function parseSbkCamp(html: string): SbkCamp {
  const lines = wpLines(html);
  const weeks: SbkWeek[] = [];
  for (const l of lines) {
    // "08-15 November 2026", "28 Nov - 05 Dec 2026": starts with a day, has a month word, ends with the year
    if (l.length > 40 || !/^\d{1,2}\s?[-\u2013 ].*[A-Za-z]{3,}.*\b20\d{2}$/.test(l)) continue;
    const r = parseRange(l);
    if (r && !weeks.some(w => w.start === r.start)) weeks.push({ ...r, label: l });
  }
  return { weeks, rooms: parseWooVariations(html), currency: wooCurrency(html), lines };
}

const roomUnit = (v: WooVariation): string => {
  const raw = Object.values(v.attributes)[0] ?? '';
  // the page's own price list names the queen rooms "Private room Queens bed" / "Private Master room Queens bed"
  return clean(raw).replace(/^Room Queens bed$/i, 'Private room, queen bed').replace(/^Master room Queens bed$/i, 'Private master room, queen bed')
    .replace(/^Shared room 2 beds$/i, 'Shared room, 2 beds');
};

export function buildSbkSlots(c: SbkCamp, today: string): Slot[] {
  const out: Slot[] = [];
  for (const w of c.weeks) {
    if (w.start < today) continue;
    for (const v of c.rooms) {
      if (v.price === null) continue;
      const unit = roomUnit(v);
      out.push({
        key: `${w.start}|${unit.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
        startDate: w.start,
        endDate: w.end,
        unit,
        price: v.price,
        currency: c.currency,
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: /shared/i.test(unit) ? 2 : 1,
        availability: v.inStock && v.purchasable ? 'unknown' : 'sold_out',
        availabilityText: v.inStock
          ? 'Room type in stock in the online shop (stock is per room type, not per date); 50% deposit or full payment online'
          : (v.stockText ?? 'Out of stock in the online shop'),
        spotsLeft: null,
      });
    }
  }
  return out;
}

export function sbkCoords(html: string): { lat: number; lng: number } | null {
  for (const b of ldOfType(html, 'LocalBusiness')) {
    const g = b.geo as Record<string, unknown> | undefined;
    const lat = Number(g?.latitude); const lng = Number(g?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0) return { lat, lng };
  }
  return null;
}

export function parseSbkContent(html: string, homeHtml: string | null = null, today = todayIso()): OfferContent {
  const c = parseSbkCamp(html);
  if (!c.weeks.length) throw new Error('sharkbay-progression: no "dd-dd Month yyyy" camp dates (layout changed?)');
  if (!c.rooms.length) throw new Error('sharkbay-progression: no variation data (layout changed?)');
  const future = c.weeks.filter(w => w.start >= today);
  const nights = daysInclusive(c.weeks[0].start, c.weeks[0].end) - 1;
  const cheapest = Math.min(...c.rooms.map(r => r.price ?? Infinity));
  const cur = c.currency ?? 'AUD';
  const fmt = (n: number): string => n.toLocaleString('en-US');
  const datesText = future.length
    ? `Camp weeks: ${future.map(w => `${w.start} to ${w.end}`).join(', ')}`
    : `Runs several times a year; the next dates are not published yet (last: ${c.weeks.map(w => w.label).join(', ')})`;

  const summary = [
    `Shark Bay Kitesurfing and KiteWest run a one-week progression kite camp in Denham, Shark Bay (Western Australia): ${nights} nights in the school's six-bedroom beach house with all meals, and either a 12-hour IKO/KA beginner course or a 12-hour progression package on the bay's flat, shallow water.`,
    'Kite equipment and the pick-up at Monkey Mia airport are included; video clinics, rental gear, fishing and wildlife safaris can be added, and riders from 12 years and non-kiting partners are welcome.',
    `${datesText}.`,
    `Prices are per person, all included: ${cur} ${fmt(cheapest)} in a shared room, more for a private or master room with a queen bed; a 50% deposit books online.`,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Shark Bay One Week Progression Kite Camp',
    summary,
    continent: 'Oceania',
    country: 'Australia',
    region: 'Shark Bay, Western Australia',
    spot: 'Denham',
    spotCoords: sbkCoords(html),
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      '12-hour IKO/KA beginner course or 12-hour progression package',
      `${nights} nights in the kite house (6 bedrooms, ocean views, walk to the beach)`,
      'All meals: breakfast, morning tea, lunch and dinner',
      'Kite equipment',
      'Free pick-up at Monkey Mia airport',
    ],
    optionalServices: ['Video clinic', 'Rental gear', 'Fishing safari', 'Wildlife / marine safari, 4WD, diving and cultural tours (Ocean Park Shark Bay)'],
    accommodation: 'shared beach house: 6 bedrooms (shared twin, private queen, master queen), 2 kitchens, A/C',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: c.rooms.map(r => ({ name: roomUnit(r), description: null, features: [] })),
    imageUrls: [...new Set([
      ...wpImages(html, SBK_PROGRESSION_URL, SBK_IMAGE_SKIP),
      ...(homeHtml ? wpImages(homeHtml, SBK_SITE + '/', SBK_IMAGE_SKIP) : []),
    ])].slice(0, 20),
    heroVideoUrl: null,
    sourceUrl: SBK_PROGRESSION_URL,
    bookingUrl: SBK_PROGRESSION_URL,
    sourceText: [
      c.lines.join('\n'),
      `parsed: weeks ${c.weeks.map(w => `${w.start}..${w.end}`).join(', ')}; rooms ${c.rooms.map(r => `${roomUnit(r)}=${r.price}${r.inStock ? '' : ' (out of stock)'}`).join(', ')}; currency ${c.currency}`,
    ].join('\n'),
  };
}

export async function fetchSbkSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const c = parseSbkCamp(await memoPage(SBK_PROGRESSION_URL));
  if (!c.weeks.length) throw new Error('sharkbay-progression: no "dd-dd Month yyyy" camp dates (layout changed?)');
  if (!c.rooms.length) throw new Error('sharkbay-progression: no variation data (layout changed?)');
  if (!c.currency) ctx?.note('no priceCurrency in the Product JSON-LD');
  const past = c.weeks.filter(w => w.start < today);
  if (past.length) ctx?.note(`${past.length} past camp date(s) dropped (${past.map(w => w.start).join(', ')})`);
  return buildSbkSlots(c, today);
}

export const sharkbayKitesurfingProgressionDenham: OfferAdapter = {
  key: 'sharkbay-kitesurfing-progression-denham',
  name: 'Shark Bay Kitesurfing One Week Progression, Denham',
  kind: 'camp',
  operator: SBK_OPERATOR,
  url: SBK_PROGRESSION_URL,
  slotMethod: 'html_dates',
  fetchBudget: 3,
  async fetchContent() {
    const html = await memoPage(SBK_PROGRESSION_URL);
    // the product page has only two photos; the home page slider adds the school's beach / riding photos
    const home = await memoPage(`${SBK_SITE}/`).catch(() => null);
    return parseSbkContent(html, home);
  },
  fetchSlots: ctx => fetchSbkSlots(todayIso(), ctx),
};
