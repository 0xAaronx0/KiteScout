// ---------------------------------------------------------------------------
// Swiss Kitesurf (kitesailing.ch, Silvaplana) - Kite camp Sicily at Lo Stagnone: 7 nights directly at the lagoon
// (single or double room, breakfast) + 6 days of semi-private lessons (VDWS theory, video analysis) + level-adapted
// gear + spot fee. This file also holds the shared parser for the operator's other camp page (Egypt, Soma Bay:
// swiss-kitesurf-camp-soma-bay.ts).
//
// Data path (checked 2026-10-19): Craft CMS pages, server-rendered.
//   camp page   /en/school/camps/kite-camp-<country>
//     - "When?" banner: the weeks ("10.04 - 17.04.2027 / ...").
//     - "Current status:" table under "IMPORTANT!!!": one row per week + the operator's status ("Not yet confirmed",
//       "Confirmed!", "Fully Booked"). This table is the slot source (week + status). The camp only runs with at
//       least 3 students; "Confirmed!" = it runs.
//     - price blocks (.text__wrapper with "CHF"): Sicily "CHF 1700.-" (standard room with double bed, alone) and
//       "If you come as a couple or as a pair ... Price per person: CHF 1400.-"; Egypt three packages "CHF 1750.- /
//       1350.- / 950.- in shared room (only bookable in pairs)" + "CHF 300.- single room surcharge".
//     - "This is included:" list, "Not included" list, gallery (a.galerie__link, full-size originals).
//   request     /en/kite-camp-booking-request (Freeform form, reCAPTCHA; we never submit it) lists the same weeks
//     WITH the year ("3.10 - 10.10.2026"); used to give year-less status rows (Egypt) their year.
// Booking: request form only, "my request is only binding after confirmation by Swiss Kitesurf" -> availability
//   'on_request' (Fully Booked -> 'sold_out'); instantBooking unset (not an online checkout), liveAvailability unset
//   (page text, no engine).
// robots.txt kitesailing.ch (2026-10-19): only /cpresources/, /vendor/, /.env disallowed.
// Requests per run: 2 (camp page + request page, both memoised for 10 min; the Egypt adapter shares the request page).
// Slots: one per future week x package variant (key "<variant>|<start>"), CHF as printed, priceUnit 'package',
//   priceBasis 'person'. Weeks that have already started are dropped; the parser reads whatever rows the status
//   table lists, so new weeks appear on the next daily run.
// State 2026-10-19: Sicily 6 weeks 10.04.-22.05.2027 (3 confirmed, 3 not yet confirmed) x 2 variants = 12 slots.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { availabilityFromText, collapse, iso, parse, todayIso, type HTMLElement } from '../parse.js';
import type { Availability, FetchContext, OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';

export const SK_SITE = 'https://kitesailing.ch';
export const SK_REQUEST_URL = `${SK_SITE}/en/kite-camp-booking-request`;
export const SK_SICILY_URL = `${SK_SITE}/en/school/camps/kite-camp-sicily`;

export const SK_OPERATOR: OperatorRef = {
  name: 'Swiss Kitesurf',
  websiteUrl: SK_SITE,
  rootDomain: 'kitesailing.ch',
  contactEmail: 'info@kitesailing.ch',
  phone: '+41818289767',
};

// --- fetch (memoised: content + slots, and both camp adapters share the request page) -----------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
export function skPage(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
const keyPart = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function visible(html: string): HTMLElement {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, template')) el.remove();
  return root;
}

// --- dates ------------------------------------------------------------------------------------------------------------
export interface SkRange { d1: number; m1: number; y1: number | null; d2: number; m2: number; y2: number | null }

/**
 * One week as the site writes it: "10.04.2027 to 17.04.2027", "15.05- 22.05.2027", "3. - 10.10", "31.10 - 7.11",
 * "3.10 - 10.10.2026". A missing start month is the end month; years may be missing (resolved by the caller).
 */
export function parseSkRange(text: string): SkRange | null {
  const m = text.replace(/[–—]/g, '-').match(/(\d{1,2})\.(?:(\d{1,2})\.?)?(?:(20\d{2}))?\s*(?:-|to)\s*(\d{1,2})\.(\d{1,2})\.?(20\d{2})?/);
  if (!m) return null;
  const d2 = +m[4], m2 = +m[5];
  const m1 = m[2] ? +m[2] : m2;
  const r = { d1: +m[1], m1, y1: m[3] ? +m[3] : null, d2, m2, y2: m[6] ? +m[6] : null };
  if (r.m1 < 1 || r.m1 > 12 || r.m2 < 1 || r.m2 > 12 || r.d1 < 1 || r.d1 > 31 || r.d2 < 1 || r.d2 > 31) return null;
  return r;
}

/** Start/end ISO dates of a range once a year is known (end in the next year when it rolls over New Year). */
function resolve(r: SkRange, year: number): { start: string; end: string } {
  const y1 = r.y1 ?? (r.y2 !== null ? (r.m2 < r.m1 ? r.y2 - 1 : r.y2) : year);
  const y2 = r.y2 ?? (r.m2 < r.m1 ? y1 + 1 : y1);
  return { start: iso(y1, r.m1, r.d1), end: iso(y2, r.m2, r.d2) };
}

/** Dated weeks of one camp on the request form ("I want to go to Egypt in this week:"), keyed "d.m" of the start. */
export function parseSkFormWeeks(html: string, camp: string): Map<string, { start: string; end: string }> {
  const out = new Map<string, { start: string; end: string }>();
  const root = parse(html);
  const field = root.querySelectorAll('input[type="checkbox"]').filter(i => (i.getAttribute('name') ?? '').toLowerCase() === `dates${camp.toLowerCase()}[]`);
  for (const i of field) {
    const r = parseSkRange(i.getAttribute('value') ?? '');
    if (!r || (r.y1 === null && r.y2 === null)) continue;
    out.set(`${r.d1}.${r.m1}`, resolve(r, 0));
  }
  return out;
}

/** A year the page states for its season ("in the fall of 2026"); fallback for year-less rows. */
export function pageSeasonYear(text: string): number | null {
  const m = text.match(/\b(?:fall|autumn|spring|summer|winter)\s+(?:of\s+)?(20\d{2})\b/i);
  return m ? +m[1] : null;
}

// --- status table -----------------------------------------------------------------------------------------------------
export interface SkWeek { start: string; end: string; raw: string; status: string }

/**
 * The "Current status:" table (week | status). Year-less rows take the year from the request form's matching week,
 * else from the page's own season year; a row whose year cannot be resolved is returned in `unresolved`.
 */
export function parseSkStatus(html: string, formWeeks: Map<string, { start: string; end: string }>): { weeks: SkWeek[]; unresolved: string[] } {
  const root = visible(html);
  const pageYear = pageSeasonYear(txt(root));
  const weeks: SkWeek[] = [];
  const unresolved: string[] = [];
  for (const table of root.querySelectorAll('.table__container table')) {
    for (const tr of table.querySelectorAll('tr')) {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 2) continue;
      const raw = txt(tds[0]);
      const r = parseSkRange(raw);
      if (!r) continue;
      let dates: { start: string; end: string } | null = null;
      if (r.y1 !== null || r.y2 !== null) dates = resolve(r, 0);
      else if (formWeeks.has(`${r.d1}.${r.m1}`)) dates = formWeeks.get(`${r.d1}.${r.m1}`)!;
      else if (pageYear) dates = resolve(r, pageYear);
      if (!dates) { unresolved.push(raw); continue; }
      if (weeks.some(w => w.start === dates!.start)) continue;
      weeks.push({ ...dates, raw, status: txt(tds[1]) });
    }
  }
  return { weeks, unresolved };
}

export function skAvailability(status: string): { availability: Availability; text: string } {
  const s = status.trim();
  if (/fully booked|sold out|ausgebucht|complet/i.test(s)) return { availability: 'sold_out', text: s };
  if (/^confirmed/i.test(s)) return { availability: 'on_request', text: `${s} (camp runs; booking by request form, confirmed by Swiss Kitesurf)` };
  if (/not yet confirmed/i.test(s)) return { availability: 'on_request', text: `${s} (runs from 3 students; booking by request form)` };
  return { availability: availabilityFromText(s) ?? 'on_request', text: s || 'Booking by request form' };
}

// --- packages ---------------------------------------------------------------------------------------------------------
export interface SkVariant { key: string; unit: string; price: number; occupancy: number; note: string }

const chf = (s: string): number | null => {
  const n = Number(s.replace(/['’\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Short label for a price block from its heading. */
function blockLabel(h3: string): string {
  if (/need equipment|rent/i.test(h3)) return 'Board & lodging + rental gear';
  if (/own equipment|only need a bed/i.test(h3)) return 'Board & lodging only';
  if (/beginner|improve|lesson/i.test(h3)) return 'Lessons package';
  return h3.replace(/[:.]+$/, '');
}

/**
 * Price variants from the .text__wrapper blocks that print CHF:
 *   Egypt  "CHF 1750.- in shared room (only bookable in pairs)" + "+ CHF 300.- single room surcharge"
 *   Sicily "CHF 1700.-" (standard room, alone) + "If you come as a couple or as a pair ... Price per person: CHF 1400.-"
 */
export function parseSkVariants(html: string): SkVariant[] {
  const out: SkVariant[] = [];
  const root = visible(html);
  for (const w of root.querySelectorAll('.text__wrapper')) {
    const t = txt(w);
    if (!/CHF\s*\d/.test(t)) continue;
    const label = blockLabel(txt(w.querySelector('h3')));
    const shared = t.match(/CHF\s*([\d'’]+)\.?-?\s*in shared room/i);
    const surcharge = t.match(/CHF\s*([\d'’]+)\.?-?\s*single room surcharge/i);
    const couple = t.match(/couple or as a pair[\s\S]*?CHF\s*([\d'’]+)/i);
    if (shared && chf(shared[1])) {
      const p = chf(shared[1])!;
      out.push({ key: keyPart(`${label} shared`), unit: `${label}, shared double room`, price: p, occupancy: 2, note: 'shared room, only bookable in pairs' });
      if (surcharge && chf(surcharge[1])) {
        out.push({ key: keyPart(`${label} single`), unit: `${label}, single room`, price: p + chf(surcharge[1])!, occupancy: 1, note: `CHF ${p} + CHF ${chf(surcharge[1])} single room surcharge` });
      }
      continue;
    }
    const first = t.match(/CHF\s*([\d'’]+)/);
    if (first && chf(first[1]) && !(couple && first.index! > t.search(/couple or as a pair/i))) {
      out.push({ key: keyPart(`${label} standard room`), unit: `${label}, standard room (1 person)`, price: chf(first[1])!, occupancy: 1, note: 'standard room with double bed, one person' });
    }
    if (couple && chf(couple[1])) {
      out.push({ key: keyPart(`${label} couple`), unit: `${label}, double room (couple / pair)`, price: chf(couple[1])!, occupancy: 2, note: 'per person when two share the standard double room' });
    }
  }
  const seen = new Set<string>();
  return out.filter(v => (seen.has(v.key) ? false : (seen.add(v.key), true)));
}

export function buildSkSlots(weeks: SkWeek[], variants: SkVariant[], today: string): Slot[] {
  const slots: Slot[] = [];
  for (const w of weeks) {
    if (w.start < today) continue;
    const a = skAvailability(w.status);
    for (const v of variants) {
      slots.push({
        key: `${v.key}|${w.start}`,
        startDate: w.start,
        endDate: w.end,
        unit: v.unit,
        price: v.price,
        currency: 'CHF',
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: v.occupancy,
        availability: a.availability,
        availabilityText: `${a.text}; CHF ${v.price} per person (${v.note})`,
        spotsLeft: null,
      });
    }
  }
  return slots;
}

export interface SkCampPages { camp: string; request: string }

/** Slots of one camp page ("Sicily" / "Egypt" = the request form's field suffix). */
export function parseSkSlots(p: SkCampPages, camp: string, today: string): { slots: Slot[]; weeks: SkWeek[]; unresolved: string[]; variants: SkVariant[] } {
  const { weeks, unresolved } = parseSkStatus(p.camp, parseSkFormWeeks(p.request, camp));
  const variants = parseSkVariants(p.camp);
  return { slots: buildSkSlots(weeks, variants, today), weeks, unresolved, variants };
}

export async function fetchSkSlots(campUrl: string, camp: string, ctx: FetchContext, today = todayIso()): Promise<Slot[]> {
  const pages = { camp: await skPage(campUrl), request: await skPage(SK_REQUEST_URL) };
  const r = parseSkSlots(pages, camp, today);
  if (r.weeks.length === 0) throw new Error(`swiss-kitesurf ${camp}: no rows in the "Current status" table (layout changed?)`);
  if (r.variants.length === 0) throw new Error(`swiss-kitesurf ${camp}: no CHF price blocks found (layout changed?)`);
  if (r.unresolved.length) ctx.note(`status rows without a resolvable year (skipped): ${r.unresolved.join('; ')}`);
  const past = r.weeks.filter(w => w.start < today);
  if (past.length) ctx.note(`${past.length} past week(s) dropped: ${past.map(w => w.start).join(', ')}`);
  if (r.slots.length === 0) ctx.note(`all listed ${camp} weeks are past; no new dates printed yet`);
  return r.slots;
}

// --- content helpers --------------------------------------------------------------------------------------------------
/** Items of the list right after the paragraph that contains `label` ("This is included", "Not included"). */
export function skListAfter(html: string, label: RegExp): string[] {
  const root = visible(html);
  const p = root.querySelectorAll('p').find(x => label.test(txt(x)));
  if (!p) return [];
  let el = p.nextElementSibling;
  while (el && el.tagName !== 'UL') {
    if (el.tagName === 'P' && /[✨✈]/.test(el.text)) return [];
    el = el.nextElementSibling;
  }
  return el ? el.querySelectorAll('li').map(li => txt(li)).filter(Boolean) : [];
}

/** og:image + the gallery originals (a.galerie__link); team portraits are not offer photos. */
export function skImages(html: string, url: string): string[] {
  const root = parse(html);
  const og = root.querySelector('meta[property="og:image"]')?.getAttribute('content');
  const gallery = root.querySelectorAll('a.galerie__link').map(a => a.getAttribute('href') ?? '').filter(Boolean);
  const out: string[] = [];
  for (const u of [og, ...gallery]) {
    if (!u) continue;
    const abs = new URL(u, url).toString();
    if (/teambilder|profil/i.test(abs)) continue;
    if (!out.includes(abs)) out.push(abs);
  }
  return out;
}

export function skNights(text: string): number | null {
  const m = text.match(/Accommodation:?\s*(\d{1,2})\s*nights/i);
  return m ? +m[1] : null;
}

export function skWeeksSummary(weeks: SkWeek[], today: string): string {
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const future = weeks.filter(w => w.start >= today);
  if (future.length === 0) {
    const years = [...new Set(weeks.map(w => w.start.slice(0, 4)))].join('/');
    return `Runs every year; the next dates are not published yet (${years}: ${weeks.map(w => fmt(w.start)).join(', ')}).`;
  }
  const y = [...new Set(future.map(w => w.start.slice(0, 4)))].join('/');
  return `Camp weeks ${y}: ${future.map(w => `${fmt(w.start)} - ${fmt(w.end)}`).join(', ')}.`;
}

// --- Sicily -----------------------------------------------------------------------------------------------------------
export function parseSkSicilyContent(p: SkCampPages, today = todayIso()): OfferContent {
  const root = visible(p.camp);
  const text = txt(root.querySelector('main') ?? root);
  const included = skListAfter(p.camp, /This is included/i);
  const excluded = skListAfter(p.camp, /Not included/i);
  const nights = skNights(text) ?? 7;
  const { weeks } = parseSkStatus(p.camp, parseSkFormWeeks(p.request, 'Sicily'));
  const variants = parseSkVariants(p.camp);
  const single = variants.find(v => v.occupancy === 1);
  const pair = variants.find(v => v.occupancy === 2);
  const summary = [
    `Swiss Kitesurf, the kite school from Silvaplana, runs spring camp weeks at Lo Stagnone in western Sicily, the large shallow flat-water lagoon near Marsala.`,
    `A week includes ${nights} nights in a single or double room directly at the kite spot with breakfast, 6 days of semi-private lessons in German or English (VDWS theory, video analysis), level-adapted kite gear and the spot fee; flights and the transfer from Palermo are not included.`,
    `${single ? `CHF ${single.price} per person alone in a standard double room` : ''}${single && pair ? ', ' : ''}${pair ? `CHF ${pair.price} per person for a couple or pair sharing` : ''}${single || pair ? '. ' : ''}A camp runs from 3 students; booking is by request.`,
    skWeeksSummary(weeks, today),
  ].join(' ');
  return {
    kind: 'camp',
    title: 'Swiss Kitesurf Kite Camp Sicily, Lo Stagnone',
    summary,
    continent: 'Europe',
    country: 'Italy',
    region: 'Lo Stagnone, Sicily',
    spot: 'Lo Stagnone',
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: included,
    optionalServices: ['Transfer from Palermo airport (organised on request)'],
    accommodation: 'single or double rooms directly at the kite spot (Birgi Vecchi)',
    mealPlan: 'breakfast',
    languages: ['de', 'en'],
    rooms: [],
    imageUrls: skImages(p.camp, SK_SICILY_URL),
    heroVideoUrl: null,
    sourceUrl: SK_SICILY_URL,
    bookingUrl: SK_REQUEST_URL,
    sourceText: [
      `camp page: ${text}`,
      `not included: ${excluded.join(' | ')}`,
      `parsed weeks: ${weeks.map(w => `${w.start}..${w.end} ${w.status}`).join('; ')}`,
      `parsed variants: ${variants.map(v => `${v.unit} CHF ${v.price}`).join('; ')}`,
    ].join('\n'),
  };
}

export const swissKitesurfCampLoStagnone: OfferAdapter = {
  key: 'swiss-kitesurf-camp-lo-stagnone',
  name: 'Swiss Kitesurf Kite Camp Sicily, Lo Stagnone',
  kind: 'camp',
  operator: SK_OPERATOR,
  url: SK_SICILY_URL,
  slotMethod: 'html_dates',
  fetchBudget: 4,
  async fetchContent() {
    return parseSkSicilyContent({ camp: await skPage(SK_SICILY_URL), request: await skPage(SK_REQUEST_URL) });
  },
  fetchSlots: ctx => fetchSkSlots(SK_SICILY_URL, 'Sicily', ctx),
};
