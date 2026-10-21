// ---------------------------------------------------------------------------
// Escape Eco Adventures - Sri Lanka Kitesurfing Tour 2027 at The Rascals (Rascals Kite Resort), Kalpitiya:
// 8 days / 7 nights at the resort, 7 days of kiting with on- and off-water coaching, three meals a day + snacks,
// support vessel, airport shuttle, drone and on-water video, boat-assisted downwinders and island trips. One base
// for the whole week -> KIND = 'camp' (the operator calls it a "tour"), like the Fiji and Indonesia rows. The resort
// itself is listed separately as a stay (adapter rascals-kite-resort-kalpitiya); this listing is Escape Eco's
// coached week.
//
// Base: the page says "Where do we stay? The Rascals resort ... https://www.rascalskiteresort.com/" (checked
//   2026-10-21), so the research's "Rascals Kite Resort" is confirmed by the page itself.
//
// Data path (checked 2026-10-21): Wix page https://www.escapeecoadventures.com.au/srilankakitesurftour, parsed with
// the shared Escape Eco parser (escape-eco-fiji-kitesurf-tour-korolevu.ts):
//   slots    "Dates 2027": "4th September - 11th September", "11th September - 18st September", "18th September -
//            25th September"; "Prices 2027" ("8 days 7 nights" line skipped): "$3895AUD p.p. aircon twin share",
//            "$3895AUD p.p. aircon couples", "$4295AUD aircon private room". One slot per future week x room type,
//            AUD per person (package, 7 nights; the private room is one person), 'on_request' (enquiry form /
//            WhatsApp + AUD 1,000 deposit within 24 h).
//   content  the same page (inclusions, base, wind, gear, payment terms) + photos (content images and the
//            pro-gallery).
// Known conflicts on the page (2026-10-21): the "Payment Dates & Terms" block still prints older prices
//   ("Kiting Twin Shares: AU$3725pp", "Couples/Shared Bed: Aircon: AU$35725pp" (sic), "Private: Aircon: AU$4140")
//   and "Add Non-Kiting +1 to Private Room: EUR 350 (euro)". The "Prices 2027" block is used for the slots; the
//   older numbers are kept in sourceText only, the +1 price in optionalServices as printed (in EUR).
// robots.txt (2026-10-21): Wix default, `Allow: /`.
// Requests per run: 1 (memoised for content + slots).
// Location strings follow the Rascals stay adapter (region 'North Western Province', spot 'Kalpitiya');
//   spotCoords = the resort's own Google Maps place link in its Organization JSON-LD (rascalskiteresort.com,
//   recorded in the Rascals fixture 2026-10-12): 8.259215, 79.765256.
// ---------------------------------------------------------------------------
import { daysInclusive, todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';
import { EE_OPERATOR, EE_SITE, eeImages, eeMoney, eePage, fetchEeSlots, parseEeTour } from './escape-eco-fiji-kitesurf-tour-korolevu.js';

export const EE_SRI_LANKA_URL = `${EE_SITE}/srilankakitesurftour`;

export function parseEeSriLankaContent(html: string): OfferContent {
  const t = parseEeTour(html);
  if (!t.year || !t.weeks.length) throw new Error('escape-eco-sri-lanka: no "Dates <year>" block (layout changed?)');
  if (!t.rooms.length) throw new Error('escape-eco-sri-lanka: no prices in the "Prices <year>" block (layout changed?)');
  const text = t.lines.join('\n');
  if (!/Rascals/i.test(text)) throw new Error('escape-eco-sri-lanka: the page no longer names The Rascals as the base (check the location)');
  const nights = daysInclusive(t.weeks[0].start, t.weeks[0].end) - 1;
  const cheapest = Math.min(...t.rooms.map(r => r.price));
  const priv = t.rooms.find(r => /private/i.test(r.unit));
  const plusOne = text.match(/Non-Kiting \+1 to Private Room:\s*€\s?([\d,]+)/i)?.[1] ?? null;
  const instructor = text.match(/optional extra at AUD\$?\s?([\d,]+)\s*p\/?h/i)?.[1] ?? null;
  const weeks = t.weeks.map(w => `${w.start} to ${w.end}`).join(', ');

  const summary = [
    `Escape Eco Adventures runs a ${nights}-night kitesurf progression week at The Rascals, a small kite resort in Kalpitiya on the north-west coast of Sri Lanka, with flat lagoon spots a short boat ride from the resort jetty.`,
    `Seven days of kiting with on- and off-water coaching, video analysis, drone and on-water video, a support vessel, boat-assisted downwinders, island trips, three meals a day with snacks and a private airport shuttle are included; the wind blows mostly 15-25 knots.`,
    `The ${t.year} weeks are ${weeks}; the week suits beginners to advanced riders.`,
    `Prices start at AUD ${eeMoney(cheapest)} per person in an air-conditioned twin share${priv ? ` (AUD ${eeMoney(priv.price)} in a private room)` : ''}, with a AUD ${eeMoney(t.deposit ?? 1000)} deposit; flights, kite gear rental and insurance are extra.`,
  ].join(' ');

  return {
    kind: 'camp',
    title: `Escape Eco Sri Lanka Kitesurfing Tour ${t.year}`,
    summary,
    continent: 'Asia',
    country: 'Sri Lanka',
    region: 'North Western Province',
    spot: 'Kalpitiya',
    spotCoords: { lat: 8.259215, lng: 79.765256 },
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      `${nights} nights at The Rascals resort (air-conditioned room, twin share)`,
      `${nights} days of kiting, weather permitting`,
      'On- and off-water coaching from qualified instructors, video analysis',
      'Breakfast, lunch and dinner + snacks',
      'Support vessel on the water',
      'Private shuttle to and from the airport',
      'Drone and on-water videography',
      'Boat-assisted downwinders and island trips (weather and level permitting)',
      'Non-kiting activities (snorkelling, yoga, pool)',
    ],
    optionalServices: [
      ...(priv ? [`Private room (AUD ${eeMoney(priv.price)} per person)`] : []),
      ...(plusOne ? [`Non-kiting partner in the private room: +EUR ${plusOne.replace(/,/g, '')} (printed in euro)`] : ['Non-kiting partner (price on request)']),
      ...(instructor ? [`One-on-one instruction until you can ride upwind: AUD ${instructor.replace(/,/g, '')} per hour`] : []),
      'Duotone kite gear rental at the resort (price list in the info pack); hire-to-buy option',
    ],
    accommodation: 'The Rascals Kite Resort: eco-style air-conditioned cabins, pool and bar',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: [],
    imageUrls: eeImages(html).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: EE_SRI_LANKA_URL,
    bookingUrl: EE_SRI_LANKA_URL,
    sourceText: [
      text,
      `parsed: year ${t.year}; weeks ${t.weeks.map(w => `${w.start}..${w.end}`).join(', ')}; rooms ${t.rooms.map(r => `${r.unit}=${r.price}`).join(', ')}; ${t.currency}; deposit ${t.deposit}`,
    ].join('\n'),
  };
}

export function fetchEeSriLankaSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  return fetchEeSlots(EE_SRI_LANKA_URL, 'escape-eco-sri-lanka', today, ctx);
}

export const escapeEcoSriLankaKitesurfTourKalpitiya: OfferAdapter = {
  key: 'escape-eco-sri-lanka-kitesurf-tour-kalpitiya',
  name: 'Escape Eco Adventures Sri Lanka Kitesurfing Tour, Kalpitiya',
  kind: 'camp',
  operator: EE_OPERATOR,
  url: EE_SRI_LANKA_URL,
  slotMethod: 'html_dates',
  instantBooking: false, // enquiry form / WhatsApp, deposit afterwards
  fetchBudget: 2,
  async fetchContent() {
    return parseEeSriLankaContent(await eePage(EE_SRI_LANKA_URL));
  },
  fetchSlots: ctx => fetchEeSriLankaSlots(todayIso(), ctx),
};
