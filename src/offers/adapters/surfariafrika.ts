// ---------------------------------------------------------------------------
// Surfari Afrika (surfariafrika.dudaone.com, Kenya + Namibia) - three land-based kite tours and a camp
// (Aaron 2026-10-12: "als Tour-Package aufnehmen"; their catamaran cruises live in cruise_offers).
//
// Data path (checked 2026-10-12, Duda site; robots.txt allows all):
//   /primal-explorer             Lamu archipelago, 8 nights (villa Manda Island, eco lodge Kipungani,
//                                Nyali); per-person price by group size + a budget version; "Dates: TBC"
//   /primale-life-downwinder-xl  Kenya coast road trip, 7 spots + 5 downwinders; "cost 2100€ sharing
//                                2450€ SINGLE UPGRADE"; the date sits on the site-wide card
//                                "Roadtrip / Downwinder xl 31 - 9 FEBRUARI 2027" (10 days)
//   /downwinder-namibia          10-day downwinder expedition, Walvis Bay - Sandwich Harbour; the page
//                                prints "Price: ........ Euro per person" → price on request; the site-wide
//                                card "Namibia Kiteboarding October, November, December 2026" → one season slot
//                                (the hub /namibia4e50299d says the downwinder dates are "To be confirmed")
// The site keeps older parallel pages of the same products (/project-page: road trip at €1600,
// /Remoteislands: older Lamu trip); the newest pages above are the source. The "ARCHIPELAGO 31 - 7
// FEBRUARY" card links to /Remoteislands, so it is NOT used as a Primal Explorer date.
//   /walvis-bay                  (added 2026-10-31, Aaron) weekly budget camp at the Walvis Bay lagoon, the hub's
//                                "Bird Lagoon & Marine SURfari"; "Starting at: 800€ per week", "WHEN 10 OCTOBER UP
//                                TO NOVEMBER" (year from the site-wide Namibia card) → one season slot per week
// Not ingested: /safari-2027---2-nights (a wildlife safari without kiting).
// Requests per run: 1 per adapter (content and slots each fetch the page once).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, monthOf, parse, todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';

const BASE = 'https://surfariafrika.dudaone.com';
export const SA_PRIMAL_EXPLORER_URL = `${BASE}/primal-explorer`;
export const SA_DOWNWINDER_XL_URL = `${BASE}/primale-life-downwinder-xl`;
export const SA_NAMIBIA_URL = `${BASE}/downwinder-namibia`;
export const SA_WALVIS_URL = `${BASE}/walvis-bay`;

const OPERATOR: OperatorRef = {
  name: 'Surfari Afrika',
  websiteUrl: BASE,
  rootDomain: 'surfariafrika.dudaone.com',
  whatsapp: '+254719372145',
};

/** Page text after the site menu (the menu ends with the "LILY" entry on every page). Decoded with
 *  node-html-parser: src/lib/content.ts htmlToText drops entities like &euro; (known bug, left alone
 *  because the cruise monitor hashes its output). */
function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script,style,noscript,svg')) el.remove();
  const t = collapse(root.structuredText);
  const i = t.indexOf(' LILY ');
  return i >= 0 ? t.slice(i + 6) : t;
}
/** "21 00" (Duda splits numbers) / "2,400" → 2100 / 2400 */
const amount = (s: string): number => Number(s.replace(/[\s,.]/g, ''));
const human = (isoDate: string): string =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const images = (html: string, url: string): string[] =>
  imageCandidates(html, url, null, 60).filter(u => !/196977156_10158294017393511/.test(u)); // site-wide header photo
/** Kenya photos the site shows on EVERY page (group on a Kenyan dune path, gear flat-lay, Lamu sand spit;
 *  checked 2026-10-12): fine for the Kenya tours, wrong on the Namibia one. */
const KENYA_SITE_WIDE = /324846706_531272312299333|82329993_10156984078613511|IMG_20211029_154320/;

function undated(key: string, unit: string | null, price: number | null, text: string | null): Slot {
  return {
    key, startDate: null, endDate: null, unit, price, currency: price ? 'EUR' : null,
    priceUnit: price ? 'package' : null, priceBasis: price ? 'person' : null, occupancy: price ? 2 : null,
    availability: 'on_request', availabilityText: text, spotsLeft: null,
  };
}

