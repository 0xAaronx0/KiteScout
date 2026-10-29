// ---------------------------------------------------------------------------
// Nordwind Wassersport, Surendorf (Schwedeneck, Eckernförde Bay, Baltic coast, Germany) - "Kompaktwochenende
// Kitesurfen": a kite weekend package of the Nordwind water-sports club and travel arm (Friday 16:00 to Sunday 16:00,
// 2 nights in the Nordwind guesthouses right above the beach and the water-sports station, beginner kite course of about
// 9 hours with VDWS instructors, a safety boat and free SUP / kayak use). Sold only as a package -> kind 'camp'.
//
// Data path (checked 2026-10-14), Contao sites of nordwind-wassersport.de:
//   content  reisen.…/kompaktwochenenden/kitesurfen.html (programme, accommodation, prices, dates "Termine 2026
//            Kitesurf-Kompaktwochenende", "Stand April 2026"), reisen.…/standorte/surendorf.html (guesthouses: 3-4 flats per
//            house with 4-8-bed rooms, bathroom and pantry, right above beach and station), verein.…/kurse/kitesurfen.html
//            (kite courses "an der Nordwind Wassersportstation in Surendorf", the guesthouses "am Hauptspot Surendorf").
//   slots    the kite weekend page: one slot per printed weekend and price variant - category A (2-person apartment,
//            couples and single bookers, "369,00 € pro Person") and category B (holiday flat with multi-bed rooms for
//            small groups, "ab 3 Personen 339,00 € pro Person / ab 5 Personen 319,00 € pro Person"). The weekend dates are
//            printed without a year in a block headed "Termine 2026"; they are Friday-to-Sunday ranges.
// Booking: request form on the page ("Jetzt Buchungsanfrage schicken!") -> 'on_request'.
// robots.txt (2026-10-14): reisen.… and verein.… only /contao/ and /_contao/ disallowed.
// Requests per run: content 3, slots 1 (the kite weekend page is memoised, so a full run makes 3).
// Parsed: slot = price variant x weekend ("cat-a-2p|2026-10-16"), EUR per person for the whole package (priceUnit
//   'package', priceBasis 'person'; occupancy 2 / 3 / 5 = the persons the variant is priced for), startDate Friday,
//   endDate Sunday. Weekends that ended before today are dropped: on 2026-10-14 only 16.-18.10.2026 is left, after that the
//   offer shows "price on request" until the 2027 dates are printed.
// Known limits: companions without the course (EUR 99 / 89), single-occupancy surcharge (EUR 69), extension night
//   (EUR 79 / 109 per flat), bed linen (EUR 12) and final cleaning (EUR 59 / 69 per flat) are in the features, not in the
//   price. No map pin on the site (no embed, no geo) - spotCoords omitted.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import { ALL_DATES } from '../types.js';

const REISEN = 'https://reisen.nordwind-wassersport.de';
export const NWS_WEEKEND_URL = `${REISEN}/kompaktwochenenden/kitesurfen.html`;
export const NWS_GUESTHOUSE_URL = `${REISEN}/standorte/surendorf.html`;
export const NWS_COURSE_URL = 'https://verein.nordwind-wassersport.de/kurse/kitesurfen.html';

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the kite weekend page */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines (scripts, styles, SVGs, navigation dropped), split at block tags. */
export function nwsLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg|head|nav)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|header|footer|article)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

export interface NwsVariant { id: string; label: string; persons: number; price: number }
export interface NwsPage {
  year: number | null;
  weekends: Array<{ start: string; end: string }>;
  variants: NwsVariant[];
  /** price lines under "Preise (pro Person für das ganze Paket)" */
  priceLines: string[];
}

/** Dates ("Termine 2026 Kitesurf-Kompaktwochenende" + "29.05. - 31.05.") and the two price blocks of the kite weekend page. */
export function parseNwsPage(html: string): NwsPage {
  const l = nwsLines(html);
  const head = l.findIndex(x => /^Termine (20\d{2}) Kitesurf-Kompaktwochenende/.test(x));
  const year = head >= 0 ? Number(l[head].match(/20\d{2}/)![0]) : null;
  const weekends: NwsPage['weekends'] = [];
  for (let k = head + 1; year && head >= 0 && k < l.length; k++) {
    const m = l[k].match(/^(\d{1,2})\.(\d{1,2})\.\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.$/);
    if (!m) { if (weekends.length) break; continue; }
    weekends.push({ start: iso(year, +m[2], +m[1]), end: iso(year, +m[4], +m[3]) });
  }
  weekends.sort((a, b) => a.start.localeCompare(b.start));
  const p0 = l.findIndex(x => /^Preise \(pro Person für das ganze Paket\)/.test(x));
  const p1 = l.findIndex((x, i) => i > p0 && /^Stand \w+ 20\d{2}/.test(x));
  const priceLines = p0 >= 0 ? l.slice(p0 + 1, p1 > p0 ? p1 + 1 : p0 + 30) : [];
  const variants: NwsVariant[] = [];
  const a = priceLines.find(x => /^\d+(?:,\d+)? € pro Person$/.test(x));
  if (a && priceLines.some(x => /Unterkunftskategorie A/.test(x))) variants.push({ id: 'cat-a-2p', label: 'category A apartment for 2 (couples and single bookers)', persons: 2, price: parseAmount(a)! });
  const b = priceLines.map(x => x.match(/^ab (\d) Personen (\d+(?:,\d+)?) € pro Person \/ ab (\d) Personen (\d+(?:,\d+)?) € pro Person$/)).find(Boolean);
  if (b) {
    variants.push({ id: `cat-b-${b[1]}p`, label: `category B holiday flat, small group from ${b[1]} persons`, persons: Number(b[1]), price: parseAmount(b[2])! });
    variants.push({ id: `cat-b-${b[3]}p`, label: `category B holiday flat, small group from ${b[3]} persons`, persons: Number(b[3]), price: parseAmount(b[4])! });
  }
  return { year, weekends, variants, priceLines };
}

