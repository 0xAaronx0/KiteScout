// ---------------------------------------------------------------------------
// Kite.pl caravans, Chałupy 6 campsite (Chałupy, Hel Peninsula, Poland) - the Kite.pl kite / windsurf / wing school
// rents out its own caravans with awnings on the Chałupy 6 campsite, where its school base is (Puck Bay side).
// Campsite rule: only the rental caravans are listed (no pitches). Kite link: the school's own base on the same
// campsite; caravan guests get 20% (May, June) / 15% (July-September) off courses and equipment rental.
//
// Liveness (2026-10-12): "PRZYJMUJEMY JUŻ REZERWACJE NA SEZON 2027!" + the 2026 season table (24.04-13.09) with
// per-caravan "wolne terminy 2026" (free dates). The 2026 season is over and 2027 prices are not published yet.
// Data path (checked 2026-10-12): WordPress (Bedrock, /app/uploads/), Polish only.
//   content  /przyczepy-chalupy-6/ (caravans, equipment, rules, deposit, campsite) + /szkola-kitesurfing/lokalizacja/
//            (school base on the campsite, map pin "54.7620288 / 18.4972413801949" + a Google Maps place link).
//   slots    /przyczepy-chalupy-6/: one card per caravan (div.m-toggleTable): name + length, layout, "wolne terminy
//            2026:" + date ranges, "Max. ilość osób", "Cena za dobę od 400zł niski sezon" and "850zł" + the high-season
//            dates ("Majówka 1-3.05, Boże Ciało 3-7.06, Hel Riders 19-21.06, wakacje 26.06-30.08"). The season comes
//            from "w sezonie 2026 w okresie 24.04-13.09".
// No booking engine: bookings by phone / e-mail (Mateusz, "Szkolenia, przyczepy").
// robots.txt (2026-10-12): disallows /wp-admin/, /?, /index.php, /wp-content/plugins/, /en/ - not our pages.
// Requests per run: content 2, slots 1 (memoised, content and slots share the caravans page).
// Parsed: per caravan, every season day gets a price class (low / high / summer holidays) and a state (inside the
//   "wolne terminy" ranges -> 'available', outside -> 'sold_out'; no free-date line -> 'on_request'); runs of equal
//   days become bands ("przyczepa-1|2026-08-29"). PLN per caravan and night ("Cena za dobę"), occupancy = max guests.
//   Low season is a "from" price ("ostateczna cena w zależności od terminu"). Summer holidays: minimum 6 nights
//   ("minimum 6-7 dni od soboty lub niedzieli").
// Inferred: printed ranges are read as inclusive nights (the page does not say arrival/departure); a free range is
//   bookable, every other season day of that caravan is taken.
// Known limits: every 2026 band ended by 2026-10-12, so the offer shows "price on request" until the page prints the
//   2027 table; prices before/after the season are "do uzgodnienia" (not slotted).
// Exported helpers (Polish date ranges, day lists) are reused by kite-crew-caravans-chalupy.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, iso, parse, parseAmount, runsOf, type HTMLElement } from '../parse.js';
import type { Availability, ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://kite.pl';
export const KPL_CARAVANS_URL = `${SITE}/przyczepy-chalupy-6/`;
export const KPL_LOCATION_URL = `${SITE}/szkola-kitesurfing/lokalizacja/`;
const CONTACT_URL = `${SITE}/kontakt/`;

// --- shared local helpers (also imported by kite-crew-caravans-chalupy) ------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes (content + slots share pages) */
export function getPage(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines (scripts, styles, SVGs dropped), split at block tags. */
export function plLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|a|button|figure)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')).replace(/[​ ]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const PL_MONTH: Record<string, number> = {
  stycznia: 1, lutego: 2, marca: 3, kwietnia: 4, maja: 5, czerwca: 6, lipca: 7, sierpnia: 8,
  'września': 9, wrzesnia: 9, 'października': 10, pazdziernika: 10, listopada: 11, grudnia: 12,
};
const MON_RE = Object.keys(PL_MONTH).join('|');
const RANGE_RE = new RegExp(`(\\d{1,2})(?:\\.(\\d{1,2})\\.?|\\s+(${MON_RE}))?\\s*[-–]\\s*(\\d{1,2})(?:\\.(\\d{1,2})|\\s+(${MON_RE}))`, 'gi');