// --- Primal Explorer (Lamu) --------------------------------------------------------------------
export interface SaTier { guests: string; premium: number; budget: number | null }
/** "6 Guests €2,400 ... BUDGET €1400 8 Guests €2,300 ... BUDGET €1300 ..." */
export function parseSaPrimalTiers(html: string): SaTier[] {
  const t = pageText(html);
  const out: SaTier[] = [];
  for (const m of t.matchAll(/(\d{1,2}\+?) Guests €\s?(\d[\d,.]*)(.{0,140}?)BUDGET €\s?(\d[\d,.]*)/g)) {
    out.push({ guests: m[1], premium: amount(m[2]), budget: amount(m[4]) });
  }
  return out;
}

export function parseSaPrimalSlots(html: string): Slot[] {
  const tbc = /Dates:\s*TBC/i.test(pageText(html));
  const text = tbc ? 'dates to be confirmed' : null;
  return parseSaPrimalTiers(html).flatMap(t => [
    undated(`premium|${t.guests}`, `Villa + eco lodge, group of ${t.guests}`, t.premium, text),
    ...(t.budget ? [undated(`budget|${t.guests}`, `Budget version, group of ${t.guests}`, t.budget, text)] : []),
  ]);
}

export function parseSaPrimalContent(html: string): OfferContent {
  const tiers = parseSaPrimalTiers(html);
  const prem = tiers.map(t => t.premium), bud = tiers.map(t => t.budget).filter((n): n is number => !!n);
  const range = (xs: number[]) => xs.length ? `EUR ${Math.min(...xs).toLocaleString('en-US')} to ${Math.max(...xs).toLocaleString('en-US')}` : 'on request';
  return {
    kind: 'tour',
    title: 'Primal Explorer: Lamu Archipelago Kite Safari, Kenya',
    summary: [
      'An eight-night guided kite trip through the Lamu archipelago on the north coast of Kenya with Surfari Afrika: three nights in a private villa on Manda Island, three in an eco lodge on the dunes of Kipungani and two in Nyali.',
      'Every day the group rides a different flat-water lagoon or downwind route, reached by sailing dhow or boat taxi with guides and a support boat; boat transfers, meals (except restaurant visits) and group coaching are included.',
      `Prices are per person by group size: ${range(prem)}, or ${range(bud)} for the budget version; flights to Manda Island are extra and the dates are still to be confirmed.`,
    ].join(' '),
    continent: 'Africa',
    country: 'Kenya',
    region: 'Lamu Archipelago',
    spot: 'Manda Island',
    itinerarySpots: [
      { name: 'Manda Island', country: 'Kenya', region: 'Lamu Archipelago', order: 1 },
      { name: 'Kipungani', country: 'Kenya', region: 'Lamu Archipelago', order: 2 },
      { name: 'Nyali', country: 'Kenya', region: 'Mombasa', order: 3 },
    ],
    durationDays: 9, // 8 nights
    skillLevels: ['intermediate', 'advanced'], // inferred: daily downwinders, no beginner course offered
    kiteLessons: true,                           // group coaching + video analysis
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: [
      '3 nights private villa on Manda Island (pool, staff, private boat captain)',
      '3 nights eco lodge in Kipungani, full board',
      '2 nights in Nyali',
      'All ground and boat transfers in the archipelago',
      'Breakfast, lunch and dinner (except restaurant visits), water, tea, coffee',
      'Daily kite support, downwinder support boat, group coaching',
      'Private dhow trip to Manda Toto',
    ],
    optionalServices: [],
    accommodation: 'private villa (Manda Island), beachfront eco lodge (Kipungani), coastal hotel (Nyali)',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: [],
    imageUrls: images(html, SA_PRIMAL_EXPLORER_URL),
    heroVideoUrl: null,
    sourceUrl: SA_PRIMAL_EXPLORER_URL,
    bookingUrl: `${BASE}/contact`,
    sourceText: pageText(html),
  };
}

// --- Primal Life Downwinder XL (Kenya coast) -------------------------------------------------
/** "Roadtrip / Downwinder xl 31 - 9 FEBRUARI 2027": start day after end day → start in the previous month. */
export function parseSaXlDates(html: string): { start: string; end: string } | null {
  const m = pageText(html).match(/Roadtrip \/ Downwinder xl\s+(\d{1,2})\s*-\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i);
  const word = m?.[3].toLowerCase().replace(/^februari$/, 'february');
  const em = word ? monthOf(word) : null;
  if (!m || !em) return null;
  const year = +m[4];
  const [sd, ed] = [+m[1], +m[2]];
  const sm = sd > ed ? (em === 1 ? 12 : em - 1) : em;
  const sy = sd > ed && em === 1 ? year - 1 : year;
  return { start: iso(sy, sm, sd), end: iso(year, em, ed) };
}

