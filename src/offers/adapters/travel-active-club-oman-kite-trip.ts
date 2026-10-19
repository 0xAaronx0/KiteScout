// ---------------------------------------------------------------------------
// Travel Active Club - Oman kite road trip (tour): 8 nights / 9 days with a 4x4 from Muscat airport to the Ras al Hadd
// lagoon (1 night), by ferry to Masirah Island (4 nights, hotel, double room; several flat and wave spots), then off-road
// to the remote lagoon camp at Bar al Hikman (full board) and back to Muscat. Daily morning yoga, 1.5 h of advanced kite
// coaching in small groups with video analysis, guided 4x4 throughout, ferry tickets, airport transfers. Not included:
// kite equipment, beginner or individual lessons, flights, meals on Masirah. Travel Active Club runs small-group kite +
// yoga trips (Brazil, Kenya, Los Roques, Egypt, Sicily, Madagascar, Oman); contact via a UAE WhatsApp number.
//
// Data path (checked 2026-10-19): Wix site, server-rendered text. The page slugs do not match their menu labels:
//   /copy-of-brazil-1-1 is "Oman 18-26 July 2026" (this trip), /copy-of-oman-18-26-july-2026 is "Madagascar - June 2026"
//   (travel-active-club-madagascar-kite-trip.ts), so the adapters pin the slugs, not the labels.
//   Shared parser (parseTacTrip, also used by the Madagascar adapter): <title> ("Oman 18-26 July 2026 | Travel Active
//   Club") gives the year; date heading lines before the first "Plan of the Trip" ("18-26 July", "20-28 June",
//   "28 June - 6 July", optionally with a year) become departures; "8 nights /9 days" / "9 days (8nights)" gives the
//   length; "Price per person in double room 2230 euros" lines give one price per room type; the "What is included" /
//   "What is not included" blocks are read as lists. Booking: "Book Now" button without a booking engine, contact by
//   e-mail / WhatsApp -> on_request.
//   State 2026-10-19: the only departure (18-26 July 2026) is past -> 0 slots ("price on request"); the summary says the
//   next dates are not published yet. A new dated heading on the page (or a new year in the title) produces slots again.
// robots.txt www.travelactiveclub.com (2026-10-19): Wix default ("*?lightbox=" disallowed only).
// Requests per run: 1 (content + slots share one memoised page fetch). Fixture trimmed to markup (scripts dropped).
// Slots: one per future departure x room line, EUR per person ("Price per person in double room"), priceUnit 'package'.
// Known limits: the Wix business location of the site is the operator's Dubai base, not used as a pin; the
//   Bar al Hikman night count is inferred (8 nights - 1 Ras al Hadd - 4 Masirah = 3), the page does not print it.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, parseAmount, parseRange } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';
import { kfImages, kfLines } from './kitefreedom-santa-fe-bantayan.js';

export const TAC_SITE = 'https://www.travelactiveclub.com';
export const TAC_OMAN_URL = `${TAC_SITE}/copy-of-brazil-1-1`;

export const TAC_OPERATOR = {
  name: 'Travel Active Club',
  websiteUrl: `${TAC_SITE}/`,
  rootDomain: 'travelactiveclub.com',
  contactEmail: 'szadejko.ilona@gmail.com', // the booking contact printed on every trip page
  whatsapp: '+971527924805',
  phone: '+971527924805',
};

const memo = new Map<string, { at: number; p: Promise<string> }>();
export function tacPage(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

// --- shared trip-page parser ------------------------------------------------------------------------
export interface TacDeparture { start: string; end: string; label: string }
export interface TacPrice { room: string; key: string; amount: number; currency: string }
export interface TacTrip {
  title: string | null;
  year: number | null;
  departures: TacDeparture[];
  days: number | null;
  nights: number | null;
  prices: TacPrice[];
  included: string[];
  excluded: string[];
  lines: string[];
}

const DATE_LINE = /^(\d{1,2})(?:st|nd|rd|th)?\s*(?:[A-Za-z]+\s*)?[-–]\s*(\d{1,2})(?:st|nd|rd|th)?\s+[A-Za-z]+(?:\s+20\d{2})?$/;

/** Lines of one titled block: after the LAST occurrence of `head` (the tab bar repeats the headings) up to `stop`. */
function block(lines: string[], head: RegExp, stop: RegExp): string[] {
  const i = lines.map((l, k) => (head.test(l) ? k : -1)).filter(k => k >= 0).pop();
  if (i === undefined) return [];
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (stop.test(l)) break;
    out.push(l);
  }
  return out;
}

