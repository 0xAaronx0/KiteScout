// ---------------------------------------------------------------------------
// KiteGeneration - Kite Camp EXperience in Punta Trettu (south-west Sardinia): fixed-date group camps of 5 nights at
// Villa Punta Trettu (en-suite rooms, pool, directly at the lagoon) with a 15-hour beginner-to-riding course and all
// gear (personal wetsuit, harness and helmet for the week). Separate listing from the villa itself
// (punta-trettu-kitesurf-house-sardinia, puntatrettukitesurfhouse.com), same property.
//
// Data path (checked 2026-10-19): WordPress, server-rendered, 3 pages.
//   /kite-camp-sardinia-punta-trettu/  content (inclusions, villa, 5-day programme, photos)
//   /prices/   table.kc-table "KITE CAMP (Kite Course, Equipment, Accommodation on the Kite Spot)":
//              KCL-5 Low (from September to June) / KCH-5 High (July and August), 5 days / nights, 15 h lessons,
//              EUR per person: private course + single room 1.575 / 1.775, private course + double room 1.275 / 1.375,
//              semi-private course + double room 975 / 1.075.
//   /kiteform/ the camp dates: "Kite Camps are organized in the following dates (... minimum of 4 participants)",
//              one <li> per month: "May 2026: done", "August 2026 (high season): 23 August (check in) - 28 August
//              (check out)", "September 2026: Not yet defined". Only rows with check-in/check-out dates become slots.
// Booking: the kiteform page is a request form ("BOOK YOUR KITE CAMP HERE" opens a form, no checkout) ->
//   availability 'on_request'; flags unset.
// robots.txt kitegeneration.com (2026-10-19): only Crawl-delay rules for MSNBot / bingbot.
// Requests per run: content 3, slots 2 (prices + kiteform), memoised.
// Slots: one per future dated camp x room/course variant (key "<code>-<variant>|<check-in>"), EUR per person, priceUnit
//   'package', the season row chosen by the check-in month.
// State 2026-10-19: the only dated 2026 camp (23.-28.08.2026) is past, September/October "Not yet defined" -> 0 slots
//   ("price on request") until the form lists 2027 dates.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, monthOf, parse, parseAmount, todayIso, type HTMLElement } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

export const KG_SITE = 'https://kitegeneration.com';
export const KG_CAMP_URL = `${KG_SITE}/kite-camp-sardinia-punta-trettu/`;
export const KG_PRICES_URL = `${KG_SITE}/prices/`;
export const KG_FORM_URL = `${KG_SITE}/kiteform/`;

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');

// --- camp dates (kiteform) ------------------------------------------------------------------------------------------
export interface KgCampDate { start: string; end: string; raw: string; high: boolean }
export interface KgDates { dated: KgCampDate[]; undated: string[]; minParticipants: number | null }

/** The <li> rows after "Kite Camps are organized in the following dates". */
export function parseKgDates(html: string): KgDates {
  const root = parse(html);
  const p = root.querySelectorAll('p').find(x => /Kite Camps are organized in the following dates/i.test(x.text));
  const out: KgDates = { dated: [], undated: [], minParticipants: null };
  if (!p) return out;
  const min = txt(p).match(/minim\w*um of (\d+) participants/i);
  out.minParticipants = min ? +min[1] : null;
  let ul = p.nextElementSibling;
  while (ul && ul.tagName !== 'UL') ul = ul.nextElementSibling;
  if (!ul) return out;
  for (const li of ul.querySelectorAll('li')) {
    const raw = txt(li).replace(/[–—]/g, '-');
    const head = raw.match(/^([A-Za-z]+)(?:\s+(20\d{2}))?\s*(\([^)]*\))?\s*:\s*(.*)$/);
    if (!head) continue;
    const year = head[2] ? +head[2] : null;
    const d = head[4].match(/(\d{1,2})\s+([A-Za-z]+)\s*\(check[ -]?in\)\s*-\s*(\d{1,2})\s+([A-Za-z]+)\s*\(check[ -]?out\)/i);
    if (!d || !year || !monthOf(d[2]) || !monthOf(d[4])) { out.undated.push(raw); continue; }
    const m1 = monthOf(d[2])!, m2 = monthOf(d[4])!;
    out.dated.push({
      start: iso(year, m1, +d[1]),
      end: iso(m2 < m1 ? year + 1 : year, m2, +d[3]),
      raw,
      high: /high season/i.test(head[3] ?? ''),
    });
  }
  return out;
}

// --- price table (prices) -------------------------------------------------------------------------------------------
export interface KgPriceRow { code: string; season: string; months: number[]; nights: number | null; hours: number | null; prices: Array<{ key: string; unit: string; occupancy: number; amount: number }> }