/** "cost 21 00€ sharing 2450€ SINGLE UPGRADE" */
export function parseSaXlPrices(html: string): { sharing: number; single: number | null } | null {
  const m = pageText(html).match(/cost\s*([\d ]{3,7})€\s*sharing\s*(?:([\d ]{3,7})€\s*single)?/i);
  return m ? { sharing: amount(m[1]), single: m[2] ? amount(m[2]) : null } : null;
}

export function parseSaXlSlots(html: string): Slot[] {
  const d = parseSaXlDates(html);
  const p = parseSaXlPrices(html);
  if (!d || !p) return [];
  const rooms: Array<[string, string, number | null, number]> = [['sharing', 'Shared room', p.sharing, 2], ['single', 'Single room', p.single, 1]];
  return rooms.filter(([, , price]) => price).map(([key, unit, price, occ]) => ({
    key: `${d.start}|${key}`, startDate: d.start, endDate: d.end, unit, price, currency: 'EUR',
    priceUnit: 'package', priceBasis: 'person', occupancy: occ,
    availability: 'on_request', availabilityText: null, spotsLeft: null,
  }));
}

export function parseSaXlContent(html: string): OfferContent {
  const d = parseSaXlDates(html);
  const p = parseSaXlPrices(html);
  return {
    kind: 'tour',
    title: 'Primal Life Downwinder XL: Kenya Coast Kite Road Trip',
    summary: [
      'A guided ten-day kite road trip along the Kenyan coast with Surfari Afrika: seven kite spots and five downwinders between Mambrui and the Sabaki river mouth in the north and Kilifi, Ras Mwachema and Diani in the south, with waves and flat water.',
      'A support bus carries people, bags and gear and always leaves after the downwind riders; two guides are on the water, nights are in shared rooms with breakfast, and lunch, dinner, visa and flights are extra.',
      `${p ? `Price EUR ${p.sharing.toLocaleString('en-US')} per person sharing${p.single ? `, EUR ${p.single.toLocaleString('en-US')} with a single room` : ''}` : 'Price on request'}${d ? `, next run ${human(d.start)} to ${human(d.end)}` : ''}.`,
    ].join(' '),
    continent: 'Africa',
    country: 'Kenya',
    region: 'Kenya Coast',
    spot: 'Nyali, Mombasa',
    itinerarySpots: [
      { name: 'Nyali', country: 'Kenya', region: 'Mombasa', order: 1 },
      { name: 'Mambrui', country: 'Kenya', region: 'Kilifi County', order: 2 },
      { name: 'Sabaki', country: 'Kenya', region: 'Kilifi County', order: 3 },          // river-mouth downwinder
      { name: 'Kilifi', country: 'Kenya', region: 'Kilifi County', order: 4 },
      { name: 'Tiwi Beach', country: 'Kenya', region: 'Kwale County', order: 5 },      // Ras Mwachema wave spot
      { name: 'Diani Beach', country: 'Kenya', region: 'Kwale County', order: 6 },
    ],
    durationDays: 10,
    skillLevels: ['intermediate', 'advanced'], // inferred: five downwinders
    kiteLessons: false,
    equipmentRental: null,
    beginnerFriendly: false,
    includedServices: [
      'Guided road backup and transport for riders, bags and gear',
      'Shared rooms (single upgrade possible), breakfast',
      'Two guides on the water, all staff',
      '7 kite spots and 5 downwinders',
      'Transfer Nyali - Mambrui on day 1, return to Diani or Mombasa airport on the last day',
    ],
    optionalServices: ['Single room upgrade'],
    accommodation: 'shared rooms in coastal lodges along the route',
    mealPlan: 'breakfast',
    languages: ['en'],
    rooms: [],
    imageUrls: images(html, SA_DOWNWINDER_XL_URL),
    heroVideoUrl: null,
    sourceUrl: SA_DOWNWINDER_XL_URL,
    bookingUrl: `${BASE}/contact`,
    sourceText: pageText(html),
  };
}

