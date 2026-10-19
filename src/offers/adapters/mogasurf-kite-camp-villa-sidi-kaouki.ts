// ---------------------------------------------------------------------------
// Mogasurf "Kite camp à la villa", Sidi Kaouki near Essaouira (Morocco) - the school's all-inclusive kite week:
// 7 nights at Villa Sunset or Villa Zephyr (shared room, max 3 people; private room on request), full board,
// 12 hours of group kite lessons (max 4 per instructor), all gear, spot and airport transfers, a BBQ night, a
// medina evening and an argan cooperative visit. Arrivals on Saturdays.
//
// Data path (checked 2026-10-19): WordPress, server-rendered; two pages.
//   slots    the home page https://www.mogasurf.com/ (dateModified 2026-10-16) carries the camp booking widget as an
//            inline script: var MONTHS={nov:{name:'Nov',dates:[{t:'7 → 14'},...]},dec:{...,{t:'19 → 26',off:1}},
//            ...,mar:{name:'Mar',full:1,dates:[...]}}; var PRICE={surf:550,kite:750}; var FULL={surf:790,kite:890};
//            the widget's price() is FULL when the month has full:1, else PRICE ("Special rate valid for stays until
//            the end of February 2027. Regular rate from March."), EUR per person ("€750 × 1 person"). off:1 weeks
//            render "Not available". The weeks carry no year: the first month gets the year that puts it on or
//            after the page's dateModified month, a month number lower than the previous one rolls the year, and
//            the result must fall on Saturdays (the page: "Arrivals on Saturdays"), else the year is moved by one.
//            Month buttons on 2026-10-19: Nov, Dec, Jan (+ "Choose my own dates"); Feb and Mar weeks are in the
//            script data and bookable through own dates, so they are kept.
//            The older packs pages (/packs-kitesurf-essaouira-maroc/ FR and /en/kitesurf-packages/ EN, both
//            dateModified 2026-10-07) still show a different widget (EUR 820 / week, Oct-Apr weeks); the newer
//            home page wins (noted in sourceText).
//   content  the EN packs page (camp description, "Rates based on shared room" list, photos) + the home widget's
//            kite inclusion list.
//   booking  request form ("No payment required at this stage · We confirm availability together") -> on_request.
// robots.txt www.mogasurf.com (2026-10-19): "Allow: /", Crawl-delay 3 -> this adapter waits 3 s between its requests.
// Requests per run: 2 (home + EN packs page), memoised between content and slots.
// Slots: one per future week, key = arrival date, EUR per person (package, 7 nights), off weeks 'closed'.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, monthOf, parse, type HTMLElement } from '../parse.js';
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
export interface MogaWeekRaw { month: string; label: string; off: boolean; full: boolean }
export interface MogaWidget { price: number | null; full: number | null; promoEnd: string | null; weeks: MogaWeekRaw[]; buttons: string[]; note: string | null; modified: string | null; includes: string[] }

const num = (obj: string | undefined, key: string): number | null => {
  const m = obj?.match(new RegExp(`\\b${key}\\s*:\\s*(\\d+)`));
  return m ? Number(m[1]) : null;
};

