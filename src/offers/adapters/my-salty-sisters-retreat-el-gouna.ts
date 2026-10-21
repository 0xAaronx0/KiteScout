// ---------------------------------------------------------------------------
// My Salty Sisters - "8 Days KITE Retreat in Egypt" (women only), El Gouna: one week with 7 nights in a Nubian villa
// with direct lagoon access (shared rooms, single rooms for a surcharge), Hurghada airport transfers, daily guided kite
// sessions + group progression coaching, body & mind workouts, workshops (self rescue, kite technique), kite rescue
// service and a goodie bag. Limited to 8 places (private house). Riders must go upwind safely; lessons / assistance via
// the partner school KitePower. Separate listing from the operator's Rhodes retreat (my-salty-sisters-retreat-kremasti).
//
// Data path (checked 2026-10-21): ONE Jimdo page, https://www.mysaltysisters.info/retreats/en/kitetrip-to-el-gouna/
//   - dates: "Kite holidays in Egypt: 17. - 24. 04.2027" (header) and "8 Days KITE Retreat in Egypt 17. - 24.04.2027"
//     (price box); every such range on the page becomes a week (Rhodes parser, after closing "24. 04.2027" to
//     "24.04.2027"), past ones are dropped.
//   - prices (EUR per person, shared room): "Standard Price:" / "€ 1.480,-" and "Early Bird:" / "only € 1.390,- (until
//     15.09.2026)" (labels differ from the Rhodes page; this parser also accepts "Regular Price" / "Last Minute"). The
//     slot carries the tier that applies on the run day (Rhodes helper mssCurrentPrice); on 2026-10-21 the early bird
//     is over -> EUR 1,480. Single room "for an additional fee" (no figure).
//   - "Included Features:" / "Not Included:" lists.
// Booking: "BOOK NOW" -> /hidden/booking-el-gouna-egypt/ (a sign-up form, not fetched) -> availability 'on_request';
//   liveAvailability unset, instantBooking false (request form, no checkout).
// robots.txt www.mysaltysisters.info (2026-10-21): /app/ and /j/ disallowed, "Crawl-Delay: 5"; this module waits 5 s
//   between its own requests (skipped on fixture replay). Doubt: the Rhodes adapter keeps its own delay chain, so the
//   two adapters running in parallel in one ingest could hit the host twice within 5 s.
// Photos: the trip page has only 4 generic photos; El Gouna photos come from the operator's own photo page of the
//   latest past El Gouna retreat: /retreats/en/previous-retreats/ links "/hidden/pictures-of-el-gouna-2026/" (11.-18.04.
//   2026), "-egypt-september-2024/", "pictures-of-egypt-november-2023/" ...; the link with the highest year that names
//   El Gouna (else Egypt) is read (19 photos in the page's own 2048/4096 rendition, Rhodes helper mssGalleryImages).
//   Gallery photos go first (capped at 16), the trip page's photos after (the "image.png" badge dropped).
// Requests per run: content 3 (trip page, previous-retreats page, latest El Gouna photo page; ~10 s with the crawl
//   delay), slots 1 (memoised with content).
// State 2026-10-21: 1 week 17.-24.04.2027 -> 1 slot, EUR 1,480 per person (standard; early bird ended 15.09.2026).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, iso, parseAmount, todayIso } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import {
  mssCurrentPrice, mssGalleryImages, mssImages, mssLines, mySaltySistersRetreatKremasti, parseMssWeeks,
  type MssPrices, type MssWeek,
} from './my-salty-sisters-retreat-kremasti.js';

const MSS_SITE = 'https://www.mysaltysisters.info';
export const MSSG_URL = `${MSS_SITE}/retreats/en/kitetrip-to-el-gouna/`;
export const MSSG_PREVIOUS_URL = `${MSS_SITE}/retreats/en/previous-retreats/`;
const MSSG_BOOKING_URL = `${MSS_SITE}/hidden/booking-el-gouna-egypt/`;
const CRAWL_DELAY_MS = 5_000; // robots.txt "Crawl-Delay: 5"
const MAX_GALLERY = 16;
const MAX_PHOTOS = 20;

/** Memoised fetch, serialised with the robots.txt crawl delay (skipped on fixture replay). */
const memo = new Map<string, { at: number; p: Promise<string> }>();
let chain: Promise<unknown> = Promise.resolve();
let lastSiteFetch = 0;
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = chain.then(async () => {
    if (!process.env.OFFERS_FIXTURE_DIR) {
      const wait = lastSiteFetch + CRAWL_DELAY_MS - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    try { return await fetchText(url); } finally { lastSiteFetch = Date.now(); }
  });
  chain = p.catch(() => undefined);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

const dmy = (s: string): string | null => {
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(20\d{2})/);
  return m ? iso(+m[3], +m[2], +m[1]) : null;
};

