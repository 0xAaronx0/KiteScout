// ---------------------------------------------------------------------------
// Matos Tarifa apartments (Ático and C. Braille), Tarifa (Cadiz, Andalusia, Spain) - two holiday apartments in the
// centre of Tarifa that the kite school Matos Tarifa (IKO and FAV certified, base on Playa de los Lances) rents to its
// students: the Ático (1 bedroom + sofa bed, 1-2 people, max. 4, private terrace "ideal for rinsing/drying your small
// gear", 2 minutes from Los Lances South beach and the old town) and C. Braille (2 bedrooms + sofa bed, 2-4 people,
// max. 6, balcony, 200 m from the old town, 500 m from Los Lances South beach). Requested with the course booking.
// This file also holds the page parser shared with The Wild House (wild-house-tarifa.ts), the third stay on the page.
//
// Data path (checked 2026-10-12): WordPress/Elementor, ONE page https://matos-tarifa.com/en/tarifa-guide/accommodation/
//   sections = <h3> headings ("Ático Apartment in Tarifa Center", "C.Braille Apartment - Ideal Kite Stay", "The Wild
//   House - Guest House", "Kitesurf Road Trip in a Campervan", ...); each apartment section has an HTML rate grid
//   (.mt-row: "October to February" / "Low Season" / "55 €" "per night") and a note "Availability confirmed by email or
//   phone following your request. Rates subject to adjustment during Holy Week and bank holidays. Cleaning fee: 40 €
//   per stay."
// Year: the seasons have none. They are dated on the page's own last edit (JSON-LD WebPage dateModified 2026-03-06 on
//   2026-10-12): one 12-month cycle starting at the season that contains that date (as mounu-island-resort-vavau):
//   Mar-May 2026, Jun-Sep 2026, Oct 2026-Feb 2027. The bands roll forward when the school edits the page again.
// No booking engine: "Indicate your request for the Ático in your kitesurfing course booking form" -> 'on_request'.
// robots.txt (2026-10-12): disallows /wp-admin/ and /wp-content/ except uploads and assets; the page is allowed.
// Requests per run: 1 (content and slots share one memoised fetch).
// Parsed: 6 slots = apartment x season band ("atico|2026-10-01"), EUR per night for the whole apartment (priceBasis
//   'group', occupancy = the comfortable capacity the page names: 2 / 4), availability 'on_request'; the 40 € cleaning
//   fee per stay is in the availability text and the room features (no slot field for a per-stay fee).
// Known limits: the JSON-LD geo (36.045276 / -5.637260) is the school on Playa de los Lances, not the apartments, so
//   no spotCoords; Holy Week / bank holiday surcharges are not quantified.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, imageCandidates, iso, ldOfType, monthOf, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

export const MATOS_SITE = 'https://matos-tarifa.com';
export const MATOS_ACCOM_URL = `${MATOS_SITE}/en/tarifa-guide/accommodation/`;
export const MATOS_BOOKING_URL = `${MATOS_SITE}/en/book-kitesurfing-course/`;
export const MATOS_OPERATOR = {
  name: 'Matos Tarifa',
  websiteUrl: `${MATOS_SITE}/en/`,
  rootDomain: 'matos-tarifa.com',
  contactEmail: 'info@matos-tarifa.com',
  phone: '+34610158236',
};

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: content + slots (and The Wild House adapter) share it */
export function matosPage(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text split at block tags (script/style bodies dropped). */
export function matosLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|article|header|footer|nav|table|span)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- shared pure parsers ------------------------------------------------------------------------------
export interface MatosSection { title: string; html: string }

/** The page cut at its <h3> headings (each stay is one section). */
export function matosSections(html: string): MatosSection[] {
  const heads = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].map(m => ({ at: m.index!, title: clean(m[1].replace(/<[^>]+>/g, ' ')) }));
  return heads.map((h, i) => ({ title: h.title, html: html.slice(h.at, i + 1 < heads.length ? heads[i + 1].at : undefined) }));
}

export function matosSection(html: string, re: RegExp): MatosSection | null {
  return matosSections(html).find(s => re.test(s.title)) ?? null;
}

/** "Highlights" list of a section (lines until the request hint). */
export function matosHighlights(sectionHtml: string): string[] {
  const lines = matosLines(sectionHtml);
  const i = lines.findIndex(l => /^Highlights$/i.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (/^(Indicate|Please include|We will confirm|Booking Request)/i.test(l)) break;
    if (!out.includes(l)) out.push(l);
  }
  return out;
}

/** Section photos (WordPress originals, one per file). */
export function matosImages(sectionHtml: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of imageCandidates(sectionHtml, MATOS_ACCOM_URL, null, 60)) {
    if (/logo|icon|\.svg|\.png$|elementor\/thumbs/i.test(u)) continue;
    const k = u.replace(/\.(?:avif|webp)$/i, '').replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); out.push(u);
  }
  return out;
}