/** The home page's booking widget script (see header). */
export function parseMogaWidget(html: string): MogaWidget {
  const priceObj = html.match(/var\s+PRICE\s*=\s*\{([^}]*)\}/)?.[1];
  const fullObj = html.match(/var\s+FULL\s*=\s*\{([^}]*)\}/)?.[1];
  const monthsSrc = html.match(/var\s+MONTHS\s*=\s*\{([\s\S]*?)\};/)?.[1] ?? '';
  const weeks: MogaWeekRaw[] = [];
  // nov:{name:'Nov',dates:[{t:'7 → 14'},{t:'28 → Dec 5'}]}, mar:{name:'Mar',full:1,dates:[...]}
  for (const m of monthsSrc.matchAll(/(\w+)\s*:\s*\{\s*name\s*:\s*'([^']+)'\s*,([^\[]*?)dates\s*:\s*\[([\s\S]*?)\]\s*\}/g)) {
    const full = /full\s*:\s*1/.test(m[3]);
    for (const d of m[4].matchAll(/\{\s*t\s*:\s*'([^']+)'([^}]*)\}/g)) {
      weeks.push({ month: m[2], label: d[1], off: /off\s*:\s*1/.test(d[2]), full });
    }
  }
  const buttons = [...html.matchAll(/bkMonth\('(\w+)'/g)].map(m => m[1]).filter(k => k !== 'custom');
  const actKite = html.match(/kite\s*:\s*\{\s*badge\s*:\s*"[^"]*"\s*,\s*items\s*:\s*\[([^\]]*)\]/)?.[1] ?? '';
  return {
    price: num(priceObj, 'kite'),
    full: num(fullObj, 'kite'),
    promoEnd: html.match(/PROMO_END\s*=\s*'(\d{4}-\d{2}-\d{2})'/)?.[1] ?? null,
    weeks,
    buttons: [...new Set(buttons)],
    note: collapse(visible(html).querySelectorAll('div').map(d => d.text).find(t => /Special rate valid/i.test(t) && t.length < 300) ?? '') || null,
    modified: html.match(/"dateModified":"(\d{4}-\d{2}-\d{2})/)?.[1] ?? html.match(/article:modified_time" content="(\d{4}-\d{2}-\d{2})/)?.[1] ?? null,
    includes: [...actKite.matchAll(/"([^"]+)"/g)].map(m => m[1]),
  };
}

export interface MogaWeek { start: string; end: string; label: string; off: boolean; full: boolean }

const addDays = (d: string, n: number): string => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const isSaturday = (d: string): boolean => new Date(`${d}T12:00:00Z`).getUTCDay() === 6;

/** Dates for the widget's year-less weeks ("7 → 14", "28 → Dec 5"); see the header for the year rule. */
export function datedMogaWeeks(w: MogaWidget, today: string): MogaWeek[] {
  const anchor = w.modified ?? today;
  const build = (firstYear: number): MogaWeek[] => {
    let year = firstYear;
    let prevMonth = 0;
    const out: MogaWeek[] = [];
    for (const raw of w.weeks) {
      const mo = monthOf(raw.month);
      const d = raw.label.match(/^(\d{1,2})\s*→/);
      if (!mo || !d) continue;
      if (prevMonth && mo < prevMonth) year++;
      prevMonth = mo;
      const start = iso(year, mo, Number(d[1]));
      out.push({ start, end: addDays(start, NIGHTS), label: `${raw.month} ${raw.label.replace(/\s*→\s*/, ' - ')}`, off: raw.off, full: raw.full });
    }
    return out;
  };
  const firstMonth = monthOf(w.weeks[0]?.month ?? '') ?? 1;
  const ay = Number(anchor.slice(0, 4));
  const am = Number(anchor.slice(5, 7));
  const guess = firstMonth >= am - 1 ? ay : ay + 1;
  const sat = (ws: MogaWeek[]) => ws.length > 0 && ws.filter(x => isSaturday(x.start)).length >= ws.length * 0.8;
  for (const y of [guess, guess + 1, guess - 1]) {
    const ws = build(y);
    if (sat(ws)) return ws;
  }
  return [];
}

export function buildMogaSlots(w: MogaWidget, today: string): Slot[] {
  return datedMogaWeeks(w, today).filter(x => x.start >= today).map(x => {
    const price = x.full ? w.full : w.price;
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
      availabilityText: x.off ? 'Not available'
        : `${x.full ? 'Regular rate' : `Special rate${w.full ? ` (instead of EUR ${w.full})` : ''}`}; booking request, availability confirmed before payment`,
      spotsLeft: null,
      packageNights: NIGHTS,
    };
  });
}

// --- content ------------------------------------------------------------------------------------
export function parseMogaContent(home: string, packs: string, today: string): OfferContent {
  const w = parseMogaWidget(home);
  const root = visible(packs);
  const packsText = collapse(root.structuredText);
  const stayList = root.querySelectorAll('li').map(li => collapse(li.text)).filter(t => /shared room|private room|full board|airport transfer|photo and video|towels/i.test(t) && t.length < 120);
  const weeks = datedMogaWeeks(w, today).filter(x => !x.off);
  const first = weeks.find(x => x.start >= today);
  const last = weeks[weeks.length - 1];
  const imgs: string[] = [];
  for (const u of [...imageCandidates(packs, MOGA_PACKS_URL, null, 30), ...imageCandidates(home, MOGA_HOME_URL, null, 30)]) {
    if (!/logo|cropped-|-\d+x\d+\.(?:jpe?g|png|webp)$/i.test(u) && !imgs.includes(u)) imgs.push(u);
  }

  const summary = [
    `Mogasurf's kite camp week in Sidi Kaouki near Essaouira, Morocco: 7 nights at Villa Sunset or Villa Zephyr (two adjoining villas with pools; shared rooms for up to 3, private room on request), full board with homemade meals, 12 hours of group kite lessons (max 4 per instructor) with all equipment, and transfers to the spots and Essaouira airport.`,
    `A BBQ night, an evening in the medina and a visit to a women's argan cooperative are included; arrivals are on Saturdays.`,
    w.price ? `Price per person EUR ${w.price}${w.full ? ` (special rate for stays until the end of February${w.promoEnd ? ` ${Number(w.promoEnd.slice(0, 4))}` : ''}, regular EUR ${w.full})` : ''}${first && last ? `; weeks published from ${first.start} to ${last.start}` : ''}; booking by request.` : 'Booking by request.',
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
      `home widget (dateModified ${w.modified}): kite EUR ${w.price} special / EUR ${w.full} regular, promo end ${w.promoEnd}; ${w.note ?? ''}`,
      `weeks: ${w.weeks.map(x => `${x.month} ${x.label}${x.off ? ' (not available)' : ''}${x.full ? ' (regular)' : ''}`).join(', ')}; month buttons: ${w.buttons.join(', ')}`,
      `includes: ${w.includes.join('; ')}`,
      `packs page: ${packsText}`,
    ].join('\n'),
  };
}

export async function fetchMogaSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const w = parseMogaWidget(await page(MOGA_HOME_URL));
  if (w.weeks.length === 0 || w.price === null) throw new Error('mogasurf: home-page booking widget (MONTHS / PRICE) not found (layout changed?)');
  const dated = datedMogaWeeks(w, today);
  if (dated.length === 0) throw new Error('mogasurf: widget weeks do not fall on Saturdays in any candidate year (data changed?)');
  const slots = buildMogaSlots(w, today);
  if (slots.length === 0) ctx?.note(`all widget weeks are past (last ${dated[dated.length - 1].start}); no new weeks published yet`);
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
