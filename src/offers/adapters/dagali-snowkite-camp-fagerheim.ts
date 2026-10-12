// ---------------------------------------------------------------------------
// Fagerheim Snowkite Camp, Hardangervidda (Norway) - a 7-night SNOWKITE camp (kiting on snow, not water)
// sold by Dagali Fjellpark (FULL ON AS, Dagali near Geilo) and run with the Upwind snowkite school
// (Jan Simek's team). The camp sits at the Fagerheim base on the Hardangervidda plateau (10 minutes by car
// from Haugastøl station), not at the Dagali Fjellpark site itself.
//
// Data path (checked 2026-10-12): WordPress + Elementor, server-rendered:
//   content  /en/snowkite-camp-fagerheim/ (season line, the four price cards, apartments, full board,
//            services, photo carousel), /en/snowkiting-for-beginners/ (weekly capacity, teaching language),
//            /en/prices-dagali-fjellpark/ (snowkite lesson prices outside the camp).
//   slots    the camp page: season line "Hardangervidda, Norway, 7.2. – 25.4.2026" + the cards
//            "Beginners 10.900 NOK", "Kitesurfers 4.900 NOK", "Snowkiters 3.900 NOK" and
//            "Accommodation, Full Board & Services 13.930 NOK" under "= Accommodation with full board +
//            Snowkiting Course of your choice".
// Booking: every "Book" button is mailto:snowkiting@dagalifjellpark.no (no engine) -> availability 'on_request'.
// Liveness (2026-10-12): site dateModified 2026-09-10 (home), 2026-10-07 (/en/snowkiting-norway/),
//   2026-04-22 (prices page); the camp page itself 2025-09-08. Aaron 2026-10-12: include it ("mit aufnehmen").
// robots.txt (2026-10-12): only /wp-admin/ disallowed (admin-ajax allowed).
// Requests per run: content 3, slots 1 (memoised: 0 extra when content ran in the same process).
// Parsed: one season band per camp variant (2026-02-07..2026-04-25, datePrecision 'season'; weeks run
//   Saturday to Saturday inside it), NOK per person for 7 nights (priceUnit 'package', packageNights 7).
//   Course variants = stay + course price (the page's own "Accommodation + Course of your choice" sum).
// Known limits:
//   - The only season on the page is 2026 and it is over; 2027 dates are not published yet, so the
//     offer shows "price on request" until the operator updates the season line (the slots then roll
//     forward on their own: keys carry the season year).
//   - "per person" is not printed next to the prices; inferred from the shared-apartment setup.
//   - The map embed is a place search ("q=Fagerheim"), no coordinates -> no spotCoords.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, parseAmount, parseRange, type HTMLElement } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://dagalifjellpark.no';
export const DAG_CAMP_URL = `${SITE}/en/snowkite-camp-fagerheim/`;
export const DAG_BEGINNERS_URL = `${SITE}/en/snowkiting-for-beginners/`;
export const DAG_PRICES_URL = `${SITE}/en/prices-dagali-fjellpark/`;
const CAMP_NIGHTS = 7;

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share it */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
/** the page body without menus, header, footer, scripts and forms */
function contentRoot(html: string): HTMLElement {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, form, [data-elementor-type="header"], [data-elementor-type="footer"]')) el.remove();
  return root.querySelector('[data-elementor-type="wp-page"]') ?? root.querySelector('main') ?? root.querySelector('body') ?? root;
}
const NOK_RE = /^([\d.\s]+)\s*NOK$/i;

// --- pure parsers -----------------------------------------------------------------------------
export interface DagCard { label: string; amount: number; features: string[] }

/** The camp's price cards: an h2 label, its bullet list, then an h2 "10.900 NOK". */
export function parseDagCards(html: string): DagCard[] {
  const root = contentRoot(html);
  const out: DagCard[] = [];
  let label: string | null = null;
  let features: string[] = [];
  for (const el of root.querySelectorAll('h2, ul')) {
    if (el.tagName === 'UL') { if (label) features.push(...el.querySelectorAll('li').map(li => txt(li)).filter(Boolean)); continue; }
    const t = txt(el);
    const m = t.match(NOK_RE);
    if (m && label) {
      const amount = parseAmount(m[1]);
      if (amount) out.push({ label, amount, features });
      label = null; features = [];
    } else if (!m) { label = t; features = []; }
  }
  return out;
}

/** "Hardangervidda, Norway, 7.2. – 25.4.2026" -> the season band. */
export function parseDagSeason(html: string): { start: string; end: string; raw: string } | null {
  const root = contentRoot(html);
  for (const el of root.querySelectorAll('p, h3, h4')) {
    const t = txt(el);
    if (!/\d{1,2}\.\d{1,2}\.\s*[–—-]\s*\d{1,2}\.\d{1,2}\.\d{4}/.test(t)) continue;
    const r = parseRange(t);
    if (r) return { ...r, raw: t };
  }
  return null;
}

