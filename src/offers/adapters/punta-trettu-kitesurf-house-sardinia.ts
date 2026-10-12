// ---------------------------------------------------------------------------
// Punta Trettu Kitesurf House (Villa Punta Trettu), San Giovanni Suergiu (south-west Sardinia, Italy) -
// a villa with 4 independent suites rented to one group at a time, a short walk from the Punta Trettu
// lagoon kite spot; gear storage, outdoor showers, pool; 10% off with a course at the partner kite school.
//
// Data path (checked 2026-10-12): WordPress (Twenty Twenty + Twentig), English pages:
//   slots    /prices/  two <table class="custom-table"> blocks: "PUNTA TRETTU KITE VILLA – LOW SEASON"
//            "(from September to June)" and "– HIGH SEASON" "(July and August)"; header = rooms used
//            ("2 rooms (up to 4 people)"), rows = stay length ("5 or 6 nights", "7 ore 8 nights",
//            "9 or more nights"), cells = EUR per night for the entire villa. Yoast dateModified
//            2026-08-24. No year on the tables.
//   content  / (villa, kite facilities, location), /punta-trettu-rooms/ (suite features + photos),
//            /prices/ (cleaning fee, deposit, "Stay & Kite" discount).
// Booking: Google Form request + availability confirmed by mail (the site also points to an Airbnb
//   calendar, a portal we do not read) -> 'on_request'.
// robots.txt (2026-10-12): only crawl-delay lines for MSNBot/bingbot (allow all).
// Requests per run: content 3, slots 1.
// Parsed: slot = rooms used x season band at the base rate (shortest stay row, 5 nights):
//   "2-rooms-4p|low|2026-27", EUR per night for the whole villa (priceBasis 'group', occupancy = max
//   persons), minNights 5, datePrecision 'month'. Season bands = the next occurrence of the printed
//   month ranges that has not ended yet (inferred year; the tables print months only).
// Known limits: longer-stay rates (7-8 and 9+ nights) are long-stay reductions and go into the room
//   features, not into slots; the cleaning fee (EUR 100 + 30 per extra room) is not in the price.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, iso, monthOf, parse, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://puntatrettukitesurfhouse.com';
export const PTK_HOME_URL = `${SITE}/`;
export const PTK_PRICES_URL = `${SITE}/prices/`;
export const PTK_ROOMS_URL = `${SITE}/punta-trettu-rooms/`;
const BOOKING_URL = `${SITE}/booking/`;

