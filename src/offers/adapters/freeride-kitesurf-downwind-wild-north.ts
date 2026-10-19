// ---------------------------------------------------------------------------
// Freeride Kitesurf - Downwind "Wild North" (Brazil): 13-day guided kite safari from Cumbuco / Tatajuba (Ceará) through
// Piauí and the Parnaíba delta to Atins and the Lençóis Maranhenses lagoons (Maranhão), 4x4 support, pousadas.
// Freeride Kitesurf (freeridekitesurf.com, Spanish phone +34) is the operator; it is NOT Freeride Tarifa
// (freeridetarifa.com, already in the catalog with two Tarifa stays).
//
// Data path (checked 2026-10-19). The shared Freeride helpers live in this file; the Rio Grande do Norte adapter imports them.
//   content  English route page /en/kite-safari/downwind-brazil/wild-north/ (dateModified 2025-05-06): 13-day program,
//            "12 NIGHTS / 13 DAYS 2.295€ *ESTIMATED PRICE P.P." (group of 4 in double rooms; single room +20%),
//            included / not included lists, gallery. The Spanish page (/kite-safari/downwind-brasil/norte-salvaje/,
//            dateModified 2024-02-02) still prints 2.195€; the newer English page is used.
//   slots    /en/kite-safari/downwind-brazil/ (dateModified 2026-02-01) "DOWNWIND DATES BRAZIL 2026": a month-by-month list
//            (mobile layout) of every route's departures ("WILD NORTH DOWNWIND / Tatajuba to Atins - 310km / 5th to 17th"
//            under NOVEMBER). The same page also prints a desktop grid whose month columns are flattened in the text,
//            so only the list layout is read (a block where two month names follow each other is the grid).
//            One slot per future departure; price = the route page's estimated EUR price per person (package);
//            availability 'on_request' ("BOOK NOW" links to the contact form, no inventory, no status words).
//            2026 departures: 1-13 Aug, 2-14 Sep, 1-13 Oct (past on 2026-10-19), 5-17 Nov -> 1 slot.
//            New years appear as a further "DOWNWIND DATES BRAZIL <year>" block; past dates are dropped.
// robots.txt (2026-10-19): "User-agent: * / Crawl-delay: 30", nothing disallowed -> this module serialises its own
//   freeridekitesurf.com requests 30 s apart (skipped on fixture replay; http.ts has no crawl-delay support).
// Requests per run: content 2 (route page + dates page), slots 2 (memoised for 10 min, shared with the RGN adapter).
// Currency: "€" on the page and "the Real (R$) against the Euro (€)" -> EUR, stated by the site.
// Flags: liveAvailability no (page text), instantBooking no (contact form).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, monthOf, parse, parseAmount, todayIso } from '../parse.js';
import type { FetchContext, ItinerarySpot, OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';

export const FREERIDE_SITE = 'https://www.freeridekitesurf.com';
export const FREERIDE_DATES_URL = `${FREERIDE_SITE}/en/kite-safari/downwind-brazil/`;
export const FREERIDE_CONTACT_URL = `${FREERIDE_SITE}/en/contact/`;
export const FREERIDE_WILD_NORTH_URL = `${FREERIDE_SITE}/en/kite-safari/downwind-brazil/wild-north/`;
const CRAWL_DELAY_MS = 30_000; // freeridekitesurf.com robots.txt "Crawl-delay: 30"

export const FREERIDE_OPERATOR: OperatorRef = {
  name: 'Freeride Kitesurf',
  websiteUrl: `${FREERIDE_SITE}/en/`,
  rootDomain: 'freeridekitesurf.com',
  contactEmail: 'contact@freeridekitesurf.com',
  phone: '+34 660 484 782',
};

// --- polite memoised fetch (crawl delay) -------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
let lastSiteFetch = 0;
let siteQueue: Promise<unknown> = Promise.resolve();
/** Memoised fetch; freeridekitesurf.com requests are serialised with the robots.txt crawl delay (skipped on fixture replay). */
export function freeridePage(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const run = async () => {
    if (!process.env.OFFERS_FIXTURE_DIR) {
      const wait = lastSiteFetch + CRAWL_DELAY_MS - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    try { return await fetchText(url, { accept: 'text/html' }); } finally { lastSiteFetch = Date.now(); }
  };
  const p = siteQueue.catch(() => undefined).then(run);
  siteQueue = p;
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text as trimmed lines, duplicates of the responsive copies removed (first occurrence kept). */
export function freerideLines(html: string): string[] {
  const seen = new Set<string>();
  return freerideLinesAll(html).filter(l => (seen.has(l) ? false : (seen.add(l), true)));
}

// --- dates page ------------------------------------------------------------------------------
export interface FreerideDeparture { route: string; stretch: string | null; start: string; end: string; label: string }

const MONTH_LINE = /^(january|february|march|april|may|june|july|august|september|october|november|december)$/i;
const DAY_RANGE = /^(\d{1,2})(?:st|nd|rd|th)?\s*(?:to|-)\s*(\d{1,2})(?:st|nd|rd|th)?$/i;

/**
 * Every departure of the "DOWNWIND DATES BRAZIL <year>" list blocks: month line, route name, stretch ("Tatajuba to Atins
 * - 310km"), day range ("5th to 17th"). Grid blocks (month names directly after each other) are skipped.
 */
export function parseFreerideDates(html: string): FreerideDeparture[] {
  const lines = freerideLinesAll(html);
  const heads: Array<{ i: number; year: number }> = [];
  lines.forEach((l, i) => { const m = l.match(/^downwind dates brazil (20\d{2})$/i); if (m) heads.push({ i, year: Number(m[1]) }); });
  const out: FreerideDeparture[] = [];
  for (let h = 0; h < heads.length; h++) {
    const from = heads[h].i + 1;
    let to = h + 1 < heads.length ? heads[h + 1].i : lines.length;
    const stop = lines.slice(from, to).findIndex(l => /^learn more about our/i.test(l));
    if (stop >= 0) to = from + stop;
    const block = lines.slice(from, to);
    const grid = block.some((l, i) => i > 0 && MONTH_LINE.test(l) && MONTH_LINE.test(block[i - 1]));
    if (grid) continue;
    const year = heads[h].year;
    let month: number | null = null;
    let route: string | null = null;
    let stretch: string | null = null;
    for (const l of block) {
      if (MONTH_LINE.test(l)) { month = monthOf(l); route = null; stretch = null; continue; }
      const d = l.match(DAY_RANGE);
      if (d && month && route) {
        const sd = Number(d[1]);
        const ed = Number(d[2]);
        const endMonth = ed < sd ? (month === 12 ? 1 : month + 1) : month;
        const endYear = ed < sd && month === 12 ? year + 1 : year;
        out.push({ route, stretch, start: iso(year, month, sd), end: iso(endYear, endMonth, ed), label: `${route}: ${l}` });
        route = null; stretch = null;
        continue;
      }
      if (/(downwind|coaching)/i.test(l) && l === l.toUpperCase()) { route = l; stretch = null; continue; }
      if (route && /\d\s*km\b/i.test(l)) stretch = l;
    }
  }
  const seen = new Set<string>();
  return out.filter(d => { const k = `${d.route}|${d.start}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
/** All lines (no de-duplication: the date blocks repeat route names on purpose). */
export function freerideLinesAll(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script,style,noscript,svg')) el.remove();
  return (root.querySelector('body') ?? root).structuredText
    .split('\n').map(s => collapse(s.replace(/[​ ]/g, ' ')).replace(/[–—]/g, '-')).filter(Boolean);
}

// --- route page ----------------------------------------------------------------------------------
export interface FreerideRoute {
  title: string | null;
  tagline: string | null;
  intro: string | null;
  nights: number | null;
  days: number | null;
  price: number | null;
  singleSurchargePct: number | null;
  program: string[];
  included: string[];
  excluded: string[];
  maxPeople: number | null;
  minPeople: number | null;
  images: string[];
}

export function parseFreerideRoute(html: string, baseUrl: string): FreerideRoute {
  const lines = freerideLines(html);
  const start = Math.max(0, lines.findIndex(l => /^select page$/i.test(l)) + 1);
  const end = (() => { const i = lines.findIndex((l, j) => j > start && /^you choose the spot/i.test(l)); return i < 0 ? lines.length : i; })();
  const body = lines.slice(start, end);
  const priceAt = body.findIndex(l => /^(\d+)\s+nights\s*\/\s*(\d+)\s+days$/i.test(l));
  const nd = priceAt >= 0 ? body[priceAt].match(/^(\d+)\s+nights\s*\/\s*(\d+)\s+days$/i) : null;
  const priceLine = priceAt >= 0 ? body.slice(priceAt + 1, priceAt + 3).find(l => /^[\d.,]+\s*€$|^€\s*[\d.,]+$/.test(l)) : undefined;
  const program = body.filter(l => /^day\s+\d+\s*:/i.test(l)).map(l => l.replace(/^day\s+(\d+)\s*:\s*/i, 'Day $1: '));
  const listAfter = (head: RegExp): string[] => {
    const i = body.findIndex(l => head.test(l));
    if (i < 0) return [];
    const out: string[] = [];
    for (let j = i + 1; j < body.length && /^\*/.test(body[j]); j++) out.push(body[j].replace(/^\*\s*/, '').replace(/\.$/, ''));
    return out;
  };
  const group = body.join(' ').match(/maximum of (\d+) people and a minimum of (\d+)/i);
  const single = body.join(' ').match(/single room[^.]*?increases (?:a |by )?(\d+)\s*%/i);

  // page photos via imageCandidates (WordPress originals); the og:image is a 150x150 thumbnail of a gallery photo,
  // and the weather icons, the logo and the sponsor wordmark are dropped
  const images: string[] = [];
  for (const raw of imageCandidates(html, baseUrl)) {
    const u = raw.replace(/-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp))$/i, '$1');
    if (/logo|wordmark|palmera|kitesize|temperature|icon/i.test(u)) continue;
    if (!images.includes(u)) images.push(u);
  }

  return {
    title: body[0] ?? null,
    tagline: body[1] ?? null,
    intro: body.find(l => l.length > 200) ?? null,
    nights: nd ? Number(nd[1]) : null,
    days: nd ? Number(nd[2]) : null,
    price: priceLine ? parseAmount(priceLine) : null,
    singleSurchargePct: single ? Number(single[1]) : null,
    program,
    included: listAfter(/^what.s included/i),
    excluded: listAfter(/^what is not included/i),
    maxPeople: group ? Number(group[1]) : null,
    minPeople: group ? Number(group[2]) : null,
    images,
  };
}

// --- slots + summary helpers ------------------------------------------------------------------------
export function buildFreerideSlots(deps: FreerideDeparture[], r: FreerideRoute, today: string): Slot[] {
  return deps.filter(d => d.start >= today).map(d => ({
    key: d.start,
    startDate: d.start,
    endDate: d.end,
    unit: 'Double room (shared)',
    price: r.price,
    currency: r.price !== null ? 'EUR' : null,
    priceUnit: r.price !== null ? 'package' : null,
    priceBasis: r.price !== null ? 'person' : null,
    occupancy: 2,
    availability: 'on_request',
    availabilityText: r.price !== null
      ? `Estimated price per person, EUR ${r.price} (group of 4, double rooms${r.singleSurchargePct ? `; single room +${r.singleSurchargePct}%` : ''}); booking request via the contact form`
      : 'Booking request via the contact form',
    spotsLeft: null,
  }));
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fmtDay(isoDate: string): string { return `${Number(isoDate.slice(8, 10))} ${MONTH_NAMES[Number(isoDate.slice(5, 7)) - 1]}`; }

/** "Departures: 5-17 November 2026." or, when all printed dates are past, "Runs every year; 2027 dates not yet published (2026: ...)". */
export function freerideDatesSentence(deps: FreerideDeparture[], today: string): string {
  const future = deps.filter(d => d.start >= today);
  if (future.length) {
    return `Next departure${future.length > 1 ? 's' : ''}: ${future.map(d => `${fmtDay(d.start)} - ${fmtDay(d.end)} ${d.end.slice(0, 4)}`).join(', ')}.`;
  }
  if (!deps.length) return 'Departure dates are published on the operator\'s downwind dates page.';
  const last = Math.max(...deps.map(d => Number(d.start.slice(0, 4))));
  const months = [...new Set(deps.filter(d => d.start.startsWith(String(last))).map(d => MONTH_NAMES[Number(d.start.slice(5, 7)) - 1]))];
  return `Runs every year; ${last + 1} dates not yet published (${last}: ${months.join(', ')}).`;
}

export async function fetchFreerideSlots(routeUrl: string, match: RegExp, today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const deps = parseFreerideDates(await freeridePage(FREERIDE_DATES_URL));
  if (deps.length === 0) throw new Error('freeride: no "DOWNWIND DATES BRAZIL <year>" list found (layout changed?)');
  const mine = deps.filter(d => match.test(d.route));
  const route = parseFreerideRoute(await freeridePage(routeUrl), routeUrl);
  if (route.price === null) ctx?.note('freeride: "<n> NIGHTS / <n> DAYS <price>€" not found on the route page; slots without price');
  const slots = buildFreerideSlots(mine, route, today);
  const past = mine.length - slots.length;
  if (past > 0) ctx?.note(`${past} past departure(s) dropped (${mine.filter(d => d.start < today).map(d => d.start).join(', ')})`);
  if (slots.length === 0) ctx?.note('no future departure printed yet');
  return slots;
}

// --- Wild North -------------------------------------------------------------------------------------
export const WILD_NORTH_MATCH = /wild north/i;

/** Route stops of the 13-day program in order (Pontal is left out: the name alone geocodes 600 km inland). */
export const WILD_NORTH_STOPS: ItinerarySpot[] = [
  { name: 'Cumbuco', country: 'Brazil', region: 'Ceará', order: 1 },
  { name: 'Tatajuba', country: 'Brazil', region: 'Ceará', order: 2 },
  { name: 'Praia de Maceió', country: 'Brazil', region: 'Ceará', order: 3 },
  { name: 'Barra Grande', country: 'Brazil', region: 'Piauí', order: 4 },
  { name: 'Macapá', country: 'Brazil', region: 'Piauí', order: 5 },
  { name: 'Pedra do Sal', country: 'Brazil', region: 'Piauí', order: 6 },
  { name: 'Ilha do Caju', country: 'Brazil', region: 'Maranhão', order: 7 },
  { name: 'Arpoador', country: 'Brazil', region: 'Maranhão', order: 8 },
  { name: 'Atins', country: 'Brazil', region: 'Maranhão', order: 9 },
  { name: 'Canto do Atins', country: 'Brazil', region: 'Maranhão', order: 10 },
];

export function parseWildNorthContent(routeHtml: string, datesHtml: string, today: string): OfferContent {
  const r = parseFreerideRoute(routeHtml, FREERIDE_WILD_NORTH_URL);
  const deps = parseFreerideDates(datesHtml).filter(d => WILD_NORTH_MATCH.test(d.route));
  const days = r.days ?? 13;
  const summary = [
    `Freeride Kitesurf's Wild North kite safari is a ${days}-day guided downwind trip along the north coast of Brazil: from Cumbuco by 4x4 to Tatajuba, then downwinds of 20 to 65 km via Barra Grande and Macapá (Piauí), across the Parnaíba delta and Ilha do Caju to Arpoador and Atins, finishing with sessions in the Lençóis Maranhenses lagoons.`,
    `It is for high-intermediate and advanced riders only, because 4x4s cannot follow along the Piauí coast; groups of ${r.minPeople ?? 3} to ${r.maxPeople ?? 12} riders with 1 or 2 guides in the water, pousadas with breakfast, boat and quad support for the delta crossing.`,
    `${r.price ? `Estimated price EUR ${r.price.toLocaleString('en-US')} per person (${r.nights ?? days - 1} nights, group of 4 in double rooms${r.singleSurchargePct ? `, single room +${r.singleSurchargePct}%` : ''}). ` : ''}${freerideDatesSentence(deps, today)}`,
  ].join(' ');
  return {
    kind: 'tour',
    title: 'Freeride Kitesurf Wild North Downwind Kite Safari',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Ceará',
    spot: 'Cumbuco',
    itinerarySpots: WILD_NORTH_STOPS,
    durationDays: days,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: false,
    equipmentRental: null,
    beginnerFriendly: false,
    includedServices: r.included,
    optionalServices: r.singleSurchargePct ? [`Single room (+${r.singleSurchargePct}% on the trip price)`] : [],
    accommodation: 'Medium-high level pousadas along the route, double rooms',
    mealPlan: 'breakfast',
    languages: ['en', 'es'],
    rooms: [],
    imageUrls: r.images.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: FREERIDE_WILD_NORTH_URL,
    bookingUrl: FREERIDE_CONTACT_URL,
    sourceText: [
      `route: ${r.title} | ${r.tagline}`,
      r.intro ?? '',
      ...r.program,
      `price: ${r.nights} nights / ${r.days} days, EUR ${r.price} estimated p.p.; single +${r.singleSurchargePct}%; group ${r.minPeople}-${r.maxPeople}`,
      `included: ${r.included.join('; ')}`,
      `not included: ${r.excluded.join('; ')}`,
      `dates: ${deps.map(d => `${d.start}..${d.end}`).join(', ')}`,
    ].join('\n'),
  };
}

export const freerideKitesurfDownwindWildNorth: OfferAdapter = {
  key: 'freeride-kitesurf-downwind-wild-north',
  name: 'Freeride Kitesurf Downwind Wild North (Tatajuba - Atins)',
  kind: 'tour',
  operator: FREERIDE_OPERATOR,
  url: FREERIDE_WILD_NORTH_URL,
  slotMethod: 'html_dates',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 3,
  async fetchContent() {
    const route = await freeridePage(FREERIDE_WILD_NORTH_URL);
    const dates = await freeridePage(FREERIDE_DATES_URL);
    return parseWildNorthContent(route, dates, todayIso());
  },
  fetchSlots: ctx => fetchFreerideSlots(FREERIDE_WILD_NORTH_URL, WILD_NORTH_MATCH, todayIso(), ctx),
};