// --- Namibia downwinder ------------------------------------------------------------------------
/** Site-wide card "Namibia Kiteboarding October, November, December 2026" → the Namibia season. The card links to
 *  the Namibia hub (/namibia4e50299d), which lists the downwinder as "To be confirmed, MIN 8 PEOPLE" (checked
 *  2026-10-28): the months are the season, not departures. */
export function parseSaNamibiaSeason(html: string): { start: string; end: string; label: string } | null {
  const m = pageText(html).match(/Namibia Kiteboarding\s+((?:[A-Za-z]+,?\s*(?:and\s+)?)+)\s+(\d{4})/i);
  if (!m) return null;
  const months = m[1].split(/[,\s]+|and/i).map(w => monthOf(w.toLowerCase())).filter((n): n is number => !!n);
  if (!months.length) return null;
  const y = +m[2], first = Math.min(...months), last = Math.max(...months);
  const end = iso(y, last, new Date(Date.UTC(y, last, 0)).getUTCDate());
  const name = (n: number) => new Date(Date.UTC(y, n - 1, 1)).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  return { start: iso(y, first, 1), end, label: `${name(first)} to ${name(last)} ${y}` };
}

export function parseSaNamibiaSlots(html: string, today = todayIso()): Slot[] {
  const t = pageText(html);
  if (!/10-Day Itinerary/i.test(t)) return [];
  const m = t.match(/Price:\s*([\d.,]+)\s*Euro per person/i);
  const price = m && /\d/.test(m[1]) ? amount(m[1]) : null; // the page prints "Price: ........ Euro"
  const real = price && price > 100 ? price : null;
  const season = parseSaNamibiaSeason(html);
  if (season && season.end >= today) {
    return [{
      ...undated(`season|${season.start.slice(0, 7)}`, null, real, `Namibia season ${season.label}; exact dates${real ? '' : ' and price'} on request`),
      startDate: season.start, endDate: season.end, datePrecision: 'season',
    }];
  }
  return [undated('expedition', null, real, real ? null : 'price on request')];
}

export function parseSaNamibiaContent(html: string, today = todayIso()): OfferContent {
  const season = parseSaNamibiaSeason(html);
  return {
    kind: 'tour',
    title: 'Namibia Downwinder Kite Safari',
    summary: [
      'A ten-day kite expedition on the Namib desert coast with Surfari Afrika, for experienced riders: a five-day downwinder of about 280 km from St. Francis Bay over Meob Bay, Conception Bay and Sandwich Harbour back to Walvis Bay, plus a wave session at Donkey Bay.',
      'Support vehicles follow along the shore, the group crosses the dunes by 4x4 and sleeps in a lodge and in dome tents between the dunes and the Atlantic; transport, guide, park fees and meals as per itinerary are included.',
      season && season.end >= today ? `Price on request; the Namibia season runs ${season.label}, exact dates on request.` : 'Price and dates on request.',
    ].join(' '),
    continent: 'Africa',
    country: 'Namibia',
    region: 'Erongo',
    spot: 'Walvis Bay',
    itinerarySpots: [
      { name: 'Walvis Bay', country: 'Namibia', region: 'Erongo', order: 1 },
      { name: 'Meob Bay', country: 'Namibia', region: 'Hardap', order: 2 },
      { name: 'Conception Bay', country: 'Namibia', region: 'Hardap', order: 3 },
      { name: 'Sandwich Harbour', country: 'Namibia', region: 'Erongo', order: 4 },
      { name: 'Donkey Bay', country: 'Namibia', region: 'Erongo', order: 5 },
    ],
    durationDays: 10,
    skillLevels: ['advanced'],
    kiteLessons: false,
    equipmentRental: null,
    beginnerFriendly: false,
    includedServices: [
      'All transport, fuel and Windhoek airport transfers',
      'Professional guide and safety support from the shore',
      'Accommodation in a lodge (B&B) and wild camping',
      'National park and concession fees',
      'Meals as per itinerary',
    ],
    optionalServices: ['Skydiving, ballooning, scenic flights, dolphin cruises, kayaking in Walvis Bay'],
    accommodation: 'lodge (B&B) and wild camping in dome tents',
    mealPlan: 'meals as per itinerary',
    languages: ['en'],
    rooms: [],
    imageUrls: images(html, SA_NAMIBIA_URL).filter(u => !KENYA_SITE_WIDE.test(u)),
    heroVideoUrl: null,
    sourceUrl: SA_NAMIBIA_URL,
    bookingUrl: `${BASE}/contact`,
    sourceText: pageText(html),
  };
}

