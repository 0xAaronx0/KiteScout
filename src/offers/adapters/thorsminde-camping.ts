// ---------------------------------------------------------------------------
// Thorsminde Camping, Thorsminde (Nissum Fjord, West Jutland, Denmark) - family campsite between the North Sea and Nissum
// Fjord with three cabin types (fishing huts for 2, family cabins for 4-6, meadow cabins for 6). Kitesurfing straight from
// the campsite on the shallow, stone-free fjord (water sports allowed 1/4-31/10, fjord access included for guests); a German
// school (thorsminde-kiten.com, contact Tobias) runs seven-day VDWS beginner courses at the campsite with all equipment.
//
// Data path (checked 2026-10-14), WordPress / Elementor:
//   content  /en/ (intro), /en/kitesurfing/ (spot rules, VDWS course, day pass DKK 75), /en/cabins/ (three cabin blocks:
//            <h2>/<h3> heading + paragraph with m² and persons).
//   slots    /priser/ (Danish; the English /en/prices/ has the same day rates but a different weekly price for the fishing
//            hut in high season, 3,300 vs 3,850 = 7 x 550 - the Danish page is used): "Priser på Thorsminde Camping 2026",
//            "Åben fra fredag d. 27/3 … – søndag d. 18/10", cabin prices per "døgn" (night) and "uge" (week) for
//            LAVSÆSON "27/3-26/6 og 17/8-18/10" and HØJSÆSON. The cabin table prints the high season as "27/6-18/10", which
//            overlaps the low season; the high band is taken from the pitch-fee line of the same page
//            ("Pladsgebyr i højsæson 27/6-16/8") - inferred, see report.
// Booking engine: Compusoft (v3.onlinebooking.dk/v3thorsmin, the "Book nu" button) lists the cabins, but on 2026-10-12 it had
//   no bookable unit at all for 2027 (season not loaded) - not used; the shared Compusoft helpers in hvide-sande-camping.ts
//   could take over once 2027 is bookable.
// robots.txt (2026-10-12): WordPress defaults (nothing we read).
// Requests per run: content 4, slots 1 (memoised with content).
// Parsed: slot = cabin type x season band (real limits, last night before the closing day 18/10), DKK per cabin per night
//   (priceUnit 'per_night', priceBasis 'room'), availability 'unknown'; past bands dropped -> [] after 17.10.2026 until the
//   2027 prices are published.
// Known limits: no map pin on the site (address link only) - spotCoords omitted; weekly prices go into the room features.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://thorsmindecamping.dk';
export const TMC_HOME_URL = `${SITE}/en/`;
export const TMC_KITE_URL = `${SITE}/en/kitesurfing/`;
export const TMC_CABINS_URL = `${SITE}/en/cabins/`;
export const TMC_PRICES_URL = `${SITE}/priser/`;
const BOOKING_URL = 'https://v3.onlinebooking.dk/v3thorsmin?lang=GB';

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the price page */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Visible text lines of the page (scripts, styles dropped; zero-width spaces removed). */
export function tmcLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|table)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')).replace(/[​ ]/g, ' ').trim())
    .filter(Boolean);
}

export const TMC_UNITS: Record<string, string> = { fiskehytte: 'Fishing hut', familiehytte: 'Family cabin', enghytte: 'Meadow cabin' };
export interface TmcRate { type: string; persons: string; season: 'low' | 'high'; night: number | null; week: number | null }
export interface TmcPrices {
  year: number | null; open: string | null; close: string | null;
  bands: Array<{ season: 'low' | 'high'; start: string; end: string }>;
  rates: TmcRate[]; cleaning: Record<string, number>; printedHigh: string | null;
}

