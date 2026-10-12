// ---------------------------------------------------------------------------
// Dakhla Attitude, Dakhla Lagoon (Morocco) - kite resort of the Dakhla Hospitality Group on the lagoon at the
// Speed Spot / Dragon Island, with the Duotone Pro Center Dakhla (kite, wing, foil, windsurf) on its own
// beach; bungalows in two camps (Dragon Camp and Windhunter Camp, 500 m apart), full board and airport
// transfers included.
//
// Data path (checked 2026-10-12): WordPress site dakhla-attitude.ma (French pages; the English switcher
// only translates part of the site).
//   slots    one price page per bungalow category: /vips-2/ (VIP A, B, C), /dragoncamp/, /dragoncamp-premium/,
//            /windhunter-2/, /windhunter-premium-2/, /speed-spot-and-premium/ (Speed Spot, Speed Spot Premium).
//            Each category prints a wpDataTables grid ("Price | Basse Saison | Saison Standard | Haute Saison",
//            rows "1 pax" .. "5 pax", MAD per bungalow per night: "Les prix sont par BG et par nuit") followed
//            by its season list ("Haute Saison : – 05/09-26 ---- 08-11-26" ...). Below it a second grid with
//            the 2027 rates ("Nouveaux tarifs 2027 Applicables à compter du 9 novembre 2026") and the
//            2026/27 + 2027/28 season lists. Column order differs between grids (Haute | Intermédiaire |
//            Basse in the 2027 grids), so columns are read by their season word.
//   content  / (bungalow overview, resort, Duotone Pro Center), /activities/kitesurf/ (school, spot
//            conditions) + the price pages (bungalow texts, photos).
// Booking engine: eZee / Yanolja (live.ipms247.com/booking/book-rooms-dakhlaattitude). live.ipms247.com
//   answers HTTP 403 to our user agent (even /robots.txt, 2026-10-12) -> not used; no live availability.
//   Slots stay 'unknown'.
// robots.txt (2026-10-12): Yoast default, nothing disallowed.
// Requests per run: content 8, slots 6 (price pages are memoised for 10 minutes, so a full run makes 8).
// Parsed: slot = bungalow category x season band with the printed date limits ("windhunter-camp-2p|
//   2027-01-05"), MAD per bungalow per night for 2 guests (the double-occupancy rate; every category sells 2
//   guests). A grid's bands end the day before the next grid's first band (2026 grid -> 2026-11-08, then the
//   2027 grid from 2026-11-09); bands that ended before today are dropped. All occupancies (1-5 pax) go into
//   the room features.
// Known limits: the "7=6" offer (low and intermediate season) and child supplements are features only. The
//   Windhunter Premium grid is captioned "WINDHUNTER CAMP" on the site (copy-paste); its prices differ, so
//   units come from the page, not from the caption.
// Shared with westpoint-dakhla.ts (same group, same rate model): DhgBand / dhgBands / dhgSlots / dhgLines.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, meta, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://dakhla-attitude.ma';
export const DA_HOME_URL = `${SITE}/`;
const KITE_URL = `${SITE}/activities/kitesurf/`;
const BOOKING_URL = 'https://live.ipms247.com/booking/book-rooms-dakhlaattitude';

// --- shared Dakhla Hospitality Group helpers (also used by westpoint-dakhla.ts) ------------------
export type DhgLevel = 'low' | 'mid' | 'high';
export const DHG_LEVEL_NAME: Record<DhgLevel, string> = { low: 'low season', mid: 'intermediate season', high: 'high season' };
/** One printed rate grid: price per bungalow per night by season level and guests, plus its season list. */
export interface DhgTable { unit: string; prices: Partial<Record<DhgLevel, Record<number, number>>>; seasons: DhgBand[]; offer76?: boolean }
export interface DhgBand { level: DhgLevel; start: string; end: string }

export const dhgKey = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Visible text split at block tags (WPBakery / Elementor blocks and table cells: one entry each). */
export function dhgLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg|select)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|span|a|button|table)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