export function parseTacTrip(html: string): TacTrip {
  const title = clean(html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '').replace(/\s*\|\s*Travel Active Club\s*$/i, '') || null;
  const year = Number(title?.match(/\b(20\d{2})\b/)?.[1]) || null;
  const lines = kfLines(html).map(l => l.replace(/[–—]/g, '-').trim()).filter(l => l && l !== '​');
  const planIdx = lines.findIndex(l => /^Plan of the Trip$/i.test(l));
  const head = planIdx > 0 ? lines.slice(0, planIdx) : lines;
  const departures: TacDeparture[] = [];
  for (const l of head) {
    if (!DATE_LINE.test(l)) continue;
    const ly = Number(l.match(/\b(20\d{2})\b/)?.[1]) || year;
    if (!ly) continue;
    const r = parseRange(l.replace(/(\d)(st|nd|rd|th)\b/g, '$1'), ly);
    if (r && !departures.some(d => d.start === r.start)) departures.push({ ...r, label: `${l}${/\b20\d{2}\b/.test(l) ? '' : ` ${ly}`}` });
  }
  const all = lines.join(' ');
  const dn = all.match(/(\d+)\s*nights?\s*\/\s*(\d+)\s*days/i);
  const dn2 = all.match(/(\d+)\s*days\s*\(\s*(\d+)\s*nights?\s*\)/i);
  const prices: TacPrice[] = [];
  for (const l of lines) {
    const m = l.match(/^Price per person in\s+(.+?)\s+(\d[\d.,]*)\s*(euros?|€|EUR|USD|\$)\s*$/i);
    if (!m) continue;
    const amount = parseAmount(m[2]);
    const room = m[1].replace(/\s*,\s*/g, ', ').trim();
    const key = /single/i.test(room) ? 'single' : /double|shared|twin/i.test(room) ? 'double' : room.toLowerCase().replace(/[^a-z]+/g, '-');
    const currency = /eur|€/i.test(m[3]) ? 'EUR' : 'USD';
    if (amount && !prices.some(p => p.key === key)) prices.push({ room, key, amount, currency });
  }
  const stopRe = /^(What is not included|Price|Book Now|Get in Touch|Plan of the Trip|Spot and wind conditions)$/i;
  return {
    title,
    year,
    departures,
    days: dn ? Number(dn[2]) : dn2 ? Number(dn2[1]) : null,
    nights: dn ? Number(dn[1]) : dn2 ? Number(dn2[2]) : null,
    prices,
    included: block(lines, /^What is included$/i, stopRe),
    excluded: block(lines, /^What is not included$/i, stopRe),
    lines,
  };
}

export function buildTacSlots(t: TacTrip, today: string): Slot[] {
  const out: Slot[] = [];
  for (const d of t.departures.filter(x => x.start >= today)) {
    const rows = t.prices.length ? t.prices : [null];
    for (const p of rows) {
      out.push({
        key: p ? `${p.key}|${d.start}` : d.start,
        startDate: d.start,
        endDate: d.end,
        unit: p ? `Price per person in ${p.room}` : null,
        price: p?.amount ?? null,
        currency: p?.currency ?? null,
        priceUnit: p ? 'package' : null,
        priceBasis: p ? 'person' : null,
        occupancy: p ? (p.key === 'single' ? 1 : 2) : null,
        availability: 'on_request',
        availabilityText: 'Booking by e-mail or WhatsApp (no online booking)',
        spotsLeft: null,
      });
    }
  }
  return out;
}

/** Sentence for the summary: the next departure(s), or that the next dates are not published yet. */
export function tacDatesSentence(t: TacTrip, today: string): string {
  const fmt = (d: TacDeparture) => d.label.replace(/\s*-\s*/, '-');
  const future = t.departures.filter(d => d.start >= today);
  if (future.length) return `Next departure${future.length > 1 ? 's' : ''}: ${future.map(fmt).join(', ')}.`;
  const last = t.departures[t.departures.length - 1];
  return last ? `The next dates are not published yet (last trip: ${fmt(last)}).` : 'Dates are not published yet.';
}

