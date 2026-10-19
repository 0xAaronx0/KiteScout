// ---------------------------------------------------------------------------
// ION CLUB Dakhla Oasis212 "Lessons Package" (Morocco) - ION CLUB's opening offer at its new centre inside the
// Oasis212 hotel on the Dakhla lagoon: 7 nights in a chalet with partial lagoon view (double occupancy), full board,
// round-trip airport transfer, 6 hours of semi-private kitesurf or wing foil lessons (all levels). The page's
// "Rental Package" (same stay with 6 days of gear rental instead of lessons) is a second unit.
//
// This file also holds the SHARED ION CLUB parser used by ion-club-pastorino-camp-dakhla.ts: ion-club.net is
// WordPress / Divi; package prices sit in Divi pricing tables (.et_pb_pricing_table: title, "8 DAYS / 7 NIGHTS",
// .et_pb_sum "830€", the frequency line "price per person, double occupancy, minimum 4 night", inclusion <li>s) or in
// custom cards (.camp-pricing-card: title, "1180€", "/ person"). robots.txt (2026-10-19): /wp-admin/, search, cart,
// checkout, account and feed paths disallowed; pages allowed.
//
// Data path (checked 2026-10-19): /ion-club-dakhla-oasis-212-packages/ prints "Travel & Booking Window: October 5th
//   to December 21th 2026" and the two pricing tables (Rental EUR 780, Lessons EUR 830 per person, double
//   occupancy, minimum 4 nights). "BOOK NOW" jumps to an on-page request form (#forms); bookings@ion-club.net.
// Slots: one season band per package (the travel window, datePrecision 'season'), EUR per person, package of 7
//   nights, occupancy 2, minNights 4 (as printed), availability 'on_request'; dropped once the window has ended (a
//   new window printed on the page is picked up by the daily run).
// Flags: no live inventory, booking by request form -> liveAvailability false, instantBooking false.
// Requests per run: content 1, slots 1 (memoised).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, monthOf, parse, parseAmount, todayIso } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';

export const ION_SITE = 'https://www.ion-club.net';
export const ION_OPERATOR: OperatorRef = {
  name: 'ION CLUB',
  websiteUrl: ION_SITE,
  rootDomain: 'ion-club.net',
  contactEmail: 'bookings@ion-club.net',
};

