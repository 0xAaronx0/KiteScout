// ---------------------------------------------------------------------------
// Skaven Strand Camping, Skaven Strand near Tarm (Ringkøbing Fjord, West Jutland, Denmark) - family beach campsite (about
// 250 units, heated pool, sauna) directly on the shallow fjord, which the site calls one of Northern Europe's best surf and
// kite areas; it names a surf school and "the possibility of instruction and an introduction to kitesurfing" (partners in
// the area, prices on request). Rental units: camping cabins for 2 and luxury cabins (35 m², 6 people); the ~80 holiday
// homes are a separate rental business and not listed here.
//
// Data path (checked 2026-10-14), WordPress / Elementor + TablePress, Danish pages (the English pages are 2025 copies):
//   content  / ("Campingpladsen åbner den 28/3 - 2026", surf school + kite sentence, "dagspriserne fra 400–450 kr."),
//            /surf-kite/ (spot, kite instruction), /camping-informationer/ (facts, 2026 activity programme).
//   slots    /priser/: TablePress table "Campinghytte | 2 personers hytte (per dag) | (per uge) | Luksushytter 35 m2 6 personer"
//            with rows "Hovedsæson" 450 / 2600 and "Andre sæsoner" 400 / 2400, luxury cabin "Dagspris 700 kr." (+ holiday
//            packages); the main-season dates are in the pitch-fee row ("i hovedsæson: 28.03-06.04.2026 14.05-17.05.2026
//            23.05-26.05.2026 27.06-16.08.2026"). The cabin table itself has no year (its "Påske 16/4-21/4" is Easter 2025).
//            Season end is not printed: inferred from the autumn-pitch period "Efterårsplads 15.08-24.10.2026" (closing day
//            24.10.2026, last night 23.10.).
// Booking engine: camping.skaven.dk ("daybooking" form flow with POST + session) - not used.
// robots.txt (2026-10-12): WordPress defaults (nothing we read).
// Requests per run: content 4, slots 1 (memoised with content).
// Parsed: slots = 2-person cabin x season band (main-season periods and the "other seasons" gaps between them inside
//   28.03.-23.10.2026) + luxury cabin over the whole season, DKK per cabin per night ('per_night', 'room'), availability
//   'unknown'; past bands dropped -> [] after 23.10.2026 until the next season's dates are published.
// Known limits: no map pin on the site (a Google place link without coordinates) - spotCoords omitted.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://skaven.dk';
export const SSC_HOME_URL = `${SITE}/`;
export const SSC_KITE_URL = `${SITE}/surf-kite/`;
export const SSC_INFO_URL = `${SITE}/camping-informationer/`;
export const SSC_PRICES_URL = `${SITE}/priser/`;
const BOOKING_URL = 'https://camping.skaven.dk/';

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the pages */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const cellText = (h: string): string => clean(h.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '));

/** Visible text lines (scripts, styles dropped), split at block tags. */
export function sscLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|table)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

/** TablePress rows of a page: arrays of cell texts (header row included). */
function tableRows(html: string): string[][] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(r => [...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => cellText(c[1])));
}

export interface SscPrices {
  cabin2: { mainDay: number | null; mainWeek: number | null; otherDay: number | null; otherWeek: number | null };
  luxury: { day: number | null; notes: string[]; label: string | null };
  mainPeriods: Array<{ start: string; end: string }>;
  autumnEnd: string | null;
}