export function dhgLevel(word: string): DhgLevel | null {
  const t = word.toLowerCase();
  if (/basse|low/.test(t)) return 'low';
  if (/interm|standard|middle|moyenne/.test(t)) return 'mid';
  if (/haute|high/.test(t)) return 'high';
  return null;
}

/** "05/09-26", "08-11-26", "23/12/2026" -> ISO; 2-digit years are 20xx. */
export function dhgDate(d: string, m: string, y: string): string {
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  return iso(year, Number(m), Number(d));
}

const addDays = (isoDate: string, n: number): string => new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * Bands of consecutive grids: each grid's bands end the day before the next grid's first band (the newer
 * grid takes over), duplicates are dropped, and bands that ended before `today` are removed.
 */
export function dhgBands(tables: DhgTable[], today: string): Array<DhgBand & { table: DhgTable }> {
  const out: Array<DhgBand & { table: DhgTable }> = [];
  tables.forEach((t, i) => {
    const nextStart = tables.slice(i + 1).map(n => n.seasons.map(b => b.start).sort()[0]).find(Boolean) ?? null;
    for (const b of [...t.seasons].sort((x, y) => x.start.localeCompare(y.start))) {
      const end = nextStart && b.end >= nextStart ? addDays(nextStart, -1) : b.end;
      if (end < b.start || end < today) continue;
      if (out.some(o => o.start === b.start && o.table.unit === t.unit)) continue;
      out.push({ level: b.level, start: b.start, end, table: t });
    }
  });
  return out;
}

/** Slot per unit x band for `guests` guests; MAD per bungalow per night, availability unknown (engine blocked). */
export function dhgSlots(tablesByUnit: Map<string, DhgTable[]>, today: string, guests = 2, text: string | null = null): Slot[] {
  const out: Slot[] = [];
  for (const [unit, tables] of tablesByUnit) {
    for (const b of dhgBands(tables, today)) {
      const price = b.table.prices[b.level]?.[guests] ?? null;
      if (price === null) continue;
      out.push({
        key: `${dhgKey(unit)}-${guests}p|${b.start}`,
        startDate: b.start,
        endDate: b.end,
        unit,
        price,
        currency: 'MAD',
        priceUnit: 'per_night',
        priceBasis: 'room',
        occupancy: guests,
        availability: 'unknown',
        availabilityText: text ?? DHG_LEVEL_NAME[b.level],
        spotsLeft: null,
      });
    }
  }
  return out;
}

/** Room feature lines: every printed grid as "2027 rates from 2026-11-09, low / intermediate / high: 1 pax ..." */
export function dhgPriceFeatures(tables: DhgTable[]): string[] {
  return tables.map(t => {
    const first = t.seasons.map(b => b.start).sort()[0];
    const levels = (['low', 'mid', 'high'] as DhgLevel[]).filter(l => t.prices[l]);
    const pax = [...new Set(levels.flatMap(l => Object.keys(t.prices[l]!).map(Number)))].sort((a, b) => a - b);
    const rows = pax.map(n => `${n} pax ${levels.map(l => t.prices[l]?.[n]?.toLocaleString('en-US') ?? '-').join(' / ')}`);
    return `MAD per bungalow per night (${levels.map(l => DHG_LEVEL_NAME[l]).join(' / ')}), seasons from ${first ?? '?'}: ${rows.join('; ')}`;
  });
}

