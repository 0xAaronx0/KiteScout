// ---------------------------------------------------------------------------
// Above The Water (Swiss kite + yoga camp operator, Kitetravel4all SARL, head coach Fabio Ingrosso) - Kitesurf camp
// "SA - Cape Town, January 2027" at Bloubergstrand: 7 nights in a double room (twin beds) in apartments "2 minutes
// from the kite spot", breakfast, 6 days of pro coaching (2 sessions a day), morning yoga with Lucia Pele, daily
// briefings, photo + video shooting, beach support and gear storage; "In cooperation with High 5 Kite School" (the
// local school at Blouberg). Day spots named on the page: Hermanus, Misty Cliffs, Platboom. One base -> KIND 'camp'.
//
// This file also holds the shared Above The Water helpers (fetch, Wix text lines, date ranges, price variants, the
// /next-camps season grid, slots, photos); the Langebaan camp (above-the-water-kite-yoga-camp-langebaan.ts) imports them.
//
// Data path (checked 2026-10-27): Wix site, server-rendered HTML.
//   slots    the camp page: weeks = the registration form's date checkboxes ("27.12 - 03.01", "03.01 - 10.01"; no year,
//            so the year is anchored on the page title "SA - Cape Town, January 2027", and Dec dates fall into 2026);
//            fallback = the hero line "27 Dec - 3 Jan, 3-10 January". Prices = the "PRICE 1880 EUR / INCLUDED ..." block
//            (7 nights in a double room) and "PRICE 1280 EUR / ONLY ACTIVITIES OPTION INCLUDED ..." (no stay). One slot per
//            future week x variant, EUR, priceUnit 'package' (packageNights 7 on the stay variant).
//            Availability: the /next-camps season grid card that links to this page ("BOOK NOW" -> 'on_request',
//            "N SPOTS LEFT" -> 'limited', "SOLD OUT!" -> 'sold_out'); without a card 'on_request'. Booking is the on-page
//            registration form + a non-refundable EUR 880 deposit per participant and week, confirmed by the operator.
//            Future editions: every /next-camps card whose heading names Cape Town (not Langebaan) is read too, so a
//            "capetown-january-2028" page is picked up without a code change (at most 3 camp pages per run).
//   content  the same page (included lists, apartment text, spots, form options) + the card's "Ideal for" line.
// Price basis: "per person" is not printed next to the prices; inferred from the deposit "per participant, per camp
//   week" (priceBasis 'person', occupancy 2 for the twin-share room).
// Level doubt (2026-10-27): the season grid says "Ideal for: Intermediate, Pro" (Blouberg: 25+ knots, ocean, waves),
//   while the camp page's "Who this camp is for" says "ride at a beginner to intermediate level" and the form offers
//   "I Need Beginner's Course". skillLevels follow the season grid (intermediate, advanced); beginnerFriendly false;
//   the beginner's course is an optional service.
// The apartment building is not named. Flights and airport transfers are not included ("all you need is your flight").
// robots.txt www.abovethewater.online (2026-10-27): Wix default, `Allow: /` (only *?lightbox= and AdsBot paths).
// Requests per run: 2 (camp page + /next-camps, memoised for content + slots); more only when the grid lists a further
//   Cape Town edition.
// Flags: liveAvailability no (season grid badge text, no inventory), instantBooking no (registration form + deposit).
// Contact: booking@abovethewater.online and +41 78 254 82 80, printed as text in the footer of every page.
// ---------------------------------------------------------------------------
import { fetchText, HttpStatusError } from '../http.js';
import { collapse, daysInclusive, iso, meta, monthOf, parse, parseAmount, todayIso, type HTMLElement } from '../parse.js';
import type { Availability, FetchContext, OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';

export const ATW_SITE = 'https://www.abovethewater.online';
export const ATW_NEXT_URL = `${ATW_SITE}/next-camps`;
export const ATW_CT_URL = `${ATW_SITE}/capetown-january-2027`;
/** camp pages read per run at most (the adapter's own page + further editions listed in the season grid) */
const MAX_CAMP_PAGES = 3;

export const ATW_OPERATOR: OperatorRef = {
  name: 'Above The Water',
  websiteUrl: ATW_SITE,
  rootDomain: 'abovethewater.online',
  contactEmail: 'booking@abovethewater.online',
  phone: '+41782548280',
};

// --- fetch + text ------------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
export function atwPage(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

const clean = (s: string): string => collapse(s.replace(/[​ ]/g, ' '));

function stripped(html: string): HTMLElement {
  const root = parse(html);
  for (const el of root.querySelectorAll('script,style,noscript,svg')) el.remove();
  return root;
}

/** Visible text lines of the Wix page (scripts, styles, SVG dropped; zero-width spaces removed). */
export function atwLines(html: string): string[] {
  const root = stripped(html);
  return (root.querySelector('body') ?? root).structuredText.split('\n').map(clean).filter(Boolean);
}

/** Values of the registration form's checkboxes (dates, variants, extras), in page order. */
export function atwFormOptions(html: string): string[] {
  return parse(html).querySelectorAll('input[type="checkbox"]')
    .map(i => clean(i.getAttribute('value') ?? ''))
    .filter(v => v && v !== 'checked');
}

// --- dates -------------------------------------------------------------------------------------
export interface AtwRange { start: string; end: string; raw: string }
export interface YearAnchor { year: number; month: number }

/** "SA - Cape Town, January 2027" (title) or ".../capetown-january-2027" (URL) -> { year 2027, month 1 }. */
export function atwAnchor(...texts: Array<string | null | undefined>): YearAnchor | null {
  for (const t of texts) {
    const m = (t ?? '').match(/\b([A-Za-z]{3,9})[\s,_-]+(20\d{2})\b/g) ?? [];
    for (const hit of m) {
      const [, word, y] = hit.match(/([A-Za-z]{3,9})[\s,_-]+(20\d{2})/)!;
      const mo = monthOf(word);
      if (mo) return { year: Number(y), month: mo };
    }
  }
  return null;
}

/** Year for a month without one: the year that puts it closest to the anchor (Dec before a "January 2027" camp = 2026). */
function yearNear(month: number, a: YearAnchor): number {
  let best = a.year;
  for (const y of [a.year - 1, a.year, a.year + 1]) {
    if (Math.abs(y * 12 + month - (a.year * 12 + a.month)) < Math.abs(best * 12 + month - (a.year * 12 + a.month))) best = y;
  }
  return best;
}

/**
 * Every date range in a text: "27.12 - 03.01", "27 Dec - 3 Jan", "3-10 January", "13-20 December 2026",
 * "11-18, 18-25 July". Missing years come from the anchor; an end before its start rolls into the next year.
 */
export function atwRanges(text: string, anchor: YearAnchor): AtwRange[] {
  let t = clean(text).replace(/[‐-―−]/g, '-');
  const found: Array<{ at: number; r: AtwRange }> = [];
  const mk = (raw: string, at: number, d1: number, m1: number, y1: number | null, d2: number, m2: number, y2: number | null): void => {
    if (!(m1 >= 1 && m1 <= 12 && m2 >= 1 && m2 <= 12 && d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31)) return;
    const ys = y1 ?? (y2 !== null && m1 <= m2 ? y2 : y2 !== null ? y2 - 1 : yearNear(m1, anchor));
    let ye = y2 ?? ys;
    if (iso(ye, m2, d2) < iso(ys, m1, d1)) ye += 1;
    found.push({ at, r: { start: iso(ys, m1, d1), end: iso(ye, m2, d2), raw: clean(raw) } });
  };
  /** run one pattern over the text, then blank out its matches so a later pattern cannot re-read them */
  const mask = (re: RegExp, fn: (m: RegExpMatchArray & { index: number }) => void): void => {
    for (const m of t.matchAll(re)) fn(m as RegExpMatchArray & { index: number });
    t = t.replace(re, hit => ' '.repeat(hit.length));
  };
  const y = (s: string | undefined): number | null => (s ? Number(s) : null);
  // 27.12 - 03.01 / 27.12.2026 - 03.01.2027
  mask(/(\d{1,2})\.(\d{1,2})(?:\.(20\d{2}))?\.?\s*-\s*(\d{1,2})\.(\d{1,2})(?:\.(20\d{2}))?/g, m =>
    mk(m[0], m.index, +m[1], +m[2], y(m[3]), +m[4], +m[5], y(m[6])));
  // 27 Dec - 3 Jan / 27 Dec 2026 - 3 Jan 2027
  mask(/(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:\s+(20\d{2}))?\s*-\s*(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:\s+(20\d{2}))?/g, m => {
    const m1 = monthOf(m[2]); const m2 = monthOf(m[5]);
    if (m1 && m2) mk(m[0], m.index, +m[1], m1, y(m[3]), +m[4], m2, y(m[6]));
  });
  // 3-10 January / 13-20 December 2026 / "11-18, 18-25 July" (the month and year of the last range apply to the list)
  mask(/((?:\d{1,2}\s*-\s*\d{1,2}\s*[,/&]\s*)*)(\d{1,2})\s*-\s*(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:\s+(20\d{2}))?/g, m => {
    const mo = monthOf(m[4]);
    if (!mo) return;
    for (const p of (m[1] ?? '').matchAll(/(\d{1,2})\s*-\s*(\d{1,2})/g)) mk(p[0], m.index, +p[1], mo, y(m[5]), +p[2], mo, y(m[5]));
    mk(m[0].slice((m[1] ?? '').length), m.index + (m[1] ?? '').length, +m[2], mo, y(m[5]), +m[3], mo, y(m[5]));
  });
  return found.sort((a, b) => a.at - b.at).map(f => f.r);
}

/** Camp weeks: the form's date checkboxes, else the date-only lines at the top of the page (hero). */
export function atwCampWeeks(html: string, anchor: YearAnchor): { weeks: AtwRange[]; source: 'form' | 'hero' | 'none'; hero: AtwRange[] } {
  const uniq = (rs: AtwRange[]): AtwRange[] => rs.filter((r, i) => rs.findIndex(x => x.start === r.start && x.end === r.end) === i);
  const form = uniq(atwFormOptions(html).flatMap(v => atwRanges(v, anchor)));
  const lines = atwLines(html);
  const formAt = lines.findIndex(l => /RIDER REGISTRATION FORM/i.test(l));
  const top = formAt > 0 ? lines.slice(0, formAt) : lines.slice(0, 40);
  // a date-only line: nothing left but separators once the ranges are removed
  const hero = uniq(top.filter(l => l.length <= 80 && atwRanges(l, anchor).length > 0
    && !/[A-Za-z]{4,}/.test(l.replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi, '')))
    .flatMap(l => atwRanges(l, anchor)));
  if (form.length) return { weeks: form, source: 'form', hero };
  return { weeks: hero, source: hero.length ? 'hero' : 'none', hero };
}

// --- prices ------------------------------------------------------------------------------------
export interface AtwVariant {
  /** the page's own label ("Group coaching", "Only activities option", "No hotel"); null for the main stay package */
  label: string | null;
  amount: number;
  currency: string;
  /** nights of accommodation the price includes; null = no accommodation */
  nights: number | null;
  /** the variant's own description / included items */
  details: string[];
}

const CUR: Record<string, string> = { '€': 'EUR', eur: 'EUR', chf: 'CHF', usd: 'USD', $: 'USD' };
const curOf = (s: string): string => CUR[s.toLowerCase()] ?? s.toUpperCase();
const NO_STAY = /only activities|no hotel|without (?:hotel|accommodation)|no accommodation/i;
const nightsIn = (items: string[]): number | null => {
  for (const i of items) {
    const m = i.match(/(\d{1,2})\s+nights?\s+(?:of\s+)?accommodation/i);
    if (m) return Number(m[1]);
  }
  return null;
};
const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/**
 * Price variants of a camp page, three layouts seen on the site (2026-10-27):
 *   A  "PRICE 1880 EUR" / "INCLUDED" / items ...; "PRICE 1280 EUR" / "ONLY ACTIVITIES OPTION INCLUDED" / items
 *   B  "Always Included" / items, then per variant "GROUP COACHING" / "1880 EUR" / description lines
 *   C  a form option "No hotel ( €1280 )"
 */
export function atwVariants(lines: string[], formOptions: string[]): AtwVariant[] {
  const out: AtwVariant[] = [];
  const stop = (l: string): boolean => /^(?:\*|BOOK NOW|View Gallery|Registration$|RIDER REGISTRATION FORM)/i.test(l);
  const priceLine = /^(?:PRICE\s+)?(\d[\d.,']*)\s*(EUR|€|CHF|USD)$/i;
  const formAt = lines.findIndex(l => /RIDER REGISTRATION FORM/i.test(l));
  const body = formAt > 0 ? lines.slice(0, formAt) : lines;
  const alwaysAt = body.findIndex(l => /^Always included$/i.test(l));
  const always: string[] = [];
  if (alwaysAt >= 0) {
    for (const l of body.slice(alwaysAt + 1)) { if (priceLine.test(l) || /^WHAT'?S DIFFERENT/i.test(l) || stop(l)) break; always.push(l); }
  }
  for (let i = 0; i < body.length; i++) {
    const m = body[i].match(priceLine);
    if (!m) continue;
    const amount = parseAmount(m[1]);
    if (!amount || amount < 100) continue;
    const isA = /^PRICE\b/i.test(body[i]);
    let label: string | null = null;
    const details: string[] = [];
    let j = i + 1;
    if (isA) {
      const head = body[j]?.match(/^(.*?)\s*INCLUDED$/i);
      if (head) { label = head[1] ? titleCase(head[1]) : null; j++; }
    } else {
      const prev = body[i - 1] ?? '';
      if (prev.length <= 40 && /^[A-Z0-9 +&:/'-]+$/.test(prev)) label = titleCase(prev);
    }
    for (; j < body.length; j++) {
      const l = body[j];
      if (priceLine.test(l) || stop(l)) break;
      if (!isA && body[j + 1] && priceLine.test(body[j + 1]) && /^[A-Z0-9 +&:/'-]+$/.test(l)) break; // next variant's label
      details.push(l);
    }
    const stay = !NO_STAY.test(label ?? '');
    const nights = stay ? nightsIn(details) ?? nightsIn(always) : null;
    out.push({ label, amount, currency: curOf(m[2]), nights, details });
  }
  for (const o of formOptions) {
    const m = o.match(/^(.+?)\s*\(\s*(€|EUR|CHF)\s*(\d[\d.,']*)\s*\)$/i);
    if (!m) continue;
    const amount = parseAmount(m[3]);
    if (!amount || out.some(v => v.amount === amount && (v.label ?? '').toLowerCase() === m[1].toLowerCase())) continue;
    out.push({ label: titleCase(m[1]), amount, currency: curOf(m[2]), nights: NO_STAY.test(m[1]) ? null : nightsIn(always), details: [] });
  }
  return out;
}

/** "Single room (+€50/night)" -> "Single room: +EUR 50 per night". */
export function atwSupplements(formOptions: string[]): string[] {
  const out: string[] = [];
  for (const o of formOptions) {
    const m = o.match(/^(.+?)\s*\(\s*\+\s*(€|EUR|CHF)\s*(\d[\d.,']*)\s*\/\s*night\s*\)$/i);
    if (m) out.push(`${titleCase(m[1])}: +${curOf(m[2])} ${parseAmount(m[3])} per night`);
  }
  return out;
}

// --- season grid (/next-camps) ------------------------------------------------------------------
export interface AtwCard { url: string; badge: string | null; heading: string; dates: string; idealFor: string | null; from: string | null }

/** Text lines with "[[A href]]" markers for links, in document order. */
function linkedLines(html: string): string[] {
  const out: string[] = [];
  const walk = (n: HTMLElement): void => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { const t = clean(c.text); if (t) out.push(t); continue; }
      if (c.nodeType !== 1) continue;
      const el = c as HTMLElement;
      if (el.tagName === 'A' && el.getAttribute('href')) out.push(`[[A ${el.getAttribute('href')}]]`);
      walk(el);
    }
  };
  const root = stripped(html);
  walk(root.querySelector('body') ?? root);
  return out;
}

/** The season grid's cards: each card links twice to its camp page (image/badge block + "from ... EUR" price). */
export function atwCards(html: string): AtwCard[] {
  const lines = linkedLines(html);
  const cards: AtwCard[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const href = lines[i].match(/^\[\[A (https?:\/\/[^\]]+)\]\]$/)?.[1];
    if (!href || seen.has(href) || !href.startsWith(ATW_SITE)) continue;
    const j = lines.indexOf(lines[i], i + 1);
    if (j < 0) continue;
    const block = lines.slice(i + 1, j).filter(l => !l.startsWith('[[A '));
    if (block.length < 2 || new URL(href).pathname.length < 2) continue;
    seen.add(href);
    let k = 0;
    const badge = /sold out|spots? left|book now|wait ?list|coming soon|last spot|fully booked/i.test(block[0]) ? block[k++] : null;
    const heading = block[k++] ?? '';
    const dates = block[k] ?? '';
    if (!/\d{1,2}\s*[-./]\s*\d{1,2}/.test(dates)) continue; // not a camp card (logo / nav links)
    const ideal = block.findIndex(l => /^Ideal for:?$/i.test(l));
    const idealInline = block.map(l => l.match(/^Ideal for:\s*(.+)$/i)?.[1]).find(Boolean) ?? null;
    const from = lines.slice(j + 1, j + 3).find(l => /\d\s*(?:EUR|€)/i.test(l)) ?? null;
    cards.push({ url: href.replace(/\/$/, ''), badge, heading, dates, idealFor: idealInline ?? (ideal >= 0 ? block[ideal + 1] ?? null : null), from });
  }
  return cards;
}

export function atwStatus(badge: string | null): { availability: Availability; spotsLeft: number | null; text: string | null } {
  const b = clean(badge ?? '');
  if (/sold out|fully booked/i.test(b)) return { availability: 'sold_out', spotsLeft: null, text: b };
  if (/wait ?list/i.test(b)) return { availability: 'waitlist', spotsLeft: null, text: b };
  const n = b.match(/(\d+)\s+spots?\s+left/i)?.[1] ?? (/last spot/i.test(b) ? '1' : null);
  if (n) return { availability: 'limited', spotsLeft: Number(n), text: b };
  return { availability: 'on_request', spotsLeft: null, text: b || null };
}

/** "Beginners, Intermediate, Pro" -> ['beginner', 'intermediate', 'advanced']. */
export function atwLevels(idealFor: string | null): string[] {
  const t = idealFor ?? '';
  return [/beginner/i.test(t) ? 'beginner' : null, /intermediate/i.test(t) ? 'intermediate' : null, /pro\b|advanced|expert/i.test(t) ? 'advanced' : null]
    .filter((x): x is string => !!x);
}

// --- slots -------------------------------------------------------------------------------------
export interface AtwSpec {
  /** the adapter's own camp page */
  url: string;
  /** season grid card headings that belong to this product (e.g. /cape\s*town/ but not Langebaan) */
  card: (heading: string) => boolean;
  /** slot unit for a variant */
  unit: (v: AtwVariant) => string;
  /** content room a stay variant prices */
  room: string;
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function buildAtwSlots(spec: AtwSpec, weeks: AtwRange[], variants: AtwVariant[], card: AtwCard | null, today: string): Slot[] {
  const st = atwStatus(card?.badge ?? null);
  const out: Slot[] = [];
  const seen = new Set<string>();
  for (const w of weeks) {
    if (w.start < today) continue; // past weeks never become slots
    for (const v of variants) {
      const unit = spec.unit(v);
      const key = `${w.start}|${slug(unit)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        startDate: w.start,
        endDate: w.end,
        unit,
        room: v.nights ? spec.room : null,
        price: v.amount,
        currency: v.currency,
        priceUnit: 'package',
        priceBasis: 'person', // inferred from the deposit "per participant", see header
        occupancy: v.nights ? 2 : 1,
        availability: st.availability,
        availabilityText: [
          st.text ? `Season grid: "${st.text}"` : null,
          'Registration form + non-refundable EUR 880 deposit per participant and week; the operator confirms',
        ].filter(Boolean).join('; '),
        // the grid's spot count is per camp; with several weeks it is not known per week
        spotsLeft: weeks.length === 1 ? st.spotsLeft : null,
        packageNights: v.nights,
      });
    }
  }
  return out;
}

export interface AtwParsed {
  url: string;
  html: string;
  anchor: YearAnchor;
  weeks: AtwRange[];
  weekSource: 'form' | 'hero' | 'none';
  hero: AtwRange[];
  variants: AtwVariant[];
  card: AtwCard | null;
  slots: Slot[];
}

export function parseAtwCamp(spec: AtwSpec, url: string, html: string, cards: AtwCard[], today: string): AtwParsed {
  const title = meta(html, 'og:title') ?? html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? null;
  const anchor = atwAnchor(title, url) ?? { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const { weeks, source, hero } = atwCampWeeks(html, anchor);
  const variants = atwVariants(atwLines(html), atwFormOptions(html));
  const path = new URL(url).pathname.replace(/\/$/, '');
  const card = cards.find(c => new URL(c.url).pathname === path) ?? null;
  return { url, html, anchor, weeks, weekSource: source, hero, variants, card, slots: buildAtwSlots(spec, weeks, variants, card, today) };
}

async function seasonCards(ctx?: Pick<FetchContext, 'note'>): Promise<AtwCard[]> {
  try {
    return atwCards(await atwPage(ATW_NEXT_URL));
  } catch (e) {
    ctx?.note(`season grid ${ATW_NEXT_URL} not read (${(e as Error).message}); availability 'on_request'`);
    return [];
  }
}

/** The adapter's camp page plus further editions of the same camp listed in the season grid. */
export async function readAtwCamps(spec: AtwSpec, today: string, ctx?: Pick<FetchContext, 'note' | 'incomplete'>): Promise<AtwParsed[]> {
  const cards = await seasonCards(ctx);
  const urls = [spec.url, ...cards.filter(c => spec.card(c.heading)).map(c => c.url)]
    .filter((u, i, a) => a.findIndex(x => new URL(x).pathname === new URL(u).pathname) === i)
    .slice(0, MAX_CAMP_PAGES);
  const out: AtwParsed[] = [];
  for (const url of urls) {
    let html: string;
    try {
      html = await atwPage(url);
    } catch (e) {
      // the own page may be retired after its season; a 404 there is not an error when the grid names a successor
      if (e instanceof HttpStatusError && e.status === 404) { ctx?.note(`${url}: 404 (page retired?)`); continue; }
      throw e;
    }
    const p = parseAtwCamp(spec, url, html, cards, today);
    if (p.weeks.length === 0) ctx?.note(`${url}: no camp dates found (layout changed?)`);
    if (p.variants.length === 0) ctx?.incomplete?.(`${url}: no prices found (layout changed?)`);
    if (p.weekSource === 'form' && p.hero.length && p.hero.map(h => h.start).join() !== p.weeks.map(w => w.start).join()) {
      ctx?.note(`${url}: hero dates (${p.hero.map(h => h.raw).join('; ')}) differ from the form dates (${p.weeks.map(w => w.raw).join('; ')}); form used`);
    }
    if (p.weeks.length && p.slots.length === 0) ctx?.note(`${url}: published weeks ${p.weeks.map(w => w.raw).join(', ')} are past`);
    out.push(p);
  }
  if (out.length === 0) throw new Error(`above-the-water: no camp page readable (${urls.join(', ')})`);
  return out;
}

export async function fetchAtwSlots(spec: AtwSpec, today: string, ctx?: Pick<FetchContext, 'note' | 'incomplete'>): Promise<Slot[]> {
  const camps = await readAtwCamps(spec, today, ctx);
  const seen = new Set<string>();
  return camps.flatMap(c => c.slots).filter(s => (seen.has(s.key) ? false : (seen.add(s.key), true)));
}

// --- photos ------------------------------------------------------------------------------------
/** Wix media ids on the page (content images + pro-gallery items), in page order, jpg/webp only. */
export function atwMediaIds(html: string): { all: string[]; gallery: string[] } {
  const root = stripped(html);
  const all: string[] = [];
  const gallery: string[] = [];
  for (const img of root.querySelectorAll('img')) {
    const id = decodeURIComponent(img.getAttribute('src') ?? '').match(/static\.wixstatic\.com\/media\/([0-9a-f]{6}_[0-9a-f]{32}~mv2\.(?:jpe?g|webp))/i)?.[1];
    if (!id) continue;
    if (!all.includes(id)) all.push(id);
    if (img.getAttribute('data-hook') === 'gallery-item-image-img' && !gallery.includes(id)) gallery.push(id);
  }
  return { all, gallery };
}

/**
 * Photos: the hand-picked ids (kite action, the spot, the accommodation; checked by eye 2026-10-27, no portraits,
 * logos, gym or food shots) that are still on the page, best first; if fewer than 6 remain (page re-done), the
 * page's pro-gallery items fill up. Bare Wix media URLs (the downloader asks Wix for a bounded size).
 */
export function atwImages(html: string, picks: string[], max = 12): string[] {
  const { all, gallery } = atwMediaIds(html);
  const ids = picks.filter(p => all.includes(p));
  if (ids.length < 6) for (const g of gallery) if (!ids.includes(g)) ids.push(g);
  return ids.slice(0, max).map(id => `https://static.wixstatic.com/media/${id}`);
}

// --- Cape Town ---------------------------------------------------------------------------------
/** Checked by eye 2026-10-27: Table Mountain + kites at Blouberg, the beach, the street by the apartments, Misty
 *  Cliffs / Platboom wave spots, riding shots, coaching on the beach. */
export const ATW_CT_PHOTOS = [
  '941edc_12033d2a05124266b77e68581663a836~mv2.jpg', // kites in front of Table Mountain
  '941edc_440766c6b76240ff8268a9117fb35441~mv2.jpg', // Blouberg beach with kites
  '941edc_b245bb73e47e47e1a354151c28dcf8f4~mv2.jpg', // Blouberg beachfront by the apartments
  '941edc_e863fe93e70e46c2b7d5f828868281ce~mv2.jpg', // kites on a white beach (day spot)
  '941edc_cb81e75fb722403b8d5400c65f97487c~mv2.jpg', // Scarborough / Cape Point waves
  '941edc_2cd5f585931a4e24bee5a1a6c8452dfd~mv2.jpg', // rider on an ocean beach
  '941edc_e4c83eaf90664597a960ae13670627f1~mv2.jpg', // riding in the waves
  '941edc_c4801701bfc3452bb47e610c06bc19a0~mv2.jpg', // big air
  '941edc_b8d21a40532d4f338b74a031a5cda8cb~mv2.jpg', // rider in Table Bay
  '941edc_44e7cbb5876b4a9181be1e4755f79fee~mv2.jpg', // coaches with kites on the beach
  '941edc_3daeb1582d9d4cbba7ef3a408c3d5345~mv2.jpg', // coaching on the beach
];

export const ATW_CT_SPEC: AtwSpec = {
  url: ATW_CT_URL,
  card: h => /cape\s*town/i.test(h) && !/langebaan/i.test(h),
  unit: v => (v.nights ? 'Double room (twin beds)' : 'Only activities (no accommodation)'),
  room: 'Double room (twin beds)',
};

const day = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const eur = (v: AtwVariant): string => `${v.currency} ${v.amount.toLocaleString('en-US')}`;

export function parseAtwCtContent(p: AtwParsed, today: string): OfferContent {
  const lines = atwLines(p.html);
  const text = lines.join('\n');
  const stay = p.variants.find(v => v.nights);
  const only = p.variants.find(v => !v.nights);
  const future = p.weeks.filter(w => w.start >= today);
  const nights = stay?.nights ?? (p.weeks[0] ? daysInclusive(p.weeks[0].start, p.weeks[0].end) - 1 : 7);
  const levels = atwLevels(p.card?.idealFor ?? null);
  const options = atwFormOptions(p.html);
  const spots = ['Hermanus', 'Misty Cliffs', 'Platboom'].filter(s => text.includes(s));
  const summary = [
    'Above The Water, a Swiss kite and yoga camp run by six-time world champion Fabio Ingrosso, holds a one-week kitesurf coaching camp at Bloubergstrand, Cape Town, in the windy South African summer (the "Cape Doctor", 25+ knots, ocean waves), in cooperation with the local High 5 Kite School.',
    `The package covers ${nights} nights in a double room with twin beds in apartments across the road from the kite spot, breakfast, 6 days of coaching with two sessions a day, morning yoga, daily briefings and a photo and video shoot${spots.length ? `; other spots the group rides: ${spots.length > 1 ? `${spots.slice(0, -1).join(', ')} and ${spots[spots.length - 1]}` : spots[0]}` : ''}.`,
    `${stay ? `It costs ${eur(stay)}` : 'The price is on the camp page'}${only ? `, or ${eur(only)} for the activities without accommodation` : ''}; flights are extra, and booking is by registration form with a non-refundable EUR 880 deposit.`,
    future.length
      ? `Camp weeks: ${future.map(w => `${day(w.start)} to ${day(w.end)}`).join(' and ')}.`
      : p.weeks.length ? 'The published camp weeks are over; the next dates are not published yet.' : 'Dates are on the camp page.',
  ].join(' ');
  return {
    kind: 'camp',
    title: 'Above The Water Kite Camp Cape Town (Bloubergstrand)',
    summary,
    continent: 'Africa',
    country: 'South Africa',
    region: 'Western Cape',
    spot: 'Bloubergstrand, Cape Town',
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: levels.length ? levels : ['intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: null,
    beginnerFriendly: false,
    includedServices: stay?.details.length ? stay.details : [`${nights} nights accommodation in double room`, 'Breakfast', '6 days pro-coaching', 'Morning yoga'],
    optionalServices: [
      ...(only ? [`Only activities option without accommodation (${eur(only)}): ${only.details.join(', ')}`] : []),
      ...(options.some(o => /beginner'?s course/i.test(o)) ? ["Beginner's course (form option, price on request)"] : []),
      'Custom offers for families, partners and groups (on request)',
    ],
    accommodation: 'Apartments in a secure building with 24/7 security, garage and gear storage, 2 minutes from the kite spot at Bloubergstrand (views of Table Mountain); double rooms with twin beds',
    mealPlan: stay?.details.some(d => /^breakfast/i.test(d)) ? 'breakfast' : null,
    languages: ['en'],
    rooms: [{ name: 'Double room (twin beds)', description: 'Shared double room with twin beds in an apartment across the road from the kite spot', features: ['Twin beds', 'Gear storage', '24/7 security'] }],
    imageUrls: atwImages(p.html, ATW_CT_PHOTOS),
    heroVideoUrl: null,
    sourceUrl: p.url,
    bookingUrl: p.url,
    sourceText: [
      text,
      `parsed: weeks (${p.weekSource}) ${p.weeks.map(w => `${w.start}..${w.end}`).join(', ')}; variants ${p.variants.map(v => `${v.label ?? 'stay'} ${eur(v)} nights=${v.nights ?? '-'}`).join('; ')}; season grid ${p.card ? `"${p.card.badge ?? ''}" ideal for "${p.card.idealFor ?? ''}"` : 'card not found'}`,
    ].join('\n'),
  };
}

export const aboveTheWaterKiteCampCapeTown: OfferAdapter = {
  key: 'above-the-water-kite-camp-cape-town',
  name: 'Above The Water - Kite Camp Cape Town (Bloubergstrand)',
  kind: 'camp',
  disciplines: ['kitesurf'],
  operator: ATW_OPERATOR,
  url: ATW_CT_URL,
  slotMethod: 'html_dates',
  instantBooking: false, // registration form + EUR 880 deposit, confirmed by the operator
  fetchBudget: 1 + MAX_CAMP_PAGES,
  async fetchContent(ctx) {
    const [p] = await readAtwCamps(ATW_CT_SPEC, todayIso(), ctx);
    return parseAtwCtContent(p, todayIso());
  },
  fetchSlots: ctx => fetchAtwSlots(ATW_CT_SPEC, todayIso(), ctx),
};