/** Danish price page: year, opening, season ranges (d/m-d/m), cabin day / week prices per season, final cleaning. */
export function parseTmcPrices(html: string): TmcPrices {
  const lines = tmcLines(html);
  const text = lines.join('\n');
  const year = Number(text.match(/Priser på Thorsminde Camping (20\d{2})/)?.[1] ?? NaN) || null;
  const op = text.match(/Åben fra [a-zæøå]+ d\. (\d{1,2})\/(\d{1,2})[\s\S]{0,40}?–\s*[a-zæøå]+ d\. (\d{1,2})\/(\d{1,2})/i);
  const open = year && op ? iso(year, +op[2], +op[1]) : null;
  const close = year && op ? iso(year, +op[4], +op[3]) : null;
  const dm = (s: string) => (year ? iso(year, +s.split('/')[1], +s.split('/')[0]) : null);
  const bands: TmcPrices['bands'] = [];
  const rates: TmcRate[] = [];
  let season: 'low' | 'high' | null = null;
  let printedHigh: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^LAVSÆSON$/i.test(l)) {
      season = 'low';
      for (const m of (lines[i + 1] ?? '').matchAll(/(\d{1,2}\/\d{1,2})\s*[-–]\s*(\d{1,2}\/\d{1,2})/g)) {
        const s = dm(m[1]); let e = dm(m[2]);
        if (s && e) { if (e === close) e = addDays(e, -1); bands.push({ season: 'low', start: s, end: e }); }
      }
      continue;
    }
    if (/^HØJSÆSON$/i.test(l)) { season = 'high'; printedHigh = lines[i + 1] ?? null; continue; }
    if (/slutrengøring|^Fastligger/i.test(l)) season = null;
    const r = l.match(/^(Fiskehytte|Familiehytte|Enghytte) \(([\d-]+) pers\.\) pr\. (døgn|uge)(?:\s+Dkr ([\d.,]+))?$/i);
    if (r && season) {
      const v = parseAmount(r[4] ?? lines[i + 1] ?? '');
      let rate = rates.find(x => x.type === r[1].toLowerCase() && x.season === season);
      if (!rate) { rate = { type: r[1].toLowerCase(), persons: r[2], season, night: null, week: null }; rates.push(rate); }
      if (/uge/i.test(r[3])) rate.week = v; else rate.night = v;
    }
  }
  // high season = the pitch-fee line "Pladsgebyr i højsæson 27/6-16/8" (the cabin table's "27/6-18/10" overlaps the low season)
  const hi = text.match(/Pladsgebyr i højsæson (\d{1,2}\/\d{1,2})\s*[-–]\s*(\d{1,2}\/\d{1,2})/i);
  if (hi && dm(hi[1]) && dm(hi[2])) bands.push({ season: 'high', start: dm(hi[1])!, end: dm(hi[2])! });
  const cleaning: Record<string, number> = {};
  const fc = text.match(/Fiskehytte slutrengøring kan tilkøbes\s*\n?\s*kr\. ([\d.,]+)/i);
  const oc = text.match(/Familie- og enghytte slutrengøring kan tilkøbes\s*\n?\s*kr\. ([\d.,]+)/i);
  if (fc && parseAmount(fc[1])) cleaning.fiskehytte = parseAmount(fc[1])!;
  if (oc && parseAmount(oc[1])) { cleaning.familiehytte = parseAmount(oc[1])!; cleaning.enghytte = parseAmount(oc[1])!; }
  return { year, open, close, bands: bands.sort((a, b) => a.start.localeCompare(b.start)), rates, cleaning, printedHigh };
}

export const tmcUnit = (r: Pick<TmcRate, 'type' | 'persons'>): string => `${TMC_UNITS[r.type] ?? r.type} (${r.persons} people)`;

export function buildTmcSlots(p: TmcPrices, today: string): Slot[] {
  const out: Slot[] = [];
  for (const b of p.bands) {
    if (b.end < today) continue;
    for (const r of p.rates.filter(x => x.season === b.season && x.night)) {
      out.push({
        key: `${r.type}|${b.start}`,
        startDate: b.start,
        endDate: b.end,
        unit: tmcUnit(r),
        price: r.night,
        currency: 'DKK',
        priceUnit: 'per_night',
        priceBasis: 'room',
        occupancy: null,
        availability: 'unknown',
        availabilityText: null,
        spotsLeft: null,
      });
    }
  }
  return out;
}

/** English cabin blocks: heading line + following paragraph (m², persons, bathroom). */
export function parseTmcCabins(html: string): Array<{ name: string; description: string }> {
  const lines = tmcLines(html);
  const out: Array<{ name: string; description: string }> = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^(Meadow cabins? with toilet and shower|Family cabin with toilet and shower|Fishing cabin with shared toilet and shower)$/i.test(lines[i])) continue;
    const d = lines[i + 1];
    if (!/\d+ m²/.test(d) || out.some(x => x.name.toLowerCase() === lines[i].toLowerCase())) continue;
    out.push({ name: lines[i], description: d.replace(/\s*Read more about our [^.]*\.\s*$/, '') });
  }
  return out;
}

export interface TmcPages { home: string; kite: string; cabins: string; prices: string }