/** Weeks of the page: the Rhodes parser, after closing "24. 04.2027" to "24.04.2027". */
export function parseMssgWeeks(lines: string[]): MssWeek[] {
  return parseMssWeeks(lines.map(l => l.replace(/(\d{1,2})\.\s+(\d{1,2}\.20\d{2})/g, '$1.$2')));
}

/** "Standard Price:" / "Regular Price:", "Early Bird:" ("only € 1.390,- (until 15.09.2026)"), "Last Minute:"; value on the label line or the next. */
export function parseMssgPrices(lines: string[]): MssPrices {
  const out: MssPrices = { regular: null, early: null, earlyUntil: null, lastMinute: null, lastMinuteAfter: null };
  const amount = (s: string) => { const m = s.match(/€\s*([\d.,]+)/); return m ? parseAmount(m[1]) : null; };
  for (let i = 0; i < lines.length; i++) {
    const label = lines[i];
    const val = /€/.test(label) ? label : (lines[i + 1] ?? '');
    if (/^(Standard|Regular) Price:?/i.test(label) && out.regular === null) out.regular = amount(val);
    if (/^Early Bird( Price)?:?/i.test(label) && out.early === null) { out.early = amount(val); out.earlyUntil = dmy(val.match(/until\s+([\d.]+)/i)?.[1] ?? ''); }
    if (/^Last Minute( Price)?:?/i.test(label) && out.lastMinute === null) { out.lastMinute = amount(val); out.lastMinuteAfter = dmy(val.match(/after\s+([\d.]+)/i)?.[1] ?? ''); }
  }
  return out;
}

export function buildMssgSlots(weeks: MssWeek[], p: MssPrices, today: string): Slot[] {
  const cur = mssCurrentPrice(p, today);
  const tiers = [
    p.early !== null ? `Early Bird EUR ${p.early}${p.earlyUntil ? ` until ${p.earlyUntil}` : ''}` : null,
    p.regular !== null ? `Standard EUR ${p.regular}` : null,
    p.lastMinute !== null ? `Last Minute EUR ${p.lastMinute}${p.lastMinuteAfter ? ` after ${p.lastMinuteAfter}` : ''}` : null,
  ].filter(Boolean).join(', ');
  const tier = cur.tier === 'Regular' ? 'Standard' : cur.tier;
  return weeks.filter(w => w.start >= today).map(w => ({
    key: w.start,
    startDate: w.start,
    endDate: w.end,
    unit: 'Shared room in the villa, 7 nights, transfers, guiding + coaching (women only)',
    price: cur.price,
    currency: cur.price !== null ? 'EUR' : null,
    priceUnit: cur.price !== null ? 'package' : null,
    priceBasis: cur.price !== null ? 'person' : null,
    occupancy: null,
    availability: 'on_request',
    availabilityText: `${tier} price${tiers ? ` (${tiers})` : ''}; single room for a surcharge; max. 8 places; booking by sign-up form`,
    spotsLeft: null,
    packageNights: 7,
    priceValidUntil: cur.validUntil,
  }));
}

export async function fetchMssgSlots(ctx: FetchContext, today = todayIso()): Promise<Slot[]> {
  const lines = mssLines(await page(MSSG_URL));
  const weeks = parseMssgWeeks(lines);
  const prices = parseMssgPrices(lines);
  if (weeks.length === 0) throw new Error('my-salty-sisters-el-gouna: no retreat dates found (layout changed?)');
  if (prices.regular === null && prices.early === null) ctx.note('no price lines found; slots are price on request');
  const past = weeks.filter(w => w.start < today);
  if (past.length) ctx.note(`past retreat week(s) dropped: ${past.map(w => w.start).join(', ')}`);
  const slots = buildMssgSlots(weeks, prices, today);
  if (slots.length === 0) ctx.note('no future retreat week printed yet');
  return slots;
}

// --- content ----------------------------------------------------------------------------------------------------------
function listAfter(lines: string[], head: RegExp, stop: RegExp): string[] {
  const i = lines.findIndex(l => head.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (stop.test(l)) break;
    out.push(l);
  }
  return out;
}

/** Newest photo page of a past El Gouna retreat (links naming "gouna" first, else "egypt"; highest year wins). */
export function mssgGalleryUrl(previousHtml: string): string | null {
  const links = [...previousHtml.matchAll(/href="(\/hidden\/[^"]*(?:gouna|egypt)[^"]*)"/gi)].map(m => m[1]);
  const pick = (re: RegExp) => {
    let best: { url: string; year: number } | null = null;
    for (const l of links.filter(x => re.test(x))) {
      const year = Number(l.match(/20\d{2}/)?.[0] ?? 0);
      if (!best || year > best.year) best = { url: new URL(l, MSS_SITE).toString(), year };
    }
    return best?.url ?? null;
  };
  return pick(/gouna/i) ?? pick(/egypt/i);
}

