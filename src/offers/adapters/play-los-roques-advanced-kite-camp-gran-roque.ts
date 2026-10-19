// ---------------------------------------------------------------------------
// Play Los Roques - ADVANCED Kite Camps, Gran Roque (Los Roques Archipelago, Venezuela): dated camp weeks for
// independent riders based at Posada Casa Play on Gran Roque, with daily boat kite safaris between the cays,
// certified instructors, rescue boat, all meals and the return flight Caracas - Los Roques. Kind 'camp'. Also home of
// the shared Play Los Roques helpers (the Kitesurfing Discovery package imports them).
//
// Data path (checked 2026-10-19), Wix site (robots.txt: "User-agent: * Allow: /", only "?lightbox=" disallowed):
//   slots    "KITE CAMP 1 - APRIL 14 TO 18, 2026 (4 DAYS / 4 NIGHTS) | Price per person in single occupancy – $1.830 |
//            ... double occupancy – $1.650 | ... triple or quadruple occupancy – $1.570 | Non-kiter option ... – $970",
//            second block "APRIL 27 TO MAY 3, 2026 (6 DAYS / 6 NIGHTS)" $2.580 / $2.310 / $2.190 / non-kiter $1.290.
//            Currency: the page prints only "$"; the site's own Wix settings say "currency":"USD" (and Venezuelan
//            tourism quotes US dollars) -> USD. One slot per future block x room type (single / double / triple-
//            quad), key `<room>|<start>`, per person (package); availability on_request (BOOK NOW / CONTACT US =
//            request by mail or WhatsApp) -> instantBooking false. Non-kiter and extra-night rates are text only.
//   content  the same page; spotCoords = the Wix site's business location (11.84919, -66.75077 = Casa Play,
//            Gran Roque).
// State 2026-10-19: both 2026 camps (14-18 Apr, 27 Apr - 3 May) are past -> 0 slots until the page lists 2027 camps;
//   the parser reads whatever "KITE CAMP n - <dates>, <year>" blocks the page prints.
// Requests per run: 1 (memoised across content + slots).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { imageCandidates, iso, monthOf, parseAmount, todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';
import { wixLines } from './kite-buen-hombre-eco-lodge.js';

export const PLR_SITE = 'https://www.playlosroques.com';
export const PLR_ADVANCED_URL = `${PLR_SITE}/kite-camps-para-avanzados`;

export const PLR_OPERATOR: OperatorRef = {
  name: 'Play Los Roques',
  websiteUrl: PLR_SITE,
  rootDomain: 'playlosroques.com',
  contactEmail: 'info@playlosroques.com',
  whatsapp: '+584123906600',
};

