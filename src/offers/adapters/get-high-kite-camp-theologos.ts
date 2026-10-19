// ---------------------------------------------------------------------------
// GET HIGH - Kitesurfing.at (Austrian kite school, Lake Neusiedl) - Kite Camp Rhodes in Theologos: summer camp weeks
// at the Surfin Bird station, staying at Hotel Sabine (4 minutes' walk, pool, breakfast), with a 6-day customised course
// (beginner to big-air / foil), video analysis, gear and spot guiding. Sold as packages through the tour operator RETTER
// Sports: "Complete Package" incl. flights + 7 nights, a camp-only price without travel, a 2-week "Windproof" package and
// an "A" (join-in, rental only) package.
//
// Data path (checked 2026-10-19): ONE WordPress page, https://www.kitesurfing.at/en/kitecamps/kite-camp-rhodos/
//   - "Dates" block: one line per week ("July 11-18, 2026", "July 18-25, 2026"); every line is read, past weeks dropped.
//   - package boxes, each "<name> ... + <inclusions> ... <price line>":
//       "Kite Camp Only"           "Approx. EUR 1, 090 per person, not including travel expenses"
//       "Complete Package"         flights + 7 nights double room + breakfast + camp: "Staying alone in a double bed,
//                                  starting at EUR 1,860 per person"
//       "Windproof Package Rhodes" flights + 14 nights + camp + wind guarantee: "Single occupancy in a double room
//                                  starting at EUR 2,800 per person"
//       "\"A\" Package"            flights + 7 nights + gear rental, no course: "Starting at EUR 1,390 per person"
//     Prices are "starting at" / "approx." (the tour operator quotes the final price, flights vary).
// Booking: "REQUEST A NO-OBLIGATION QUOTE NOW" = mailto:office@kitesurfing.at -> availability 'on_request'; flags unset.
// robots.txt www.kitesurfing.at (2026-10-19): only /wp-admin/ disallowed.
// Requests per run: 1 (memoised page).
// Slots (when the page lists future weeks): per week "complete" / "camp-only" / "a-package" (7 nights), plus
//   "windproof" for a week directly followed by another listed week (14 nights); key "<variant>|<start>".
// State 2026-10-19: only the two July 2026 weeks are printed (past) -> 0 slots ("price on request") until 2027 dates
//   appear.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse, parseAmount, parseRange, todayIso } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

export const GH_URL = 'https://www.kitesurfing.at/en/kitecamps/kite-camp-rhodos/';

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible lines of the camp section (from the H1 block to the quick-booking footer). */
export function ghLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('head, script, style, noscript, template')) el.remove();
  const lines = root.structuredText.split('\n').map(l => collapse(l)).filter(Boolean);
  const from = lines.findIndex(l => /COME JOIN US AT THE GET HIGH KITE CAMP/i.test(l));
  const to = lines.findIndex((l, i) => i > from && /^QUICK COURSE (REGISTRATION|BOOKING)$/i.test(l));
  return lines.slice(Math.max(0, from), to > from ? to : undefined);
}

// --- dates ------------------------------------------------------------------------------------------------------------
export interface GhWeek { start: string; end: string; raw: string }