/** Photo-page photos first (capped), then the trip page's own photos (badge dropped), one per Jimdo image id. */
export function mssgPhotoCandidates(tripHtml: string, galleryHtml: string | null): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  const add = (u: string) => {
    const id = u.match(/\/image\/(i[0-9a-f]+)\//)?.[1] ?? u;
    if (ids.has(id) || out.length >= MAX_PHOTOS) return;
    ids.add(id);
    out.push(u);
  };
  for (const u of (galleryHtml ? mssGalleryImages(galleryHtml) : []).slice(0, MAX_GALLERY)) add(u);
  for (const u of mssImages(tripHtml)) if (!/\/image\.png$/i.test(u)) add(u);
  return out;
}

export function parseMssgContent(html: string, today = todayIso(), galleryHtml: string | null = null): OfferContent {
  const lines = mssLines(html);
  const weeks = parseMssgWeeks(lines);
  const prices = parseMssgPrices(lines);
  const included = listAfter(lines, /^Included Features:?$/i, /^Not Included:?$/i);
  const excluded = listAfter(lines, /^Not Included:?$/i, /^As always|^Limited spots|kite level do I need/i);
  const places = lines.join(' ').match(/limited to (\d+) spots/i)?.[1];
  const future = weeks.filter(w => w.start >= today);
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const cur = mssCurrentPrice(prices, today);
  const summary = [
    `My Salty Sisters runs women-only kite and empowerment retreats; in Egypt the group spends a week in El Gouna on the Red Sea, a flat-water lagoon with steady side-onshore wind, 30 minutes from Hurghada airport.`,
    `The week includes 7 nights in a Nubian villa with direct lagoon access (shared rooms, single rooms for a surcharge), airport transfers, daily guided kite sessions and group coaching, body & mind workouts, workshops such as self rescue and a kite rescue service; flights, visa, food and drinks, lessons and rental gear are extra.`,
    `All levels are welcome, but riders must be able to go upwind safely (lessons can be arranged with the partner school KitePower)${places ? `; the retreat is limited to ${places} places` : ''}.`,
    future.length
      ? `Next retreat: ${future.map(w => `${fmt(w.start)} - ${fmt(w.end)}`).join(', ')}${cur.price !== null ? `, EUR ${cur.price.toLocaleString('en-US')} per person in a shared room` : ''}; booking by form.`
      : `Runs every year; the next dates are not published yet${weeks.length ? ` (last: ${weeks.map(w => fmt(w.start)).join(', ')})` : ''}.`,
  ].join(' ');
  return {
    kind: 'camp',
    title: 'My Salty Sisters Kite Retreat Egypt (women only), El Gouna',
    summary,
    continent: 'Africa',
    country: 'Egypt',
    region: 'Red Sea Governorate',
    spot: 'El Gouna',
    // no spotCoords: the site prints none; "El Gouna" geocodes
    itinerarySpots: [],
    durationDays: 8,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: false,
    equipmentRental: false,
    beginnerFriendly: false,
    includedServices: included,
    optionalServices: [
      'Single room (surcharge)',
      'Beginner lessons / assistance with the partner school KitePower',
      'Rental gear and kite storage (organised on request)',
      'Bring a friend: 10% off for both on the normal package price',
    ],
    accommodation: 'Nubian villa in El Gouna with direct lagoon access, shared rooms (single rooms for a surcharge)',
    mealPlan: null, // "Food & Beverages" are not included
    languages: ['en', 'de'],
    rooms: [],
    imageUrls: mssgPhotoCandidates(html, galleryHtml),
    heroVideoUrl: null,
    sourceUrl: MSSG_URL,
    bookingUrl: MSSG_BOOKING_URL,
    sourceText: [
      `page: ${lines.slice(Math.max(0, lines.findIndex(l => /^Kiting In /i.test(l)))).slice(0, 200).map(l => collapse(l)).join(' / ')}`,
      `not included: ${excluded.join(' | ')}`,
      `parsed: weeks ${weeks.map(w => `${w.start}..${w.end}`).join(', ')}; prices ${JSON.stringify(prices)}`,
    ].join('\n'),
  };
}

export const mySaltySistersRetreatElGouna: OfferAdapter = {
  key: 'my-salty-sisters-retreat-el-gouna',
  name: 'My Salty Sisters Kite Retreat Egypt (women only), El Gouna',
  kind: 'camp',
  operator: mySaltySistersRetreatKremasti.operator,
  url: MSSG_URL,
  slotMethod: 'html_dates',
  instantBooking: false,
  fetchBudget: 4,
  async fetchContent(ctx) {
    const html = await page(MSSG_URL);
    let gallery: string | null = null;
    try {
      const url = mssgGalleryUrl(await page(MSSG_PREVIOUS_URL));
      if (url) gallery = await page(url);
      else ctx.note('my-salty-sisters-el-gouna: no El Gouna photo page linked on the previous-retreats page');
    } catch (e) { ctx.note(`my-salty-sisters-el-gouna: photo pages failed (${(e as Error).message})`); }
    return parseMssgContent(html, todayIso(), gallery);
  },
  fetchSlots: ctx => fetchMssgSlots(ctx),
};
