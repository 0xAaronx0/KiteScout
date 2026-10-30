// ---------------------------------------------------------------------------
// Mogasurf "Kite camp à la villa", Sidi Kaouki near Essaouira (Morocco) - the school's all-inclusive kite week:
// 7 nights at Villa Sunset or Villa Zephyr (shared room, max 3 people; private room on request), full board,
// 12 hours of group kite lessons (max 4 per instructor), all gear, spot and airport transfers, a BBQ night, a
// medina evening and an argan cooperative visit. Arrivals on Saturdays.
//
// Data path (checked 2026-10-30): WordPress/Elementor, server-rendered; two pages.
//   slots    the EN packs page https://www.mogasurf.com/en/kitesurf-packages/ (dateModified 2026-10-29) carries the camp
//            booking widget as an inline script (the FR home page has the same widget with identical dates):
//            var DATA=[{"k":"2026-11","label":"November 2026","dates":[{"s":"2026-11-07","e":"2026-11-14","t":"Nov 7 → 14"},
//            ...,{"s":"2026-12-19",...,"off":1},...,{"s":"2027-03-20",...,"yoga":1},...]}] (JSON, ISO dates, Nov 2026 to
//            Jun 2027 on 2026-10-30); var SPECIAL={surf:550,kite:750}; var REF={surf:790,kite:890} (struck-through
//            price); var REG={surf:650,kite:890}; function rateFor(iso){return iso<'2027-02-01'?'lm':(iso<'2027-03-01'
//            ?'sp':'reg')} - the widget prices a week REG when rateFor(arrival) is 'reg', else SPECIAL ("Last-minute
//            rate" / "Special rate" instead of REF), EUR per person ("€750 × 1 person"). off:1 weeks render "Not
//            available". yoga:1 weeks are only listed for the "Kitesurf + Yoga" info request ("Price on request"), the
//            kite activity hides them, so they get no slot.
//            Until 2026-10-19 the home page had an older widget (var MONTHS with year-less weeks, var PRICE / FULL)
//            and the packs page showed EUR 820 / week; both are gone, that format is no longer read.
//   content  the EN packs page (camp description, "Rates based on shared room" list, the widget's kite inclusion
//            list) + photos from both pages.
//   booking  request form ("No payment required at this stage · We confirm availability together") -> on_request.
// robots.txt www.mogasurf.com (2026-10-19): "Allow: /", Crawl-delay 3 -> this adapter waits 3 s between its requests.
// Requests per run: slots 1 (EN packs page), content 2 (+ home), memoised between content and slots.
// Slots: one per future kite week, key = arrival date, EUR per person (package, 7 nights), off weeks 'closed'.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, type HTMLElement } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.mogasurf.com';
export const MOGA_HOME_URL = `${SITE}/`;
export const MOGA_PACKS_URL = `${SITE}/en/kitesurf-packages/`;
const CRAWL_DELAY_MS = 3_000; // robots.txt "Crawl-delay:3"
const NIGHTS = 7;