/** Months a season cell covers: "Low (from September to June)" -> 9..12,1..6; "High (July and August)" -> 7, 8. */
export function seasonMonths(cell: string): number[] {
  const range = cell.match(/from\s+([A-Za-z]+)\s+to\s+([A-Za-z]+)/i);
  if (range && monthOf(range[1]) && monthOf(range[2])) {
    const out: number[] = [];
    for (let m = monthOf(range[1])!; ; m = (m % 12) + 1) { out.push(m); if (m === monthOf(range[2])) break; }
    return out;
  }
  return [...cell.matchAll(/[A-Za-z]+/g)].map(m => monthOf(m[0])).filter((m): m is number => m !== null);
}

const VARIANTS = [
  { key: 'private-single', unit: 'Private course, single room', occupancy: 1 },
  { key: 'private-double', unit: 'Private course, double room (2 people, different level)', occupancy: 2 },
  { key: 'semi-private-double', unit: 'Semi-private course, double room (2 people, similar level)', occupancy: 2 },
];

export function parseKgPrices(html: string): KgPriceRow[] {
  const root = parse(html);
  const table = root.querySelectorAll('table').find(t => /KITE CAMP/i.test(txt(t.querySelector('thead') ?? t)) && /KITE CAMP \d/i.test(txt(t)));
  if (!table) return [];
  const rows: KgPriceRow[] = [];
  for (const tr of table.querySelectorAll('tbody tr')) {
    const c = tr.querySelectorAll('td').map(td => txt(td));
    if (c.length < 8 || !/KITE CAMP/i.test(c[1])) continue;
    const prices = VARIANTS.map((v, i) => ({ ...v, amount: parseAmount(c[5 + i]) ?? 0 })).filter(p => p.amount > 0);
    rows.push({ code: c[0], season: c[2], months: seasonMonths(c[2]), nights: parseAmount(c[3]), hours: parseAmount(c[4]), prices });
  }
  return rows;
}

export function buildKgSlots(dates: KgDates, rows: KgPriceRow[], today: string): Slot[] {
  const slots: Slot[] = [];
  for (const d of dates.dated) {
    if (d.start < today) continue;
    const m = +d.start.slice(5, 7);
    const row = rows.find(r => r.months.includes(m)) ?? (d.high ? rows.find(r => /high/i.test(r.season)) : rows.find(r => /low/i.test(r.season)));
    const variants = row?.prices.length ? row.prices : [{ key: 'camp', unit: 'Kite camp', occupancy: null as unknown as number, amount: 0 }];
    for (const v of variants) {
      const priced = v.amount > 0;
      slots.push({
        key: `${row ? `${row.code.toLowerCase()}-` : ''}${v.key}|${d.start}`,
        startDate: d.start,
        endDate: d.end,
        unit: v.unit,
        price: priced ? v.amount : null,
        currency: priced ? 'EUR' : null,
        priceUnit: priced ? 'package' : null,
        priceBasis: priced ? 'person' : null,
        occupancy: v.occupancy ?? null,
        availability: 'on_request',
        availabilityText: `Request form; the camp runs from ${dates.minParticipants ?? 4} participants${row ? ` (${row.code}, ${row.season})` : ''}`,
        spotsLeft: null,
      });
    }
  }
  return slots;
}

export async function fetchKgSlots(ctx: FetchContext, today = todayIso()): Promise<Slot[]> {
  const dates = parseKgDates(await page(KG_FORM_URL));
  const rows = parseKgPrices(await page(KG_PRICES_URL));
  if (dates.dated.length === 0 && dates.undated.length === 0) throw new Error('kitegeneration: camp date list not found on /kiteform/ (layout changed?)');
  if (rows.length === 0) throw new Error('kitegeneration: KITE CAMP price table not found on /prices/ (layout changed?)');
  const slots = buildKgSlots(dates, rows, today);
  const past = dates.dated.filter(d => d.start < today);
  if (past.length) ctx.note(`${past.length} past camp date(s) dropped: ${past.map(d => d.start).join(', ')}`);
  if (slots.length === 0) ctx.note(`no future camp dates published (${dates.undated.join('; ')})`);
  return slots;
}

// --- content ----------------------------------------------------------------------------------------------------------
export interface KgPages { camp: string; prices: string; form: string }

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