export interface PlRange { start: string; end: string; label: string; raw: string }

/**
 * Polish day ranges with the year given separately: "1-3.05", "26.06-30.08", "28.06- 5.07", "4 maja – 3 czerwca",
 * "8-19 czerwca", "31.08-13 września". The start month defaults to the end month. `label` = text before the range
 * inside the same comma-separated part ("Majówka", "wakacje").
 */
export function plRanges(text: string, year: number): PlRange[] {
  const out: PlRange[] = [];
  for (const part of text.replace(/[​ ]/g, ' ').split(/[,;]/)) {
    for (const m of part.matchAll(RANGE_RE)) {
      const endMonth = m[5] ? Number(m[5]) : PL_MONTH[(m[6] ?? '').toLowerCase()];
      const startMonth = m[2] ? Number(m[2]) : m[3] ? PL_MONTH[m[3].toLowerCase()] : endMonth;
      if (!startMonth || !endMonth) continue;
      const start = iso(year, startMonth, Number(m[1]));
      let end = iso(year, endMonth, Number(m[4]));
      if (end < start) end = iso(year + 1, endMonth, Number(m[4]));
      out.push({ start, end, label: collapse(part.slice(0, m.index)), raw: collapse(m[0]) });
    }
  }
  return out;
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
export const inRange = (d: string, r: { start: string; end: string }): boolean => d >= r.start && d <= r.end;
export const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** WordPress size variant -> original ("-768x576.jpg" -> ".jpg"; WebP Express copies "-768x576.jpg.webp" -> ".jpg"). */
export const wpOriginal = (u: string): string => u.replace(/-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp))(?:\.webp)?$/i, '$1');

// --- pure parsers -----------------------------------------------------------------------------
export interface KplCaravan {
  no: number;
  name: string;
  lengthM: number | null;
  airCon: boolean;
  layout: string;
  maxGuests: number | null;
  freeYear: number | null;
  freeText: string | null;
  lowPrice: number | null;
  highPrice: number | null;
  highText: string;
  images: string[];
}

const text = (el: HTMLElement): string => clean(el.innerHTML.replace(/<br\s*\/?>/gi, ' ')).replace(/[​ ]/g, ' ').replace(/\s+/g, ' ').trim();