const memo = new Map<string, { at: number; p: Promise<string> }>();
let lastFetch = 0;
let queue: Promise<unknown> = Promise.resolve();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const run = async () => {
    if (!process.env.OFFERS_FIXTURE_DIR) {
      const wait = lastFetch + CRAWL_DELAY_MS - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    try { return await fetchText(url); } finally { lastFetch = Date.now(); }
  };
  const p = queue.catch(() => undefined).then(run);
  queue = p;
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
function visible(html: string): HTMLElement {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, template')) el.remove();
  return root;
}

// --- widget data ----------------------------------------------------------------------------------
export interface MogaWeek { start: string; end: string; label: string; off: boolean; yoga: boolean }
export interface MogaWidget {
  special: number | null; regular: number | null; ref: number | null;
  lastMinuteBefore: string | null; regularFrom: string | null;
  weeks: MogaWeek[]; includes: string[]; modified: string | null;
}

const num = (obj: string | undefined, key: string): number | null => {
  const m = obj?.match(new RegExp(`\\b${key}\\s*:\\s*(\\d+)`));
  return m ? Number(m[1]) : null;
};
// var DATA=[...]; / var T={...}; are one-line JSON literals
const jsonVar = (html: string, name: string): unknown => {
  const src = html.match(new RegExp(`var\\s+${name}\\s*=\\s*([\\[{].*[\\]}])\\s*;\\s*$`, 'm'))?.[1];
  if (!src) return null;
  try { return JSON.parse(src); } catch { return null; }
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The booking widget script (see header). */
export function parseMogaWidget(html: string): MogaWidget {
  const data = jsonVar(html, 'DATA');
  const weeks: MogaWeek[] = [];
  for (const m of Array.isArray(data) ? data : []) {
    for (const d of Array.isArray(m?.dates) ? m.dates : []) {
      if (!ISO.test(d?.s) || !ISO.test(d?.e)) continue;
      weeks.push({ start: d.s, end: d.e, label: String(d.t ?? ''), off: d.off === 1, yoga: d.yoga === 1 });
    }
  }
  const rate = html.match(/function\s+rateFor\s*\(\s*iso\s*\)\s*\{[^}]*\}/)?.[0] ?? '';
  const t = jsonVar(html, 'T') as { kite?: unknown } | null;
  return {
    special: num(html.match(/var\s+SPECIAL\s*=\s*\{([^}]*)\}/)?.[1], 'kite'),
    regular: num(html.match(/var\s+REG\s*=\s*\{([^}]*)\}/)?.[1], 'kite'),
    ref: num(html.match(/var\s+REF\s*=\s*\{([^}]*)\}/)?.[1], 'kite'),
    lastMinuteBefore: rate.match(/iso\s*<\s*'(\d{4}-\d{2}-\d{2})'\s*\?\s*'lm'/)?.[1] ?? null,
    regularFrom: rate.match(/iso\s*<\s*'(\d{4}-\d{2}-\d{2})'\s*\?\s*'sp'\s*:\s*'reg'/)?.[1] ?? null,
    weeks,
    includes: Array.isArray(t?.kite) ? t.kite.filter((x): x is string => typeof x === 'string') : [],
    modified: html.match(/"dateModified":"(\d{4}-\d{2}-\d{2})/)?.[1] ?? html.match(/article:modified_time" content="(\d{4}-\d{2}-\d{2})/)?.[1] ?? null,
  };
}

const nightsOf = (w: MogaWeek): number => Math.round((Date.parse(w.end) - Date.parse(w.start)) / 86400000);

/** Kite weeks (the widget hides yoga weeks for the kite activity). */
export const kiteWeeks = (w: MogaWidget): MogaWeek[] => w.weeks.filter(x => !x.yoga);

export function buildMogaSlots(w: MogaWidget, today: string): Slot[] {
  return kiteWeeks(w).filter(x => x.start >= today).map(x => {
    const regular = w.regularFrom !== null && x.start >= w.regularFrom;
    const price = regular ? w.regular : w.special;
    const rateLabel = regular ? 'Regular rate'
      : `${w.lastMinuteBefore && x.start < w.lastMinuteBefore ? 'Last-minute rate' : 'Special rate'}${w.ref ? ` (instead of EUR ${w.ref})` : ''}`;
    return {
      key: x.start,
      startDate: x.start,
      endDate: x.end,
      unit: 'Kite camp week, shared room (max 3 people), full board',
      price,
      currency: price !== null ? 'EUR' : null,
      priceUnit: price !== null ? 'package' as const : null,
      priceBasis: price !== null ? 'person' as const : null,
      occupancy: 1,
      availability: x.off ? 'closed' as const : 'on_request' as const,
      availabilityText: x.off ? 'Not available' : `${rateLabel}; booking request, availability confirmed before payment`,
      spotsLeft: null,
      packageNights: nightsOf(x),
    };
  });
}