/** /priser/: cabin table (Hovedsæson / Andre sæsoner rows, luxury column) + main-season periods from the pitch-fee row. */
export function parseSscPrices(html: string): SscPrices {
  const rows = tableRows(html);
  const head = rows.findIndex(r => /^Campinghytte$/i.test(r[0] ?? ''));
  const cabin2 = { mainDay: null as number | null, mainWeek: null as number | null, otherDay: null as number | null, otherWeek: null as number | null };
  const luxury = { day: null as number | null, notes: [] as string[], label: head >= 0 ? rows[head][3] ?? null : null };
  if (head >= 0) {
    for (const r of rows.slice(head + 1, head + 8)) {
      if (/^Hovedsæson$/i.test(r[0])) { cabin2.mainDay = parseAmount(r[1] ?? ''); cabin2.mainWeek = parseAmount(r[2] ?? ''); }
      if (/^Andre sæsoner$/i.test(r[0])) { cabin2.otherDay = parseAmount(r[1] ?? ''); cabin2.otherWeek = parseAmount(r[2] ?? ''); }
      const lx = r[3] ?? '';
      const day = lx.match(/Dagspris ([\d.]+) kr/i);
      if (day) luxury.day = parseAmount(day[1]);
      else if (/kr/i.test(lx)) luxury.notes.push(lx);
      if (/^Tillæg/i.test(r[0])) break;
    }
  }
  const fee = rows.find(r => /^Pladsgebyr standart?pladser$/i.test(r[0] ?? ''))?.[1] ?? '';
  const mainPeriods = [...fee.matchAll(/(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(20\d{2})/g)]
    .map(m => ({ start: iso(+m[5], +m[2], +m[1]), end: iso(+m[5], +m[4], +m[3]) }));
  const autumn = rows.find(r => /^Efterårsplads$/i.test(r[0] ?? ''))?.[1]?.match(/-(\d{2})\.(\d{2})\.(20\d{2})/);
  return { cabin2, luxury, mainPeriods, autumnEnd: autumn ? iso(+autumn[3], +autumn[2], +autumn[1]) : null };
}

/** "Campingpladsen åbner den 28/3 - 2026" */
export function parseSscOpening(html: string): string | null {
  const m = sscLines(html).join(' ').match(/åbner den (\d{1,2})\/(\d{1,2})\s*-\s*(20\d{2})/);
  return m ? iso(+m[3], +m[2], +m[1]) : null;
}

export const SSC_CABIN2 = 'Camping cabin for 2';
export const SSC_LUXURY = 'Luxury cabin (35 m², 6 people)';

/** Season bands: main periods (inclusive nights) and the "other seasons" gaps between them inside [open, lastNight]. */
export function sscBands(open: string, lastNight: string, main: Array<{ start: string; end: string }>): Array<{ season: 'main' | 'other'; start: string; end: string }> {
  const out: Array<{ season: 'main' | 'other'; start: string; end: string }> = [];
  let cur = open;
  for (const m of [...main].sort((a, b) => a.start.localeCompare(b.start))) {
    const s = m.start < open ? open : m.start;
    const e = m.end > lastNight ? lastNight : m.end;
    if (s > e) continue;
    if (cur < s) out.push({ season: 'other', start: cur, end: addDays(s, -1) });
    out.push({ season: 'main', start: s, end: e });
    cur = addDays(e, 1);
  }
  if (cur <= lastNight) out.push({ season: 'other', start: cur, end: lastNight });
  return out;
}

export function buildSscSlots(p: SscPrices, open: string | null, today: string): Slot[] {
  if (!open || !p.autumnEnd) return [];
  const lastNight = addDays(p.autumnEnd, -1);
  const base = { currency: 'DKK', priceUnit: 'per_night' as const, priceBasis: 'room' as const, occupancy: null, availability: 'unknown' as const, availabilityText: null, spotsLeft: null };
  const out: Slot[] = [];
  for (const b of sscBands(open, lastNight, p.mainPeriods)) {
    const price = b.season === 'main' ? p.cabin2.mainDay : p.cabin2.otherDay;
    if (b.end < today || !price) continue;
    out.push({ key: `cabin-2p|${b.start}`, startDate: b.start, endDate: b.end, unit: SSC_CABIN2, price, ...base });
  }
  if (p.luxury.day && lastNight >= today) out.push({ key: `luxury-cabin|${open}`, startDate: open, endDate: lastNight, unit: SSC_LUXURY, price: p.luxury.day, ...base });
  return out;
}

export interface SscPages { home: string; kite: string; info: string; prices: string }

export function parseSkavenContent(p: SscPages): OfferContent {
  const home = sscLines(p.home);
  const kite = sscLines(p.kite);
  const info = sscLines(p.info);
  const prices = parseSscPrices(p.prices);
  const open = parseSscOpening(p.home);
  const intro = kite.find(l => /Skaven Strand er kendt for sit lave vand/i.test(l)) ?? null;
  const lessons = kite.find(l => /undervisning og introduktion til kitesurfing/i.test(l)) ?? null;
  const school = home.find(l => /Surferskole/i.test(l)) ?? null;
  const area = info.find(l => /bedste surf og kite områder/i.test(l)) ?? null;
  const units = info.join(' ').match(/Antal enheder: (\d+)/)?.[1] ?? null;
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dk = (n: number | null) => (n ? `DKK ${n.toLocaleString('en-US')}` : '-');
  const rooms: ContentRoom[] = [
    {
      name: SSC_CABIN2,
      description: 'Camping cabin for two people on the campsite by the fjord; electricity by consumption, bed linen to bring or rent.',
      features: [`Main season: ${dk(prices.cabin2.mainDay)} per night, ${dk(prices.cabin2.mainWeek)} per week`, `Other seasons: ${dk(prices.cabin2.otherDay)} per night, ${dk(prices.cabin2.otherWeek)} per week`],
    },
    {
      name: SSC_LUXURY,
      description: 'Luxury cabin of 35 m² for up to six people; electricity by consumption.',
      features: [`${dk(prices.luxury.day)} per night`, ...prices.luxury.notes.map(n => `Package: ${n.replace(/^Uge /, 'Weeks ').replace(/Påske/, 'Easter').replace(/Chr himmelfart/, 'Ascension').replace(/Pinse/, 'Whitsun').replace(/,? kr\./g, ' DKK')}`)],
    },
  ];
  const imgs: string[] = [];
  for (const html of [p.kite, p.home, p.info]) {
    for (const m of html.matchAll(/https:\/\/skaven\.dk\/wp-content\/uploads\/[^"'\s)]+?\.(?:jpe?g|webp)/gi)) {
      if (/-\d+x\d+\.|logo|1200x675/i.test(m[0]) || imgs.includes(m[0])) continue;
      imgs.push(m[0]);
    }
  }

  const summary = [
    `Skaven Strand Camping is a family campsite${units ? ` with about ${units} units` : ''} directly on the beach of Ringkøbing Fjord near Tarm in West Jutland, Denmark, with a heated pool and sauna${open ? `; it opened on ${fmt(open)} for the season` : ''}.`,
    `Besides pitches it rents camping cabins for two (DKK ${prices.cabin2.otherDay ?? 400}-${prices.cabin2.mainDay ?? 450} per night depending on the season) and 35 m² luxury cabins for six (DKK ${prices.luxury.day ?? 700} per night).`,
    'The site calls the shallow fjord with its steady wind (especially May to September) one of the best surf and kite areas in Northern Europe, ideal for beginners, and names a surf school and the possibility of kitesurfing instruction through partners in the area.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Skaven Strand Camping',
    summary,
    continent: 'Europe',
    country: 'Denmark',
    region: 'Skaven Strand, West Jutland',
    spot: 'Skaven Strand',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: lessons ? true : null,
    equipmentRental: null,
    beginnerFriendly: true,
    includedServices: ['Showers, sauna and heated pool (in the person price)', 'Fjord access'],
    optionalServices: ['Kitesurfing instruction / introduction via partners in the area (on request)', 'Bed linen DKK 90 per set', 'Bike rental', 'Wi-Fi (DKK 25 per day)', 'Shop and café'],
    accommodation: 'camping cabins on a beach campsite',
    mealPlan: 'self_catering',
    languages: ['da', 'de', 'en'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: SSC_KITE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${school ?? ''} | opening ${open ?? '-'}`,
      `surf/kite: ${intro ?? ''} | ${lessons ?? ''}`,
      `camping info: ${area ?? ''}`,
      `prices: cabin for 2 main ${prices.cabin2.mainDay}/${prices.cabin2.mainWeek}, other ${prices.cabin2.otherDay}/${prices.cabin2.otherWeek}; luxury ${prices.luxury.day} (${prices.luxury.notes.join('; ')}); main season ${prices.mainPeriods.map(m => `${m.start}..${m.end}`).join(', ')}; autumn pitch until ${prices.autumnEnd ?? '-'}`,
    ].join('\n'),
  };
}

export async function fetchSscSlots(today: string): Promise<Slot[]> {
  const prices = parseSscPrices(await page(SSC_PRICES_URL));
  if (!prices.cabin2.mainDay && !prices.cabin2.otherDay) throw new Error('skaven-strand-camping: cabin table ("Campinghytte" / "Hovedsæson") not found on /priser/');
  return buildSscSlots(prices, parseSscOpening(await page(SSC_HOME_URL)), today);
}

export const skavenStrandCamping: OfferAdapter = {
  key: 'skaven-strand-camping',
  name: 'Skaven Strand Camping',
  kind: 'accommodation',
  operator: {
    name: 'Skaven Strand Camping og Sommerhusudlejning',
    websiteUrl: SITE,
    rootDomain: 'skaven.dk',
    contactEmail: 'info@skaven.dk',
    phone: '+4597374069',
  },
  url: SSC_KITE_URL,
  slotMethod: 'price_table',
  fetchBudget: 5,
  confidence: 'medium', // season end inferred, cabin table year-less
  async fetchContent() {
    const home = await page(SSC_HOME_URL);
    const kite = await page(SSC_KITE_URL);
    const info = await page(SSC_INFO_URL);
    const prices = await page(SSC_PRICES_URL);
    if (!/kite/i.test(kite)) throw new Error('skaven-strand-camping: kite text missing on /surf-kite/');
    return parseSkavenContent({ home, kite, info, prices });
  },
  async fetchSlots(ctx) {
    const slots = await fetchSscSlots(todayIso());
    if (slots.length === 0) ctx.note('skaven-strand-camping: no future band (season over or dates missing) - price on request');
    return slots;
  },
};