/** The caravan cards (div.m-toggleTable with an accommodation wrapper). */
export function parseKplCaravans(html: string): KplCaravan[] {
  const out: KplCaravan[] = [];
  for (const card of parse(html).querySelectorAll('.m-toggleTable')) {
    if (!card.querySelector('.m-toggleTable--accommodation')) continue;
    const cols = card.querySelectorAll('.m-toggleTable__header');
    const info = cols[0];
    if (!info) continue;
    const ps = info.querySelectorAll('p').map(text).filter(Boolean);
    const name = ps[0] ?? '';
    const no = Number(name.match(/PRZYCZEPA\s*#\s*(\d+)/i)?.[1] ?? NaN);
    if (!Number.isFinite(no)) continue;
    const freeIdx = ps.findIndex(p => /wolne terminy/i.test(p));
    const maxCol = cols.find(c => /ilość osób/i.test(c.text));
    const priceCol = cols.find(c => /Cena za dobę/i.test(c.text));
    const pricePs = priceCol ? priceCol.querySelectorAll('p').map(text) : [];
    const lowP = pricePs.find(p => /niski sezon/i.test(p)) ?? '';
    const highP = pricePs.find(p => p !== lowP && /\d\s*zł/i.test(p)) ?? '';
    const lengthRaw = name.match(/DŁ\.\s*([\d,.]+)\s*M/i)?.[1];
    out.push({
      no,
      name,
      lengthM: lengthRaw ? Number(lengthRaw.replace(',', '.')) : null,
      airCon: /KLIMATYZACJ/i.test(name),
      layout: (ps.find(p => /^układ/i.test(p)) ?? '').replace(/^układ w środku:\s*/i, ''),
      maxGuests: maxCol ? Number(maxCol.querySelector('strong')?.text.trim() ?? maxCol.text.match(/(\d+)\s*$/)?.[1]) || null : null,
      freeYear: freeIdx >= 0 ? Number(ps[freeIdx].match(/(20\d{2})/)?.[1] ?? NaN) || null : null,
      freeText: freeIdx >= 0 ? ps.slice(freeIdx + 1).join(', ') || null : null,
      lowPrice: parseAmount(lowP.match(/(\d[\d\s.]*)\s*zł/i)?.[1] ?? ''),
      highPrice: parseAmount(highP.match(/(\d[\d\s.]*)\s*zł/i)?.[1] ?? ''),
      highText: collapse(highP.replace(/^\s*\d[\d\s.]*\s*zł/i, '')),
      images: card.querySelectorAll('img[data-lazy-load]').map(i => i.getAttribute('data-lazy-load') ?? '')
        .filter(u => u && !/mapka|stick-man|logo/i.test(u)).map(wpOriginal),
    });
  }
  return out;
}

export interface KplPage {
  season: { year: number; start: string; end: string } | null;
  nextSeason: number | null;
  minNightsSummer: number | null;
  parkingPerDay: number | null;
  deposit: number | null;
  caravans: KplCaravan[];
}

export function parseKplPage(html: string): KplPage {
  const t = plLines(html).join('\n');
  const s = t.match(/w sezonie (20\d{2}) w okresie (\d{1,2}\.\d{1,2})\s*[-–]\s*(\d{1,2}\.\d{1,2})/i);
  let season: KplPage['season'] = null;
  if (s) {
    const r = plRanges(`${s[2]}-${s[3]}`, Number(s[1]))[0];
    if (r) season = { year: Number(s[1]), start: r.start, end: r.end };
  }
  return {
    season,
    nextSeason: Number(t.match(/REZERWACJE NA SEZON (20\d{2})/i)?.[1] ?? NaN) || null,
    minNightsSummer: Number(t.match(/wynajmujemy na minimum (\d+)/i)?.[1] ?? NaN) || null,
    parkingPerDay: Number(t.match(/postoju samochodu\s*\(?\s*(\d+)\s*zł\s*\/\s*doba/i)?.[1] ?? NaN) || null,
    deposit: Number(t.match(/Wysokość kaucji wynosi (\d+)\s*zł/i)?.[1] ?? NaN) || null,
    caravans: parseKplCaravans(html),
  };
}

const unitName = (c: KplCaravan): string =>
  `Caravan #${c.no} with awning${c.lengthM ? ` (${String(c.lengthM)} m${c.airCon ? ', air conditioning' : ''})` : c.airCon ? ' (air conditioning)' : ''}`;

export function buildKplSlots(p: KplPage): Slot[] {
  const season = p.season;
  if (!season) return [];
  const out: Slot[] = [];
  for (const c of p.caravans) {
    if (c.lowPrice === null && c.highPrice === null) continue;
    const high = plRanges(c.highText, season.year);
    const free = c.freeText && c.freeYear === season.year ? plRanges(c.freeText, season.year) : null;
    const days = eachDay(season.start, season.end).map(date => {
      const hi = high.find(r => inRange(date, r));
      const tier = hi ? (/wakacje/i.test(hi.label) ? 'summer' : 'high') : 'low';
      const availability: Availability = free === null ? 'on_request' : free.some(r => inRange(date, r)) ? 'available' : 'sold_out';
      return { date, tier, availability };
    });
    for (const run of runsOf(days, d => `${d.tier}|${d.availability}`)) {
      const price = run.first.tier === 'low' ? c.lowPrice : c.highPrice;
      out.push({
        key: `przyczepa-${c.no}|${run.start}`,
        startDate: run.start,
        endDate: run.end,
        unit: unitName(c),
        price,
        currency: price === null ? null : 'PLN',
        priceUnit: price === null ? null : 'per_night',
        priceBasis: price === null ? null : 'room',
        occupancy: c.maxGuests,
        availability: run.first.availability,
        availabilityText: free !== null ? `wolne terminy ${season.year}: ${c.freeText}` : null,
        spotsLeft: null,
        minNights: run.first.tier === 'summer' ? p.minNightsSummer : null,
      });
    }
  }
  return out;
}

/** Map pin of the school base: the coordinates printed on /lokalizacja/ (or the Google Maps place link). */
export function parseKplCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/!3d(5\d\.\d+)!4d(1\d\.\d+)/) ?? plLines(html).join('\n').match(/^(5\d\.\d{4,})\n(1\d\.\d{4,})$/m);
  return m ? { lat: Number(Number(m[1]).toFixed(6)), lng: Number(Number(m[2]).toFixed(6)) } : null;
}

const LAYOUT_FEATURES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/sofa podkowa[^,]*?łóżko (\d(?:-\d)?) osobowe/i, m => `U-shaped sofa with table, converts to a bed for ${m[1]}`],
  [/siedziska ze stolikiem składane na łóżko pojedyncze/i, () => 'Dinette converting to a single bed'],
  [/łóżko małżeńskie/i, () => 'Double bed'],
  [/łóżko piętrowe/i, () => 'Bunk bed'],
  [/umywalka/i, () => 'Washbasin'],
  [/toaleta/i, () => 'Toilet'],
];

