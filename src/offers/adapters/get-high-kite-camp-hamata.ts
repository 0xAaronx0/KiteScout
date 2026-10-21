// ---------------------------------------------------------------------------
// GET HIGH - Kitesurfing.at (Austrian kite school, Lake Neusiedl) - Kite Camp Egypt in Hamata, run with its partner
// Kite Village Hamata on the Red Sea: weeks with 7 nights in the village's lagoon-view Nubian-style bungalows, breakfast
// and dinner buffet, airport transfer, a 6-day customised course (beginner to jump training), video analysis, gear,
// workshops and spot guiding. Sold as packages through the Austrian tour operator RETTER Sports: "Complete Package"
// incl. flights, a camp-only price, a 2-week "Windproof Package" and an "A" (join-in, rental only) package.
// Separate listing from the operator's Rhodes camp (get-high-kite-camp-theologos) and from the Kite Village Hamata
// stay (kite-village-hamata). This file also holds the shared helpers for the Sicily camp
// (get-high-kite-camp-lo-stagnone.ts).
//
// Data path (checked 2026-10-21): ONE WordPress page, https://www.kitesurfing.at/en/kitecamps/kite-camp-aegypten/
//   - "Dates" block: one line per week, here in the long form "November 21, 2026 – November 28, 2026" (the Rhodes
//     parser's parseRange does not read it, so this file has its own reader that also takes the short forms). The
//     page prints "November 28, 2026 – November 5, 2026" (a typo for December 5): an end before the start, or more
//     than 21 nights after it, is replaced by start + 7 nights and noted.
//   - package boxes (Rhodes helper parseGhPackages):
//       "Complete Package"   + Flights + 7 nights in a bungalow + Airport transfer + Breakfast and dinner buffet ...
//                            "In a double room, starting at €2,099 per person"
//       "Kite Camp Only"     course, gear, guiding, no travel or bed: "About €1,250 per person"
//       "Windproof Package"  flights + 14 nights + course + 7 days guided rental + wind guarantee:
//                            "Single occupancy in a double room starting at €3,090 per person"
//       "\"A\" Package"      flights + 7 nights + gear, NO course: "Starting at €1,700 per person" (not a camp: kept as
//                            an optional service, no slot)
//     The "Yacht Special" (a cruise) is not in this camp section and is skipped by design.
//     Prices are "starting at" / "about" (the tour operator quotes the final price; flights vary). The page does not
//     print the departure airport (getting-here text: fly into Marsa Alam, or Hurghada).
// Booking: "REQUEST A NO-OBLIGATION QUOTE NOW" = inquiry form / mail -> availability 'on_request'; liveAvailability unset,
//   instantBooking false.
// robots.txt www.kitesurfing.at (2026-10-21): only /wp-admin/ disallowed (admin-ajax allowed). No crawl delay.
// Requests per run: 1 (memoised page).
// Slots: per future week "complete" and "camp-only" (7 nights), plus "windproof" for a week directly followed by
//   another listed week (14 nights); key "<variant>|<start>". EUR as printed, priceUnit 'package', priceBasis 'person'.
//   Weeks that have started are dropped; any new line in the "Dates" block becomes a week on the next run.
// State 2026-10-21: 3 weeks 21.11.-12.12.2026 -> 3 complete + 3 camp-only + 2 windproof = 8 slots; cheapest with
//   accommodation EUR 2,099 pp (complete, double room, incl. flights), camp only about EUR 1,250 pp.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { iso, monthOf, parseRange, todayIso } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import { getHighKiteCampTheologos, ghImages, ghLines, parseGhPackages, type GhPackage } from './get-high-kite-camp-theologos.js';

