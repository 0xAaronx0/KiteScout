// ---------------------------------------------------------------------------
// Global Kite Trips - All-inclusive Progression Camp, Cumbuco (Ceará, Brazil). Antoine (coach) and Lara (yoga)
// host small-group camps at Casa Dias de Vento: 11-day camps (or an 8-day part of one) with daily coaching and video
// analysis or beginner lessons, three meals a day, yoga, downwinders to Cauípe / Taíba, airport transfers.
// Kind 'camp'. Also home of the shared Global Kite Trips helpers (the Colombia safari imports them).
//
// Data path (checked 2026-10-19), WordPress + Elementor + Slider Revolution:
//   dates    the camp page prints the sessions "Oct 24th - 3rd 2026" and "Nov 14th - 24th 2026" (hero slider and
//            "Upcoming Trips" menu); the hero slider's title layer says "SOLD OUT" for the camp (one headline above
//            both sessions, so both sessions are sold out per the provider; the request form still lists them).
//            /booking/ (the request form) names the 8-day options: "8 days - Nov 14th - 21th", "8 days - Oct 31th -
//            3rd" (the October one is 4 days as printed, so that slot keeps the session window + packageNights 7).
//   prices   only in the page's "Booking Options" picture (wp-content/uploads/2026/04/Untitled-3.jpeg, also split
//            into Promo-Rectangular-Posts-1/-2), read by hand 2026-10-19: Independent riders (advanced coaching)
//            11 days USD 2,350 shared / 2,750 private, 8 days 2,250 / 2,550; Beginners 11 days 2,050 / 2,450,
//            8 days 1,850 / 2,250; per person ("1 person in shared/private room"); beginner lessons 6 h USD 400,
//            12 h USD 730; non-kiting companion USD 1,750. Currency printed as "$2.350 USD". The constants are
//            released only while the page still links the same picture files (liveness guard).
//   booking  request form + USD 1,000 deposit after confirmation (form page) -> instantBooking false.
// robots.txt (2026-10-19): Yoast block, "Disallow:" (empty) -> everything allowed.
// Requests per run: 2 (camp page + /booking/, memoised across content + slots).
// Slots: session x track (independent / beginner) x room (shared / private) x length (11 / 8 days); key
//   `<track>-<room>-<days>d|<session start>`; USD per person (package). Past sessions are dropped.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, daysInclusive, htmlToText, imageCandidates, iso, monthOf, todayIso } from '../parse.js';
import type { Availability, OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';

export const GKT_SITE = 'https://www.globalkitetrips.com';
export const GKT_CUMBUCO_URL = `${GKT_SITE}/cumbuco-brazil-2026-oct-24th-nov-3rd/`;
export const GKT_BOOKING_URL = `${GKT_SITE}/booking/`;

export const GKT_OPERATOR: OperatorRef = {
  name: 'Global Kite Trips',
  websiteUrl: GKT_SITE,
  rootDomain: 'globalkitetrips.com',
};

// --- shared helpers -----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
export function gktPage(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Page text without the site menu / footer repeats (they list every trip's dates). */
export function gktText(html: string): string {
  return collapse(htmlToText(html)).replace(/[–—]/g, '-');
}

export interface GktSession { start: string; end: string; label: string }

/**
 * Dated sessions like "Oct 24th - 3rd 2026", "Nov 14 - 24th 2026", "March 7th - 16th 2027", "Feb 27th - Mar 8th 2027".
 * An end day below the start day rolls into the next month. Deduplicated by start date, sorted.
 */
export function parseGktSessions(text: string): GktSession[] {
  const out = new Map<string, GktSession>();
  const re = /\b([A-Z][a-z]{2,8})\.? (\d{1,2})(?:st|nd|rd|th)?\s*-\s*(?:([A-Z][a-z]{2,8})\.? )?(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/g;
  for (const m of text.matchAll(re)) {
    const m1 = monthOf(m[1]);
    if (!m1) continue;
    const y = Number(m[5]);
    const d1 = Number(m[2]); const d2 = Number(m[4]);
    let m2 = m[3] ? monthOf(m[3]) : m1;
    if (!m2) continue;
    if (!m[3] && d2 < d1) m2 = m1 + 1;
    const start = iso(y, m1, d1);
    const end = m2 > 12 ? iso(y + 1, m2 - 12, d2) : iso(m2 < m1 ? y + 1 : y, m2, d2);
    if (!out.has(start)) out.set(start, { start, end, label: m[0].trim() });
  }
  return [...out.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/** The request form's options: "8 days - Nov 14th - 21th Cumbuco progression camp" -> { days, month, from, to }. */
export function parseGktFormOptions(bookingHtml: string): Array<{ days: number; month: number; from: number; to: number; label: string }> {
  const t = gktText(bookingHtml);
  const out: Array<{ days: number; month: number; from: number; to: number; label: string }> = [];
  for (const m of t.matchAll(/(\d{1,2}) days - ([A-Z][a-z]{2,8})\.? (\d{1,2})(?:st|nd|rd|th)? - (\d{1,2})(?:st|nd|rd|th)? Cumbuco/g)) {
    const mo = monthOf(m[2]);
    if (mo) out.push({ days: Number(m[1]), month: mo, from: Number(m[3]), to: Number(m[4]), label: m[0].replace(/ Cumbuco$/, '') });
  }
  return out;
}

const addDays = (d: string, n: number): string => {
  const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10);
};

// --- Cumbuco camp ---------------------------------------------------------------------------------
/** Hand-read from the "Booking Options" picture (2026-10-19); USD per person. */
const PRICE_IMAGES = ['/2026/04/Untitled-3', '/2026/04/Promo-Rectangular-Posts-1', '/2026/04/Promo-Rectangular-Posts-2'];
export const GKT_CUMBUCO_PRICES: Array<{ track: 'independent' | 'beginner'; room: 'shared' | 'private'; days: 11 | 8; price: number }> = [
  { track: 'independent', room: 'shared', days: 11, price: 2350 },
  { track: 'independent', room: 'private', days: 11, price: 2750 },
  { track: 'independent', room: 'shared', days: 8, price: 2250 },
  { track: 'independent', room: 'private', days: 8, price: 2550 },
  { track: 'beginner', room: 'shared', days: 11, price: 2050 },
  { track: 'beginner', room: 'private', days: 11, price: 2450 },
  { track: 'beginner', room: 'shared', days: 8, price: 1850 },
  { track: 'beginner', room: 'private', days: 8, price: 2250 },
];
const COMPANION_USD = 1750;
const LESSONS_USD = { h6: 400, h12: 730 };

export interface GktCamp { sessions: GktSession[]; soldOut: boolean; pricesLinked: boolean }

export function parseGktCamp(html: string): GktCamp {
  const t = gktText(html);
  // the page body after the menu: the menu repeats "Cumbuco, Brazil 2026 Oct 24th Nov 3rd ..." without a year per range
  const sessions = parseGktSessions(t);
  const slider = [...html.matchAll(/<rs-layer[^>]*>([\s\S]*?)<\/rs-layer>/g)].map(m => collapse(m[1].replace(/<[^>]+>/g, ' ')));
  const soldOut = slider.some(s => /^sold out$/i.test(s.trim())) || /\bSOLD OUT\b/.test(t);
  const pricesLinked = PRICE_IMAGES.some(p => html.includes(p));
  return { sessions, soldOut, pricesLinked };
}

const TRACK_UNIT = { independent: 'Independent rider (advanced coaching)', beginner: 'Beginner' } as const;

export function buildGktCampSlots(c: GktCamp, form: ReturnType<typeof parseGktFormOptions>, today: string): Slot[] {
  const out: Slot[] = [];
  const availability: Availability = c.soldOut ? 'sold_out' : 'on_request';
  for (const s of c.sessions.filter(x => x.start >= today && daysInclusive(x.start, x.end) >= 8)) {
    const year = Number(s.start.slice(0, 4));
    for (const p of GKT_CUMBUCO_PRICES) {
      let start = s.start; let end = s.end; let packageNights: number | null = null; let label = s.label;
      if (p.days === 8) {
        const opt = form.find(o => o.days === 8 && iso(year, o.month, o.from) >= s.start && iso(year, o.month, o.from) <= s.end);
        const oStart = opt ? iso(year, opt.month, opt.from) : null;
        const oEnd = opt ? (opt.to >= opt.from ? iso(year, opt.month, opt.to) : (opt.month === 12 ? iso(year + 1, 1, opt.to) : iso(year, opt.month + 1, opt.to))) : null;
        if (opt && oStart && oEnd && daysInclusive(oStart, oEnd) === 8) { start = oStart; end = oEnd; label = opt.label; }
        else packageNights = 7;   // 8 days somewhere in the session; the form's dates are missing or inconsistent
      }
      out.push({
        key: `${p.track}-${p.room}-${p.days}d|${s.start}`,
        startDate: start,
        endDate: end,
        unit: `${TRACK_UNIT[p.track]}, ${p.room} room, ${p.days} days`,
        price: c.pricesLinked ? p.price : null,
        currency: c.pricesLinked ? 'USD' : null,
        priceUnit: c.pricesLinked ? 'package' : null,
        priceBasis: c.pricesLinked ? 'person' : null,
        occupancy: 1,
        availability,
        availabilityText: [c.soldOut ? 'SOLD OUT (camp headline)' : null, `${label}${packageNights ? ' (8-day part of the session)' : ''}`].filter(Boolean).join(' · '),
        spotsLeft: null,
        packageNights,
      });
    }
  }
  return out;
}

export function parseGktCumbucoContent(html: string, today = todayIso()): OfferContent {
  const t = gktText(html);
  const c = parseGktCamp(html);
  const next = c.sessions.filter(s => s.start >= today);
  const human = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const datesLine = next.length
    ? `Camp dates: ${next.map(s => `${human(s.start)} to ${human(s.end)}`).join(' and ')}${c.soldOut ? ' (the provider marks the camp sold out)' : ''}.`
    : `Runs every year; the next dates are not published yet${c.sessions.length ? ` (${c.sessions[0].start.slice(0, 4)}: ${c.sessions.map(s => human(s.start).replace(/ \d{4}$/, '')).join(' and ')})` : ''}.`;
  const imgs = imageCandidates(html, GKT_CUMBUCO_URL, null, 40)
    .filter(u => !/dummy\.png|Untitled-3|Promo-Rectangular|logo/i.test(u));

  return {
    kind: 'camp',
    title: 'Global Kite Trips All-Inclusive Progression Camp Cumbuco',
    summary: [
      'A small-group kite camp in Cumbuco (Ceará, Brazil) run by coach Antoine and yoga teacher Lara: 11 days (or an 8-day part) at Casa Dias de Vento, a house with pool a few meters from the beach, with three meals a day, daily yoga, guided downwinders to the Cauípe and Taíba lagoons, photos and airport transfers.',
      'Independent riders get daily coaching with video analysis; beginners can add private lessons with all equipment.',
      `${datesLine} Prices from USD 1,850 (beginner, 8 days, shared room) to USD 2,750 per person.`,
    ].join(' '),
    continent: 'South America',
    country: 'Brazil',
    region: 'Ceará',
    spot: 'Cumbuco',
    itinerarySpots: [],
    durationDays: 11,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: null,
    beginnerFriendly: true,
    includedServices: [
      'Accommodation at Casa Dias de Vento (shared or private room, private bathrooms)',
      '3 meals a day (breakfast at home, dinners at local restaurants)',
      'Daily kite coaching with video analysis and guided downwinders (independent riders)',
      'Daily yoga, photos and videos',
      'Airport transfers (Fortaleza) and transport to the spots',
    ],
    optionalServices: [
      `Beginner private lessons with equipment: 6 h USD ${LESSONS_USD.h6}, 12 h USD ${LESSONS_USD.h12}`,
      `Non-kiting companion: USD ${COMPANION_USD.toLocaleString('en-US')}`,
    ],
    accommodation: 'kite house with pool (Casa Dias de Vento), shared or private room',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: [],
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: GKT_CUMBUCO_URL,
    bookingUrl: GKT_BOOKING_URL,
    sourceText: [
      `camp: ${t}`,
      `parsed: sessions ${c.sessions.map(s => `${s.start}..${s.end}`).join(', ')}; sold out ${c.soldOut}; price picture linked ${c.pricesLinked}`,
    ].join('\n'),
  };
}

export async function fetchGktCumbucoSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const c = parseGktCamp(await gktPage(GKT_CUMBUCO_URL));
  if (c.sessions.length === 0) throw new Error('global-kite-trips cumbuco: no dated session ("Oct 24th - 3rd 2026") found (layout changed?)');
  const form = parseGktFormOptions(await gktPage(GKT_BOOKING_URL));
  if (!c.pricesLinked) ctx?.note('the "Booking Options" price picture changed; prices withheld until the constants are re-read');
  const slots = buildGktCampSlots(c, form, today);
  if (slots.length === 0) ctx?.note(`all sessions are past (${c.sessions.map(s => s.start).join(', ')}); next dates not published yet`);
  return slots;
}

export const globalKiteTripsProgressionCampCumbuco: OfferAdapter = {
  key: 'global-kite-trips-progression-camp-cumbuco',
  name: 'Global Kite Trips Progression Camp, Cumbuco',
  kind: 'camp',
  operator: GKT_OPERATOR,
  url: GKT_CUMBUCO_URL,
  slotMethod: 'html_dates',
  liveAvailability: false,
  instantBooking: false,
  confidence: 'medium',
  fetchBudget: 3,
  async fetchContent() { return parseGktCumbucoContent(await gktPage(GKT_CUMBUCO_URL)); },
  fetchSlots: ctx => fetchGktCumbucoSlots(todayIso(), ctx),
};
