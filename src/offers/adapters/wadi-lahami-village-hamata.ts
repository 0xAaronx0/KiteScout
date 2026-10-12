// ---------------------------------------------------------------------------
// Wadi Lahami Village, south of Hamata (Red Sea, Egypt) - eco-lodge of Red Sea Diving Safari (the
// property's own operator) with Royal Tents and Deluxe Chalets, full board, a PADI dive center and the
// Wadi Lahami Kitesurfing Center on the lagoon in front of the beach.
//
// Data path (checked 2026-10-12), all on www.redsea-divingsafari.com (server-rendered ASP.NET pages):
//   content  /villages/wadi-lahami/ (about the village, kite text, map script with the village's
//            latitude/longitude), /villages/wadi-lahami/accommodation/ (Royal Tent + Deluxe Chalet texts,
//            amenities, room photos), /price-lists/wadi-lahami (Kite Surfing tab: station service, rental,
//            courses).
//   slots    /price-lists/wadi-lahami shows one price period (button: "€ Summer 2026 (01/05/2026 -
//            31/10/2026)"); the dropdown links the other periods (/price-lists/wadi-lahami/euro-winter-26-27,
//            /euro-summer-27; the "le-*" EGP lists are for Egyptian residents and are skipped). Each period
//            page has the table "Accommodation rates per person/ night" with a High season and a Low season
//            column and, under "General Notes", the months of each season.
// No online inventory: "Book Now" leads to the operator's booking request form -> availability 'unknown'.
// robots.txt (2026-10-12): only Cloudflare content-signal comments, no Disallow -> allowed.
// Requests per run: content 3, slots 1 + one per further € period (2 on 2026-10-12) = 3.
// Parsed: slot = room x occupancy x season band inside a price period ("royal-tent-2p|2027-01-01"),
//   EUR per person per night (full board), real limits = period dates split at the high/low months;
//   bands that ended before today are dropped.
// Known limits: discounts (triple -5 EUR pp/day, 2+ weeks, 4+ weeks), child rates, the mandatory
//   environmental fee and transfers are kept in sourceText only (Slot has no stay-length field).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, iso, meta, parse, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.redsea-divingsafari.com';
export const WL_VILLAGE_URL = `${SITE}/villages/wadi-lahami/`;
export const WL_ROOMS_URL = `${SITE}/villages/wadi-lahami/accommodation/`;
export const WL_PRICES_URL = `${SITE}/price-lists/wadi-lahami`;
const BOOKING_URL = `${SITE}/Booking`;

export interface WlRate { unit: string; occupancy: number; high: number | null; low: number | null }
export interface WlPeriod {
  label: string;           // "€ Summer 2026"
  start: string;           // YYYY-MM-DD
  end: string;
  currency: string;        // EUR for the € lists
  highMonths: number[];
  lowMonths: number[];
  rates: WlRate[];
}
export interface WlPeriodLink { label: string; url: string; start: string; end: string }

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const dmy = (s: string): string | null => {
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? iso(+m[3], +m[2], +m[1]) : null;
};
const range = (s: string): { start: string; end: string } | null => {
  const m = s.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  const start = m ? dmy(m[1]) : null;
  const end = m ? dmy(m[2]) : null;
  return start && end ? { start, end } : null;
};
const cellText = (html: string): string => clean(html.replace(/data-content="[^"]*"/g, '').replace(/<[^>]+>/g, ' '));

// --- pure parsers -----------------------------------------------------------------------------
/** The period shown on a price-list page (the dropdown button) + its season months + room rates. */
export function parseWlPeriod(html: string): WlPeriod | null {
  const btn = html.match(/<button[^>]*dropdown-toggle[\s\S]*?class="season[^"]*">([^<]+)<\/span>\s*<span class="dates">([^<]+)<\/span>/);
  if (!btn) return null;
  const label = clean(btn[1]);
  const r = range(btn[2]);
  if (!r) return null;
  const months = (re: RegExp): number[] => {
    const m = html.match(re);
    if (!m) return [];
    return clean(m[1]).toLowerCase().split(/[,\s]+/).map(w => MONTH_NAMES.indexOf(w) + 1).filter(n => n > 0);
  };
  const highMonths = months(/<strong>\s*High season\*?:\s*<\/strong>([^<]*)/i);
  const lowMonths = months(/<strong>\s*Low season\*?:\s*<\/strong>([^<]*)/i);

  const rates: WlRate[] = [];
  const at = html.indexOf('Accommodation rates per person/ night</th>');
  const tStart = at >= 0 ? html.lastIndexOf('<table', at) : -1;
  const table = tStart >= 0 ? html.slice(tStart, html.indexOf('</table>', at)) : '';
  // header order decides which column is high / low
  const head = [...table.slice(0, table.indexOf('</thead>')).matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(h => cellText(`${h[1]}`).toLowerCase());
  const col = (word: string) => head.findIndex((h, i) => i > 0 && h.includes(word)) - 1;
  const hi = col('high'); const lo = col('low');
  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => cellText(c[1]));
    if (cells.length < 2) continue;
    const name = cells[0].match(/^(.+?)\s*\((double|single|triple)\)$/i);
    if (!name) continue;
    const occ = { single: 1, double: 2, triple: 3 }[name[2].toLowerCase() as 'single' | 'double' | 'triple'];
    const vals = cells.slice(1).map(c => (/[\d]/.test(c) ? parseAmount(c) : null));
    rates.push({ unit: name[1].trim(), occupancy: occ, high: hi >= 0 ? vals[hi] ?? null : null, low: lo >= 0 ? vals[lo] ?? null : null });
  }
  return { label, start: r.start, end: r.end, currency: /€|EUR/.test(label) ? 'EUR' : /EGP|LE\b/.test(label) ? 'EGP' : 'EUR', highMonths, lowMonths, rates };
}