export function parseThorsmindeContent(p: TmcPages): OfferContent {
  const kite = tmcLines(p.kite);
  const home = tmcLines(p.home);
  const prices = parseTmcPrices(p.prices);
  const cabins = parseTmcCabins(p.cabins);
  const course = kite.find(l => /VDWS guidelines/i.test(l)) ?? null;
  const rules = kite.find(l => /only be used for water sports during the period/i.test(l)) ?? null;
  const pass = kite.find(l => /day pass costs DKK (\d+)/i.test(l))?.match(/DKK (\d+)/)?.[1] ?? null;
  const school = p.kite.match(/href="(https?:\/\/(?:www\.)?thorsminde-kiten\.[a-z]+\/?)"/)?.[1] ?? p.home.match(/href="(https?:\/\/(?:www\.)?thorsminde-kiten\.[a-z]+\/?)"/)?.[1] ?? null;
  const dk = (n: number | null | undefined) => (n ? `DKK ${n.toLocaleString('en-US')}` : '-');
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const typeOf = (name: string) => (/meadow/i.test(name) ? 'enghytte' : /family/i.test(name) ? 'familiehytte' : 'fiskehytte');
  const rooms: ContentRoom[] = cabins.map(c => {
    const t = typeOf(c.name);
    return {
      name: c.name.replace(/^Meadow cabins/i, 'Meadow cabin'),
      description: c.description,
      features: [
        ...prices.rates.filter(r => r.type === t).map(r => `${prices.year ?? ''} ${r.season} season: ${dk(r.night)} per night, ${dk(r.week)} per week`.trim()),
        ...(prices.cleaning[t] ? [`Final cleaning ${dk(prices.cleaning[t])} (optional)`] : []),
      ],
    };
  });
  const nights = prices.rates.map(r => r.night).filter((x): x is number => !!x);
  const imgs: string[] = [];
  for (const html of [p.cabins, p.kite, p.home]) {
    for (const m of html.matchAll(/(?:src|href|data-src)="(https:\/\/thorsmindecamping\.dk\/wp-content\/uploads\/[^"]+?\.(?:jpe?g|webp))"/gi)) {
      const u = m[1];
      if (/-\d+x\d+\.|logo|icon|ACSI|DK-CAMP|banner/i.test(u) || imgs.includes(u)) continue;
      imgs.push(u);
    }
  }

  const summary = [
    `Thorsminde Camping is a family campsite between the North Sea and Nissum Fjord at Thorsminde in West Jutland, Denmark${prices.open && prices.close ? `, open ${fmt(prices.open)} to ${fmt(prices.close)}` : ''}.`,
    `It rents fishing huts for two (shared toilet and shower), family cabins for 4-6 and meadow cabins for 6 with their own shower and toilet${nights.length ? `; ${prices.year} prices run from DKK ${Math.min(...nights)} to ${Math.max(...nights)} per night` : ''}.`,
    `Kitesurfers ride straight from the campsite on the shallow, stone-free fjord (water sports allowed from 1 April to 31 October, fjord access included for guests), and a German school runs seven-day VDWS beginner courses at the campsite with all equipment provided.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Thorsminde Camping',
    summary,
    continent: 'Europe',
    country: 'Denmark',
    region: 'Thorsminde, West Jutland',
    spot: 'Thorsminde',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: course ? true : null,
    equipmentRental: null,
    beginnerFriendly: true,
    includedServices: ['Fjord access for kitesurfing', 'Indoor pool with sauna (Maundy Thursday to 1 September)', 'Fitness room and activity room', 'Wi-Fi'],
    optionalServices: [
      'Seven-day VDWS kitesurfing beginner course with equipment (German school, contact Tobias +49 179 510 2925)',
      ...(pass ? [`Kite day pass for non-guests DKK ${pass}`] : []),
      'Final cleaning (DKK 300 fishing hut, DKK 500 family / meadow cabin)', 'Linen package DKK 110', 'Dog in the cabin DKK 100 per stay',
    ],
    accommodation: 'camping cabins on a family campsite',
    mealPlan: 'self_catering',
    languages: ['da', 'en', 'de'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: TMC_KITE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home.find(l => /North Sea meets Nissum Fjord/i.test(l)) ?? ''}`,
      `kite: ${rules ?? ''} | ${course ?? ''} | day pass DKK ${pass ?? '-'} | school ${school ?? '-'}`,
      `cabins: ${cabins.map(c => `${c.name}: ${c.description}`).join(' | ')}`,
      `prices ${prices.year} (open ${prices.open}..${prices.close}): ${prices.bands.map(b => `${b.season} ${b.start}..${b.end}`).join('; ')} | printed high season "${prices.printedHigh ?? '-'}" | ${prices.rates.map(r => `${r.type} ${r.season} ${r.night}/night ${r.week}/week`).join('; ')}`,
    ].join('\n'),
  };
}

export async function fetchTmcSlots(today: string): Promise<Slot[]> {
  const prices = parseTmcPrices(await page(TMC_PRICES_URL));
  if (prices.bands.length === 0 || prices.rates.length === 0) throw new Error('thorsminde-camping: cabin prices (LAVSÆSON / HØJSÆSON blocks) not found on /priser/');
  return buildTmcSlots(prices, today);
}

export const thorsmindeCamping: OfferAdapter = {
  key: 'thorsminde-camping',
  name: 'Thorsminde Camping',
  kind: 'accommodation',
  operator: {
    name: 'Thorsminde Camping ApS',
    websiteUrl: SITE,
    rootDomain: 'thorsmindecamping.dk',
    contactEmail: 'mail@thorsmindecamping.dk',
    phone: '+4520451976',
  },
  url: TMC_KITE_URL,
  slotMethod: 'price_table',
  fetchBudget: 5,
  async fetchContent() {
    const home = await page(TMC_HOME_URL);
    const kite = await page(TMC_KITE_URL);
    const cabins = await page(TMC_CABINS_URL);
    const prices = await page(TMC_PRICES_URL);
    if (!/VDWS/.test(kite)) throw new Error('thorsminde-camping: VDWS course block missing on /en/kitesurfing/');
    return parseThorsmindeContent({ home, kite, cabins, prices });
  },
  async fetchSlots(ctx) {
    const slots = await fetchTmcSlots(todayIso());
    if (slots.length === 0) ctx.note('thorsminde-camping: no future band in the printed cabin prices - price on request until the next season is published');
    return slots;
  },
};