export function tacPriceSentence(t: TacTrip, today: string): string {
  if (!t.prices.length) return 'Price on request.';
  const future = t.departures.some(d => d.start >= today);
  const list = t.prices.map(p => `${p.currency} ${p.amount.toLocaleString('en-US')} in ${p.room}`).join(', ');
  return `${future ? 'Price per person' : `Price per person of the last trip${t.year ? ` (${t.year})` : ''}`}: ${list}; booking by e-mail or WhatsApp.`;
}

export async function fetchTacSlots(url: string, today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const t = parseTacTrip(await tacPage(url));
  if (t.departures.length === 0) throw new Error(`travel-active-club: no dated heading found on ${url} (layout changed?)`);
  const slots = buildTacSlots(t, today);
  if (slots.length === 0) ctx?.note(`all departures are past (${t.departures.map(d => d.start).join(', ')}); next dates not published yet`);
  if (t.prices.length === 0) ctx?.note('no "Price per person in ..." line found');
  return slots;
}

// --- Oman ----------------------------------------------------------------------------------------------
export function parseTacOmanContent(html: string, today: string): OfferContent {
  const t = parseTacTrip(html);
  const summary = [
    `Travel Active Club's ${t.nights ?? 8}-night / ${t.days ?? 9}-day kite road trip through Oman in the summer monsoon season (18-30 knots): from Muscat airport by 4x4 to the Ras al Hadd lagoon, by ferry to Masirah Island for 4 nights of flat-water and wave spots, then off-road to the remote lagoon camp at Bar al Hikman.`,
    `Daily morning yoga and 1.5 hours of advanced kite coaching in small groups with video analysis; hotel on Masirah (double room), full board at the Bar al Hikman camp, ferry tickets and airport transfers are included, kite equipment and meals on Masirah are not.`,
    `${tacDatesSentence(t, today)} ${tacPriceSentence(t, today)}`,
  ].join(' ');
  return {
    kind: 'tour',
    title: 'Travel Active Club Oman Kite Road Trip',
    summary,
    continent: 'Asia',
    country: 'Oman',
    region: 'Al Sharqiyah South',
    spot: 'Muscat',
    itinerarySpots: [
      { name: 'Muscat', country: 'Oman', region: 'Muscat', order: 1 },
      { name: 'Ras al Hadd', country: 'Oman', region: 'Al Sharqiyah South', order: 2 },
      { name: 'Masirah Island', country: 'Oman', region: 'Al Sharqiyah South', order: 3 },
      { name: 'Bar al Hikman', country: 'Oman', region: 'Al Wusta', order: 4 },
    ],
    durationDays: t.days ?? 9,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: true, // advanced coaching; the beginner course is not included
    equipmentRental: false,
    beginnerFriendly: false,
    includedServices: t.included,
    optionalServices: ['Turtle-watching night excursion at Ras al Hadd', 'Extra hotel night near Muscat airport before or after the trip'],
    accommodation: 'hotel on Masirah Island (double room), remote camp at Bar al Hikman',
    mealPlan: 'full board at the Bar al Hikman camp only; meals on Masirah not included',
    languages: ['en'],
    rooms: [],
    imageUrls: kfImages(html),
    heroVideoUrl: null,
    sourceUrl: TAC_OMAN_URL,
    bookingUrl: TAC_OMAN_URL,
    sourceText: t.lines.join('\n'),
  };
}

export const travelActiveClubOmanKiteTrip: OfferAdapter = {
  key: 'travel-active-club-oman-kite-trip',
  name: 'Travel Active Club Oman Kite Road Trip',
  kind: 'tour',
  operator: TAC_OPERATOR,
  url: TAC_OMAN_URL,
  slotMethod: 'html_dates',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() {
    return parseTacOmanContent(await tacPage(TAC_OMAN_URL), new Date().toISOString().slice(0, 10));
  },
  fetchSlots: ctx => fetchTacSlots(TAC_OMAN_URL, new Date().toISOString().slice(0, 10), ctx),
};