/** "Equipment available for rent 4.000 NOK" (Kitesurfers / Snowkiters cards). */
export function dagRentalPrice(cards: DagCard[]): number | null {
  for (const c of cards) for (const f of c.features) {
    const m = f.match(/equipment[^0-9]*rent[^0-9]*([\d.]+)\s*NOK/i);
    if (m) return parseAmount(m[1]);
  }
  return null;
}

const STAY_RE = /^accommodation/i;

export function buildDagSlots(cards: DagCard[], season: { start: string; end: string }): Slot[] {
  const stay = cards.find(c => STAY_RE.test(c.label));
  if (!stay) return [];
  const year = season.start.slice(0, 4);
  const base: Omit<Slot, 'key' | 'unit' | 'price'> = {
    startDate: season.start,
    endDate: season.end,
    currency: 'NOK',
    priceUnit: 'package',
    priceBasis: 'person',
    occupancy: null,
    availability: 'on_request',
    availabilityText: 'Book by e-mail (snowkiting@dagalifjellpark.no); Saturday-to-Saturday weeks',
    spotsLeft: null,
    datePrecision: 'season',
    packageNights: CAMP_NIGHTS,
  };
  const out: Slot[] = [{ ...base, key: `stay-full-board|${year}`, unit: 'Stay with full board (no course)', price: stay.amount }];
  for (const c of cards) {
    if (c === stay) continue;
    out.push({ ...base, key: `${keyPart(c.label)}|${year}`, unit: `${c.label} camp (stay with full board + course)`, price: stay.amount + c.amount });
  }
  return out;
}

export interface DagLessonPrices { privateDay: number | null; groupDayMin: number | null; groupDayMax: number | null }

/** Prices page, "Snowkiting" block: private day rate and the 1-day group lesson range (per person). */
export function parseDagLessonPrices(html: string): DagLessonPrices {
  const root = contentRoot(html);
  const text = txt(root);
  const priv = text.match(/Private snowkiting lessons:\s*([\d.]+)\s*NOK\s*\/\s*1 day/i);
  const day1: number[] = [];
  for (const table of root.querySelectorAll('table')) {
    if (!/1-Day Group Lesson/i.test(txt(table))) continue;
    for (const tr of table.querySelectorAll('tbody tr')) {
      const a = parseAmount(txt(tr.querySelectorAll('td')[1]));
      if (a) day1.push(a);
    }
  }
  return {
    privateDay: priv ? parseAmount(priv[1]) : null,
    groupDayMin: day1.length ? Math.min(...day1) : null,
    groupDayMax: day1.length ? Math.max(...day1) : null,
  };
}

export interface DagPages { camp: string; beginners: string; prices: string }