export function parseKgContent(p: KgPages, today = todayIso()): OfferContent {
  const root = parse(p.camp);
  for (const el of root.querySelectorAll('script, style, noscript, template, header, footer, nav')) el.remove();
  const main = root.querySelector('main') ?? root.querySelector('article') ?? root;
  const text = txt(main);
  const dates = parseKgDates(p.form);
  const rows = parseKgPrices(p.prices);
  const nights = rows[0]?.nights ?? 5;
  const low = rows.find(r => /low/i.test(r.season));
  const high = rows.find(r => /high/i.test(r.season));
  const lo = (r?: KgPriceRow) => (r?.prices.length ? Math.min(...r.prices.map(x => x.amount)) : null);
  const hi = (r?: KgPriceRow) => (r?.prices.length ? Math.max(...r.prices.map(x => x.amount)) : null);
  const future = dates.dated.filter(d => d.start >= today);
  // past season as the form lists it: months marked "done" + the dated camps ("2026: May, June, July, 23 August - 28 August")
  const done = dates.undated.map(r => r.match(/^([A-Za-z]+)\s+(20\d{2})\b.*:\s*done\b/i)).filter((m): m is RegExpMatchArray => !!m);
  const pastYear = dates.dated[0]?.start.slice(0, 4) ?? done[0]?.[2];
  const pastList = [...done.filter(m => m[2] === pastYear).map(m => m[1]), ...dates.dated.filter(d => d.start < today).map(d => `${fmtDay(d.start)} - ${fmtDay(d.end)}`)];
  const datesLine = future.length
    ? `Camp dates: ${future.map(d => `${fmtDay(d.start)} - ${fmtDay(d.end)} ${d.end.slice(0, 4)}`).join(', ')}.`
    : `Runs every year on fixed dates; the next dates are not published yet${pastYear && pastList.length ? ` (${pastYear}: ${pastList.join(', ')})` : ''}.`;
  const summary = [
    `KiteGeneration runs fixed-date group kite camps in Punta Trettu, the shallow flat-water lagoon in south-west Sardinia.`,
    `A camp is ${nights} nights at Villa Punta Trettu directly on the spot (private en-suite rooms, pool, garden) with a ${rows[0]?.hours ?? 15}-hour course from first steps to independent riding and all gear, including a personal wetsuit, harness and helmet for the week.`,
    low || high
      ? `Per person: EUR ${lo(low)}-${hi(low)} in low season (September to June) and EUR ${lo(high)}-${hi(high)} in July and August, depending on private or semi-private course and single or double room. Camps run from ${dates.minParticipants ?? 4} participants; booking is by request.`
      : `Camps run from ${dates.minParticipants ?? 4} participants; booking is by request.`,
    datesLine,
  ].join(' ');

  // inclusion cards: <p>emoji</p><p>Title</p><p>Description</p> under "#1. Everything You Need"
  const included: string[] = [];
  const ps = main.querySelectorAll('p');
  for (let i = 0; i + 2 < ps.length; i++) {
    const icon = txt(ps[i]);
    if (!icon || icon.length > 4 || /[A-Za-z0-9]/.test(icon)) continue;
    const title = txt(ps[i + 1]);
    const desc = txt(ps[i + 2]);
    if (title && desc && title.length < 40 && !/community/i.test(title)) included.push(`${title}: ${desc.replace(/\s*[—–]\s*/g, ', ')}`);
    i += 2;
  }
  return {
    kind: 'camp',
    title: 'KiteGeneration Kite Camp EXperience, Punta Trettu',
    summary,
    continent: 'Europe',
    country: 'Italy',
    region: 'Punta Trettu, Sardinia',
    spot: 'Punta Trettu',
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: included.length ? included : [
      `${nights} nights at Villa Punta Trettu, private en-suite room`,
      `${rows[0]?.hours ?? 15}-hour kite course (beginner to first independent rides)`,
      'Kites, bars, boards; personal wetsuit, harness and helmet for the week',
    ],
    optionalServices: ['Sports club membership EUR 10 (12 months, includes third-party liability insurance), required for lessons'],
    accommodation: 'Villa Punta Trettu: private en-suite rooms with independent entrance, pool, garden, directly at the kite spot',
    mealPlan: null,
    languages: ['en', 'it'],
    rooms: [],
    imageUrls: imageCandidates(p.camp, KG_CAMP_URL, null, 30).filter(u => !/logo|icon|whatsapp|flag/i.test(u)),
    heroVideoUrl: null,
    sourceUrl: KG_CAMP_URL,
    bookingUrl: KG_FORM_URL,
    sourceText: [
      `camp page: ${text}`,
      `price rows: ${rows.map(r => `${r.code} ${r.season} ${r.nights}n ${r.hours}h ${r.prices.map(x => `${x.unit} EUR ${x.amount}`).join(', ')}`).join(' | ')}`,
      `dates: ${dates.dated.map(d => `${d.start}..${d.end}`).join(', ')}; undated: ${dates.undated.join('; ')}`,
    ].join('\n'),
  };
}

export const kitegenerationKiteCampPuntaTrettu: OfferAdapter = {
  key: 'kitegeneration-kite-camp-punta-trettu',
  name: 'KiteGeneration Kite Camp EXperience, Punta Trettu',
  kind: 'camp',
  operator: {
    name: 'KiteGeneration',
    websiteUrl: KG_SITE,
    rootDomain: 'kitegeneration.com',
    phone: '+393275376016',
  },
  url: KG_CAMP_URL,
  slotMethod: 'html_dates',
  fetchBudget: 4,
  async fetchContent() {
    return parseKgContent({ camp: await page(KG_CAMP_URL), prices: await page(KG_PRICES_URL), form: await page(KG_FORM_URL) });
  },
  fetchSlots: ctx => fetchKgSlots(ctx),
};