export function buildNwsSlots(p: NwsPage, today: string): Slot[] {
  const out: Slot[] = [];
  for (const w of p.weekends) {
    if (w.end < today) continue;
    for (const v of p.variants) {
      out.push({
        key: `${v.id}|${w.start}`,
        startDate: w.start,
        endDate: w.end,
        unit: `Kite weekend, ${v.label}`,
        price: v.price,
        currency: 'EUR',
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: v.persons,
        availability: 'on_request',
        availabilityText: null,
        spotsLeft: null,
      });
    }
  }
  return out;
}

/** Contao originals (files/CONTENT/…) of the three pages; the logo and the 350 px thumbnails are dropped. */
export function nwsImages(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  // Contao pages carry <base href="https://<host>/">: relative paths start at the site root
  for (const m of html.matchAll(/(?:src|href)="(files\/CONTENT\/[^"]+\.(?:jpe?g|webp))"/gi)) {
    const u = new URL(m[1], new URL('/', baseUrl)).toString();
    if (/logo/i.test(u) || out.includes(u)) continue;
    out.push(u);
  }
  return out;
}

export interface NwsPages { weekend: string; guesthouse: string; course: string }

export function parseNordwindContent(p: NwsPages): OfferContent {
  const w = nwsLines(p.weekend);
  const g = nwsLines(p.guesthouse);
  const c = nwsLines(p.course);
  const parsed = parseNwsPage(p.weekend);
  const pick = (lines: string[], re: RegExp) => lines.find(x => re.test(x)) ?? null;
  const intro = pick(w, /^Ein Wochenende im Zeichen von Wind, Wasser und bunten Schirmen/);
  const stay = pick(w, /^Eure Unterkünfte, die Nordwind Gästehäuser/);
  const arrival = pick(w, /^Die Anreise für euer Aktionswochenende/);
  const house = pick(g, /^Die gemütlichen und direkt am Meer gelegenen Nordwind Gästehäuser Surendorf/);
  const station = pick(c, /Nordwind Wassersportstation in Surendorf/);
  const hub = pick(c, /Gästehäuser am Hauptspot Surendorf/);
  const eur = (re: RegExp, label: string) => {
    const line = parsed.priceLines.find(x => re.test(x));
    const a = line ? parseAmount(line.replace(/^[^\d]*/, '')) : null;
    return a ? `${label}: EUR ${a}` : null;
  };
  const fmt = (d: string) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.`;
  const prices = parsed.variants.map(v => v.price);

  const rooms: ContentRoom[] = [
    {
      name: 'Category A apartment',
      description: '2-person apartment in the Nordwind guesthouses with pantry kitchen and bathroom, mostly with sea view; for couples and single bookers.',
      features: [
        ...(parsed.variants.find(v => v.id === 'cat-a-2p') ? [`Kite weekend EUR ${parsed.variants.find(v => v.id === 'cat-a-2p')!.price} per person`] : []),
        ...[
          eur(/^Mitreisende ohne Kitekurs 99/, 'Companion without course'),
          eur(/^Zuschlag Einzelbelegung/, 'Single-occupancy surcharge (whole weekend)'),
          eur(/^Optional Verlängerungsnacht 79/, 'Extension night per flat'),
          eur(/^\+ Endreinigung 59/, 'Final cleaning per flat'),
        ].filter((x): x is string => !!x),
      ],
    },
    {
      name: 'Category B holiday flat',
      description: 'Holiday flat with multi-bed rooms (2-6 beds), pantry kitchen and bathroom, mostly with sea view; for small groups of 3 to about 8.',
      features: [
        ...parsed.variants.filter(v => v.id.startsWith('cat-b')).map(v => `Kite weekend EUR ${v.price} per person from ${v.persons} persons`),
        ...[
          eur(/^Mitreisende ohne Kitekurs 89/, 'Companion without course'),
          eur(/^Optional Verlängerungsnacht 109/, 'Extension night per flat'),
          eur(/^\+ Endreinigung 69/, 'Final cleaning per flat'),
        ].filter((x): x is string => !!x),
      ],
    },
  ];

  const imgs: string[] = [];
  // the same file is served by both hosts (reisen. / verein.): keep it once
  for (const u of [...nwsImages(p.weekend, NWS_WEEKEND_URL), ...nwsImages(p.course, NWS_COURSE_URL), ...nwsImages(p.guesthouse, NWS_GUESTHOUSE_URL)]) {
    if (!imgs.some(x => new URL(x).pathname === new URL(u).pathname)) imgs.push(u);
  }

  const upcoming = parsed.weekends.filter(x => x.end >= todayIso());
  const summary = [
    'Nordwind Wassersport runs kite weekends from its water-sports station on the beach of Surendorf on Eckernförde Bay, Germany: two nights from Friday to Sunday in the Nordwind guesthouses right above the beach and the station, plus a beginner kite course of about 9 hours over two days in small groups with qualified instructors and a safety boat.',
    prices.length ? `The package costs EUR ${Math.max(...prices)} per person in a 2-person apartment, or EUR ${Math.min(...prices)}-${[...prices].sort((a, b) => b - a)[1] ?? Math.min(...prices)} per person for small groups in a holiday flat; SUP boards and kayaks are free to use, and the VDWS licence can be taken for EUR 35.` : 'Prices are given on request.',
    parsed.year ? `${parsed.year} dates run from ${fmt(parsed.weekends[0].start)} to ${fmt(parsed.weekends[parsed.weekends.length - 1].end)}${parsed.year}${upcoming.length ? '' : ' (all past; new dates not yet printed)'}.` : '',
  ].filter(Boolean).join(' ');

  return {
    kind: 'camp',
    title: 'Nordwind Kite Weekend Surendorf',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Surendorf, Baltic Coast',
    spot: 'Surendorf',
    itinerarySpots: [],
    durationDays: 3, // Friday 16:00 to Sunday 16:00 = 2 nights
    skillLevels: ['beginner'],
    kiteLessons: true,
    equipmentRental: null,
    beginnerFriendly: true,
    includedServices: ['2 nights in the Nordwind guesthouses', 'Kite beginner course (about 9 hours)', 'Wetsuit, helmet and buoyancy aid', 'Free use of SUP boards and kayaks', 'Wi-Fi'],
    optionalServices: ['VDWS licence exam (EUR 35)', 'Extension night (EUR 79 or 109 per flat)', 'Bed linen and towels (EUR 12 per person)', 'Final cleaning (EUR 59 or 69 per flat)', 'Companions without course (EUR 99 or 89)'],
    accommodation: 'guesthouse apartments above the water-sports station',
    mealPlan: 'self_catering',
    languages: ['de'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: NWS_WEEKEND_URL,
    bookingUrl: NWS_WEEKEND_URL,
    sourceText: [
      `weekend: ${intro ?? ''}`,
      `stay: ${stay ?? ''}`,
      `arrival: ${arrival ?? ''}`,
      `guesthouses: ${house ?? ''}`,
      `kite station: ${station ?? ''} | ${hub ?? ''}`,
      `prices: ${parsed.priceLines.join(' | ')}`,
      `dates ${parsed.year ?? '-'}: ${parsed.weekends.map(x => `${x.start}..${x.end}`).join(', ')}`,
    ].join('\n'),
  };
}

export async function fetchNwsSlots(today: string, ctx?: Pick<FetchContext, 'note' | 'lastPublished'>): Promise<Slot[]> {
  const parsed = parseNwsPage(await page(NWS_WEEKEND_URL));
  if (!parsed.year || parsed.weekends.length === 0) throw new Error('nordwind-wassersport: "Termine YYYY Kitesurf-Kompaktwochenende" dates not found');
  if (parsed.variants.length < 2) throw new Error(`nordwind-wassersport: price blocks changed (${parsed.variants.length} variants parsed)`);
  ctx?.lastPublished?.(buildNwsSlots(parsed, ALL_DATES));
  return buildNwsSlots(parsed, today);
}

export const nordwindWassersportSurendorf: OfferAdapter = {
  key: 'nordwind-wassersport-surendorf',
  name: 'Nordwind Wassersport Kite Weekend Surendorf',
  kind: 'camp',
  operator: {
    name: 'Nordwind Wassersport',
    websiteUrl: 'https://nordwind-wassersport.de',
    rootDomain: 'nordwind-wassersport.de',
    contactEmail: 'info@nordwind-wassersport.de',
    phone: '+4943465955',
  },
  url: NWS_WEEKEND_URL,
  slotMethod: 'html_dates',
  fetchBudget: 3,
  async fetchContent() {
    const weekend = await page(NWS_WEEKEND_URL);
    const guesthouse = await page(NWS_GUESTHOUSE_URL);
    const course = await page(NWS_COURSE_URL);
    if (!/Kitesurf/.test(weekend) || !/Surendorf/.test(course)) throw new Error('nordwind-wassersport: kite weekend / Surendorf station text missing (layout changed?)');
    return parseNordwindContent({ weekend, guesthouse, course });
  },
  async fetchSlots(ctx) {
    return fetchNwsSlots(todayIso(), ctx);
  },
};