// --- Walvis Bay camp (Bird Lagoon & Marine Surfari) -------------------------------------------
/** Footer cards every page carries (Kenya trips, catamaran, safari, contact; checked 2026-10-31): not Walvis Bay. */
const SITE_WIDE_CARDS = /324846706_531272312299333|82329993_10156984078613511|IMG_20211029_154320|ChatGPT\+Image|lamu1-1920x678|967cd710_original|febf691aa9f7ba610a643f43e5108ad0|vintage-typewriters/;

/** "WHEN 10 OCTOBER UP TO NOVEMBER": the year comes from the site-wide "Namibia Kiteboarding ... 2026" card. */
export function parseSaWalvisSeason(html: string): { start: string; end: string; label: string } | null {
  const t = pageText(html);
  const m = t.match(/WHEN\s+(\d{1,2})\s+([A-Za-z]+)\s+UP TO\s+([A-Za-z]+)/i);
  const year = parseSaNamibiaSeason(html)?.start.slice(0, 4);
  const sm = m ? monthOf(m[2].toLowerCase()) : null, em = m ? monthOf(m[3].toLowerCase()) : null;
  if (!m || !sm || !em || !year) return null;
  const y = +year, ey = em < sm ? y + 1 : y;
  const start = iso(y, sm, +m[1]), end = iso(ey, em, new Date(Date.UTC(ey, em, 0)).getUTCDate());
  return { start, end, label: `${human(start)} to ${human(end)}` };
}

/** "Pricing Starting at: 800€ per week" */
export function parseSaWalvisPrice(html: string): number | null {
  const m = pageText(html).match(/Starting at:?\s*([\d .,]{2,7})\s*€\s*per week/i);
  return m ? amount(m[1]) : null;
}

export function parseSaWalvisSlots(html: string, today = todayIso()): Slot[] {
  const price = parseSaWalvisPrice(html);
  const season = parseSaWalvisSeason(html);
  const weekly = (s: Slot): Slot => ({ ...s, priceUnit: price ? 'per_week' : null });
  if (season && season.end >= today) {
    return [weekly({
      ...undated(`season|${season.start.slice(0, 7)}`, 'Weekly camp, shared room', price, `"Starting at ${price ?? '?'}€ per week", season ${season.label}; exact dates and final price on request`),
      startDate: season.start < today ? today : season.start, endDate: season.end, datePrecision: 'season',
    })];
  }
  return [weekly(undated('weekly', 'Weekly camp, shared room', price, 'season and exact dates on request'))];
}

export function parseSaWalvisContent(html: string, today = todayIso()): OfferContent {
  const price = parseSaWalvisPrice(html);
  const season = parseSaWalvisSeason(html);
  const all = images(html, SA_WALVIS_URL).filter(u => !SITE_WIDE_CARDS.test(u));
  // Duda prints each photo as -1920w and -640w; the ingest does not dedupe size variants
  const own = all.filter(u => !/-640w\./.test(u) || !all.includes(u.replace('-640w.', '-1920w.')));
  return {
    kind: 'camp',
    title: 'Walvis Bay Kite Camp: Bird Lagoon & Marine Surfari, Namibia',
    summary: [
      'A budget weekly kite camp at the Walvis Bay lagoon on the Namib desert coast with Surfari Afrika: waist-deep flat water for freestyle, the 2.5 km offshore "Speed Strip" one tack away, and two to three guided downwinders such as the Pelican Point run past the seal colony and shipwrecks.',
      'Guests stay in a new eco lodge a short walk from the lagoon, sharing or with a single upgrade, self-catering or with the small on-site restaurant; airport transfers from Windhoek, 4x4 support, guiding, kite bag storage and visits to different spots are included, and certified lessons and premium rental gear are available for beginners to advanced riders.',
      `${price ? `Prices start at EUR ${price.toLocaleString('en-US')} per person per week` : 'Price on request'}${season && season.end >= today ? `; the camp season runs ${season.label}` : ''}, exact dates on request.`,
    ].join(' '),
    continent: 'Africa',
    country: 'Namibia',
    region: 'Erongo',
    spot: 'Walvis Bay',
    itinerarySpots: [
      { name: 'Walvis Bay', country: 'Namibia', region: 'Erongo', order: 1 },
      { name: 'Pelican Point', country: 'Namibia', region: 'Erongo', order: 2 },
    ],
    durationDays: 7,
    skillLevels: ['beginner', 'intermediate', 'advanced'], // the Namibia hub: "Beginner to Advanced"
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      'Airport transfers and transport between Windhoek and Walvis Bay',
      'Accommodation on a sharing basis in an eco lodge at the lagoon',
      'Guiding to different lagoons and spots by 4x4, secure kite bag storage',
      '4x4 support and on-water and beach assistance on all downwinders',
    ],
    optionalServices: [
      'Single room upgrade',
      'Self-catering option or the restaurant on site',
      'Certified kite lessons and premium rental gear',
      'Extra accommodation and transfers in Windhoek',
    ],
    accommodation: 'eco lodge at the Walvis Bay lagoon, shared or single rooms',
    mealPlan: null,
    languages: ['en'],
    rooms: [],
    imageUrls: own,
    heroVideoUrl: null,
    sourceUrl: SA_WALVIS_URL,
    bookingUrl: `${BASE}/contact`,
    sourceText: pageText(html),
  };
}

