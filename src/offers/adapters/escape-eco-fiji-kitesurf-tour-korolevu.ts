// ---------------------------------------------------------------------------
// Escape Eco Adventures (kite + foil school, Port Stephens NSW) - Fiji Kitesurfing Tour 2027 at the Fiji Beachouse,
// Korolevu (Coral Coast, Viti Levu): 7 nights twin share, daily kiting with small coach ratios, boat-assisted
// downwinders and tow-foil lessons, three meals a day, airport transfer, photo + video coaching. One base for the
// whole week -> KIND = 'camp' (the operator calls it a "tour").
//
// This file also holds the shared Escape Eco parser (the Indonesia tour adapter imports it).
//
// Data path (checked 2026-10-19): Wix site, one page per tour, all server-rendered:
//   https://www.escapeecoadventures.com.au/fijikitesurftour (canonical; /fijitour is the same page)
//   slots    the "Dates & Prices" block: "Dates 2027" + one line per week ("7th August - 14st August",
//            "21st August - 28th August"; year from the heading), then "Prices 2027": "$4250AUD p.p. Twin Share",
//            "+$714.5AUD p.p. Private Room" (a surcharge on the twin-share price -> private = 4,964.50 pp).
//            One slot per future week x room, AUD per person (package, 7 nights). Booking is by phone / form with a
//            AUD 1,000 deposit within 24 h, so availability is 'on_request' ("There are limited private and twin
//            rooms available. Contact us to organise ...").
//   content  the same page: inclusions, accommodation, payment terms, non-kiter and gear-rental prices, the
//            pro-gallery (photo items in the page's warmup JSON: file name + media id) and content images.
// Known conflicts on the page (2026-10-19): the non-kiting partner costs "+$1290.9 non-activity plus one" in the
//   date block but "Adults: +$1106.5 (Which gets you a private room together)" further down; both are kept in
//   optionalServices. The medical-conference variant ("from $4500AUD") is a separate product, not a slot.
// robots.txt (2026-10-19): Wix default, `Allow: /` (only ?lightbox= and AdsBot paths disallowed).
// Requests per run: 1 (the tour page, memoised for content + slots).
// spotCoords: the Fiji Beachouse's own LodgingBusiness JSON-LD geo (fijibeachouse.com, read 2026-10-19,
//   address "Queens Highway, Coral Coast, Korolevu"); the Escape Eco page has only the operator's NSW location.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, daysInclusive, parse, parseAmount, parseRange, todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';

export const EE_SITE = 'https://www.escapeecoadventures.com.au';
/** the page's canonical URL; /fijitour serves the identical page (checked 2026-10-19) */
export const EE_FIJI_URL = `${EE_SITE}/fijikitesurftour`;

export const EE_OPERATOR: OperatorRef = {
  name: 'Escape Eco Adventures',
  websiteUrl: EE_SITE,
  rootDomain: 'escapeecoadventures.com.au',
  contactEmail: 'info@escapeecoadventures.com.au',
  whatsapp: '+61423085701',
};

// --- shared fetch + text --------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
export function eePage(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines of the Wix page (scripts, styles, SVG dropped; zero-width spaces removed). */
export function eeLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script,style,noscript,svg')) el.remove();
  return (root.querySelector('body') ?? root).structuredText
    .split('\n').map(s => collapse(s.replace(/[\u200b\u00a0]/g, ' '))).filter(Boolean);
}

// --- shared parser ----------------------------------------------------------------------------------
export interface EeWeek { start: string; end: string; label: string }
export interface EeRoom { unit: string; price: number; occupancy: number; raw: string }
export interface EeTour {
  year: number | null;
  weeks: EeWeek[];
  rooms: EeRoom[];
  currency: string | null;
  deposit: number | null;
  lines: string[];
}