export function parseDagaliContent(p: DagPages): OfferContent {
  const camp = contentRoot(p.camp);
  const campText = txt(camp);
  const beginners = txt(contentRoot(p.beginners));
  const cards = parseDagCards(p.camp);
  const season = parseDagSeason(p.camp);
  const rental = dagRentalPrice(cards);
  const lessons = parseDagLessonPrices(p.prices);
  const stay = cards.find(c => STAY_RE.test(c.label));
  const courses = cards.filter(c => c !== stay);
  const capacity = beginners.match(/weekly capacity:\s*(\d+)\s*persons/i)?.[1] ?? null;
  const paras = camp.querySelectorAll('p').map(x => txt(x)).filter(t => t.length > 60);
  const fmt = (n: number): string => n.toLocaleString('en-US');
  const day = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  const imageUrls = imageCandidates(p.camp, DAG_CAMP_URL, null, 60)
    .filter(u => /\/wp-content\/uploads\//.test(u) && !/Map_EN|logo|icon|\.svg/i.test(u))
    .slice(0, 30);

  const summary = [
    `Fagerheim Snowkite Camp is a ${CAMP_NIGHTS}-night snowkiting camp - kiting on snow with skis or a snowboard, not on water - on the Hardangervidda mountain plateau in Norway, sold by Dagali Fjellpark and taught by the Upwind snowkite school.`,
    `Guests stay directly on the spot at the Fagerheim base in renovated apartments for 4 (two double bedrooms, living room with fireplace) with full board, pick-up at Haugastøl station, gear storage, sauna and yoga${stay ? `; the stay costs ${fmt(stay.amount)} NOK` : ''}.`,
    courses.length ? `Courses are added on top: ${courses.map(c => `${c.label.toLowerCase()} ${fmt(c.amount)} NOK`).join(', ')}${rental ? `, with equipment rental at ${fmt(rental)} NOK` : ''}.` : '',
    season ? `The published season runs ${day(season.start)} to ${day(season.end)} in Saturday-to-Saturday weeks; booking is by e-mail.` : 'Booking is by e-mail.',
  ].filter(Boolean).join(' ');

  return {
    kind: 'camp',
    title: 'Fagerheim Snowkite Camp',
    summary,
    continent: 'Europe',
    country: 'Norway',
    region: 'Hardangervidda',
    spot: 'Fagerheim, Hardangervidda',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: CAMP_NIGHTS + 1,
    // "The offer is suitable for both beginners and advanced snowkiters" + a kitesurfers' track
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: courses.length > 0,
    equipmentRental: rental !== null || /complete snowkiting gear package/i.test(campText),
    beginnerFriendly: courses.some(c => /beginner/i.test(c.label)),
    // "The package includes 7 nights accommodation with full board, pick-up at the train station (or free
    // parking ...), convenient snowkite pick-up, and secure storage for your gear. Recharge with yoga and
    // stretching, unwind in the evening sauna ... all included in your stay."
    includedServices: /package includes/i.test(campText) ? [
      `${CAMP_NIGHTS} nights in a shared apartment (double rooms) reserved for camp participants`,
      'Full board: breakfast, lunch to go, dinner',
      'Pick-up at Haugastøl train station (or free parking)',
      'Snowkite pick-up on the plateau',
      'Secure gear storage',
      ...(/yoga/i.test(campText) ? ['Yoga and stretching'] : []),
      ...(/sauna/i.test(campText) ? ['Evening sauna'] : []),
    ] : [],
    optionalServices: [
      ...courses.map(c => `${c.label} course: ${c.features.filter(f => !/equipment available for rent/i.test(f)).join(', ')} (${fmt(c.amount)} NOK)`),
      ...(rental ? [`Snowkite equipment rental for the week (${fmt(rental)} NOK)`] : []),
      ...(lessons.privateDay ? [`Private snowkite lesson outside the camp (${fmt(lessons.privateDay)} NOK per day)`] : []),
      ...(lessons.groupDayMin && lessons.groupDayMax ? [`Group snowkite lesson outside the camp (${fmt(lessons.groupDayMin)}-${fmt(lessons.groupDayMax)} NOK per person and day, by group size)`] : []),
      'Multi-day snowkite trips, cross-country skis, snowshoeing or dog sledding on request',
    ],
    accommodation: 'Renovated two-floor apartments for 4 at the Fagerheim base (2 double bedrooms, fireplace, kitchen)',
    mealPlan: /full board/i.test(campText) ? 'full_board' : null,
    languages: /we teach in english/i.test(beginners) ? ['en'] : [],
    rooms: [{
      name: 'Apartment for 4',
      description: 'Two floors, 2 double bedrooms, living room with a fireplace, bathroom & toilet, kitchen and storage; three apartments connect into one living area for up to 12.',
      features: ['2 double bedrooms', 'Fireplace', 'Kitchen', '5G internet coverage', ...(capacity ? [`Weekly camp capacity ${capacity} persons`] : [])],
    }],
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: DAG_CAMP_URL,
    bookingUrl: DAG_CAMP_URL, // its "Book" buttons open an e-mail to snowkiting@dagalifjellpark.no
    sourceText: [
      `season: ${season?.raw ?? '?'}`,
      `cards: ${cards.map(c => `${c.label} ${c.amount} NOK [${c.features.join('; ')}]`).join(' | ')}`,
      `lessons outside the camp: private ${lessons.privateDay ?? '?'} NOK/day; group 1 day ${lessons.groupDayMin ?? '?'}-${lessons.groupDayMax ?? '?'} NOK p.p.`,
      `beginners page: capacity ${capacity ?? '?'} persons/week`,
      `camp page: ${paras.join(' ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const dagaliSnowkiteCampFagerheim: OfferAdapter = {
  key: 'dagali-snowkite-camp-fagerheim',
  name: 'Fagerheim Snowkite Camp (Dagali Fjellpark, Hardangervidda)',
  kind: 'camp',
  operator: {
    name: 'Dagali Fjellpark',
    websiteUrl: `${SITE}/en/`,
    rootDomain: 'dagalifjellpark.no',
    contactEmail: 'snowkiting@dagalifjellpark.no',
    phone: '+47 98 09 89 75',
  },
  url: DAG_CAMP_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'medium',
  async fetchContent() {
    const [camp, beginners, prices] = [await page(DAG_CAMP_URL), await page(DAG_BEGINNERS_URL), await page(DAG_PRICES_URL)];
    return parseDagaliContent({ camp, beginners, prices });
  },
  async fetchSlots(ctx) {
    const html = await page(DAG_CAMP_URL);
    const cards = parseDagCards(html);
    const season = parseDagSeason(html);
    if (!cards.some(c => STAY_RE.test(c.label)) || cards.length < 2) throw new Error(`dagali-snowkite-camp: price cards not found or changed (${cards.length} parsed)`);
    if (!season) throw new Error('dagali-snowkite-camp: season line ("7.2. – 25.4.2026") not found');
    if (season.end < new Date().toISOString().slice(0, 10)) ctx.note(`published season ${season.start}..${season.end} is over; next season not on the page yet`);
    return buildDagSlots(cards, season);
  },
};