// --- adapters ------------------------------------------------------------------------------------
export const surfariafrikaPrimalExplorer: OfferAdapter = {
  key: 'surfariafrika-primal-explorer',
  name: 'Surfari Afrika Primal Explorer (Lamu, Kenya)',
  kind: 'tour', operator: OPERATOR, url: SA_PRIMAL_EXPLORER_URL,
  slotMethod: 'price_table', fetchBudget: 2,
  async fetchContent() { return parseSaPrimalContent(await fetchText(SA_PRIMAL_EXPLORER_URL)); },
  async fetchSlots(ctx) {
    const slots = parseSaPrimalSlots(await fetchText(SA_PRIMAL_EXPLORER_URL));
    ctx.note('group-size price table, dates to be confirmed: undated on-request slots');
    return slots;
  },
};

export const surfariafrikaDownwinderXl: OfferAdapter = {
  key: 'surfariafrika-downwinder-xl',
  name: 'Surfari Afrika Primal Life Downwinder XL (Kenya coast)',
  kind: 'tour', operator: OPERATOR, url: SA_DOWNWINDER_XL_URL,
  slotMethod: 'html_dates', fetchBudget: 2,
  async fetchContent() { return parseSaXlContent(await fetchText(SA_DOWNWINDER_XL_URL)); },
  async fetchSlots(ctx) {
    const html = await fetchText(SA_DOWNWINDER_XL_URL);
    if (!parseSaXlDates(html)) ctx.note('no "Roadtrip / Downwinder xl <dates>" card on the page');
    return parseSaXlSlots(html);
  },
};

export const surfariafrikaNamibiaDownwinder: OfferAdapter = {
  key: 'surfariafrika-namibia-downwinder',
  name: 'Surfari Afrika Namibia downwinder expedition',
  kind: 'tour', operator: OPERATOR, url: SA_NAMIBIA_URL,
  slotMethod: 'price_table', fetchBudget: 2,
  confidence: 'low', // no price on the page, only the Namibia season (site-wide card)
  async fetchContent() { return parseSaNamibiaContent(await fetchText(SA_NAMIBIA_URL)); },
  async fetchSlots() { return parseSaNamibiaSlots(await fetchText(SA_NAMIBIA_URL)); },
};

export const surfariafrikaWalvisBayCamp: OfferAdapter = {
  key: 'surfariafrika-walvis-bay-camp',
  name: 'Surfari Afrika Walvis Bay kite camp (Bird Lagoon & Marine Surfari)',
  kind: 'camp', operator: OPERATOR, url: SA_WALVIS_URL,
  slotMethod: 'price_table', fetchBudget: 2,
  confidence: 'low', // a "starting at" weekly price and a season, no departures
  async fetchContent() { return parseSaWalvisContent(await fetchText(SA_WALVIS_URL)); },
  async fetchSlots(ctx) {
    const html = await fetchText(SA_WALVIS_URL);
    if (!parseSaWalvisSeason(html)) ctx.note('no "WHEN <day> <month> UP TO <month>" line or Namibia season card');
    return parseSaWalvisSlots(html);
  },
};
