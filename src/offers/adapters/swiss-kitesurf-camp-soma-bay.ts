import { EVERGREEN_PILOT_SUMMARIES } from '../evergreen-pilot-summaries.js';
// ---------------------------------------------------------------------------
// Swiss Kitesurf (kitesailing.ch, Silvaplana) - Kite camp Egypt in Soma Bay (Kiloashara, Red Sea): autumn weeks with
// transfers, 7 nights in a simple hotel next to the kite station, full board, an excursion to Safaga, and one of three
// packages (lessons / rental gear / board & lodging only).
//
// Data path (checked 2026-10-19): /en/school/camps/kite-camp-egypt; parser shared with the Sicily camp
//   (swiss-kitesurf-camp-lo-stagnone.ts, header there). The status rows on this page carry no year ("3. - 10.10",
//   "31.10 - 7.11"); the year comes from the request form's Egypt weeks ("3.10 - 10.10.2026"), else from the page's
//   "in the fall of 2026".
// Prices (2026-10-19): CHF 1750 lessons / 1350 rental gear / 950 board & lodging only, per person in a shared double
//   room (only bookable in pairs), + CHF 300 single room surcharge -> 6 variants per week.
// Booking: request form only -> 'on_request' ("Fully Booked" -> 'sold_out'); flags unset (no checkout, no engine).
// Requests per run: 2 (camp page + request page, memoised; the request page is shared with the Sicily adapter).
// State 2026-10-19: 5 weeks 03.10.-07.11.2026; the 3 fully booked October weeks are past, 24.10. and 31.10. are
//   "Confirmed!" -> 2 weeks x 6 variants = 12 slots. After 31.10.2026 the adapter returns [] until the page lists
//   the next season.
// ---------------------------------------------------------------------------
import { collapse, parse, todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent } from '../types.js';
import {
  SK_OPERATOR, SK_REQUEST_URL, SK_SITE, fetchSkSlots, parseSkFormWeeks, parseSkStatus, parseSkVariants, skImages,
  skListAfter, skNights, skPage, type SkCampPages,
} from './swiss-kitesurf-camp-lo-stagnone.js';

export const SK_EGYPT_URL = `${SK_SITE}/en/school/camps/kite-camp-egypt`;

export function parseSkEgyptContent(p: SkCampPages, today = todayIso()): OfferContent {
  const root = parse(p.camp);
  for (const el of root.querySelectorAll('script, style, noscript, template')) el.remove();
  const text = collapse((root.querySelector('main') ?? root).text);
  const included = skListAfter(p.camp, /This is included/i);
  const nights = skNights(text) ?? 7;
  const { weeks } = parseSkStatus(p.camp, parseSkFormWeeks(p.request, 'Egypt'));
  const variants = parseSkVariants(p.camp);
  const summary = EVERGREEN_PILOT_SUMMARIES['swiss-kitesurf-camp-soma-bay'];
  return {
    kind: 'camp',
    title: 'Swiss Kitesurf Kite Camp Egypt, Soma Bay',
    summary,
    continent: 'Africa',
    country: 'Egypt',
    region: 'Red Sea',
    spot: 'Soma Bay',
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: included,
    optionalServices: variants.map(v => `${v.unit}: CHF ${v.price} per person`),
    accommodation: 'simple hotel next to the kite station (double or single rooms)',
    mealPlan: 'full_board',
    languages: ['de', 'en'],
    rooms: [],
    imageUrls: skImages(p.camp, SK_EGYPT_URL),
    heroVideoUrl: null,
    sourceUrl: SK_EGYPT_URL,
    bookingUrl: SK_REQUEST_URL,
    sourceText: [
      `camp page: ${text}`,
      `parsed weeks: ${weeks.map(w => `${w.start}..${w.end} ${w.status}`).join('; ')}`,
      `parsed variants: ${variants.map(v => `${v.unit} CHF ${v.price}`).join('; ')}`,
    ].join('\n'),
  };
}

export const swissKitesurfCampSomaBay: OfferAdapter = {
  key: 'swiss-kitesurf-camp-soma-bay',
  name: 'Swiss Kitesurf Kite Camp Egypt, Soma Bay',
  kind: 'camp',
  operator: SK_OPERATOR,
  url: SK_EGYPT_URL,
  slotMethod: 'html_dates',
  fetchBudget: 4,
  async fetchContent() {
    return parseSkEgyptContent({ camp: await skPage(SK_EGYPT_URL), request: await skPage(SK_REQUEST_URL) });
  },
  fetchSlots: ctx => fetchSkSlots(SK_EGYPT_URL, 'Egypt', ctx),
};
