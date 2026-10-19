// ---------------------------------------------------------------------------
// My Salty Sisters - Empowerment & Kite Retreat Rhodes (women only), Kremasti: one week with 7 nights in shared rooms
// of a beachfront accommodation, breakfast, daily guided kite sessions and group coaching at Kremasti Beach (partner
// station Air Riders Kite Pro Center), body & mind workouts, empowerment workshops, a beach BBQ and a trip to Rhodes town.
// For women of all levels who can already go upwind (lessons / assistance via the partner school, 15% off).
//
// Data path (checked 2026-10-19): ONE Jimdo page, https://www.mysaltysisters.info/retreats/en/kitetrip-to-rhodes/
//   - dates: "19.-26.06.2027" (header) and "WEEK KITE Retreat 19.-26. June 2027" (price box); every such range on the
//     page becomes a week, past ones are dropped.
//   - prices (EUR per person): "Regular Price: EUR 1.390,-", "Early Bird Price: EUR 1.290,- (until 01.02.2027)",
//     "Last Minute: EUR 1.450,- (after 15.05.2027)". The slot carries the price that applies on the run day with
//     priceValidUntil = the day the next tier starts minus one (early bird -> 2027-02-01, regular -> 2027-05-15);
//     the daily run moves it to the next tier automatically. Single rooms "for an additional charge" (no figure).
//   - "Included Features:" / "Not Included:" lists.
// Booking: "BOOK NOW" -> /hidden/booking-rhodes-kite-retreats/, a form ("You will receive your booking confirmation ...
//   within 1-3 days") -> availability 'on_request'; flags unset. The booking page repeats dates and prices; not fetched.
// robots.txt www.mysaltysisters.info (2026-10-19): /app/ and /j/ disallowed, "Crawl-Delay: 5"; we make 1 request per run.
// Photos: the page reuses the operator's Colombia retreat photos (file names say "colombia"); those are dropped, the
//   remaining generic retreat photos are kept (few; no Rhodes-specific photo on the page).
// State 2026-10-19: 1 week 19.-26.06.2027 -> 1 slot, early bird EUR 1,290 valid until 2027-02-01.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, iso, monthOf, parse, parseAmount, todayIso } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

export const MSS_RHODES_URL = 'https://www.mysaltysisters.info/retreats/en/kitetrip-to-rhodes/';
const MSS_BOOKING_URL = 'https://www.mysaltysisters.info/hidden/booking-rhodes-kite-retreats/';

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible lines of the page (structured text, collapsed). */
export function mssLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('head, script, style, noscript, template')) el.remove();
  return root.structuredText.split('\n').map(l => collapse(l)).filter(Boolean);
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dmy = (s: string): string | null => {
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(20\d{2})/);
  return m ? iso(+m[3], +m[2], +m[1]) : null;
};

// --- dates ------------------------------------------------------------------------------------------------------------
export interface MssWeek { start: string; end: string }