// --- shared helpers -----------------------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
export function ionFetch(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

export interface IonPrice {
  title: string;
  /** "8 DAYS / 7 NIGHTS" -> 7 */
  nights: number | null;
  days: number | null;
  price: number | null;
  currency: string | null;
  /** the line next to the price ("price per person, double occupancy, minimum 4 night" / "/ person") */
  basis: string;
  /** inclusion bullets / card detail */
  items: string[];
}

function priceCurrency(s: string): string | null {
  return /€|EUR/i.test(s) ? 'EUR' : /\$|USD/.test(s) ? 'USD' : /£|GBP/.test(s) ? 'GBP' : null;
}

/** Divi pricing tables and the custom camp price cards, in page order. */
export function parseIonPrices(html: string): IonPrice[] {
  const root = parse(html);
  const out: IonPrice[] = [];
  for (const t of root.querySelectorAll('.et_pb_pricing_table')) {
    const sum = collapse(t.querySelector('.et_pb_sum')?.text ?? '');
    const dur = collapse(t.querySelector('.et_pb_best_value')?.text ?? '');
    const d = dur.match(/(\d+)\s*DAYS?\s*\/\s*(\d+)\s*NIGHTS?/i);
    out.push({
      title: collapse(t.querySelector('.et_pb_pricing_title')?.text ?? ''),
      nights: d ? Number(d[2]) : null,
      days: d ? Number(d[1]) : null,
      price: sum ? parseAmount(sum) : null,
      currency: priceCurrency(sum),
      basis: collapse(t.querySelector('.et_pb_frequency')?.text ?? '').replace(/^\/\s*/, ''),
      items: t.querySelectorAll('li').map(li => collapse(li.text)).filter(Boolean),
    });
  }
  for (const c of root.querySelectorAll('.camp-pricing-card')) {
    const sum = collapse(c.querySelector('.camp-pricing-price')?.text ?? '');
    out.push({
      title: collapse(c.querySelector('.camp-pricing-card-title')?.text ?? ''),
      nights: null,
      days: null,
      price: sum ? parseAmount(sum) : null,
      currency: priceCurrency(sum),
      basis: collapse(c.querySelector('.camp-pricing-person')?.text ?? '').replace(/^\/\s*/, ''),
      items: [collapse(c.querySelector('.camp-pricing-detail')?.text ?? '')].filter(Boolean),
    });
  }
  return out;
}

/** Visible text without scripts / styles. */
export function ionText(html: string): string {
  const root = parse(html);
  root.querySelectorAll('script, style, noscript').forEach(e => e.remove());
  return collapse((root.querySelector('#main-content') ?? root).text);
}

/** "October 5th to December 21th 2026" (year printed once, at the end). */
export function parseIonWindow(text: string): { start: string; end: string } | null {
  const m = text.match(/([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+to\s+([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})/);
  if (!m) return null;
  const m1 = monthOf(m[1]);
  const m2 = monthOf(m[3]);
  if (!m1 || !m2) return null;
  const y = Number(m[5]);
  return { start: iso(m2 < m1 ? y - 1 : y, m1, Number(m[2])), end: iso(y, m2, Number(m[4])) };
}

/** Product photos: wp-content uploads, minus the site's footer icons (2020/06) and logos. */
export function ionImages(html: string, base: string): string[] {
  return imageCandidates(html, base, null, 40)
    .filter(u => /\/wp-content\/uploads\//.test(u) && !/\/2020\/06\/|logo|\.svg(\?|$)|\.png(\?|$)/i.test(u));
}

// --- Oasis212 packages -------------------------------------------------------------------------------------
export const ION_PKG_URL = `${ION_SITE}/ion-club-dakhla-oasis-212-packages/`;

export interface IonPackagePage { window: { start: string; end: string } | null; lessons: IonPrice | null; rental: IonPrice | null; text: string }

export function parseIonPackagePage(html: string): IonPackagePage {
  const text = ionText(html);
  const w = text.match(/Travel\s*&\s*Booking Window:\s*([^.]*?20\d{2})/i);
  const prices = parseIonPrices(html);
  return {
    window: w ? parseIonWindow(w[1]) : null,
    lessons: prices.find(p => /lesson/i.test(p.title)) ?? null,
    rental: prices.find(p => /rental/i.test(p.title)) ?? null,
    text,
  };
}

const minNightsOf = (basis: string): number | null => {
  const m = basis.match(/minimum\s*(\d+)\s*night/i);
  return m ? Number(m[1]) : null;
};

export function buildIonPackageSlots(p: IonPackagePage, today: string): Slot[] {
  if (!p.window || p.window.end < today) return [];
  const units: Array<[string, string, IonPrice | null]> = [
    ['lessons', 'Lessons package (6 h semi-private lessons, kitesurf or wing foil)', p.lessons],
    ['rental', 'Rental package (6 days of gear rental, kitesurf or wing foil)', p.rental],
  ];
  return units.filter(([, , x]) => x && x.price !== null).map(([id, label, x]) => ({
    key: `${id}|${p.window!.start}`,
    startDate: p.window!.start,
    endDate: p.window!.end,
    unit: label,
    price: x!.price,
    currency: x!.currency ?? 'EUR',
    priceUnit: 'package',
    priceBasis: 'person',
    occupancy: /double occupancy/i.test(x!.basis) ? 2 : null,
    availability: 'on_request',
    availabilityText: `${x!.currency ?? 'EUR'} ${x!.price} ${x!.basis} (${x!.days ?? 8} days / ${x!.nights ?? 7} nights; travel window ${p.window!.start} to ${p.window!.end}); booking request form`,
    spotsLeft: null,
    datePrecision: 'season',
    packageNights: x!.nights ?? 7,
    minNights: minNightsOf(x!.basis),
  } satisfies Slot));
}

export async function fetchIonPackageSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const p = parseIonPackagePage(await ionFetch(ION_PKG_URL));
  if (!p.lessons && !p.rental) throw new Error('ion-club oasis212: no package pricing table found (layout changed?)');
  if (!p.window) { ctx?.note('travel window ("Travel & Booking Window: ...") not found; no slots'); return []; }
  const slots = buildIonPackageSlots(p, today);
  if (slots.length === 0) ctx?.note(`travel window ${p.window.start}..${p.window.end} has ended; no new window printed yet`);
  return slots;
}

export function parseIonPackageContent(html: string): OfferContent {
  const p = parseIonPackagePage(html);
  if (!p.lessons) throw new Error('ion-club oasis212: "LESSONS PACKAGE" table not found (layout changed?)');
  const window = p.window ? `between ${p.window.start} and ${p.window.end}` : 'in the travel window printed on the page';
  const summary = [
    `ION CLUB's opening packages at its centre inside the Oasis212 hotel on the Dakhla lagoon: 7 nights in a wooden chalet with partial lagoon view (double bed plus living room with 2 convertible beds, private terrace), full board and the round-trip transfer from Dakhla airport.`,
    `The lessons package adds 6 hours of semi-private kitesurf or wing foil lessons for all levels (EUR ${p.lessons.price} per person, double occupancy); the rental package adds 6 days of gear rental instead (EUR ${p.rental?.price ?? '?'}).`,
    `Several spots - flat and choppy, shallow and deep water - lie right at the centre, with side to side-onshore wind around 20 knots. Valid for travel ${window}, minimum 4 nights; booking on request.`,
  ].join(' ');
  return {
    kind: 'camp',
    title: 'ION CLUB Dakhla Oasis212 Lessons Package',
    summary,
    continent: 'Africa',
    country: 'Morocco',
    region: 'Dakhla-Oued Ed-Dahab',
    spot: 'Dakhla Lagoon',
    itinerarySpots: [],
    durationDays: (p.lessons.nights ?? 7) + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      '7 nights in a chalet with partial lagoon view at the Oasis212 hotel (double occupancy)',
      'Full board',
      'Round-trip airport transfer from Dakhla airport',
      'Lessons package: 6 hours of semi-private lessons, kitesurf or wing foil',
      'Rental package (alternative): 6 days of equipment rental, kitesurf or wing foil',
    ],
    optionalServices: ['Accommodation outside a package: -20% (on request)'],
    accommodation: 'wooden chalets at the Oasis212 hotel (spa, beach club)',
    mealPlan: 'full_board',
    languages: ['en', 'fr', 'de'],
    rooms: [],
    imageUrls: ionImages(html, ION_PKG_URL),
    heroVideoUrl: null,
    sourceUrl: ION_PKG_URL,
    bookingUrl: ION_PKG_URL,
    sourceText: [
      `window: ${p.window?.start ?? '-'}..${p.window?.end ?? '-'}`,
      ...[p.lessons, p.rental].filter(Boolean).map(x => `${x!.title}: ${x!.price} ${x!.currency} ${x!.basis}; ${x!.items.join(' | ')}`),
      p.text.slice(p.text.search(/ION CLUB HOLIDAYS/i) >= 0 ? p.text.search(/ION CLUB HOLIDAYS/i) : 0, 4000),
    ].join('\n'),
  };
}

export const ionClubOasis212LessonsPackageDakhla: OfferAdapter = {
  key: 'ion-club-oasis212-lessons-package-dakhla',
  name: 'ION CLUB Dakhla Oasis212 Lessons Package',
  kind: 'camp',
  operator: ION_OPERATOR,
  url: ION_PKG_URL,
  slotMethod: 'price_table',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 2,
  fetchContent: async () => parseIonPackageContent(await ionFetch(ION_PKG_URL)),
  fetchSlots: ctx => fetchIonPackageSlots(todayIso(), ctx),
};
