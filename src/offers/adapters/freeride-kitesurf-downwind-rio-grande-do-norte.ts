// ---------------------------------------------------------------------------
// Freeride Kitesurf - Downwind Rio Grande do Norte (Brazil): 11-day guided kite safari from São Miguel do Gostoso via
// Galinhos, Macau and Ponta do Mel to Tremembé / Icapuí (Ceará), 4x4 support, pousadas with breakfast.
//
// Data path (checked 2026-10-19), shared Freeride helpers in freeride-kitesurf-downwind-wild-north.ts:
//   content  English route page /en/kite-safari/downwind-brazil/rio-grande-norte/ (dateModified 2025-02-11): 11-day program,
//            "10 NIGHTS / 11 DAYS 1.815€ *ESTIMATED PRICE P.P." (group of 4 in double rooms; single room +20%),
//            included / not included lists, gallery. (Spanish twin: /kite-safari/downwind-brasil/rio-grande-norte/.)
//   slots    /en/kite-safari/downwind-brazil/ "DOWNWIND DATES BRAZIL 2026" list: "DOWNWIND RIO GRANDE DO NORTE /
//            S. M. do Gostoso to Icapuí - 260km / 11th - 21st" under NOVEMBER -> 1 slot (11-21 Nov 2026), EUR per person,
//            availability 'on_request' (contact form). Past dates are dropped; new years are read automatically.
// robots.txt (2026-10-19): "Crawl-delay: 30", nothing disallowed (the shared fetch waits 30 s between requests).
// Requests per run: content 2, slots 2 (dates page memoised and shared with the Wild North adapter).
// Flags: liveAvailability no, instantBooking no (contact form).
// ---------------------------------------------------------------------------
import { todayIso } from '../parse.js';
import type { ItinerarySpot, OfferAdapter, OfferContent } from '../types.js';
import {
  FREERIDE_CONTACT_URL, FREERIDE_DATES_URL, FREERIDE_OPERATOR, FREERIDE_SITE,
  fetchFreerideSlots, freerideDatesSentence, freeridePage, parseFreerideDates, parseFreerideRoute,
} from './freeride-kitesurf-downwind-wild-north.js';

export const FREERIDE_RGN_URL = `${FREERIDE_SITE}/en/kite-safari/downwind-brazil/rio-grande-norte/`;
export const RGN_MATCH = /rio grande do norte/i;

/** Route stops of the program in order (the end transfer goes to Natal or Fortaleza airport; not a stop). */
export const RGN_STOPS: ItinerarySpot[] = [
  { name: 'São Miguel do Gostoso', country: 'Brazil', region: 'Rio Grande do Norte', order: 1 },
  { name: 'Galinhos', country: 'Brazil', region: 'Rio Grande do Norte', order: 2 },
  { name: 'Macau', country: 'Brazil', region: 'Rio Grande do Norte', order: 3 },
  { name: 'Ponta do Mel', country: 'Brazil', region: 'Rio Grande do Norte', order: 4 },
  { name: 'Tremembé', country: 'Brazil', region: 'Ceará', order: 5 },
  { name: 'Icapuí', country: 'Brazil', region: 'Ceará', order: 6 },
];

export function parseRgnContent(routeHtml: string, datesHtml: string, today: string): OfferContent {
  const r = parseFreerideRoute(routeHtml, FREERIDE_RGN_URL);
  const deps = parseFreerideDates(datesHtml).filter(d => RGN_MATCH.test(d.route));
  const days = r.days ?? 11;
  const summary = [
    `Freeride Kitesurf's Rio Grande do Norte kite safari is ${days === 8 || days === 11 || days === 18 ? 'an' : 'a'} ${days}-day guided downwind trip on Brazil's north-east coast: three days in São Miguel do Gostoso, then downwinds to Galinhos, Macau and Ponta do Mel, ending in Tremembé and Icapuí just across the border in Ceará.`,
    `It suits intermediate riders and up, with mixed flat-water and wave spots, a kitesurf guide in the water at all times and 4x4 support along the beach where possible; groups of ${r.minPeople ?? 3} to ${r.maxPeople ?? 12} riders stay in pousadas with breakfast, and the trip ends with a transfer to Natal or Fortaleza airport.`,
    `${r.price ? `Estimated price EUR ${r.price.toLocaleString('en-US')} per person (${r.nights ?? days - 1} nights, group of 4 in double rooms${r.singleSurchargePct ? `, single room +${r.singleSurchargePct}%` : ''}). ` : ''}${freerideDatesSentence(deps, today)}`,
  ].join(' ');
  return {
    kind: 'tour',
    title: 'Freeride Kitesurf Rio Grande do Norte Downwind Kite Safari',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'São Miguel do Gostoso, Rio Grande do Norte',
    spot: 'São Miguel do Gostoso',
    itinerarySpots: RGN_STOPS,
    durationDays: days,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: false,
    equipmentRental: null,
    beginnerFriendly: false,
    includedServices: r.included,
    optionalServices: r.singleSurchargePct ? [`Single room (+${r.singleSurchargePct}% on the trip price)`] : [],
    accommodation: 'Medium-high level pousadas along the route, double rooms',
    mealPlan: 'breakfast',
    languages: ['en', 'es'],
    rooms: [],
    imageUrls: r.images.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: FREERIDE_RGN_URL,
    bookingUrl: FREERIDE_CONTACT_URL,
    sourceText: [
      `route: ${r.title} | ${r.tagline}`,
      r.intro ?? '',
      ...r.program,
      `price: ${r.nights} nights / ${r.days} days, EUR ${r.price} estimated p.p.; single +${r.singleSurchargePct}%; group ${r.minPeople}-${r.maxPeople}`,
      `included: ${r.included.join('; ')}`,
      `not included: ${r.excluded.join('; ')}`,
      `dates: ${deps.map(d => `${d.start}..${d.end}`).join(', ')}`,
    ].join('\n'),
  };
}

export const freerideKitesurfDownwindRioGrandeDoNorte: OfferAdapter = {
  key: 'freeride-kitesurf-downwind-rio-grande-do-norte',
  name: 'Freeride Kitesurf Downwind Rio Grande do Norte (São Miguel do Gostoso - Icapuí)',
  kind: 'tour',
  operator: FREERIDE_OPERATOR,
  url: FREERIDE_RGN_URL,
  slotMethod: 'html_dates',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 3,
  async fetchContent() {
    const route = await freeridePage(FREERIDE_RGN_URL);
    const dates = await freeridePage(FREERIDE_DATES_URL);
    return parseRgnContent(route, dates, todayIso());
  },
  fetchSlots: ctx => fetchFreerideSlots(FREERIDE_RGN_URL, RGN_MATCH, todayIso(), ctx),
};