export function matosDateModified(html: string): string | null {
  const wp = ldOfType(html, 'WebPage').find(o => typeof o.dateModified === 'string');
  const d = (wp?.dateModified as string | undefined) ?? html.match(/article:modified_time" content="([^"]+)"/)?.[1];
  return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

// --- apartments -----------------------------------------------------------------------------------------
export interface MatosRate { months: string; season: string; m1: number; m2: number; amount: number; currency: string }
export interface MatosApartment { key: string; name: string; text: string[]; highlights: string[]; rates: MatosRate[]; cleaningFee: number | null; occupancy: number | null; images: string[] }

/** Rate grid rows: "October to February" + "Low Season" + "55 €". */
export function parseMatosRates(sectionHtml: string): MatosRate[] {
  const out: MatosRate[] = [];
  for (const row of parse(sectionHtml).querySelectorAll('.mt-row')) {
    const months = collapse(row.querySelector('.mt-title')?.text ?? '');
    const season = collapse(row.querySelector('.mt-sub')?.text ?? '');
    const price = collapse(row.querySelector('.mt-price')?.text ?? '');
    const mm = months.match(/([A-Za-z]+)\s+to\s+([A-Za-z]+)/);
    const m1 = mm ? monthOf(mm[1]) : null;
    const m2 = mm ? monthOf(mm[2]) : null;
    const amount = parseAmount(price);
    if (m1 && m2 && amount) out.push({ months, season, m1, m2, amount, currency: /€|eur/i.test(price) ? 'EUR' : 'EUR' });
  }
  return out;
}

export function parseMatosApartment(section: MatosSection): MatosApartment {
  const lines = matosLines(section.html);
  const fee = lines.join(' ').match(/Cleaning fee:\s*([\d.,]+)\s*€\s*per stay/i)?.[1];
  const comfy = lines.join(' ').match(/comfortably accommodate (?:\d+ to )?(\d+) people/i)?.[1];
  const name = /braille/i.test(section.title) ? 'C. Braille apartment' : /tico/i.test(section.title) ? 'Ático apartment' : section.title;
  const stop = lines.findIndex(l => /^Highlights$/i.test(l));
  return {
    key: /braille/i.test(section.title) ? 'c-braille' : keyPart(name.replace(/ apartment$/i, '')),
    name,
    text: lines.slice(1, stop > 0 ? stop : 12),
    highlights: matosHighlights(section.html),
    rates: parseMatosRates(section.html),
    cleaningFee: fee ? parseAmount(fee) : null,
    occupancy: comfy ? Number(comfy) : null,
    images: matosImages(section.html),
  };
}

export function parseMatosApartments(html: string): MatosApartment[] {
  return matosSections(html).filter(s => /apartment/i.test(s.title) && !/combine/i.test(s.title)).map(parseMatosApartment).filter(a => a.rates.length > 0);
}

export interface MatosBand { rate: MatosRate; start: string; end: string }

/** Year-less seasons -> one 12-month cycle of dated bands starting at the season that contains `anchor`. */
export function matosBands(rates: MatosRate[], anchor: string): MatosBand[] {
  const y0 = Number(anchor.slice(0, 4));
  const all: MatosBand[] = [];
  for (const r of rates) {
    for (const y of [y0 - 1, y0, y0 + 1]) {
      const ey = r.m2 < r.m1 ? y + 1 : y;
      all.push({ rate: r, start: iso(y, r.m1, 1), end: iso(ey, r.m2, lastDay(ey, r.m2)) });
    }
  }
  all.sort((a, b) => a.start.localeCompare(b.start));
  const first = all.find(b => b.start <= anchor && b.end >= anchor) ?? all.find(b => b.start > anchor);
  if (!first) return [];
  const cycleEnd = iso(Number(first.start.slice(0, 4)) + 1, Number(first.start.slice(5, 7)), 1);
  return all.filter(b => b.start >= first.start && b.start < cycleEnd);
}

export function buildMatosSlots(apts: MatosApartment[], anchor: string): Slot[] {
  const out: Slot[] = [];
  for (const a of apts) {
    for (const b of matosBands(a.rates, anchor)) {
      out.push({
        key: `${a.key}|${b.start}`,
        startDate: b.start,
        endDate: b.end,
        unit: a.name,
        price: b.rate.amount,
        currency: b.rate.currency,
        priceUnit: 'per_night',
        priceBasis: 'group',
        occupancy: a.occupancy,
        availability: 'on_request',
        availabilityText: `${b.rate.season} (${b.rate.months}); availability confirmed by email or phone${a.cleaningFee ? `; cleaning fee ${a.cleaningFee} € per stay` : ''}`,
        spotsLeft: null,
      });
    }
  }
  return out;
}

export function parseMatosApartmentsContent(html: string): OfferContent {
  const apts = parseMatosApartments(html);
  const all = matosLines(html);
  const intro = all.filter(l => /Matos Tarifa school offers|Handpicked accommodations/i.test(l));
  const school = all.find(l => /Official Kitesurf Center of Tarifa/i.test(l)) ?? null;
  const rooms: ContentRoom[] = apts.map(a => ({
    name: a.name,
    description: a.text.filter(t => /^(Located|Sleeping Space|Comfort|Indoor Living|The .Plus.|Los Lances|Old Town|Historical Center|Amenities)/i.test(t)).join(' ') || null,
    features: [
      ...a.highlights,
      ...a.rates.map(r => `${r.season} (${r.months}): EUR ${r.amount} per night`),
      ...(a.cleaningFee ? [`Cleaning fee: EUR ${a.cleaningFee} per stay`] : []),
      'Rates subject to adjustment during Holy Week and bank holidays',
    ],
  }));
  const at = apts.find(a => a.key === 'atico');
  const br = apts.find(a => a.key === 'c-braille');
  const rate = (a: MatosApartment | undefined, re: RegExp) => a?.rates.find(r => re.test(r.season))?.amount ?? null;
  const images = [...new Set(apts.flatMap(a => a.images))];

  const summary = [
    `The kite school Matos Tarifa rents two apartments in the centre of Tarifa, Spain, to its students: the Ático (one bedroom plus sofa bed, 1-2 people, max. 4, private terrace for rinsing and drying gear, 2 minutes' walk from Los Lances South beach) and C. Braille (two bedrooms plus sofa bed, 2-4 people, max. 6, balcony, 200 m from the old town).`,
    `Both have Wi-Fi, TV and a fully equipped kitchen${at && br ? `; nightly rates are EUR ${rate(at, /low/i)} / ${rate(br, /low/i)} (October-February), ${rate(at, /mid/i)} / ${rate(br, /mid/i)} (March-May) and ${rate(at, /high/i)} / ${rate(br, /high/i)} (June-September) for the Ático / C. Braille` : ''}, plus a ${at?.cleaningFee ?? br?.cleaningFee ?? 40} € cleaning fee per stay.`,
    `The apartments are requested with a kite course booking and confirmed by email or phone; Matos Tarifa (IKO and FAV certified) teaches in English, Spanish and French on Playa de los Lances.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Matos Tarifa Apartments (Ático and C. Braille)',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Tarifa town',
    spot: 'Tarifa',
    itinerarySpots: [],
    durationDays: null,
    // course levels on the page: Discovery, Intermediate, Independent, Advanced, Strapless, Tiki
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /Kitesurf lessons in English, Spanish, and French/i.test(all.join(' ')),
    equipmentRental: null,
    beginnerFriendly: /Beginner/i.test(all.join(' ')),
    includedServices: ['Wi-Fi', 'TV', 'Fully equipped kitchen'],
    optionalServices: ['Kitesurf courses with Matos Tarifa (levels 1-6: discovery to strapless and Tiki)', 'Campervan rental with Vanbreak (10% off with the code MATOS)'],
    accommodation: 'holiday apartments',
    mealPlan: 'self_catering',
    languages: ['en', 'es', 'fr'],
    rooms,
    imageUrls: images.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: MATOS_ACCOM_URL,
    bookingUrl: MATOS_BOOKING_URL,
    sourceText: [
      `intro: ${intro.join(' ')}`,
      ...apts.map(a => `${a.name}: ${a.text.join(' ')} | highlights: ${a.highlights.join(', ')} | rates: ${a.rates.map(r => `${r.months} ${r.season} ${r.amount}`).join('; ')} | cleaning ${a.cleaningFee ?? '-'}`),
      `school: ${school ?? '-'}`,
      `dateModified: ${matosDateModified(html) ?? '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------------
export const matosApartmentsTarifa: OfferAdapter = {
  key: 'matos-apartments-tarifa',
  name: 'Matos Tarifa Apartments (Ático and C. Braille)',
  kind: 'accommodation',
  operator: MATOS_OPERATOR,
  url: MATOS_ACCOM_URL,
  slotMethod: 'price_table',
  fetchBudget: 2,
  confidence: 'medium', // year-less season table, year from the page's last edit
  async fetchContent() {
    return parseMatosApartmentsContent(await matosPage(MATOS_ACCOM_URL));
  },
  async fetchSlots(ctx) {
    const html = await matosPage(MATOS_ACCOM_URL);
    const apts = parseMatosApartments(html);
    if (apts.length === 0) throw new Error('matos-apartments: no apartment rate grid (.mt-row) on the accommodation page (layout changed?)');
    const anchor = matosDateModified(html);
    if (!anchor) { ctx.note('no dateModified: the year-less seasons cannot be dated, price on request'); return []; }
    return buildMatosSlots(apts, anchor);
  },
};