/** Other price periods from the dropdown; only the € (foreigner / non-resident) lists. */
export function parseWlPeriodLinks(html: string): WlPeriodLink[] {
  const out: WlPeriodLink[] = [];
  const menu = html.slice(html.indexOf('<ul class="dropdown-menu">'));
  for (const m of menu.matchAll(/<a href="(\/price-lists\/wadi-lahami\/[^"]+)">([\s\S]*?)<\/a>/g)) {
    const label = clean(m[2].match(/class="season[^"]*">([^<]+)</)?.[1] ?? '');
    const r = range(m[2]);
    if (!label.startsWith('€') || !r) continue;
    out.push({ label, url: new URL(m[1], SITE).toString(), start: r.start, end: r.end });
  }
  return out;
}

const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Split each period at its high/low months into bands with real date limits; drop bands that ended before `today`. */
export function buildWlSlots(periods: WlPeriod[], today: string): Slot[] {
  const out: Slot[] = [];
  for (const p of periods) {
    const bands: Array<{ start: string; end: string; season: 'high' | 'low' }> = [];
    let y = +p.start.slice(0, 4); let m = +p.start.slice(5, 7);
    for (let guard = 0; guard < 36; guard++) {
      const mStart = iso(y, m, 1) < p.start ? p.start : iso(y, m, 1);
      const mEnd = iso(y, m, lastDay(y, m)) > p.end ? p.end : iso(y, m, lastDay(y, m));
      if (mStart > p.end) break;
      const season = p.highMonths.includes(m) ? 'high' : p.lowMonths.includes(m) ? 'low' : null;
      if (season) {
        const last = bands[bands.length - 1];
        const dayAfter = last ? new Date(Date.parse(last.end) + 86400000).toISOString().slice(0, 10) : null;
        if (last && last.season === season && dayAfter === mStart) last.end = mEnd;
        else bands.push({ start: mStart, end: mEnd, season });
      }
      m += 1; if (m > 12) { m = 1; y += 1; }
    }
    for (const b of bands) {
      if (b.end < today) continue;
      for (const r of p.rates) {
        const price = b.season === 'high' ? r.high : r.low;
        if (price === null) continue;
        out.push({
          key: `${keyPart(r.unit)}-${r.occupancy}p|${b.start}`,
          startDate: b.start,
          endDate: b.end,
          unit: r.unit,
          price,
          currency: p.currency,
          priceUnit: 'per_night',
          priceBasis: 'person',
          occupancy: r.occupancy,
          availability: 'unknown',
          availabilityText: `${p.label}, ${b.season} season rate`,
          spotsLeft: null,
        });
      }
    }
  }
  return out;
}