/** "19.-26.06.2027", "19.-26. June 2027", "28.06.-05.07.2027", "28. June - 5. July 2027". */
export function parseMssWeeks(lines: string[]): MssWeek[] {
  const out: MssWeek[] = [];
  const add = (w: MssWeek) => { if (w.end >= w.start && !out.some(o => o.start === w.start)) out.push(w); };
  for (const raw of lines) {
    const l = raw.replace(/[–—]/g, '-');
    for (const m of l.matchAll(/(\d{1,2})\.(?:(\d{1,2})\.)?\s*-\s*(\d{1,2})\.(\d{1,2})\.(20\d{2})/g)) {
      add({ start: iso(+m[5], m[2] ? +m[2] : +m[4], +m[1]), end: iso(+m[5], +m[4], +m[3]) });
    }
    for (const m of l.matchAll(/(\d{1,2})\.\s*(?:([A-Za-z]+)\s*)?-\s*(\d{1,2})\.\s*([A-Za-z]+)\s+(20\d{2})/g)) {
      const m2 = monthOf(m[4]);
      const m1 = m[2] ? monthOf(m[2]) : m2;
      if (m1 && m2) add({ start: iso(m2 < m1 ? +m[5] - 1 : +m[5], m1, +m[1]), end: iso(+m[5], m2, +m[3]) });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// --- prices -----------------------------------------------------------------------------------------------------------
export interface MssPrices { regular: number | null; early: number | null; earlyUntil: string | null; lastMinute: number | null; lastMinuteAfter: string | null }

export function parseMssPrices(lines: string[]): MssPrices {
  const out: MssPrices = { regular: null, early: null, earlyUntil: null, lastMinute: null, lastMinuteAfter: null };
  for (let i = 0; i < lines.length; i++) {
    const label = lines[i];
    const val = /€/.test(label) ? label : (lines[i + 1] ?? '');
    const amount = (s: string) => { const m = s.match(/€\s*([\d.,]+)/); return m ? parseAmount(m[1]) : null; };
    if (/^Regular Price:?/i.test(label) && out.regular === null) out.regular = amount(val);
    if (/^Early Bird Price:?/i.test(label) && out.early === null) { out.early = amount(val); out.earlyUntil = dmy(val.match(/until\s+([\d.]+)/i)?.[1] ?? ''); }
    if (/^Last Minute:?/i.test(label) && out.lastMinute === null) { out.lastMinute = amount(val); out.lastMinuteAfter = dmy(val.match(/after\s+([\d.]+)/i)?.[1] ?? ''); }
  }
  return out;
}

/** The tier that applies on `today`: early bird until its date (inclusive), last minute after its date, else regular. */
export function mssCurrentPrice(p: MssPrices, today: string): { price: number | null; tier: string; validUntil: string | null } {
  if (p.early !== null && p.earlyUntil && today <= p.earlyUntil) return { price: p.early, tier: 'Early Bird', validUntil: p.earlyUntil };
  if (p.lastMinute !== null && p.lastMinuteAfter && today > p.lastMinuteAfter) return { price: p.lastMinute, tier: 'Last Minute', validUntil: null };
  if (p.regular !== null) return { price: p.regular, tier: 'Regular', validUntil: p.lastMinuteAfter };
  return { price: null, tier: 'on request', validUntil: null };
}

export function buildMssSlots(weeks: MssWeek[], p: MssPrices, today: string): Slot[] {
  const cur = mssCurrentPrice(p, today);
  const tiers = [
    p.early !== null ? `Early Bird EUR ${p.early}${p.earlyUntil ? ` until ${p.earlyUntil}` : ''}` : null,
    p.regular !== null ? `Regular EUR ${p.regular}` : null,
    p.lastMinute !== null ? `Last Minute EUR ${p.lastMinute}${p.lastMinuteAfter ? ` from ${addDays(p.lastMinuteAfter, 1)}` : ''}` : null,
  ].filter(Boolean).join(', ');
  return weeks.filter(w => w.start >= today).map(w => ({
    key: w.start,
    startDate: w.start,
    endDate: w.end,
    unit: 'Shared room, 7 nights with breakfast (women only)',
    price: cur.price,
    currency: cur.price !== null ? 'EUR' : null,
    priceUnit: cur.price !== null ? 'package' : null,
    priceBasis: cur.price !== null ? 'person' : null,
    occupancy: null,
    availability: 'on_request',
    availabilityText: `${cur.tier} price${tiers ? ` (${tiers})` : ''}; single room on request for a surcharge; booking form, confirmation within 1-3 days`,
    spotsLeft: null,
    priceValidUntil: cur.validUntil,
  }));
}

export async function fetchMssSlots(ctx: FetchContext, today = todayIso()): Promise<Slot[]> {
  const lines = mssLines(await page(MSS_RHODES_URL));
  const weeks = parseMssWeeks(lines);
  const prices = parseMssPrices(lines);
  if (weeks.length === 0) throw new Error('my-salty-sisters: no retreat dates found (layout changed?)');
  if (prices.regular === null && prices.early === null) ctx.note('no price lines found; slots are price on request');
  const past = weeks.filter(w => w.start < today);
  if (past.length) ctx.note(`past retreat week(s) dropped: ${past.map(w => w.start).join(', ')}`);
  const slots = buildMssSlots(weeks, prices, today);
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

/** Content photos as Jimdo originals (transf/none); icons/logos (< 300 px everywhere) and other destinations' photos dropped. */
export function mssImages(html: string): string[] {
  const best = new Map<string, { url: string; w: number }>();
  for (const m of html.matchAll(/https:\/\/image\.jimcdn\.com\/app\/cms\/image\/transf\/([^/]+)\/path\/([^/]+)\/image\/([^/]+)\/version\/(\d+)\/([^"'\s,?]+)/g)) {
    const [, transf, site, id, ver, name] = m;
    if (/colombia|favicon/i.test(name)) continue;
    const w = transf === 'none' ? 9999 : Number(transf.match(/dimension=(\d+)/)?.[1] ?? 0);
    const prev = best.get(id);
    const url = `https://image.jimcdn.com/app/cms/image/transf/none/path/${site}/image/${id}/version/${ver}/${name}`;
    if (!prev || w > prev.w) best.set(id, { url, w });
  }
  return [...best.values()].filter(x => x.w >= 300).map(x => x.url);
}

export function parseMssContent(html: string, today = todayIso()): OfferContent {
  const lines = mssLines(html);
  const weeks = parseMssWeeks(lines);
  const prices = parseMssPrices(lines);
  const included = listAfter(lines, /^Included Features:?$/i, /^Not Included:?$/i);
  const excluded = listAfter(lines, /^Not Included:?$/i, /^Limited spots|^Which kite level/i);
  const future = weeks.filter(w => w.start >= today);
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const cur = mssCurrentPrice(prices, today);
  const summary = [
    `My Salty Sisters runs women-only kite and empowerment retreats; on Rhodes the group stays a week in Kremasti, a village near Rhodes town whose beach has steady side-shore wind, with the Air Riders Kite Pro Center as partner station.`,
    `The week includes 7 nights in shared rooms of a beachfront accommodation with breakfast, daily guided kite sessions and group coaching, morning body & mind workouts, empowerment workshops, a beach BBQ and a trip to Rhodes town; flights, transfers, lessons and rental gear are extra.`,
    `All levels are welcome, but riders must be able to go upwind safely (lessons with the partner school at 15% off).`,
    future.length
      ? `Next retreat: ${future.map(w => `${fmt(w.start)} - ${fmt(w.end)}`).join(', ')}${cur.price !== null ? `, EUR ${cur.price.toLocaleString('en-US')} per person (${cur.tier.toLowerCase()}${prices.regular ? `, regular ${prices.regular.toLocaleString('en-US')}` : ''}${prices.lastMinute ? `, last minute ${prices.lastMinute.toLocaleString('en-US')}` : ''})` : ''}; booking by form.`
      : `Runs every year; the next dates are not published yet${weeks.length ? ` (last: ${weeks.map(w => fmt(w.start)).join(', ')})` : ''}.`,
  ].join(' ');
  return {
    kind: 'camp',
    title: 'My Salty Sisters Kite Retreat Rhodes (women only), Kremasti',
    summary,
    continent: 'Europe',
    country: 'Greece',
    region: 'Dodecanese',
    spot: 'Kremasti, Rhodes',
    // no spotCoords: the site prints no coordinates; "Kremasti, Rhodes" may need a KNOWN_PINS entry at ingest
    itinerarySpots: [],
    durationDays: 8,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: false,
    equipmentRental: false,
    beginnerFriendly: false,
    includedServices: included,
    optionalServices: [
      'Single room (surcharge, if available)',
      'Lessons, assistance and rental at Air Riders Kite Pro Center (15% discount)',
      'Bring a friend: 10% off for both on the regular package price',
    ],
    accommodation: 'beachfront accommodation in Kremasti, shared rooms (single rooms for a surcharge)',
    mealPlan: 'breakfast',
    languages: ['en', 'de'],
    rooms: [],
    imageUrls: mssImages(html),
    heroVideoUrl: null,
    sourceUrl: MSS_RHODES_URL,
    bookingUrl: MSS_BOOKING_URL,
    sourceText: [
      `page: ${lines.join(' / ')}`,
      `not included: ${excluded.join(' | ')}`,
      `parsed: weeks ${weeks.map(w => `${w.start}..${w.end}`).join(', ')}; prices ${JSON.stringify(prices)}`,
    ].join('\n'),
  };
}

export const mySaltySistersRetreatKremasti: OfferAdapter = {
  key: 'my-salty-sisters-retreat-kremasti',
  name: 'My Salty Sisters Kite Retreat Rhodes (women only), Kremasti',
  kind: 'camp',
  operator: {
    name: 'My Salty Sisters',
    websiteUrl: 'https://www.mysaltysisters.info',
    rootDomain: 'mysaltysisters.info',
    phone: '+436769505200',
  },
  url: MSS_RHODES_URL,
  slotMethod: 'html_dates',
  fetchBudget: 2,
  async fetchContent() {
    return parseMssContent(await page(MSS_RHODES_URL));
  },
  fetchSlots: ctx => fetchMssSlots(ctx),
};