export interface PtkColumn { rooms: number; persons: number; label: string }
export interface PtkRow { code: string; nightsLabel: string; minNights: number | null; prices: number[] }
export interface PtkTable { season: string; startMonth: number; endMonth: number; monthsLabel: string; columns: PtkColumn[]; rows: PtkRow[] }

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const text = (h: string): string => collapse(parse(h).text);
function daysIn(year: number, month: number): number { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

// --- pure parsers -----------------------------------------------------------------------------
/** "(from September to June)" / "(July and August)" -> first and last month. */
export function parseMonthRange(s: string): { startMonth: number; endMonth: number } | null {
  const words = [...s.matchAll(/[A-Za-z]+/g)].map(m => monthOf(m[0])).filter((m): m is number => m !== null);
  if (words.length < 2) return null;
  return { startMonth: words[0], endMonth: words[words.length - 1] };
}

/** Both season tables of /prices/. */
export function parsePtkTables(html: string): PtkTable[] {
  const out: PtkTable[] = [];
  for (const t of html.matchAll(/<table class="custom-table">([\s\S]*?)<\/table>/g)) {
    const body = t[1];
    const title = text(body.match(/class="title-main">([\s\S]*?)<\/th>/)?.[1] ?? '');
    const sub = text(body.match(/class="title-sub">([\s\S]*?)<\/th>/)?.[1] ?? '');
    const season = title.match(/(LOW|HIGH|MID)\s+SEASON/i)?.[1].toLowerCase();
    const range = parseMonthRange(sub);
    if (!season || !range) continue;
    const head = body.match(/<tr[^>]*>\s*<th>N\.<\/th>([\s\S]*?)<\/tr>/)?.[1] ?? '';
    const columns: PtkColumn[] = [...head.matchAll(/<th>([\s\S]*?)<\/th>/g)].map(m => text(m[1].replace(/<br\s*\/?>/gi, ' ')))
      .map(label => {
        const m = label.match(/(\d+)\s+rooms?\s*\(up to (\d+) people\)/i);
        return m ? { rooms: Number(m[1]), persons: Number(m[2]), label } : null;
      }).filter((c): c is PtkColumn => c !== null);
    const rows: PtkRow[] = [];
    for (const r of (body.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...r[1].matchAll(/<td(?![^>]*rowspan)[^>]*>([\s\S]*?)<\/td>/g)].map(m => text(m[1]));
      if (cells.length < 2 + columns.length) continue;
      const prices = cells.slice(2, 2 + columns.length).map(c => parseAmount(c) ?? NaN);
      if (prices.some(p => !Number.isFinite(p))) continue;
      const n = cells[1].match(/(\d+)/);
      rows.push({ code: cells[0], nightsLabel: cells[1].replace(/\bore\b/, 'or'), minNights: n ? Number(n[1]) : null, prices });
    }
    if (columns.length && rows.length) out.push({ season, ...range, monthsLabel: sub.replace(/^\(|\)$/g, ''), columns, rows });
  }
  return out;
}

/** Next occurrence of a month range that has not ended on `today` (ranges may wrap the year end). */
export function seasonBand(startMonth: number, endMonth: number, today: string): { start: string; end: string; label: string } {
  const y = Number(today.slice(0, 4));
  for (const sy of [y - 1, y, y + 1]) {
    const ey = endMonth < startMonth ? sy + 1 : sy;
    const start = iso(sy, startMonth, 1);
    const end = iso(ey, endMonth, daysIn(ey, endMonth));
    if (end >= today) return { start, end, label: ey === sy ? String(sy) : `${sy}-${String(ey).slice(2)}` };
  }
  throw new Error('unreachable');
}

/** Slots = rooms used x season at the base (shortest-stay) rate; longer-stay rates stay in the features. */
export function buildPtkSlots(tables: PtkTable[], today: string): Slot[] {
  const out: Slot[] = [];
  for (const t of tables) {
    const band = seasonBand(t.startMonth, t.endMonth, today);
    const base = [...t.rows].sort((a, b) => (a.minNights ?? 99) - (b.minNights ?? 99))[0];
    t.columns.forEach((c, i) => {
      out.push({
        key: `${keyPart(`${c.rooms} room${c.rooms > 1 ? 's' : ''} ${c.persons}p`)}|${t.season}|${band.label}`,
        startDate: band.start,
        endDate: band.end,
        unit: `Entire villa, ${c.rooms} room${c.rooms > 1 ? 's' : ''} (up to ${c.persons} people)`,
        price: base.prices[i],
        currency: 'EUR',
        priceUnit: 'per_night',
        priceBasis: 'group',
        occupancy: c.persons,
        availability: 'on_request',
        availabilityText: null,
        spotsLeft: null,
        datePrecision: 'month',
        minNights: base.minNights,
      });
    });
  }
  return out;
}

function mainText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav, svg')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}
const pick = (t: string, re: RegExp): string | null => t.match(re)?.[0]?.trim() ?? null;

/** Own photos (wp-content/uploads on this host), originals (no -WxH), logos and icons dropped. */
export function ptkImages(pages: string[], max = 30): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const html of pages) {
    for (const m of html.matchAll(/https:\/\/puntatrettukitesurfhouse\.com\/wp-content\/uploads\/[^"' )?,]+\.jpe?g/gi)) {
      const u = m[0].replace(/-\d+x\d+(\.[a-z]+)$/i, '$1');
      if (/logo|favicon|icon|mail-to|whatsapp/i.test(u)) continue;
      const k = u.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); out.push(u);
    }
  }
  return out.slice(0, max);
}

export interface PtkPages { home: string; prices: string; rooms: string }