/** Kite Surfing tab of the price list: one line per table row ("Kite Courses: Basic Course - 8hrs - Private EUR 429"). */
export function parseWlKitePrices(html: string): Array<{ table: string; item: string; price: number | null }> {
  const at = html.indexOf('id="kite-surfing-rates"');
  if (at < 0) return [];
  const end = html.indexOf('</section>', at);
  const pane = html.slice(at, end > at ? end : at + 60000);
  const out: Array<{ table: string; item: string; price: number | null }> = [];
  for (const t of pane.matchAll(/<table[\s\S]*?<\/table>/g)) {
    const rows = [...t[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(r => [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => cellText(c[1])));
    const title = rows[0]?.[0] ?? '';
    for (const r of rows.slice(1)) if (r.length >= 2 && r[0]) out.push({ table: title, item: r[0], price: parseAmount(r[1]) });
  }
  return out;
}

/** Visible text split at block tags (one entry per paragraph / list item / cell). */
function lines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|select|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}
const pageText = (html: string): string => {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, select, header, footer, nav')) el.remove();
  return collapse((root.querySelector('body') ?? root).text);
};
const between = (t: string, a: string, b: string): string => {
  const s = t.indexOf(a); if (s < 0) return '';
  const e = t.indexOf(b, s + a.length);
  return collapse(t.slice(s + a.length, e < 0 ? undefined : e));
};

export interface WlPages { village: string; rooms: string; prices: string }

/** Room sections on /villages/wadi-lahami/accommodation/: <h3> name, first <p> description, <li> amenities. */
export function parseWlRooms(roomsHtml: string): ContentRoom[] {
  return parse(roomsHtml).querySelectorAll('.accommodation-setion').map(sec => {
    const name = collapse(sec.querySelector('h3')?.text ?? '');
    const description = collapse(sec.querySelector('p')?.text ?? '') || null;
    const features = sec.querySelectorAll('li').map(li => collapse(li.text)).filter(Boolean);
    return { name, description, features };
  }).filter(r => r.name);
}

/** "About the Village" tab pane: one entry per paragraph. */
export function parseWlAbout(villageHtml: string): string[] {
  const pane = parse(villageHtml).querySelector('#about-camp');
  return (pane?.querySelectorAll('p') ?? []).map(p => collapse(p.text)).filter(t => t.length > 20);
}

export function parseWadiLahamiContent(p: WlPages): OfferContent {
  const village = pageText(p.village);
  const about = parseWlAbout(p.village).join(' ');
  const location = `Wadi ${between(village, 'Locations & Landmarks Wadi ', 'Wadi Lahami Village Location')}`;
  const lat = Number(p.village.match(/var latitude = '(-?\d+\.\d+)'/)?.[1]);
  const lng = Number(p.village.match(/var longitude = '(-?\d+\.\d+)'/)?.[1]);
  const period = parseWlPeriod(p.prices);
  const kite = parseWlKitePrices(p.prices);
  const rooms = parseWlRooms(p.rooms).map(r => ({
    ...r,
    features: [
      ...r.features,
      ...(period?.rates ?? []).filter(x => x.unit === r.name).map(x => `${x.occupancy === 1 ? 'Single' : x.occupancy === 2 ? 'Double' : 'Triple'} use: EUR ${x.high} (high) / ${x.low} (low season) per person per night, full board (${period!.label})`),
    ],
  }));
  const kiteLine = (table: RegExp, item: RegExp): string | null => {
    const k = kite.find(x => table.test(x.table) && item.test(x.item));
    return k && k.price !== null ? `EUR ${k.price}` : null;
  };
  const station = kiteLine(/staying at Wadi Lahami/i, /per day/i);
  const basic = kiteLine(/Kite Courses/i, /Basic Course - 8hrs - Private/i);
  const fullSetWeek = kiteLine(/Rental/i, /Full Set 1 week/i);
  const rentalBrands = kite.find(x => /Rental Equipment/i.test(x.table))?.table.match(/brands:\s*([^)]+)/i)?.[1] ?? null;
  const notes = lines(p.prices).filter(l => /discount|Children 0-5|Environmental Fee|full-board basis/i.test(l)).slice(0, 8);

  const imgs: string[] = [];
  const og = meta(p.village, 'og:image');
  if (og) imgs.push(new URL(og, SITE).toString());
  for (const html of [p.rooms, p.village]) {
    for (const m of html.matchAll(/<img\b[^>]*>/g)) {
      const src = m[0].match(/src="(\/Photos\/[^"]+)"/)?.[1];
      const alt = m[0].match(/alt="([^"]*)"/)?.[1] ?? '';
      if (!src || /\/banners\//.test(src) || /Marsa (Shagra|Nakari)/i.test(alt)) continue;
      const u = encodeURI(new URL(src, SITE).toString().replace(/%20/g, ' '));
      if (!imgs.includes(u)) imgs.push(u);
    }
  }

  const minRate = period ? Math.min(...period.rates.flatMap(r => [r.high, r.low]).filter((x): x is number => x !== null)) : null;
  const summary = [
    'Wadi Lahami Village is the smallest and most southern eco-lodge of Red Sea Diving Safari, about 10 km south of Hamata on Egypt\'s Red Sea coast, next to a large protected mangrove area and on the doorstep of the Fury Shoals reefs.',
    `Guests stay in Royal Tents with shared bathrooms or Deluxe Chalets with en-suite bathroom and sea view, on full board${minRate !== null ? ` (from EUR ${minRate} per person per night)` : ''}.`,
    `The Wadi Lahami Kitesurfing Center sits on a quiet bay with a sandy-bottomed lagoon in front of the beach and offers station service, ${rentalBrands ? `${rentalBrands} ` : ''}rental and courses; a PADI 5* dive center runs boat dives to the southern reefs.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Wadi Lahami Village',
    summary,
    continent: 'Africa',
    country: 'Egypt',
    region: 'Red Sea',
    spot: 'Wadi Lahami',
    spotCoords: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null, // village map script on the site
    itinerarySpots: [],
    durationDays: null,
    // village page: "ideal playground for experienced kiters and a perfect learning space for beginners"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: kite.some(x => /Kite Courses/i.test(x.table)),
    equipmentRental: kite.some(x => /Rental/i.test(x.table)),
    beginnerFriendly: /perfect learning space for beginners/i.test(village),
    includedServices: ['Full board (breakfast, lunch, dinner)', 'Soft drinks, water, coffee and tea', 'Daily housekeeping'],
    optionalServices: [
      station ? `Kite station service for in-house guests (${station} per day, up to 6 days; weekly rates)` : 'Kite station service',
      basic ? `Kite courses (basic course 8 h private ${basic}; group and refresher courses)` : 'Kite courses',
      fullSetWeek ? `Kite equipment rental${rentalBrands ? ` (${rentalBrands})` : ''} (full set ${fullSetWeek} per week)` : 'Kite equipment rental',
      'Scuba diving packages and PADI courses',
      'Snorkeling trips (Satayah dolphin reef)',
      'Transfers from Marsa Alam and Hurghada airports',
    ],
    accommodation: 'Royal Tents (shared bathrooms) and Deluxe Chalets (en-suite)',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: WL_VILLAGE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `about: ${about}`,
      `location: ${location}`,
      `coords (village map script): ${lat},${lng}`,
      `rooms: ${rooms.map(r => `${r.name}: ${r.description} | ${r.features.join('; ')}`).join('\n')}`,
      `price period: ${period ? `${period.label} ${period.start}..${period.end} high ${period.highMonths.join(',')} low ${period.lowMonths.join(',')}` : '-'}`,
      `notes: ${notes.join(' | ')}`,
      `kite prices: ${kite.map(k => `${k.table}: ${k.item} ${k.price ?? '-'}`).join('; ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const wadiLahamiVillageHamata: OfferAdapter = {
  key: 'wadi-lahami-village-hamata',
  name: 'Wadi Lahami Village',
  kind: 'accommodation',
  operator: {
    name: 'Red Sea Diving Safari',
    websiteUrl: SITE,
    rootDomain: 'redsea-divingsafari.com',
  },
  url: WL_VILLAGE_URL,
  slotMethod: 'price_table',
  fetchBudget: 6,
  async fetchContent() {
    const [village, rooms, prices] = [
      await fetchText(WL_VILLAGE_URL, { accept: 'text/html' }),
      await fetchText(WL_ROOMS_URL, { accept: 'text/html' }),
      await fetchText(WL_PRICES_URL, { accept: 'text/html' }),
    ];
    return parseWadiLahamiContent({ village, rooms, prices });
  },
  async fetchSlots(ctx) {
    const today = todayIso();
    const first = await fetchText(WL_PRICES_URL, { accept: 'text/html' });
    const shown = parseWlPeriod(first);
    if (!shown || shown.rates.length === 0) throw new Error('wadi-lahami: price period or accommodation rate table not found (layout changed?)');
    const periods: WlPeriod[] = [shown];
    for (const link of parseWlPeriodLinks(first)) {
      if (link.end < today || periods.some(p => p.start === link.start && p.end === link.end && p.currency === 'EUR')) continue;
      const p = parseWlPeriod(await fetchText(link.url, { accept: 'text/html' }));
      if (!p || p.rates.length === 0) { ctx.incomplete(`price period ${link.label} not readable`); continue; }
      periods.push(p);
    }
    if (shown.currency !== 'EUR') ctx.note(`default price list is ${shown.label}`);
    return buildWlSlots(periods.filter(p => p.currency === 'EUR'), today);
  },
};
