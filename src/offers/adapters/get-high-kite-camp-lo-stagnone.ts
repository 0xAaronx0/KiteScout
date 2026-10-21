// ---------------------------------------------------------------------------
// GET HIGH - Kitesurfing.at (Austrian kite school, Lake Neusiedl) - Kite Camp Sicily at Lo Stagnone di Marsala:
// spring and autumn weeks with 7 nights in 2-room apartments at Torre Lupa (kitchen for self-catering, pool, garden),
// a rental car, a 6-day customised course (beginner to jump training), video analysis, gear, workshops and spot guiding
// with the local partner Kitelagune. Sold as packages through the Austrian tour operator RETTER Sports: "Complete
// Package" incl. flights, a camp-only price, a 2-week "Windproof Package" and an "A" (join-in, rental only) package.
// Shared helpers live in get-high-kite-camp-hamata.ts (same page layout).
//
// Data path (checked 2026-10-21): ONE WordPress page, https://www.kitesurfing.at/en/kitecamps/kite-camp-sizilien/
//   - "Dates" block: "April 11–18, 2026", "April 18–25, 2026", "April 25 – May 2, 2026", "September 26 – October 3,
//     2026", "October 3 – October 10, 2026" (every line read, past weeks dropped).
//   - package boxes (Rhodes helper parseGhPackages):
//       "Complete Package"         + Flights + 7 nights in a 2-room apartment + Rental car + course ...
//                                  "Single room in a 2-room apartment starting at €1,705 per person"
//       "Kite Camp Only"           "About €1,090 per person"
//       "Windproof Package: Sicily" 14 nights: "Single room in a 2-room apartment starting at €2,720 per person"
//       "\"A\" Package"            no course: "Starting at €1,250 per person" (optional service, no slot)
//     Flights: the page names e.g. Vienna-Palermo or Bratislava-Trapani as the short flight; not the package's airport.
// Booking: "REQUEST A NO-OBLIGATION QUOTE NOW" -> availability 'on_request'; liveAvailability unset, instantBooking false.
// robots.txt www.kitesurfing.at (2026-10-21): only /wp-admin/ disallowed.
// Requests per run: 1 (memoised page).
// Slots: as for Hamata (complete / camp-only per week, windproof over two consecutive weeks), key "<variant>|<start>".
// State 2026-10-21: only 2026 weeks are printed (latest 3.-10.10.2026, past) -> 0 slots (price on request) until the
//   2027 dates appear; the summary says so.
// ---------------------------------------------------------------------------
import { todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent } from '../types.js';
import { getHighKiteCampTheologos, ghLines, parseGhPackages, type GhPackage } from './get-high-kite-camp-theologos.js';
import { fetchGhxSlots, ghPage, ghxDash, ghxImages, ghxPastSeason, ghxWeekList, parseGhxWeeks, type GhxPlace } from './get-high-kite-camp-hamata.js';

export const GHS_URL = 'https://www.kitesurfing.at/en/kitecamps/kite-camp-sizilien/';

export const GHS_PLACE: GhxPlace = {
  completeUnit: '7 nights single room in a 2-room apartment (self-catering), rental car',
  windproofUnit: '14 nights single room in a 2-room apartment (self-catering), rental car',
  flights: '(departure airport not printed; the page names e.g. Vienna-Palermo or Bratislava-Trapani)',
};

export function parseGhsContent(html: string, today = todayIso()): OfferContent {
  const lines = ghLines(html);
  const weeks = parseGhxWeeks(lines);
  const pkgs = parseGhPackages(lines);
  const by = (k: GhPackage['key']) => pkgs.find(p => p.key === k);
  const complete = by('complete');
  const campOnly = by('camp-only');
  const future = weeks.filter(w => w.start >= today);
  const summary = [
    `GET HIGH - Kitesurfing.at, a kite school from Lake Neusiedl in Austria, runs spring and autumn kite camp weeks at Lo Stagnone di Marsala in western Sicily, a large shallow flat-water lagoon with thermal wind that suits beginners as well as jump training.`,
    `The group stays in 2-room apartments at Torre Lupa (kitchen for self-catering, pool, garden), drives to the spot by rental car and gets a 6-day course tailored to each level, video analysis, radio training, workshops, gear for independent practice and spot guiding with the local partner Kitelagune.`,
    [
      complete?.price ? `The complete package with flights, rental car and 7 nights starts at EUR ${complete.price.toLocaleString('en-US')} per person (single room in a 2-room apartment)` : null,
      campOnly?.price ? `the camp alone costs about EUR ${campOnly.price.toLocaleString('en-US')}` : null,
    ].filter(Boolean).join('; ') + (complete?.price || campOnly?.price ? '; quotes on request via the tour operator RETTER Sports.' : 'Quotes on request via the tour operator RETTER Sports.'),
    future.length
      ? `Camp weeks: ${ghxWeekList(future)}.`
      : `Runs every spring and autumn; the next dates are not published yet${weeks.length ? ` (${ghxPastSeason(weeks)})` : ''}.`,
  ].join(' ');
  return {
    kind: 'camp',
    title: 'GET HIGH Kite Camp Sicily, Lo Stagnone',
    summary,
    continent: 'Europe',
    country: 'Italy',
    region: 'Lo Stagnone, Sicily',
    spot: 'Lo Stagnone',
    // no spotCoords: the page prints none (same spot string as the other Lo Stagnone adapters)
    itinerarySpots: [],
    durationDays: (complete?.nights ?? 7) + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: ghxDash(complete?.inclusions.length ? complete.inclusions : (campOnly?.inclusions ?? [])),
    optionalServices: ghxDash(pkgs.filter(p => p.key !== 'complete').map(p => `${p.name}: ${p.priceLine || 'on request'}`)),
    accommodation: 'Torre Lupa: 2-room apartments with kitchen, pool and garden (family-run)',
    mealPlan: 'self_catering',
    languages: ['de', 'en'],
    rooms: [],
    imageUrls: ghxImages(html),
    heroVideoUrl: null,
    sourceUrl: GHS_URL,
    bookingUrl: GHS_URL,
    sourceText: [
      `camp section: ${lines.join(' / ')}`,
      `parsed: weeks ${weeks.map(w => `${w.start}..${w.end}${w.fixed ? ' (end fixed)' : ''}`).join(', ')}; packages ${pkgs.map(p => `${p.key} ${p.price} (${p.nights ?? '-'} n)`).join(', ')}`,
    ].join('\n'),
  };
}

export const getHighKiteCampLoStagnone: OfferAdapter = {
  key: 'get-high-kite-camp-lo-stagnone',
  name: 'GET HIGH Kite Camp Sicily, Lo Stagnone',
  kind: 'camp',
  operator: getHighKiteCampTheologos.operator,
  url: GHS_URL,
  slotMethod: 'html_dates',
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() {
    return parseGhsContent(await ghPage(GHS_URL));
  },
  fetchSlots: ctx => fetchGhxSlots(ctx, GHS_URL, GHS_PLACE, 'get-high-sicily'),
};