export function parseGhWeeks(lines: string[]): GhWeek[] {
  const i = lines.findIndex(l => /^Dates$/i.test(l));
  if (i < 0) return [];
  const out: GhWeek[] = [];
  for (const raw of lines.slice(i + 1)) {
    if (/^Registration/i.test(raw)) break;
    const r = parseRange(raw);
    if (r && !out.some(o => o.start === r.start)) out.push({ ...r, raw });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// --- packages ---------------------------------------------------------------------------------------------------------
export interface GhPackage { key: 'camp-only' | 'complete' | 'windproof' | 'a-package'; name: string; price: number | null; priceLine: string; nights: number | null; inclusions: string[] }

const HEADS: Array<[RegExp, GhPackage['key']]> = [
  [/^Kite Camp Only$/i, 'camp-only'],
  [/^Complete Package$/i, 'complete'],
  [/^Windproof Package/i, 'windproof'],
  [/^["“”]?A["“”]? Package$/i, 'a-package'],
];

export function parseGhPackages(lines: string[]): GhPackage[] {
  const out: GhPackage[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = HEADS.find(([re]) => re.test(lines[i]));
    if (!head) continue;
    const inclusions: string[] = [];
    let priceLine = '';
    for (const l of lines.slice(i + 1, i + 40)) {
      if (HEADS.some(([re]) => re.test(l))) break;
      if (/^\+\s*/.test(l)) inclusions.push(l.replace(/^\+\s*/, ''));
      if (/€\s*[\d]/.test(l) && /per person/i.test(l) && !/taxi/i.test(l)) { priceLine = l.replace(/€\s*(\d),\s+(\d{3})\b/, '€$1,$2').replace(/Approx\.€/i, 'Approx. €'); break; }
    }
    const m = priceLine.match(/€\s*([\d][\d.,\s]*\d)/);
    const nights = inclusions.map(x => x.match(/(\d+)\s+nights/i)?.[1]).find(Boolean);
    out.push({ key: head[1], name: lines[i].replace(/[“”]/g, '"'), price: m ? parseAmount(m[1]) : null, priceLine, nights: nights ? +nights : null, inclusions });
  }
  return out.filter((p, i, a) => a.findIndex(x => x.key === p.key) === i);
}

const UNIT: Record<GhPackage['key'], string> = {
  complete: 'Complete package: flights, 7 nights double room (single use), breakfast, 6-day course',
  'camp-only': 'Kite camp only: 6-day course, gear, guiding (no travel or accommodation)',
  'a-package': '"A" package: flights, 7 nights, breakfast, gear rental (no course)',
  windproof: 'Windproof package: flights, 14 nights (single use), course + 7 days supervised rental, wind guarantee',
};

export function buildGhSlots(weeks: GhWeek[], pkgs: GhPackage[], today: string): Slot[] {
  const slots: Slot[] = [];
  for (const [i, w] of weeks.entries()) {
    if (w.start < today) continue;
    for (const p of pkgs) {
      let end = w.end;
      if (p.key === 'windproof') {
        const next = weeks[i + 1];
        if (!next || next.start !== w.end) continue;
        end = next.end;
      }
      slots.push({
        key: `${p.key}|${w.start}`,
        startDate: w.start,
        endDate: end,
        unit: UNIT[p.key],
        price: p.price,
        currency: p.price !== null ? 'EUR' : null,
        priceUnit: p.price !== null ? 'package' : null,
        priceBasis: p.price !== null ? 'person' : null,
        occupancy: p.key === 'complete' || p.key === 'windproof' ? 1 : null,
        availability: 'on_request',
        availabilityText: `${p.priceLine || 'price on request'}; quote by e-mail request (tour operator RETTER Sports)`,
        spotsLeft: null,
        ...(p.key === 'camp-only' ? {} : { packageNights: p.key === 'windproof' ? 14 : (p.nights ?? 7) }),
      });
    }
  }
  return slots;
}

export async function fetchGhSlots(ctx: FetchContext, today = todayIso()): Promise<Slot[]> {
  const lines = ghLines(await page(GH_URL));
  const weeks = parseGhWeeks(lines);
  const pkgs = parseGhPackages(lines);
  if (weeks.length === 0) throw new Error('get-high-rhodes: "Dates" block not found or empty (layout changed?)');
  if (pkgs.length === 0) throw new Error('get-high-rhodes: no package boxes found (layout changed?)');
  const past = weeks.filter(w => w.start < today);
  if (past.length) ctx.note(`past week(s) dropped: ${past.map(w => w.raw).join('; ')}`);
  const slots = buildGhSlots(weeks, pkgs, today);
  if (slots.length === 0) ctx.note('no future camp week printed yet');
  return slots;
}

// --- content ----------------------------------------------------------------------------------------------------------
/** Photos of the camp section (Hotel / Spot / title images), full size; icons, logo and 150x150 thumbs dropped. */
export function ghImages(html: string): string[] {
  const i = html.indexOf('COME JOIN US');
  const j = html.indexOf('QUICK COURSE REGISTRATION', i);
  const seg = i >= 0 ? html.slice(i, j > i ? j : undefined) : html;
  const out: string[] = [];
  for (const m of seg.matchAll(/(?:src|href|data-src|data-lazy-src)="(https:\/\/www\.kitesurfing\.at\/wp-content\/uploads\/[^"]+\.(?:jpe?g|png|webp))"/gi)) {
    const u = m[1].replace(/-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp))$/i, '$1');
    if (/icon|logo|swoosh/i.test(u)) continue;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export function parseGhContent(html: string, today = todayIso()): OfferContent {
  const lines = ghLines(html);
  const weeks = parseGhWeeks(lines);
  const pkgs = parseGhPackages(lines);
  const by = (k: GhPackage['key']) => pkgs.find(p => p.key === k);
  const complete = by('complete');
  const campOnly = by('camp-only');
  const future = weeks.filter(w => w.start >= today);
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const summary = [
    `GET HIGH - Kitesurfing.at, a kite school from Lake Neusiedl in Austria, runs summer kite camp weeks in Theologos on the west coast of Rhodes, a thermal-wind spot with deeper water that suits big-air and foil training as well as beginners.`,
    `The group stays at Hotel Sabine, four minutes' walk from the Surfin Bird station (pool, breakfast), and gets a 6-day course tailored to each level, video analysis, gear for independent practice, workshops and spot guiding with trips around the island.`,
    [
      complete?.price ? `The complete package with flights and 7 nights starts at EUR ${complete.price.toLocaleString('en-US')} per person (single use of a double room)` : null,
      campOnly?.price ? `the camp alone costs about EUR ${campOnly.price.toLocaleString('en-US')}` : null,
    ].filter(Boolean).join('; ') + (complete?.price || campOnly?.price ? '; quotes on request via the tour operator RETTER Sports.' : 'Quotes on request via the tour operator RETTER Sports.'),
    future.length
      ? `Camp weeks: ${future.map(w => `${fmt(w.start)} - ${fmt(w.end)} ${w.end.slice(0, 4)}`).join(', ')}.`
      : `Runs every summer; the next dates are not published yet${weeks.length ? ` (${[...new Set(weeks.map(w => w.start.slice(0, 4)))].join('/')}: ${weeks.map(w => `${fmt(w.start)} - ${fmt(w.end)}`).join(', ')})` : ''}.`,
  ].join(' ');
  return {
    kind: 'camp',
    title: 'GET HIGH Kite Camp Rhodes, Theologos',
    summary,
    continent: 'Europe',
    country: 'Greece',
    region: 'Dodecanese',
    spot: 'Theologos, Rhodes',
    // no spotCoords: the site prints none ("Theologos, Rhodes" does not geocode; logos-beach-village-theologos pins it by hand)
    itinerarySpots: [],
    durationDays: (complete?.nights ?? 7) + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: complete?.inclusions.length ? complete.inclusions : (campOnly?.inclusions ?? []),
    optionalServices: pkgs.filter(p => p.key !== 'complete').map(p => `${p.name}: ${p.priceLine || 'on request'}`),
    accommodation: 'Hotel Sabine, Theologos: double rooms with balcony, pool, restaurant, 4 minutes from the spot',
    mealPlan: 'breakfast',
    languages: ['de', 'en'],
    rooms: [],
    imageUrls: ghImages(html),
    heroVideoUrl: null,
    sourceUrl: GH_URL,
    bookingUrl: GH_URL,
    sourceText: [
      `camp section: ${lines.join(' / ')}`,
      `parsed: weeks ${weeks.map(w => `${w.start}..${w.end}`).join(', ')}; packages ${pkgs.map(p => `${p.key} ${p.price} (${p.nights ?? '-'} n)`).join(', ')}`,
    ].join('\n'),
  };
}

export const getHighKiteCampTheologos: OfferAdapter = {
  key: 'get-high-kite-camp-theologos',
  name: 'GET HIGH Kite Camp Rhodes, Theologos',
  kind: 'camp',
  operator: {
    name: 'GET HIGH - Kitesurfing.at',
    websiteUrl: 'https://www.kitesurfing.at',
    rootDomain: 'kitesurfing.at',
    contactEmail: 'office@kitesurfing.at',
    phone: '+4369919678682',
  },
  url: GH_URL,
  slotMethod: 'html_dates',
  fetchBudget: 2,
  async fetchContent() {
    return parseGhContent(await page(GH_URL));
  },
  fetchSlots: ctx => fetchGhSlots(ctx),
};
