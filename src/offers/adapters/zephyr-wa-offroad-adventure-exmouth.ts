// ---------------------------------------------------------------------------
// Zephyr Kitesurfing Tours - Western Australia Signature Adventure Off-Road Kiteboarding Tour, Exmouth (Western
// Australia): 7 nights at the Escape Resort in Exmouth (2-bedroom apartments, ensuite per bedroom), daily 4WD trips
// in the company's Landcruiser to remote kite spots in Cape Range National Park / Ningaloo Reef, daily coaching for
// intermediate to advanced riders, a rescue boat, the mobile kite centre (kitchen, fridge, toilet, shower), all meals,
// airport transfers from Exmouth airport; max 7 guests. One base, day trips -> KIND = 'camp' (Zephyr calls it a tour).
//
// Data path (checked 2026-10-19): WordPress, two pages:
//   dates    /western-australia-kiteboarding-tour/ "TOUR DATES: 31ST OCTOBER - 7TH NOVEMBER 2026" and the
//            "2026 TOUR DATES" block ("31ST OCTOBER - 7TH NOVEMBER"; the year comes from the heading). Every such
//            range is read, so new dates appear without a code change; dates before today are dropped.
//   price    not printed anywhere on the site (tour page, book-now page) -> price null ("price on request").
//   booking  /book-now/ embeds a Checkfront widget (zephyr.checkfront.com, item 218 = the WA tour): "You will not be
//            charged at the time of booking. A deposit is required within 7 days". zephyr.checkfront.com answers our
//            bot with a Cloudflare block page even on /robots.txt (2026-10-19) -> BLOCKED, not read; availability
//            'unknown', liveAvailability / instantBooking unset.
//   content  the tour page (about, inclusions, location, accommodation, photos) + the book-now section of the WA
//            tour (suitability: "experienced kiters only ... must be able to ride upwind").
// robots.txt (2026-10-19): only /wp-admin/ disallowed, "Crawl-delay: 10" -> this adapter waits 10 s between its own
//   zephyrkitetours.com requests (local helper; the shared throttle in http.ts is 1.5 s; skipped on fixture replay).
// Requests per run: content 2 (tour + book-now page, ~10 s), slots 1 (tour page, memoised in the same run).
// spotCoords: none on the site ("Exmouth, Western Australia" is left to the geocoder).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { daysInclusive, imageCandidates, parseRange, todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';
import { wpLines } from './kite-republic-aitutaki-winter-escape.js';

export const ZEPHYR_SITE = 'https://www.zephyrkitetours.com';
export const ZEPHYR_WA_URL = `${ZEPHYR_SITE}/western-australia-kiteboarding-tour/`;
export const ZEPHYR_BOOK_URL = `${ZEPHYR_SITE}/book-now/`;
const CRAWL_DELAY_MS = 10_000; // zephyrkitetours.com robots.txt "Crawl-delay: 10"

export const ZEPHYR_OPERATOR: OperatorRef = {
  name: 'Zephyr Kitesurfing Tours',
  websiteUrl: ZEPHYR_SITE,
  rootDomain: 'zephyrkitetours.com',
  contactEmail: 'info@zephyrkitetours.com',
};

