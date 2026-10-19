// ---------------------------------------------------------------------------
// Travel Active Club - Madagascar kite trip (tour): 8 nights / 9 days in northern Madagascar. Pick-up at Diego Suarez
// airport, 5 nights at Mada Kite Camp on Sakalava Bay (sea-view bungalows on the spot, excursion to the French Mountain
// and a secret spot), by car and boat to Tao Resort on the Emerald Sea (3 nights, sea-facing bungalows, boat trip to
// sandbanks), back to the airport by boat and car. Full board (no drinks), daily morning yoga, 1.5 h of advanced kite
// coaching in small groups with video analysis. Not included: flights (international and domestic), a layover night in
// Antananarivo, kite equipment, beginner or individual lessons, insurance, the Amber Mountain / Red Tsingy day.
//
// Data path (checked 2026-10-19): Wix page /copy-of-oman-18-26-july-2026 (menu label "Madagascar - June 2026"; the Wix
//   slugs do not match the labels). Parsed with the shared parseTacTrip of travel-active-club-oman-kite-trip.ts:
//   <title> "Madagascar - June 2026" (year), heading "20-28 June", "9 days (8nights)", "Price per person in double,shared
//   room 2190 euros" and "Price per person in single room 2495 euros", the included / not-included lists.
//   State 2026-10-19: the only departure (20-28 June 2026) is past -> 0 slots ("price on request"); the summary says the
//   next dates are not published yet. A new dated heading produces slots again.
// robots.txt www.travelactiveclub.com (2026-10-19): Wix default ("*?lightbox=" disallowed only).
// Requests per run: 1 (memoised between content and slots). Fixture trimmed to markup (scripts dropped).
// Slots: one per future departure x room line (double/shared, single), EUR per person, priceUnit 'package'.
// Pins: "Emerald Sea (Mer d'Emeraude), Babaomby" is the spot name already pinned in ingest KNOWN_PINS (Babaomby lodge
//   adapter); Sakalava Bay and Diego Suarez geocode by name.
// ---------------------------------------------------------------------------
import type { OfferAdapter, OfferContent } from '../types.js';
import { TAC_OPERATOR, TAC_SITE, fetchTacSlots, parseTacTrip, tacDatesSentence, tacPage, tacPriceSentence } from './travel-active-club-oman-kite-trip.js';
import { kfImages } from './kitefreedom-santa-fe-bantayan.js';

export const TAC_MADAGASCAR_URL = `${TAC_SITE}/copy-of-oman-18-26-july-2026`;
const REGION = 'Diana (Diego Suarez)';

export function parseTacMadagascarContent(html: string, today: string): OfferContent {
  const t = parseTacTrip(html);
  const summary = [
    `Travel Active Club's ${t.nights ?? 8}-night / ${t.days ?? 9}-day kite trip to northern Madagascar in the trade-wind season: 5 nights at Mada Kite Camp on Sakalava Bay (sea-view bungalows on the spot) and 3 nights at Tao Resort on the Emerald Sea, with transfers by car and boat from and to Diego Suarez airport.`,
    `Full board, daily morning yoga, 1.5 hours of advanced kite coaching in small groups with video analysis and excursions to the French Mountain and a secret spot are included; flights, kite equipment and beginner lessons are not.`,
    `${tacDatesSentence(t, today)} ${tacPriceSentence(t, today)}`,
  ].join(' ');
  return {
    kind: 'tour',
    title: 'Travel Active Club Madagascar Kite Trip',
    summary,
    continent: 'Africa',
    country: 'Madagascar',
    region: REGION,
    spot: 'Diego Suarez',
    itinerarySpots: [
      { name: 'Diego Suarez', country: 'Madagascar', region: REGION, order: 1 },
      { name: 'Sakalava Bay', country: 'Madagascar', region: REGION, order: 2 },
      { name: "Emerald Sea (Mer d'Emeraude), Babaomby", country: 'Madagascar', region: REGION, order: 3 },
    ],
    durationDays: t.days ?? 9,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: true, // advanced coaching; the beginner course is not included
    equipmentRental: false,
    beginnerFriendly: false,
    includedServices: t.included,
    optionalServices: ['Day tour to Amber Mountain and the Red Tsingy', 'Layover night near Antananarivo airport (Nosy Manga hotel recommended)'],
    accommodation: 'sea-view bungalows at Mada Kite Camp (Sakalava Bay) and Tao Resort (Emerald Sea); double/shared or single room',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: [],
    imageUrls: kfImages(html),
    heroVideoUrl: null,
    sourceUrl: TAC_MADAGASCAR_URL,
    bookingUrl: TAC_MADAGASCAR_URL,
    sourceText: t.lines.join('\n'),
  };
}

export const travelActiveClubMadagascarKiteTrip: OfferAdapter = {
  key: 'travel-active-club-madagascar-kite-trip',
  name: 'Travel Active Club Madagascar Kite Trip',
  kind: 'tour',
  operator: TAC_OPERATOR,
  url: TAC_MADAGASCAR_URL,
  slotMethod: 'html_dates',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() {
    return parseTacMadagascarContent(await tacPage(TAC_MADAGASCAR_URL), new Date().toISOString().slice(0, 10));
  },
  fetchSlots: ctx => fetchTacSlots(TAC_MADAGASCAR_URL, new Date().toISOString().slice(0, 10), ctx),
};