// --- Dakhla Attitude parsers -----------------------------------------------------------------
const NUM = /^\d{1,2}[ .,]?\d{3}$|^\d{3,4}$/;
const RANGE = /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\s*-{2,}\s*(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/;

/** Page -> category markers (multi-category pages); a grid belongs to the nearest marker above it. */
export const DA_PAGES: Array<{ path: string; units: Array<{ unit: string; marker: RegExp }> }> = [
  { path: '/vips-2/', units: [
    { unit: 'VIP A', marker: /^BUNGALOW - Vip A$/i }, { unit: 'VIP B', marker: /^BUNGALOW - Vip B$/i }, { unit: 'VIP C', marker: /^BUNGALOW - Vip C$/i },
  ] },
  { path: '/dragoncamp/', units: [{ unit: 'Dragon Camp', marker: /^$/ }] },
  { path: '/dragoncamp-premium/', units: [{ unit: 'Dragon Camp Premium', marker: /^$/ }] },
  { path: '/windhunter-2/', units: [{ unit: 'Windhunter Camp', marker: /^$/ }] },
  { path: '/windhunter-premium-2/', units: [{ unit: 'Windhunter Premium', marker: /^$/ }] },
  { path: '/speed-spot-and-premium/', units: [
    { unit: 'Speed Spot', marker: /^Speed Spot$/i }, { unit: 'Speed Spot Premium', marker: /^Speed Spot Premium$/i },
  ] },
];

/** All rate grids of one price page, in document order, each with the season list printed under it. */
export function parseDaTables(html: string, units: Array<{ unit: string; marker: RegExp }>): DhgTable[] {
  const ls = dhgLines(html);
  const out: DhgTable[] = [];
  let marker = units.length === 1 ? units[0].unit : null;
  let cur: DhgTable | null = null;
  let level: DhgLevel | null = null;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    const mk = units.length > 1 ? units.find(u => u.marker.test(l)) : undefined;
    if (mk) marker = mk.unit;
    // grid: "Price"/"Prix" + three season words
    if (/^(price|prix)$/i.test(l) && [1, 2, 3].every(k => ls[i + k] && ls[i + k].length < 30 && dhgLevel(ls[i + k]))) {
      const cols = [1, 2, 3].map(k => dhgLevel(ls[i + k])!);
      let j = i + 4;
      while (/^(mad|€)$/i.test(ls[j] ?? '')) j++;
      const prices: DhgTable['prices'] = {};
      while (/^(\d) pax$/i.test(ls[j] ?? '') && [1, 2, 3].every(k => NUM.test(ls[j + k] ?? ''))) {
        const pax = Number(ls[j].match(/^(\d)/)![1]);
        cols.forEach((c, k) => { (prices[c] ??= {})[pax] = Number(ls[j + k + 1].replace(/[ .,]/g, '')); });
        j += 4;
      }
      if (Object.keys(prices).length && marker) {
        cur = { unit: marker, prices, seasons: [] };
        out.push(cur);
        level = null;
      }
      i = j - 1;
      continue;
    }
    if (!cur) continue;
    if (/offre 7=6/i.test(l)) cur.offer76 = true;
    // season list under the grid: "Haute Saison :" / "Saison Intermédiaire:" / "Basse Saison :" + "– dd/mm/yy ---- dd/mm/yy"
    if (/:\s*$/.test(l) && l.length < 30 && dhgLevel(l)) { level = dhgLevel(l); continue; }
    const r = l.match(RANGE);
    if (r && level) {
      const start = dhgDate(r[1], r[2], r[3]); const end = dhgDate(r[4], r[5], r[6]);
      if (end >= start && !cur.seasons.some(b => b.start === start)) cur.seasons.push({ level, start, end });
    }
  }
  return out.filter(t => t.seasons.length > 0);
}

export function daTablesByUnit(pages: Array<{ path: string; html: string }>): Map<string, DhgTable[]> {
  const out = new Map<string, DhgTable[]>();
  for (const p of pages) {
    const def = DA_PAGES.find(d => d.path === p.path);
    if (!def) continue;
    for (const t of parseDaTables(p.html, def.units)) {
      if (!out.has(t.unit)) out.set(t.unit, []);
      out.get(t.unit)!.push(t);
    }
  }
  return out;
}

const PHOTO_JUNK = /logo|wall[-.]|Plan-DA|Capture|forecast|line-wind|DA-[A-Z]+\.png|\/\d+\.png$|airport-transfer|baby-sitting|boats\.png|car-rental|download|full-restaurant|hospital|laundry|WIFI/i;

/** Photos per page in document order (og:image first, then every uploads JPEG the page references: the
 *  Salient theme puts slider and gallery photos into style="background-image" and lightbox links), size
 *  variants folded, pages interleaved so every bungalow category contributes. */