// --- fetch with the crawl delay -------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
let lastFetch = 0;
let queue: Promise<unknown> = Promise.resolve();
/** Memoised fetch, serialised with the robots.txt crawl delay (no wait on fixture replay). */
export function zephyrPage(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const run = async (): Promise<string> => {
    if (!process.env.OFFERS_FIXTURE_DIR) {
      const wait = lastFetch + CRAWL_DELAY_MS - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    try { return await fetchText(url, { accept: 'text/html' }); } finally { lastFetch = Date.now(); }
  };
  const p = queue.catch(() => undefined).then(run);
  queue = p;
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

// --- parsers ------------------------------------------------------------------------------------------
export interface ZephyrDate { start: string; end: string; label: string }

const DAY = String.raw`\d{1,2}(?:ST|ND|RD|TH)?\s+[A-Z]{3,9}`;
const RANGE_RE = new RegExp(String.raw`^(?:TOUR DATES:?\s*)?(${DAY}(?:\s+20\d{2})?\s*-\s*${DAY}(?:\s+20\d{2})?)$`, 'i');

/** "TOUR DATES: 31ST OCTOBER - 7TH NOVEMBER 2026" lines, or a bare range under a "2026 TOUR DATES" heading. */
export function parseZephyrDates(html: string): ZephyrDate[] {
  const out: ZephyrDate[] = [];
  let headingYear: number | undefined;
  for (const raw of wpLines(html)) {
    const l = raw.replace(/[–—]/g, '-').trim();
    const h = l.match(/^(20\d{2})\s+TOUR DATES$/i);
    if (h) { headingYear = Number(h[1]); continue; }
    const m = l.match(RANGE_RE);
    if (!m) continue;
    const r = parseRange(m[1].replace(/(\d)(?:ST|ND|RD|TH)\b/gi, '$1'), headingYear);
    if (r && !out.some(d => d.start === r.start)) out.push({ ...r, label: m[1] });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export function buildZephyrSlots(dates: ZephyrDate[], today: string): Slot[] {
  return dates.filter(d => d.start >= today).map(d => ({
    key: d.start,
    startDate: d.start,
    endDate: d.end,
    unit: 'Shared 2-bedroom apartment (own bedroom with ensuite)',
    price: null,
    currency: null,
    priceUnit: null,
    priceBasis: null,
    occupancy: 1,
    availability: 'unknown',
    availabilityText: 'Price not printed on the site; book in the operator\'s Checkfront calendar (no charge at booking, deposit within 7 days) or enquire',
    spotsLeft: null,
  }));
}

/** The lines of the "OUR WA REMOTE KITEBOARDING TOUR INCLUDES:" list. */
export function parseZephyrInclusions(lines: string[]): string[] {
  const i = lines.findIndex(l => /TOUR INCLUDES:?$/i.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (/^Location$/i.test(l) || out.length >= 15) break;
    out.push(l.replace(/\.$/, ''));
  }
  return out;
}

/** Own tour photos: the WA shots and the Exmouth accommodation; skill badges, the Cocos photo and thumbnails dropped. */
export function zephyrImages(html: string): string[] {
  const out: string[] = [];
  for (const u of imageCandidates(html, ZEPHYR_WA_URL, null, 80)) {
    if (!/\/wp-content\/uploads\//.test(u) || !/\.(jpe?g|png|webp|avif)$/i.test(u)) continue;
    if (/Cocos|Thumbnail|logo|icon|Flat-Water|Waves\.png|Intermediate|Advanced|Adventure\.png|Twin-Tip|Small-Groups/i.test(u)) continue;
    // only the -WxH thumbnail suffix is stripped; "-scaled" / "-scaled-e<id>" files are the published versions as linked
    const orig = u.replace(/-\d{2,4}x\d{2,4}(\.[a-z]+)$/i, '$1');
    const stem = (x: string): string => x.replace(/-scaled(?:-e\d+)?(\.[a-z]+)$/i, '$1');
    if (!out.some(x => stem(x) === stem(orig))) out.push(orig);
  }
  return out;
}

export interface ZephyrPages { tour: string; book: string | null }

export function parseZephyrContent(p: ZephyrPages, today = todayIso()): OfferContent {
  const lines = wpLines(p.tour);
  const dates = parseZephyrDates(p.tour);
  if (!dates.length) throw new Error('zephyr-wa: no "TOUR DATES" range on the tour page (layout changed?)');
  const included = parseZephyrInclusions(lines);
  if (!included.length) throw new Error('zephyr-wa: inclusions list not found (layout changed?)');
  const future = dates.filter(d => d.start >= today);
  const ref = future[0] ?? dates[dates.length - 1];
  const nights = daysInclusive(ref.start, ref.end) - 1;
  const bookLines = p.book ? wpLines(p.book) : [];
  const waIdx = bookLines.findIndex(l => /^W\.A\. SIGNATURE ADVENTURE OFF-ROAD/i.test(l));
  const bookWa = waIdx >= 0 ? bookLines.slice(waIdx, waIdx + 20) : [];
  const testimonials = lines.findIndex(l => /^TESTIMONIALS$/i.test(l));
  const datesText = future.length
    ? `Tour dates: ${future.map(d => `${d.start} to ${d.end}`).join(', ')}`
    : `Runs once a year; the next dates are not published yet (last: ${dates.map(d => `${d.start} to ${d.end}`).join(', ')})`;

  const summary = [
    `Zephyr Kitesurfing Tours runs a small-group off-road kite trip from Exmouth, Western Australia: ${nights} nights at the 4.5-star Escape Resort in shared two-bedroom apartments (each bedroom with its own ensuite), and every day a 4WD trip to a different remote kite spot in Cape Range National Park on the Ningaloo Reef.`,
    'Daily coaching, a rescue boat, the mobile kite centre with kitchen, toilet and shower, all meals and the Exmouth airport transfers are included; the group is limited to seven riders.',
    'It is for experienced kiters only: riders must be able to ride upwind, as some spots are offshore.',
    `${datesText}. The price is not published on the site; booking runs through the operator's online calendar with a deposit due within 7 days.`,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Zephyr Western Australia Off-Road Kiteboarding Tour',
    summary,
    continent: 'Oceania',
    country: 'Australia',
    region: 'Exmouth, Western Australia',
    spot: 'Exmouth',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: null,
    beginnerFriendly: false,
    includedServices: included,
    optionalServices: ['Whole one-bedroom apartment instead of a shared two-bedroom apartment (price on request)'],
    accommodation: 'Exmouth Escape Resort: shared 2-bedroom apartments, each bedroom with its own ensuite',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: [{ name: 'Shared 2-bedroom apartment (own bedroom with ensuite)', description: 'Escape Resort Exmouth; no single supplement', features: ['ensuite per bedroom'] }],
    imageUrls: zephyrImages(p.tour).slice(0, 20),
    heroVideoUrl: null,
    sourceUrl: ZEPHYR_WA_URL,
    bookingUrl: ZEPHYR_BOOK_URL,
    sourceText: [
      (testimonials > 0 ? lines.slice(0, testimonials) : lines).join('\n'),
      bookWa.length ? `book-now (W.A. tour): ${bookWa.join('\n')}` : '',
      `parsed: dates ${dates.map(d => `${d.start}..${d.end}`).join(', ')}; price not printed`,
    ].filter(Boolean).join('\n'),
  };
}

export async function fetchZephyrSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const dates = parseZephyrDates(await zephyrPage(ZEPHYR_WA_URL));
  if (!dates.length) throw new Error('zephyr-wa: no "TOUR DATES" range on the tour page (layout changed?)');
  const past = dates.filter(d => d.start < today);
  if (past.length) ctx?.note(`${past.length} past tour date(s) dropped (${past.map(d => d.start).join(', ')})`);
  return buildZephyrSlots(dates, today);
}

export const zephyrWaOffroadAdventureExmouth: OfferAdapter = {
  key: 'zephyr-wa-offroad-adventure-exmouth',
  name: 'Zephyr Western Australia Signature Adventure Off-Road Kiteboarding Tour, Exmouth',
  kind: 'camp',
  operator: ZEPHYR_OPERATOR,
  url: ZEPHYR_WA_URL,
  slotMethod: 'html_dates',
  fetchBudget: 3,
  confidence: 'medium',
  async fetchContent() {
    const tour = await zephyrPage(ZEPHYR_WA_URL);
    const book = await zephyrPage(ZEPHYR_BOOK_URL).catch(() => null);
    return parseZephyrContent({ tour, book });
  },
  fetchSlots: ctx => fetchZephyrSlots(todayIso(), ctx),
};