// --- shared helpers -----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
export function plrPage(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
export const plrText = (html: string): string => wixLines(html).join(' | ').replace(/[–—]/g, '-');

/** The Wix site's business location (siteData "latitude"/"longitude"). */
export function plrCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/"latitude":(-?\d+\.\d+),"longitude":(-?\d+\.\d+)/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

/** The site's own currency setting ("currency":"USD"); the pages print only "$". */
export function plrCurrency(html: string): string {
  return html.match(/"currency":"([A-Z]{3})"/)?.[1] ?? 'USD';
}

export const PLR_REGION = 'Los Roques Archipelago';

// --- ADVANCED camps ---------------------------------------------------------------------------------
type Room = 'single' | 'double' | 'triple';
export interface PlrCamp { start: string; end: string; days: number; nights: number; label: string; prices: Partial<Record<Room, number>>; nonKiter: number | null }

export function parsePlrCamps(html: string): PlrCamp[] {
  const t = plrText(html);
  const out: PlrCamp[] = [];
  const re = /KITE CAMP \d+\s*-\s*([A-Z]+)\s+(\d{1,2})\s+TO\s+(?:([A-Z]+)\s+)?(\d{1,2}),?\s+(20\d{2})\s*\((\d+)\s*DAYS?\s*\/\s*(\d+)\s*NIGHTS?\)/gi;
  const heads = [...t.matchAll(re)];
  heads.forEach((m, i) => {
    const m1 = monthOf(m[1].toLowerCase());
    const m2 = m[3] ? monthOf(m[3].toLowerCase()) : m1;
    if (!m1 || !m2) return;
    const y = Number(m[5]);
    const start = iso(y, m1, +m[2]);
    const end = iso(m2 < m1 ? y + 1 : y, m2, +m[4]);
    const from = (m.index ?? 0) + m[0].length;
    const extra = t.slice(from).search(/EXTRA NIGHT/i);
    const to = heads[i + 1]?.index ?? (extra >= 0 ? from + extra : t.length);
    const block = t.slice(from, to);
    const price = (re2: RegExp) => { const x = block.match(re2); return x ? parseAmount(x[1]) : null; };
    const prices: Partial<Record<Room, number>> = {};
    const s = price(/single occupancy\s*-\s*\$\s?([\d.,]+)/i); if (s) prices.single = s;
    const d = price(/double occupancy\s*-\s*\$\s?([\d.,]+)/i); if (d) prices.double = d;
    const tr = price(/triple(?: or quadruple)? occupancy\s*-\s*\$\s?([\d.,]+)/i); if (tr) prices.triple = tr;
    out.push({ start, end, days: +m[6], nights: +m[7], label: m[0].trim(), prices, nonKiter: price(/Non-kiter[^$]*\$\s?([\d.,]+)/i) });
  });
  return out;
}

const ROOMS: Array<{ room: Room; unit: string; occ: number }> = [
  { room: 'single', unit: 'Single occupancy', occ: 1 },
  { room: 'double', unit: 'Double occupancy', occ: 2 },
  { room: 'triple', unit: 'Triple or quadruple occupancy', occ: 3 },
];

export function buildPlrCampSlots(camps: PlrCamp[], currency: string, today: string): Slot[] {
  const out: Slot[] = [];
  for (const c of camps.filter(x => x.start >= today)) {
    for (const r of ROOMS) {
      const price = c.prices[r.room];
      if (!price) continue;
      out.push({
        key: `${r.room}|${c.start}`,
        startDate: c.start,
        endDate: c.end,
        unit: `${r.unit}, ${c.nights} nights`,
        price,
        currency,
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: r.occ,
        availability: 'on_request',
        availabilityText: `${c.label.replace(/\s+/g, ' ')}${c.nonKiter ? `; non-kiter ${currency} ${c.nonKiter}` : ''}`,
        spotsLeft: null,
      });
    }
  }
  return out;
}

export function parsePlrAdvancedContent(html: string, today = todayIso()): OfferContent {
  const t = plrText(html);
  const camps = parsePlrCamps(html);
  const cur = plrCurrency(html);
  const next = camps.filter(c => c.start >= today);
  const human = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const all = camps.flatMap(c => Object.values(c.prices)).filter((x): x is number => !!x);
  const yearOf = camps[0]?.start.slice(0, 4);
  const datesLine = next.length
    ? `Camp dates: ${next.map(c => `${human(c.start)} to ${human(c.end)} ${c.start.slice(0, 4)} (${c.nights} nights)`).join(', ')}.`
    : `The ${yearOf ? Number(yearOf) + 1 : 'next'} dates are not published yet${camps.length ? ` (${yearOf}: ${camps.map(c => `${human(c.start)} to ${human(c.end)}`).join(' and ')})` : ''}.`;
  const shortest = camps.reduce<PlrCamp | null>((a, b) => (!a || b.nights < a.nights ? b : a), null);
  const nights = (next[0] ?? shortest)?.nights ?? 4;
  const imgs = imageCandidates(html, PLR_ADVANCED_URL, null, 40).filter(u => !/logo|icon/i.test(u));

  return {
    kind: 'camp',
    title: 'Play Los Roques Advanced Kite Camp',
    summary: [
      'Kite camps for independent riders on Gran Roque in the Los Roques Archipelago, Venezuela: Posada Casa Play (8 air-conditioned rooms) with all meals, daily boat kite safaris from cay to cay with certified instructors, rescue boat and beach set-ups, and the return flight Caracas - Los Roques.',
      `${camps.length ? `Camps run ${[...new Set(camps.map(c => c.nights))].join(' or ')} nights. ` : ''}${datesLine}`,
      all.length ? `Last published prices: ${cur} ${Math.min(...all).toLocaleString('en-US')} to ${Math.max(...all).toLocaleString('en-US')} per person by room occupancy.` : '',
    ].join(' ').trim(),
    continent: 'South America',
    country: 'Venezuela',
    region: PLR_REGION,
    spot: 'Gran Roque',
    spotCoords: plrCoords(html),
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: false,
    equipmentRental: null,
    beginnerFriendly: false,
    includedServices: [
      'Return flight Caracas - Los Roques, welcome at Gran Roque airport',
      'Accommodation at Posada Casa Play (air conditioning, private bathroom, Starlink Wi-Fi)',
      'All meals: breakfast, beach lunch box, dinner',
      'Daily kite safaris by boat between the cays with certified instructors, rescue boat, beach set-ups',
    ],
    optionalServices: [
      camps.find(c => c.nonKiter) ? `Non-kiter companion (from ${cur} ${Math.min(...camps.map(c => c.nonKiter ?? Infinity)).toLocaleString('en-US')})` : 'Non-kiter companion',
      'Extra nights',
    ],
    accommodation: 'posada (Posada Casa Play, Gran Roque)',
    mealPlan: 'full_board',
    languages: ['es', 'en'],
    rooms: [],
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: PLR_ADVANCED_URL,
    bookingUrl: PLR_ADVANCED_URL,
    sourceText: [
      `page: ${t}`,
      `parsed: ${camps.map(c => `${c.start}..${c.end} ${JSON.stringify(c.prices)} non-kiter ${c.nonKiter}`).join('; ')}; currency ${cur}`,
    ].join('\n'),
  };
}

export async function fetchPlrAdvancedSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const html = await plrPage(PLR_ADVANCED_URL);
  const camps = parsePlrCamps(html);
  if (camps.length === 0) throw new Error('play-los-roques advanced: no "KITE CAMP n - <dates>, <year>" block found (layout changed?)');
  const slots = buildPlrCampSlots(camps, plrCurrency(html), today);
  if (slots.length === 0) ctx?.note(`all printed camps are past (${camps.map(c => c.start).join(', ')}); next dates not published yet`);
  return slots;
}

export const playLosRoquesAdvancedKiteCampGranRoque: OfferAdapter = {
  key: 'play-los-roques-advanced-kite-camp-gran-roque',
  name: 'Play Los Roques Advanced Kite Camp, Gran Roque',
  kind: 'camp',
  operator: PLR_OPERATOR,
  url: PLR_ADVANCED_URL,
  slotMethod: 'html_dates',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() { return parsePlrAdvancedContent(await plrPage(PLR_ADVANCED_URL)); },
  fetchSlots: ctx => fetchPlrAdvancedSlots(todayIso(), ctx),
};