export function daImages(pages: string[], max = 30): string[] {
  const seen = new Set<string>();
  const perPage = pages.map(html => {
    const og = meta(html, 'og:image');
    const list: string[] = [];
    for (const u of [og ?? '', ...[...html.matchAll(/https:\/\/dakhla-attitude\.ma\/wp-content\/uploads\/[^"'()\s]+?\.(?:jpe?g|webp)/gi)].map(m => m[0])]) {
      const url = u.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
      if (!url || PHOTO_JUNK.test(url)) continue;
      const k = url.replace(/-scaled(?=\.[a-z]+$)/i, '');
      if (seen.has(k)) continue;
      seen.add(k); list.push(url);
    }
    return list;
  });
  const out: string[] = [];
  for (let i = 0; out.length < max && perPage.some(l => l.length > i); i++) for (const l of perPage) if (l[i] && out.length < max) out.push(l[i]);
  return out;
}

export interface DaPages { home: string; kite: string; prices: Array<{ path: string; html: string }> }

/** English summaries of the French bungalow texts on the price pages (2026-10-12). */
const DA_ROOM_TEXT: Record<string, string> = {
  'VIP A': '40 m² VIP bungalow in the centre of Dragon Camp for up to 3 guests: living room with sofa and satellite TV, double bed, dressing room, terrace over the lagoon and Dragon Island.',
  'VIP B': '30 m² VIP bungalow for couples (up to 2 guests) on the left side of Dragon Camp, overlooking the lagoon and Dragon Island; double bed, dressing room, satellite TV.',
  'VIP C': 'VIP bungalow of 40-45 m² for up to 4 guests with double bed, satellite TV, bathroom with double basin and a private lounge.',
  'Dragon Camp': 'Standard bungalow of about 18 m² for up to 2 guests near reception, restaurant and bar; two single beds, private bathroom, terrace with lagoon view.',
  'Dragon Camp Premium': 'Family bungalow of about 32 m² for up to four adults (or two adults and two children) near the restaurant and bar; double bed, living space, terrace with lagoon view.',
  'Windhunter Camp': 'Eco bungalow of 16-30 m² for 2 to 5 guests in the quieter Windhunter Camp, 500 m from Dragon Camp; two single beds, private bathroom, terrace with lagoon view.',
  'Windhunter Premium': 'Premium bungalow in the Windhunter Camp, 500 m from Dragon Camp, for up to 4 guests (the rate grid goes to 4 pax); private bathroom and terrace.',
  'Speed Spot': 'Connecting bungalow between sand and lagoon with direct access to the Speed Spot, for up to 3 guests; private bathroom and terrace facing the desert and/or lagoon.',
  'Speed Spot Premium': 'Speed Spot bungalow for up to 4 guests with direct access to the Speed Spot; private bathroom and terrace facing the desert and/or lagoon.',
};

export function parseDakhlaAttitudeContent(p: DaPages): OfferContent {
  const home = dhgLines(p.home);
  const kite = dhgLines(p.kite);
  const byUnit = daTablesByUnit(p.prices);
  const kiteText = kite.join(' ');
  const rooms: ContentRoom[] = [...byUnit.entries()].map(([unit, tables]) => ({
    name: unit,
    description: DA_ROOM_TEXT[unit] ?? null,
    features: [
      'Full board, airport transfers, Wi-Fi and fitness room included',
      ...dhgPriceFeatures(tables),
      ...(tables.some(t => t.offer76) ? ['Offer 7=6: stay 7 nights, pay 6 in low and intermediate season'] : []),
    ],
  }));
  // headline: the newest grid of each category (the 2027 rates on 2026-10-12), 2 guests
  const all2 = [...byUnit.values()].map(ts => ts[ts.length - 1]).flatMap(t => Object.values(t.prices).map(x => x?.[2]).filter((n): n is number => typeof n === 'number'));
  const nUnits = byUnit.size;
  const og = meta(p.home, 'og:image');

  const summary = [
    'Dakhla Attitude is a kite resort on the Dakhla lagoon in southern Morocco, at the Speed Spot facing Dragon Island, run by the Dakhla Hospitality Group.',
    `It has ${nUnits} bungalow categories in two camps (Dragon Camp near reception, restaurant and bar; Windhunter Camp 500 m away), from 18 m² standard bungalows to VIP bungalows, with full board and airport transfers included${all2.length ? `; with the current rates 2 guests pay from MAD ${Math.min(...all2).toLocaleString('en-US')} per bungalow per night` : ''}.`,
    'The resort\'s Duotone Pro Center Dakhla is open all year and teaches kitesurfing on the flat, shallow lagoon with IKO or VDWS instructors, and also offers wing foil, kite foil, windsurf and wakeboarding.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Dakhla Attitude',
    summary,
    continent: 'Africa',
    country: 'Morocco',
    region: 'Dakhla-Oued Ed-Dahab',
    spot: 'Dakhla Lagoon',
    itinerarySpots: [],
    durationDays: null,
    // kite page: "Convient pour : Débutants/Intermédiaires/Avancés/Professionnels"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /cours de kitesurf/i.test(kiteText),
    equipmentRental: /location|rental/i.test(`${home.join(' ')} ${kiteText}`),
    beginnerFriendly: /débutants/i.test(kiteText),
    includedServices: ['Full board', 'Airport transfers (return)', 'Wi-Fi', 'Fitness room'],
    optionalServices: [
      'Kitesurf lessons at the Duotone Pro Center (private and semi-private; IKO / VDWS instructors)',
      'Kite, wing and windsurf equipment (Duotone)',
      'Wing foil, kite foil, wakefoil, windsurf, SUP, wakeboard',
      'Excursions to other spots around Dakhla, downwinders',
      'Spa, padel, kids club, surf shop',
    ],
    accommodation: 'bungalows in two camps (Dragon Camp, Windhunter Camp) and VIP bungalows',
    mealPlan: 'full_board',
    // kite page: lessons mainly in English and French, also German, Spanish, Polish and Arabic
    languages: ['en', 'fr', 'de', 'es', 'pl', 'ar'],
    rooms,
    imageUrls: daImages([p.home, ...p.prices.map(x => x.html), p.kite]),
    heroVideoUrl: null,
    sourceUrl: DA_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home.join(' ')}`,
      `kitesurf: ${kiteText}`,
      ...p.prices.map(x => `${x.path}: ${dhgLines(x.html).join(' ')}`),
      `og:image ${og ?? ''}`,
    ].join('\n'),
  };
}

// --- fetch (memoised so content + slots in one run read each price page once) -------------------
const memo = new Map<string, { at: number; text: Promise<string> }>();
export function dhgFetch(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.text;
  const text = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), text });
  text.catch(() => memo.delete(url));
  return text;
}

async function daPricePages(): Promise<Array<{ path: string; html: string }>> {
  const out: Array<{ path: string; html: string }> = [];
  for (const d of DA_PAGES) out.push({ path: d.path, html: await dhgFetch(`${SITE}${d.path}`) });
  return out;
}

export async function fetchDaSlots(today = todayIso()): Promise<Slot[]> {
  const byUnit = daTablesByUnit(await daPricePages());
  const expected = DA_PAGES.flatMap(d => d.units.map(u => u.unit));
  const missing = expected.filter(u => !byUnit.has(u));
  if (missing.length) throw new Error(`dakhla-attitude: no rate grid with season list for ${missing.join(', ')} (layout changed?)`);
  return dhgSlots(byUnit, today);
}

// --- adapter ----------------------------------------------------------------------------------
export const dakhlaAttitudeDakhla: OfferAdapter = {
  key: 'dakhla-attitude-dakhla',
  name: 'Dakhla Attitude',
  kind: 'accommodation',
  operator: {
    name: 'Dakhla Attitude (Dakhla Hospitality Group)',
    websiteUrl: SITE,
    rootDomain: 'dakhla-attitude.ma',
    contactEmail: 'booking@dakhla-attitude.ma',
    phone: '+212661835010',
  },
  url: DA_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 9,
  async fetchContent() {
    const home = await dhgFetch(DA_HOME_URL);
    const kite = await dhgFetch(KITE_URL);
    return parseDakhlaAttitudeContent({ home, kite, prices: await daPricePages() });
  },
  async fetchSlots() {
    return fetchDaSlots();
  },
};