export function parseKitePlContent(caravansHtml: string, locationHtml: string): OfferContent {
  const p = parseKplPage(caravansHtml);
  const t = plLines(caravansHtml).join('\n');
  const loc = plLines(locationHtml).join('\n');
  const n = p.caravans.length;
  const lows = p.caravans.map(c => c.lowPrice).filter((x): x is number => x !== null);
  const highs = p.caravans.map(c => c.highPrice).filter((x): x is number => x !== null);
  const low = lows.length ? Math.min(...lows) : null;
  const high = highs.length ? Math.max(...highs) : null;
  const maxGuests = p.caravans.map(c => c.maxGuests).filter((x): x is number => x !== null);
  const discount = t.match(/(\d+)% rabatu w maju i czerwcu oraz (\d+)% w lipcu, sierpniu i wrześniu/i);
  const highText = p.caravans[0]?.highText ?? '';
  const holidays = p.season ? plRanges(highText, p.season.year).find(r => /wakacje/i.test(r.label)) : undefined;
  const fmt = (d: string) => `${Number(d.slice(8, 10))} ${['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(d.slice(5, 7))]}`;

  const shared = [
    /drewnianą podłogą/i.test(t) && 'Awning with wooden floor, table and chairs, lounge set, beach loungers and windbreak',
    /aneks kuchenny/i.test(t) && 'Kitchenette with large fridge, electric hob, microwave, kettle, moka pot, crockery, pots and pans',
    /kołdry i poduszki/i.test(t) && 'Duvets and pillows provided (bring your own bed linen)',
    /podłączone są do wody/i.test(t) && 'Water connection and working toilet',
    /Starlink/i.test(t) && 'Fast Starlink internet',
  ].filter((x): x is string => !!x);
  const rooms: ContentRoom[] = p.caravans.map(c => ({
    name: unitName(c),
    description: `Caravan with awning on the Chałupy 6 campsite${c.maxGuests ? `, up to ${c.maxGuests} guests` : ''}.`,
    features: [
      ...LAYOUT_FEATURES.map(([re, f]) => { const m = c.layout.match(re); return m ? f(m) : null; }).filter((x): x is string => !!x),
      ...(c.airCon ? ['Air conditioning'] : []),
      ...shared,
      ...(c.lowPrice ? [`From PLN ${c.lowPrice} per night in low season (final price depends on the dates)`] : []),
      ...(c.highPrice ? [`PLN ${c.highPrice} per night: ${c.highText}`] : []),
      ...(c.freeText ? [`Free dates ${c.freeYear ?? ''}: ${c.freeText}`.replace('  ', ' ')] : []),
    ],
  }));

  const images: string[] = [];
  for (const u of p.caravans.flatMap(c => c.images)) if (!images.includes(u)) images.push(u);

  const summary = [
    `Kite.pl, a kite, windsurf and wing school with its base on the Chałupy 6 campsite on the Puck Bay side of the Hel Peninsula, rents out ${n} caravans with awnings on the same campsite${maxGuests.length ? ` for up to ${Math.max(...maxGuests)} guests each` : ''}, with kitchenette, water connection and toilet${/Starlink/i.test(t) ? ' and Starlink internet' : ''}.`,
    p.season && low !== null && high !== null
      ? `The ${p.season.year} season ran from ${fmt(p.season.start)} to ${fmt(p.season.end)}, from PLN ${low} per caravan and night in low season and PLN ${high} on the May and Corpus Christi holidays, the Hel Riders weekend and the summer holidays${holidays ? ` (${fmt(holidays.start)} to ${fmt(holidays.end)}${p.minNightsSummer ? `, minimum ${p.minNightsSummer} nights from Saturday or Sunday` : ''})` : ''}${p.nextSeason ? `; bookings for ${p.nextSeason} are open` : ''}.`
      : null,
    `Prices include the campsite fees except parking${p.parkingPerDay ? ` (PLN ${p.parkingPerDay} per day)` : ''}${discount ? `, and caravan guests get ${discount[1]}% off courses and equipment rental at the school in May and June (${discount[2]}% July to September)` : ''}.`,
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Kite.pl caravans, Chałupy 6',
    summary,
    continent: 'Europe',
    country: 'Poland',
    region: 'Chałupy, Hel Peninsula',
    spot: 'Chałupy',
    spotCoords: parseKplCoords(locationHtml),
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: /szkolenia kitesurfingowe/i.test(t),
    equipmentRental: /wypożyczalni/i.test(t),
    beginnerFriendly: null,
    includedServices: [
      'Campsite fees (caravan pitch, electricity, persons)',
      ...(/kołdry i poduszki/i.test(t) ? ['Duvets and pillows'] : []),
      ...(/Starlink/i.test(t) ? ['Starlink internet'] : []),
    ],
    optionalServices: [
      ...(discount ? [`Kitesurf, windsurf and wing courses and equipment rental at the Kite.pl base (${discount[1]}% off in May-June, ${discount[2]}% in July-September for caravan guests)`] : ['Kitesurf, windsurf and wing courses at the Kite.pl base']),
      ...(p.parkingPerDay ? [`Car parking (PLN ${p.parkingPerDay} per day)`] : []),
      ...(/ubezpieczenia od kosztów rezygnacji/i.test(t) ? ['Cancellation insurance (3% of the booking)'] : []),
    ],
    accommodation: 'caravans with awnings on a campsite',
    mealPlan: 'self_catering',
    languages: ['pl'],
    rooms,
    imageUrls: images.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KPL_CARAVANS_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `caravans: ${t.slice(0, 6000)}`,
      `location: ${(loc.match(/Nasza\nLokalizacja[\s\S]*?Zobacz na mapie/) ?? [''])[0]}`,
      `season: ${p.season ? `${p.season.start}..${p.season.end}` : '-'}; next season bookings: ${p.nextSeason ?? '-'}; min nights summer: ${p.minNightsSummer ?? '-'}; deposit: ${p.deposit ?? '-'} PLN`,
      ...p.caravans.map(c => `#${c.no} ${c.name} | max ${c.maxGuests} | low ${c.lowPrice} | high ${c.highPrice} (${c.highText}) | free ${c.freeYear}: ${c.freeText}`),
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const kitePlCaravansChalupy: OfferAdapter = {
  key: 'kite-pl-caravans-chalupy',
  name: 'Kite.pl caravans Chałupy 6',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Kite.pl',
    websiteUrl: SITE,
    rootDomain: 'kite.pl',
    contactEmail: 'mateusz@kite.pl',
    phone: '+48 500 275 599',
  },
  url: KPL_CARAVANS_URL,
  slotMethod: 'html_dates',
  fetchBudget: 3,
  confidence: 'medium',
  async fetchContent() {
    const [caravans, location] = [await getPage(KPL_CARAVANS_URL), await getPage(KPL_LOCATION_URL)];
    return parseKitePlContent(caravans, location);
  },
  async fetchSlots(ctx) {
    const page = parseKplPage(await getPage(KPL_CARAVANS_URL));
    if (!page.season) throw new Error('kite-pl-caravans-chalupy: season line ("w sezonie YYYY w okresie dd.mm-dd.mm") not found');
    if (page.caravans.length === 0) throw new Error('kite-pl-caravans-chalupy: no caravan cards (div.m-toggleTable) found');
    if (page.nextSeason && page.nextSeason > page.season.year) ctx.note(`bookings open for ${page.nextSeason}, prices still the ${page.season.year} table`);
    return buildKplSlots(page);
  },
};