export const GHH_URL = 'https://www.kitesurfing.at/en/kitecamps/kite-camp-aegypten/';

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** One fetch per page per 10 minutes (content + slots share it). */
export function ghPage(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const nightsBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// --- dates ------------------------------------------------------------------------------------------------------------
export interface GhxWeek { start: string; end: string; raw: string; fixed: boolean }

/**
 * One "Dates" line: "November 21, 2026 – November 28, 2026", "April 25 – May 2, 2026", "July 11-18, 2026".
 * An implausible end (before the start, or > 21 nights) becomes start + 7 nights (`fixed`).
 */
export function parseGhxDateLine(raw: string): GhxWeek | null {
  const t = raw.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  let r: { start: string; end: string } | null = null;
  const m = t.match(/([A-Za-z]+)\.?\s(\d{1,2}),?\s(20\d{2})\s?-\s?([A-Za-z]+)\.?\s(\d{1,2}),?\s(20\d{2})/);
  if (m && monthOf(m[1]) && monthOf(m[4])) r = { start: iso(+m[3], monthOf(m[1])!, +m[2]), end: iso(+m[6], monthOf(m[4])!, +m[5]) };
  else r = parseRange(t);
  if (!r) return null;
  const n = nightsBetween(r.start, r.end);
  if (n < 1 || n > 21) return { start: r.start, end: addDays(r.start, 7), raw, fixed: true };
  return { ...r, raw, fixed: false };
}

export function parseGhxWeeks(lines: string[]): GhxWeek[] {
  const i = lines.findIndex(l => /^Dates$/i.test(l));
  if (i < 0) return [];
  const out: GhxWeek[] = [];
  for (const raw of lines.slice(i + 1, i + 40)) {
    if (/^Registration/i.test(raw)) break;
    const w = parseGhxDateLine(raw);
    if (w && !out.some(o => o.start === w.start)) out.push(w);
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// --- slots ------------------------------------------------------------------------------------------------------------
export interface GhxPlace {
  /** e.g. "7 nights bungalow, breakfast + dinner" (what the complete package adds to the course) */
  completeUnit: string;
  windproofUnit: string;
  /** flight wording for the slot text */
  flights: string;
}

/** Persons the "per person" price assumes, from the price line ("In a double room" -> 2, "Single ..." -> 1). */
export function ghxOccupancy(priceLine: string): number | null {
  if (/single (room|occupancy|use)|staying alone/i.test(priceLine)) return 1;
  if (/double room/i.test(priceLine)) return 2;
  return null;
}

/** Slots per future week: complete + camp-only (7 nights), windproof over two consecutive listed weeks (14 nights). */
export function buildGhxSlots(weeks: GhxWeek[], pkgs: GhPackage[], place: GhxPlace, today: string): Slot[] {
  const slots: Slot[] = [];
  const quote = 'quote by request (tour operator RETTER Sports)';
  for (const [i, w] of weeks.entries()) {
    if (w.start < today) continue;
    for (const p of pkgs) {
      if (p.key === 'a-package') continue; // no course: not a camp variant
      let end = w.end;
      if (p.key === 'windproof') {
        const next = weeks[i + 1];
        if (!next || next.start !== w.end) continue;
        end = next.end;
      }
      const priced = p.price !== null;
      const text = p.key === 'camp-only'
        ? `${p.priceLine || 'price on request'}; camp only, no flights or accommodation; ${quote}`
        : `${p.priceLine || 'price on request'}; incl. flights ${place.flights}; ${quote}`;
      slots.push({
        key: `${p.key}|${w.start}`,
        startDate: w.start,
        endDate: end,
        unit: p.key === 'complete' ? `Complete package: flights, ${place.completeUnit}, 6-day course`
          : p.key === 'windproof' ? `Windproof package: flights, ${place.windproofUnit}, course + 7 days guided rental, wind guarantee`
            : 'Kite camp only: 6-day course, gear, guiding (no travel or accommodation)',
        price: p.price,
        currency: priced ? 'EUR' : null,
        priceUnit: priced ? 'package' : null,
        priceBasis: priced ? 'person' : null,
        occupancy: p.key === 'camp-only' ? null : ghxOccupancy(p.priceLine),
        availability: 'on_request',
        availabilityText: text,
        spotsLeft: null,
        ...(p.key === 'camp-only' ? {} : { packageNights: p.key === 'windproof' ? 14 : (p.nights ?? 7) }),
      });
    }
  }
  return slots;
}

export async function fetchGhxSlots(ctx: FetchContext, url: string, place: GhxPlace, label: string, today = todayIso()): Promise<Slot[]> {
  const lines = ghLines(await ghPage(url));
  const weeks = parseGhxWeeks(lines);
  const pkgs = parseGhPackages(lines);
  if (!lines.some(l => /^Dates$/i.test(l))) throw new Error(`${label}: "Dates" block not found (layout changed?)`);
  if (pkgs.length === 0) throw new Error(`${label}: no package boxes found (layout changed?)`);
  for (const w of weeks.filter(x => x.fixed)) ctx.note(`date line "${w.raw}" has an implausible end; read as ${w.start}..${w.end}`);
  const past = weeks.filter(w => w.start < today);
  if (past.length) ctx.note(`past week(s) dropped: ${past.map(w => w.raw).join('; ')}`);
  const slots = buildGhxSlots(weeks, pkgs, place, today);
  if (slots.length === 0) ctx.note('no future camp week printed yet');
  return slots;
}

/** Camp-section photos (Rhodes helper), one per file: WordPress "-scaled" twins dropped, capped. */
export function ghxImages(html: string, max = 16): string[] {
  const all = ghImages(html);
  return all.filter(u => !/-scaled\.(?:jpe?g|png|webp)$/i.test(u) || !all.includes(u.replace(/-scaled(\.\w+)$/i, '$1'))).slice(0, max);
}

/** "2026: April, September and October" from the listed (past) weeks. */
export function ghxPastSeason(weeks: GhxWeek[]): string {
  const byYear = new Map<string, string[]>();
  for (const w of weeks) {
    const y = w.start.slice(0, 4);
    const m = new Date(`${w.start}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
    const list = byYear.get(y) ?? [];
    if (!list.includes(m)) list.push(m);
    byYear.set(y, list);
  }
  const join = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);
  return [...byYear.entries()].map(([y, ms]) => `${y}: ${join(ms)}`).join('; ');
}

/** Page wording with en / em dashes as plain hyphens (user-visible lists). */
export const ghxDash = (xs: string[]): string[] => xs.map(x => x.replace(/\s*[–—]\s*/g, ' - '));

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export const ghxWeekList = (weeks: GhxWeek[]) => weeks.map(w => `${fmt(w.start)} - ${fmt(w.end)}`).join(', ');

// --- content ----------------------------------------------------------------------------------------------------------
const HAMATA: GhxPlace = {
  completeUnit: '7 nights bungalow, breakfast + dinner buffet, airport transfer',
  windproofUnit: '14 nights bungalow, breakfast + dinner buffet, airport transfer',
  flights: '(departure airport not printed; arrival Marsa Alam or Hurghada)',
};

export function parseGhhContent(html: string, today = todayIso()): OfferContent {
  const lines = ghLines(html);
  const weeks = parseGhxWeeks(lines);
  const pkgs = parseGhPackages(lines);
  const by = (k: GhPackage['key']) => pkgs.find(p => p.key === k);
  const complete = by('complete');
  const campOnly = by('camp-only');
  const future = weeks.filter(w => w.start >= today);
  const summary = [
    `GET HIGH - Kitesurfing.at, a kite school from Lake Neusiedl in Austria, runs kite camp weeks in Hamata on Egypt's southern Red Sea coast together with its long-time partner Kite Village Hamata, whose large flat lagoon suits beginners as well as jump training.`,
    `The group stays in the village's lagoon-view Nubian-style bungalows with breakfast and dinner buffet and gets a 6-day course tailored to each level, video analysis, radio training, workshops, gear for independent practice and spot guiding.`,
    [
      complete?.price ? `The complete package with flights, transfer and 7 nights starts at EUR ${complete.price.toLocaleString('en-US')} per person in a double room` : null,
      campOnly?.price ? `the camp alone costs about EUR ${campOnly.price.toLocaleString('en-US')}` : null,
    ].filter(Boolean).join('; ') + (complete?.price || campOnly?.price ? '; quotes on request via the tour operator RETTER Sports.' : 'Quotes on request via the tour operator RETTER Sports.'),
    future.length
      ? `Camp weeks: ${ghxWeekList(future)}.`
      : `Runs every year; the next dates are not published yet${weeks.length ? ` (${ghxPastSeason(weeks)})` : ''}.`,
  ].join(' ');
  return {
    kind: 'camp',
    title: 'GET HIGH Kite Camp Egypt, Hamata',
    summary,
    continent: 'Africa',
    country: 'Egypt',
    region: 'Red Sea',
    spot: 'Hamata',
    // no spotCoords: the page prints none (kite-village-hamata uses the same spot name)
    itinerarySpots: [],
    durationDays: (complete?.nights ?? 7) + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: ghxDash(complete?.inclusions.length ? complete.inclusions : (campOnly?.inclusions ?? [])),
    optionalServices: ghxDash([
      ...pkgs.filter(p => p.key !== 'complete').map(p => `${p.name}: ${p.priceLine || 'on request'}`),
      ...lines.filter(l => /^Equipment insurance/i.test(l)),
    ]),
    accommodation: 'Kite Village Hamata: lagoon-view bungalows in Nubian style, beach across the road',
    mealPlan: 'half_board',
    languages: ['de', 'en'],
    rooms: [],
    imageUrls: ghxImages(html),
    heroVideoUrl: null,
    sourceUrl: GHH_URL,
    bookingUrl: GHH_URL,
    sourceText: [
      `camp section: ${lines.join(' / ')}`,
      `parsed: weeks ${weeks.map(w => `${w.start}..${w.end}${w.fixed ? ' (end fixed)' : ''}`).join(', ')}; packages ${pkgs.map(p => `${p.key} ${p.price} (${p.nights ?? '-'} n)`).join(', ')}`,
    ].join('\n'),
  };
}

export const getHighKiteCampHamata: OfferAdapter = {
  key: 'get-high-kite-camp-hamata',
  name: 'GET HIGH Kite Camp Egypt, Hamata',
  kind: 'camp',
  operator: getHighKiteCampTheologos.operator,
  url: GHH_URL,
  slotMethod: 'html_dates',
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() {
    return parseGhhContent(await ghPage(GHH_URL));
  },
  fetchSlots: ctx => fetchGhxSlots(ctx, GHH_URL, HAMATA, 'get-high-hamata'),
};