// --- content ------------------------------------------------------------------------------------
export function parseMogaContent(home: string, packs: string, today: string): OfferContent {
  const w = parseMogaWidget(packs);
  const root = visible(packs);
  const packsText = collapse(root.structuredText);
  const stayList = root.querySelectorAll('li').map(li => collapse(li.text)).filter(t => /shared room|private room|full board|airport transfer|photo and video|towels/i.test(t) && t.length < 120);
  const weeks = kiteWeeks(w).filter(x => !x.off);
  const first = weeks.find(x => x.start >= today);
  const last = weeks[weeks.length - 1];
  const imgs: string[] = [];
  for (const u of [...imageCandidates(packs, MOGA_PACKS_URL, null, 30), ...imageCandidates(home, MOGA_HOME_URL, null, 30)]) {
    if (!/logo|cropped-|-\d+x\d+\.(?:jpe?g|png|webp)$/i.test(u) && !imgs.includes(u)) imgs.push(u);
  }

  const summary = [
    `Mogasurf's kite camp week in Sidi Kaouki near Essaouira, Morocco: 7 nights at Villa Sunset or Villa Zephyr (two adjoining villas with pools; shared rooms for up to 3, private room on request), full board with homemade meals, 12 hours of group kite lessons (max 4 per instructor) with all equipment, and transfers to the spots and Essaouira airport.`,
    `A BBQ night, an evening in the medina and a visit to a women's argan cooperative are included; arrivals are on Saturdays.`,
    w.special ? `Price per person EUR ${w.special}${w.regular && w.regularFrom ? ` (special rate for arrivals before ${w.regularFrom}, regular EUR ${w.regular})` : ''}${first && last ? `; weeks published from ${first.start} to ${last.start}` : ''}; booking by request.` : 'Booking by request.',
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Mogasurf Kite Camp at the Villa, Sidi Kaouki',
    summary,
    continent: 'Africa',
    country: 'Morocco',
    region: 'Marrakech-Safi',
    spot: 'Sidi Kaouki',
    itinerarySpots: [],
    durationDays: NIGHTS + 1,
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: w.includes.length ? w.includes : stayList,
    optionalServices: ['Private room (on request)', 'Private coaching with Ismail Adarzane', 'Shorter stays (on request)'],
    accommodation: 'two adjoining villas with pools (Villa Sunset, Villa Zephyr), shared rooms for up to 3',
    mealPlan: 'full_board',
    languages: ['fr', 'en'],
    rooms: [],
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: MOGA_PACKS_URL,
    bookingUrl: MOGA_HOME_URL,
    sourceText: [
      `packs page widget (dateModified ${w.modified}): kite EUR ${w.special} special (last-minute before ${w.lastMinuteBefore}, instead of EUR ${w.ref}) / EUR ${w.regular} regular from ${w.regularFrom}`,
      `weeks: ${w.weeks.map(x => `${x.start} - ${x.end}${x.off ? ' (not available)' : ''}${x.yoga ? ' (kitesurf + yoga week, price on request, not bookable as kite week)' : ''}`).join(', ')}`,
      `includes: ${w.includes.join('; ')}`,
      `packs page: ${packsText}`,
    ].join('\n'),
  };
}

export async function fetchMogaSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const w = parseMogaWidget(await page(MOGA_PACKS_URL));
  const weeks = kiteWeeks(w);
  if (weeks.length === 0 || w.special === null || w.regular === null || w.regularFrom === null) {
    throw new Error('mogasurf: packs-page booking widget (DATA / SPECIAL / REG / rateFor) not found (layout changed?)');
  }
  const slots = buildMogaSlots(w, today);
  if (slots.length === 0) ctx?.note(`all widget weeks are past (last ${weeks[weeks.length - 1].start}); no new weeks published yet`);
  return slots;
}

export const mogasurfKiteCampVillaSidiKaouki: OfferAdapter = {
  key: 'mogasurf-kite-camp-villa-sidi-kaouki',
  name: 'Mogasurf Kite Camp at the Villa, Sidi Kaouki',
  kind: 'camp',
  operator: {
    name: 'Mogasurf',
    websiteUrl: MOGA_HOME_URL,
    rootDomain: 'mogasurf.com',
    contactEmail: 'info@mogasurf.com',
    whatsapp: '+212618910431',
    phone: '+212618910431',
  },
  url: MOGA_PACKS_URL,
  slotMethod: 'html_dates',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 3,
  async fetchContent() {
    const home = await page(MOGA_HOME_URL);
    const packs = await page(MOGA_PACKS_URL);
    return parseMogaContent(home, packs, new Date().toISOString().slice(0, 10));
  },
  fetchSlots: ctx => fetchMogaSlots(new Date().toISOString().slice(0, 10), ctx),
};
