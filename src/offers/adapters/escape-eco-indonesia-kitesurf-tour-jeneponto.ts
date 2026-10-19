// ---------------------------------------------------------------------------
// Escape Eco Adventures - Indonesia Kitesurfing Tour 2027 at Batikite Resort, Mallasoro, Jeneponto (South Sulawesi):
// 7 nights in air-conditioned bungalows, 7 days of kiting with on- and off-water coaching on the resort's flat,
// shallow lagoon, three meals a day, airport shuttle, drone and on-water video. One base for the whole week ->
// KIND = 'camp' (the operator calls it a "tour"). The resort itself is listed separately as a stay
// (adapter batikite-resort-jeneponto); this listing is Escape Eco's coached week.
//
// Data path (checked 2026-10-19): Wix page https://www.escapeecoadventures.com.au/indonesiakitesurftour, parsed
// with the shared Escape Eco parser (escape-eco-fiji-kitesurf-tour-korolevu.ts):
//   slots    "Dates 2027": "27th June - 4th July", "4th July - 11th July"; "Prices 2027": "$2850AUD p.p. AC twin
//            share*", "$3155ppAUD p.p. AC private*". The "Payment Dates & Terms" block adds the premium rooms
//            ("AU$3072pp for Premium with AC" twin share, "AU$3598 for Premium with AC" private) -> 4 room types.
//            One slot per future week x room type, AUD per person (package, 7 nights), 'on_request' (phone /
//            enquiry form + AUD 1,000 deposit within 24 h).
//   content  the same page (inclusions, wind, non-kiter, gear) + photos (content images and the pro-gallery;
//            two website screenshots in the gallery are skipped).
// robots.txt (2026-10-19): Wix default, `Allow: /`.
// Requests per run: 1 (memoised for content + slots).
// Location strings follow the Batikite stay adapter (region 'South Sulawesi', spot 'Mallasoro, Jeneponto');
//   spotCoords = the resort's own JSON-LD geo (indonesiakitesurfing.com, recorded in the Batikite fixture
//   2026-10-12): -5.6492245, 119.5844938.
// ---------------------------------------------------------------------------
import { daysInclusive, parseAmount, todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';
import {
  EE_OPERATOR, EE_SITE, eeImages, eeMoney, eePage, fetchEeSlots, parseEeTour, type EeRoom, type EeTour,
} from './escape-eco-fiji-kitesurf-tour-korolevu.js';

export const EE_INDONESIA_URL = `${EE_SITE}/indonesiakitesurftour`;

/** Premium rooms from the "Payment Dates & Terms" block (not in the "Prices" block). */
export function eeIndonesiaPremiumRooms(t: EeTour): EeRoom[] {
  const text = t.lines.join('\n');
  const out: EeRoom[] = [];
  const twin = text.match(/Twin Shares?:[^\n]*?AU\$\s?([\d,]+)\s*(?:pp\s*)?for Premium/i);
  const priv = text.match(/Private:[^\n]*(?:\n\s*)?AU\$\s?([\d,]+)\s*(?:pp\s*)?for Premium/i);
  const a = twin ? parseAmount(twin[1]) : null;
  const b = priv ? parseAmount(priv[1]) : null;
  if (a) out.push({ unit: 'Premium AC twin share', price: a, occupancy: 2, raw: twin![0].replace(/\s+/g, ' ') });
  if (b) out.push({ unit: 'Premium AC private room', price: b, occupancy: 1, raw: priv![0].replace(/\s+/g, ' ') });
  return out;
}

export function parseEeIndonesiaContent(html: string): OfferContent {
  const t = parseEeTour(html);
  if (!t.year || !t.weeks.length) throw new Error('escape-eco-indonesia: no "Dates <year>" block (layout changed?)');
  if (!t.rooms.length) throw new Error('escape-eco-indonesia: no prices in the "Prices <year>" block (layout changed?)');
  const rooms = [...t.rooms, ...eeIndonesiaPremiumRooms(t).filter(r => !t.rooms.some(x => x.unit === r.unit))];
  const text = t.lines.join('\n');
  const nights = daysInclusive(t.weeks[0].start, t.weeks[0].end) - 1;
  const cheapest = Math.min(...rooms.map(r => r.price));
  const plusOne = text.match(/Non-Kiting \+1 to Private Room:\s*\+AUD\$?\s?([\d,]+)/i)?.[1] ?? null;
  const instructor = text.match(/Private Instructor[^\n]*?\+AUD\$?\s?([\d,]+)\s*p\/?h/i)?.[1] ?? null;
  const weeks = t.weeks.map(w => `${w.start} to ${w.end}`).join(' and ');

  const summary = [
    `Escape Eco Adventures runs a ${nights}-night kitesurf progression week at Batikite Resort in Mallasoro, Jeneponto (South Sulawesi, Indonesia), with the kite spot, a flat and shallow lagoon, right in front of the resort.`,
    'Seven days of kiting with on- and off-water coaching from qualified instructors, wind and trick theory, drone and on-water video, breakfast, lunch and dinner and a private airport shuttle are included; the trade wind blows mostly 15-25 knots.',
    `The ${t.year} weeks are ${weeks}; the week suits complete beginners as well as riders working on jumps and rotations.`,
    `Prices start at AUD ${eeMoney(cheapest)} per person in an air-conditioned twin share (private and premium rooms cost more), with a AUD ${eeMoney(t.deposit ?? 1000)} deposit; flights, gear rental and insurance are extra.`,
  ].join(' ');

  return {
    kind: 'camp',
    title: `Escape Eco Indonesia Kitesurfing Tour ${t.year}`,
    summary,
    continent: 'Asia',
    country: 'Indonesia',
    region: 'South Sulawesi',
    spot: 'Mallasoro, Jeneponto',
    spotCoords: { lat: -5.6492245, lng: 119.5844938 },
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      `${nights} nights in an air-conditioned bungalow at Batikite Resort (twin share)`,
      `${nights} days of kiting with on- and off-water coaching`,
      'Breakfast, lunch and dinner',
      'Private shuttle to and from the airport',
      'Drone and on-water videography',
      'Theory: kitesurfing technique, wind and trick progression',
    ],
    optionalServices: [
      'Private room or premium room (see prices)',
      ...(plusOne ? [`Non-kiting partner in the private room: +AUD ${plusOne.replace(/,/g, '')}`] : []),
      ...(instructor ? [`Private instructor: AUD ${instructor.replace(/,/g, '')} per hour`] : []),
      'Core kite gear rental (price list in the info pack)',
      'Moped rental at the resort',
    ],
    accommodation: 'Batikite Resort: air-conditioned tropical bungalows (standard or premium), pool, restaurant and bar',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: [],
    imageUrls: eeImages(html).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: EE_INDONESIA_URL,
    bookingUrl: EE_INDONESIA_URL,
    sourceText: [
      text,
      `parsed: year ${t.year}; weeks ${t.weeks.map(w => `${w.start}..${w.end}`).join(', ')}; rooms ${rooms.map(r => `${r.unit}=${r.price}`).join(', ')}; ${t.currency}; deposit ${t.deposit}`,
    ].join('\n'),
  };
}

export function fetchEeIndonesiaSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  return fetchEeSlots(EE_INDONESIA_URL, 'escape-eco-indonesia', today, ctx, eeIndonesiaPremiumRooms);
}

export const escapeEcoIndonesiaKitesurfTourJeneponto: OfferAdapter = {
  key: 'escape-eco-indonesia-kitesurf-tour-jeneponto',
  name: 'Escape Eco Adventures Indonesia Kitesurfing Tour, Jeneponto',
  kind: 'camp',
  operator: EE_OPERATOR,
  url: EE_INDONESIA_URL,
  slotMethod: 'html_dates',
  instantBooking: false,           // phone / enquiry form, deposit afterwards
  fetchBudget: 2,
  async fetchContent() {
    return parseEeIndonesiaContent(await eePage(EE_INDONESIA_URL));
  },
  fetchSlots: ctx => fetchEeIndonesiaSlots(todayIso(), ctx),
};