export function parsePuntaTrettuContent(p: PtkPages, today = todayIso()): OfferContent {
  const home = mainText(p.home);
  const prices = mainText(p.prices);
  const rooms = mainText(p.rooms);
  const tables = parsePtkTables(p.prices);
  const all = tables.flatMap(t => t.rows.flatMap(r => r.prices));
  const minN = Math.min(...tables.flatMap(t => t.rows.map(r => r.minNights ?? 99)));
  const cleaning = pick(prices, /The cleaning fee is[^.]*\./i);
  const discount = pick(prices, /The 10% discount on your stay is reserved for[^.]*\./i);
  const airport = pick(home, /\d+h drive from Cagliari[^.]*\./i);
  const nSuites = home.match(/(\d+) (?:private en-suite rooms|independent suites|independent rooms)/i)?.[1] ?? '4';

  const rateFeatures = tables.flatMap(t => t.columns.map((c, i) =>
    `${t.season === 'low' ? 'Low' : t.season === 'high' ? 'High' : 'Mid'} season (${t.monthsLabel}), ${c.label}: ${t.rows.map(r => `${r.nightsLabel} EUR ${r.prices[i]}`).join(' / ')} per night`));
  const contentRooms: ContentRoom[] = [
    {
      name: 'Entire villa (exclusive use)',
      description: `The whole property for one group, priced per night by the number of suites used (1 to ${nSuites}) and the length of stay.`,
      features: [...rateFeatures, ...(cleaning ? [cleaning] : []), 'Security deposit, refunded at check-out'],
    },
    {
      name: 'Independent suite',
      description: 'Each suite has its own armoured external door with a personal code and an en-suite bathroom; there are no corridors or reception.',
      features: ['Private external entrance', 'En-suite bathroom with shower', 'Smart Wi-Fi air conditioning and heating', 'High-speed Wi-Fi', 'Storage space', 'Outdoor sitting area'],
    },
  ];

  const summary = [
    `Punta Trettu Kitesurf House rents its villa near San Giovanni Suergiu in south-west Sardinia to one group at a time: ${nSuites} independent suites, each with its own entrance and en-suite bathroom, a short walk from the flat, shallow Punta Trettu lagoon.`,
    'The villa has a swimming pool, a professional kitchen (self-catering), a large garden with BBQ, private parking, gear storage, outdoor showers and a washer-dryer for kite equipment.',
    all.length ? `Rates are per night for the whole villa, from EUR ${Math.min(...all)} to ${Math.max(...all)} depending on season (low September-June, high July-August), suites used and length of stay (minimum ${Number.isFinite(minN) && minN < 99 ? minN : 5} nights), plus a final cleaning fee.` : '',
    'Groups in which every guest takes a 10-hour course with the partner kite school get 10% off the stay.',
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Punta Trettu Kitesurf House',
    summary,
    continent: 'Europe',
    country: 'Italy',
    region: 'Punta Trettu, Sardinia',
    spot: 'Punta Trettu',
    itinerarySpots: [],
    durationDays: null,
    // home: "Whether your crew includes absolute beginners or seasoned freestylers" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: null,          // lessons through the partner school, not by the house itself
    equipmentRental: null,
    beginnerFriendly: /absolute beginners/i.test(home) ? true : null,
    includedServices: ['Exclusive use of the whole villa', 'Swimming pool and solarium', 'Professional kitchen', 'Gear storage, washing area and outdoor showers', 'Washer-dryer', 'Wi-Fi', 'Private parking'],
    optionalServices: ['10-hour kite course with the partner school (10% off the stay when all guests attend)', 'Private transfers on request'],
    accommodation: `private villa with ${nSuites} independent suites (whole-villa rental)`,
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms: contentRooms,
    imageUrls: ptkImages([p.home, p.rooms]),
    heroVideoUrl: null,
    sourceUrl: PTK_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `villa: ${home.slice(0, 3000)}`,
      `suites: ${rooms.slice(0, 2500)}`,
      `rates: ${tables.map(t => {
        const b = seasonBand(t.startMonth, t.endMonth, today);
        return `${t.season} (${t.monthsLabel}; next band ${b.start}..${b.end}): ${t.columns.map((c, i) => `${c.label} ${t.rows.map(r => `${r.code} ${r.nightsLabel} ${r.prices[i]}`).join(', ')}`).join(' | ')}`;
      }).join('\n')}`,
      `cleaning: ${cleaning ?? ''}`,
      `discount: ${discount ?? ''}`,
      `airport: ${airport ?? ''}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const puntaTrettuKitesurfHouseSardinia: OfferAdapter = {
  key: 'punta-trettu-kitesurf-house-sardinia',
  name: 'Punta Trettu Kitesurf House Sardinia',
  kind: 'accommodation',
  operator: {
    name: 'Punta Trettu Kitesurf House',
    websiteUrl: SITE,
    rootDomain: 'puntatrettukitesurfhouse.com',
    whatsapp: '+393286858458',
  },
  url: PTK_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 5,
  async fetchContent() {
    const [home, prices, rooms] = [
      await fetchText(PTK_HOME_URL, { accept: 'text/html' }),
      await fetchText(PTK_PRICES_URL, { accept: 'text/html' }),
      await fetchText(PTK_ROOMS_URL, { accept: 'text/html' }),
    ];
    return parsePuntaTrettuContent({ home, prices, rooms });
  },
  async fetchSlots() {
    const tables = parsePtkTables(await fetchText(PTK_PRICES_URL, { accept: 'text/html' }));
    if (tables.length < 2) throw new Error(`punta-trettu-kitesurf-house: expected the low + high season tables on /prices/, parsed ${tables.length}`);
    return buildPtkSlots(tables, todayIso());
  },
};