/** 4250 -> "4,250", 4964.5 -> "4,964.50" */
export const eeMoney = (x: number): string =>
  x.toLocaleString('en-US', Number.isInteger(x) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const stripOrdinals = (s: string): string => s.replace(/(\d)(st|nd|rd|th)\b/gi, '$1');

/** "Twin Share" -> "Twin share", "AC private*" -> "AC private room" */
function roomName(raw: string): string {
  let s = collapse(raw.replace(/\*+/g, '').replace(/p\.p\.|pp\b/gi, '').replace(/^AUD\b|\bAUD\b/g, '')).trim();
  if (/private$/i.test(s)) s += ' room';
  s = s.toLowerCase().replace(/\bac\b/, 'AC');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The "Dates & Prices" block: "Dates <year>", one line per week until "Prices <year>"; then price lines until
 * "Including". A line starting with "+" is a surcharge on the first (base) price.
 */
export function parseEeTour(html: string): EeTour {
  const lines = eeLines(html);
  const di = lines.findIndex(l => /^Dates\s+20\d{2}$/i.test(l));
  const year = di >= 0 ? Number(lines[di].match(/20\d{2}/)![0]) : null;
  const weeks: EeWeek[] = [];
  let pi = -1;
  if (di >= 0 && year) {
    for (let i = di + 1; i < lines.length; i++) {
      if (/^Prices\b/i.test(lines[i])) { pi = i; break; }
      const r = parseRange(stripOrdinals(lines[i]).replace(/\bof\s+/i, ''), year);
      if (r) weeks.push({ ...r, label: lines[i] });
    }
  }
  const rooms: EeRoom[] = [];
  let currency: string | null = null;
  if (pi >= 0) {
    let base: number | null = null;
    for (let i = pi + 1; i < lines.length && !/^Including\b/i.test(lines[i]); i++) {
      const m = lines[i].match(/^(\+)?\s*(?:AU)?\$\s?([\d,.]+)\s*(pp)?\s*(AUD)?\s*(?:p\.p\.)?\s*(.*)$/i);
      if (!m) continue;
      const amount = parseAmount(m[2]);
      if (amount === null) continue;
      if (m[4] || /AU\$/i.test(lines[i])) currency = 'AUD';
      const unit = roomName(m[5] || 'Twin share');
      if (m[1]) {
        if (base === null) continue;
        rooms.push({ unit, price: Math.round((base + amount) * 100) / 100, occupancy: /private/i.test(unit) ? 1 : 2, raw: lines[i] });
      } else {
        if (base === null) base = amount;
        rooms.push({ unit, price: amount, occupancy: /private/i.test(unit) ? 1 : 2, raw: lines[i] });
      }
    }
  }
  const dep = lines.join('\n').match(/Deposit:\s*\$\s?([\d,]+)/i)?.[1];
  return { year, weeks, rooms, currency, deposit: dep ? parseAmount(dep) : null, lines };
}

export function buildEeSlots(t: EeTour, today: string): Slot[] {
  const out: Slot[] = [];
  for (const w of t.weeks) {
    if (w.start < today) continue;
    for (const r of t.rooms) {
      out.push({
        key: `${w.start}|${r.unit.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
        startDate: w.start,
        endDate: w.end,
        unit: r.unit,
        price: r.price,
        currency: t.currency,
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: r.occupancy,
        availability: 'on_request',
        availabilityText: `Booked by phone or enquiry form; AUD ${eeMoney(t.deposit ?? 1000)} deposit within 24 h secures the spot ("${r.raw}")`,
        spotsLeft: null,
      });
    }
  }
  return out;
}

/** Photos: content <img> media + pro-gallery items (warmup JSON), as bare Wix media URLs (the downloader bounds them). */
export function eeImages(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | null | undefined): void => {
    if (!id || seen.has(id) || !/\.(jpe?g|webp)$/i.test(id)) return;
    seen.add(id);
    out.push(`https://static.wixstatic.com/media/${id}`);
  };
  const root = parse(html);
  for (const el of root.querySelectorAll('header,footer,script,style')) el.remove();
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? '';
    const alt = img.getAttribute('alt') ?? '';
    if (/logo|stars|instagram|facebook|icon/i.test(alt + src)) continue;
    const w = Number(src.match(/\/w_(\d+),/)?.[1] ?? 0);
    if (w && w < 200) continue;
    add(decodeURIComponent(src).match(/static\.wixstatic\.com\/media\/([^/]+)/)?.[1]);
  }
  // pro-gallery items: {"metaData":{...,"fileName":"EcoEscapeFiji_16Aug-0586.jpg","name":"<id>"},"mediaUrl":"<id>"}
  for (const m of html.matchAll(/"fileName":"([^"]*)","name":"([0-9a-f]{6}_[0-9a-f]{32}~mv2\.[a-z]+)"\},"mediaUrl"/g)) {
    if (/screenshot|logo/i.test(m[1])) continue;
    add(m[2]);
  }
  return out;
}

/** "+$1290.9 non-activity plus one" / "Adults: +$1106.5" / "+$125p/h Private Instructor" / "rent for $930" */
function eeExtras(text: string): string[] {
  const out: string[] = [];
  const n = (s: string | undefined): string | null => (s ? eeMoney(Number(s)) : null);
  const plusOne = text.match(/\+\$([\d.]+)\s*non-activity plus one/i)?.[1];
  const adults = text.match(/Adults:\s*\+\$([\d.]+)/i)?.[1];
  if (plusOne || adults) {
    out.push(`Non-kiting partner: ${[adults ? `+AUD ${n(adults)} (shares the kiter's private room)` : null, plusOne ? `+AUD ${n(plusOne)} (as listed with the dates)` : null].filter(Boolean).join('; ')}`);
  }
  const instr = text.match(/\+\$\s?([\d.]+)\s*p\/?h\s*Private Instructor/i)?.[1] ?? text.match(/Private Instructor[^+\n]*\+AUD\$?\s?([\d.]+)\s*p\/?h/i)?.[1];
  if (instr) out.push(`Private instructor: AUD ${n(instr)} per hour`);
  const rent = text.match(/full kite kit to rent for \$([\d,]+)/i)?.[1];
  out.push(rent ? `Kite gear rental: AUD ${rent.replace(/,/g, '')} for the week` : 'Kite gear rental (price list in the info pack)');
  return out;
}

// --- Fiji ---------------------------------------------------------------------------------------------
export function parseEeFijiContent(html: string): OfferContent {
  const t = parseEeTour(html);
  if (!t.year || !t.weeks.length) throw new Error('escape-eco-fiji: no "Dates <year>" block (layout changed?)');
  if (!t.rooms.length) throw new Error('escape-eco-fiji: no prices in the "Prices <year>" block (layout changed?)');
  const text = t.lines.join('\n');
  const nights = daysInclusive(t.weeks[0].start, t.weeks[0].end) - 1;
  const twin = t.rooms[0];
  const priv = t.rooms.find(r => /private/i.test(r.unit));
  const medical = text.match(/medical conference \(from \$\s?([\d,]+)\s*AUD\)/i)?.[1] ?? null;
  const fmt = eeMoney;
  const weeks = t.weeks.map(w => `${w.start} to ${w.end}`).join(' and ');

  const summary = [
    `Escape Eco Adventures runs a ${nights}-night kitesurf progression week at the Fiji Beachouse, a small family-run resort at Korolevu on the Coral Coast of Viti Levu, Fiji.`,
    'Daily kiting at the best spot of the day (flat lagoons or reef waves, reached by boat, van or from the beach), small kiter-to-instructor ratios, boat-assisted downwinders and tow-foil lessons, photo and video coaching, three meals a day and the airport transfer are included.',
    `The ${t.year} weeks are ${weeks}; beginners to advanced riders are welcome.`,
    `The price is AUD ${fmt(twin.price)} per person in a twin share${priv ? ` or AUD ${fmt(priv.price)} in a private room` : ''}, with a AUD ${eeMoney(t.deposit ?? 1000)} deposit; flights and gear rental are extra.`,
  ].join(' ');

  return {
    kind: 'camp',
    title: `Escape Eco Fiji Kitesurfing Tour ${t.year}`,
    summary,
    continent: 'Oceania',
    country: 'Fiji',
    region: 'Coral Coast, Viti Levu',
    spot: 'Korolevu',
    spotCoords: { lat: -18.2268, lng: 177.7679 },
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      `${nights} nights twin share at the Fiji Beachouse (Bure or Hibiscus room, air-conditioned, private bathroom)`,
      'Daily kiting, weather permitting, with a small kiter-to-instructor ratio',
      'Breakfast, lunch and dinner',
      'Airport transfer',
      'Professional photos and videos',
      'Tow-foil lessons and boat-assisted downwinders (weather and level permitting)',
      'Non-kiting activities (volleyball, yoga, waterfalls, SUP / kayak)',
    ],
    optionalServices: [
      ...(priv ? [`Private room (+AUD ${fmt(priv.price - twin.price)} per person)`] : []),
      ...eeExtras(text),
      ...(medical ? [`Medical-conference version of the tour (from AUD ${medical.replace(/,/g, '')}, extra inclusions, by phone)`] : []),
    ],
    accommodation: 'Fiji Beachouse resort: air-conditioned Bure and Hibiscus rooms with private bathrooms',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: [],
    imageUrls: eeImages(html).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: EE_FIJI_URL,
    bookingUrl: EE_FIJI_URL,
    sourceText: [
      text,
      `parsed: year ${t.year}; weeks ${t.weeks.map(w => `${w.start}..${w.end}`).join(', ')}; rooms ${t.rooms.map(r => `${r.unit}=${r.price}`).join(', ')}; ${t.currency}; deposit ${t.deposit}`,
    ].join('\n'),
  };
}

/** Shared slot fetch for the Escape Eco tours (dated weeks; past weeks are dropped). */
export async function fetchEeSlots(url: string, label: string, today: string, ctx?: { note(t: string): void }, extraRooms?: (t: EeTour) => EeRoom[]): Promise<Slot[]> {
  const t = parseEeTour(await eePage(url));
  if (!t.year || !t.weeks.length) throw new Error(`${label}: no "Dates <year>" block (layout changed?)`);
  if (!t.rooms.length) throw new Error(`${label}: no prices in the "Prices <year>" block (layout changed?)`);
  if (!t.currency) ctx?.note('no "AUD" next to the prices; currency taken as unknown');
  if (extraRooms) for (const r of extraRooms(t)) if (!t.rooms.some(x => x.unit === r.unit)) t.rooms.push(r);
  const slots = buildEeSlots(t, today);
  if (!slots.length) ctx?.note(`all ${t.year} weeks are past (${t.weeks.map(w => w.start).join(', ')}); no new dates printed yet`);
  return slots;
}

export const escapeEcoFijiKitesurfTourKorolevu: OfferAdapter = {
  key: 'escape-eco-fiji-kitesurf-tour-korolevu',
  name: 'Escape Eco Adventures Fiji Kitesurfing Tour, Korolevu',
  kind: 'camp',
  operator: EE_OPERATOR,
  url: EE_FIJI_URL,
  slotMethod: 'html_dates',
  instantBooking: false,           // phone / enquiry form, deposit by bank transfer or card afterwards
  fetchBudget: 2,
  async fetchContent() {
    return parseEeFijiContent(await eePage(EE_FIJI_URL));
  },
  fetchSlots: ctx => fetchEeSlots(EE_FIJI_URL, 'escape-eco-fiji', todayIso(), ctx),
};

