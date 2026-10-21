// ---------------------------------------------------------------------------
// CSKV Casa Suiça Kite Villas, Praia do Farol (Itarema, Ceará, Brazil) - three identical beachfront villas
// (178 m2, 2 master suites, private pool) rented as a whole villa or per suite, in front of The Kite Point,
// the operator's beach kite base (take-off / landing assistance, kite and wing lessons on request, beach bar).
// Praia do Farol lies next to Ilha do Guajiru (Itarema); the same operator runs Pousada Casa Suiça.
//
// Inclusion: Aaron's decision of 2026-10-12 (flagged: next to Ilha do Guajiru, villas also offered for sale).
//   Rentals are visibly open: each villa page carries "RESERVATIONS & RATES" with a reservation request form,
//   season rates, payment and cancellation terms. Newest sign of life: footer "© 2026 CSKV Casa Suiça Kite
//   Villas"; the pages carry no dateModified.
//
// Data path (checked 2026-10-12): cskv.com.br (WordPress, English):
//   content  / (villa gallery casa_suica_kite_villas_0nn.jpg, nav links to the rental villas 1 / 4 / 11),
//            /kite-villas-casa-1/ (villa description, included services, rates, conditions, gallery),
//            /the-kite-point/ (kite base, lounge, spot). Villas 4 and 11 print the same text and rates as
//            villa 1 (checked 2026-10-12), so only villa 1 is read.
//   slots    the "RATES" table on /kite-villas-casa-1/: "FULL PERIOD DAILY RATES / VILLA (4 Persons) SUITE
//            (2 Persons) / High season July - January R$2500/day R$1250/day / Low season February - June
//            R$2000/day R$1000/day / MINIMUM STAY 3 nights". Booking = request form, availability confirmed by
//            the team ("We will check availability for chosen dates") -> 'on_request'.
// robots.txt (2026-10-12): only /wp-admin/ disallowed (admin-ajax allowed).
// Requests per run: content 3, slots 1 (0 extra when content ran in the same process).
// Parsed: slot = unit x season band ("villa-4p|high|2026-27"), BRL per night ("/day" = per overnight day) for the
//   whole villa (4 persons) or one suite (2 persons), minNights 3, datePrecision 'month'. Season band = the next
//   occurrence of the printed month range that has not ended yet (inferred year; the table prints months only).
// Known limits: Christmas, New Year and Carnival are "special packages (prices upon request)" - not modelled;
//   long stays (7+ nights) get discounts on request. Breakfast is not included (à la carte at the beach bar).
//   No map coordinates on the site -> no spotCoords.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, iso, monthOf, parse, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://cskv.com.br';
export const CSKV_HOME_URL = `${SITE}/`;
export const CSKV_VILLA_URL = `${SITE}/kite-villas-casa-1/`;
export const CSKV_KITE_POINT_URL = `${SITE}/the-kite-point/`;

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share it */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible block lines (block elements end a line; scripts, styles, cookie banner dropped). */
export function cskvLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, #cookie-law-info-bar, .cli-modal')) el.remove();
  return root.structuredText.split('\n').map(l => collapse(l)).filter(Boolean);
}
const cskvText = (html: string): string => cskvLines(html).join('\n');
function daysIn(y: number, m: number): number { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
const MONTH_EN = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// --- pure parsers -----------------------------------------------------------------------------
export interface CskvSeason { season: 'high' | 'low'; startMonth: number; endMonth: number; villa: number; suite: number }
export interface CskvRates { villaPersons: number; suitePersons: number; minNights: number | null; seasons: CskvSeason[] }

/** The "RATES" table of a villa page. */
export function parseCskvRates(html: string): CskvRates {
  const t = cskvText(html).replace(/\n/g, ' ');
  const head = t.match(/VILLA\s*\((\d+)\s*Persons?\)\s*SUITE\s*\((\d+)\s*Persons?\)/i);
  const seasons: CskvSeason[] = [];
  for (const m of t.matchAll(/(High|Low)\s+season\s+([A-Za-zç]+)\s*-\s*([A-Za-zç]+)\s+R\$\s?([\d.,]+)\s*\/\s*day\s+R\$\s?([\d.,]+)\s*\/\s*day/gi)) {
    const s = monthOf(m[2]); const e = monthOf(m[3]);
    const villa = parseAmount(m[4]); const suite = parseAmount(m[5]);
    if (!s || !e || !villa || !suite) continue;
    seasons.push({ season: m[1].toLowerCase() as 'high' | 'low', startMonth: s, endMonth: e, villa, suite });
  }
  const min = t.match(/MINIMUM STAY\s*(\d+)\s*nights?/i)?.[1];
  return { villaPersons: head ? Number(head[1]) : 4, suitePersons: head ? Number(head[2]) : 2, minNights: min ? Number(min) : null, seasons };
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

export const cskvUnit = (u: 'villa' | 'suite', r: CskvRates): string =>
  (u === 'villa' ? `Entire villa (up to ${r.villaPersons} persons)` : `Suite (up to ${r.suitePersons} persons)`);

export function buildCskvSlots(r: CskvRates, today: string): Slot[] {
  const out: Slot[] = [];
  for (const s of r.seasons) {
    const band = seasonBand(s.startMonth, s.endMonth, today);
    for (const [unitKey, unit, price, persons] of [
      ['villa', cskvUnit('villa', r), s.villa, r.villaPersons],
      ['suite', cskvUnit('suite', r), s.suite, r.suitePersons],
    ] as const) {
      out.push({
        key: `${unitKey}-${persons}p|${s.season}|${band.label}`,
        startDate: band.start,
        endDate: band.end,
        unit,
        price,
        currency: 'BRL',
        priceUnit: 'per_night',
        priceBasis: 'room',
        occupancy: persons,
        availability: 'on_request',
        availabilityText: `${s.season} season ${MONTH_EN[s.startMonth]} - ${MONTH_EN[s.endMonth]}; reservation request, availability confirmed by the team`,
        spotsLeft: null,
        datePrecision: 'month',
        minNights: r.minNights,
      });
    }
  }
  return out;
}

/** Own photos per page (wp-content/uploads originals; logos, maps, badges dropped), capped per page so villa,
 *  kite point and home gallery all show up: [html, cap] pairs in order. */
export function cskvImages(pages: Array<[string, number]>, max = 30): string[] {
  const out: string[] = [];
  for (const [html, cap] of pages) {
    let n = 0;
    for (const m of html.matchAll(/https:\/\/cskv\.com\.br\/wp-content\/uploads\/[^"' )?,#]+\.jpe?g/gi)) {
      const u = m[0].replace(/-\d+x\d+(\.[a-z]+)$/i, '$1');
      if (/logo|favicon|icon|bg_map|download\.jpg|_bottom_|TOP_cskv/i.test(u) || out.includes(u)) continue;
      if (n++ >= cap) break;
      out.push(u);
    }
  }
  return out.slice(0, max);
}

export interface CskvPages { home: string; villa: string; kitePoint: string }

export function parseCskvContent(p: CskvPages, today = todayIso()): OfferContent {
  const villa = cskvText(p.villa);
  const kp = cskvText(p.kitePoint);
  const home = cskvText(p.home);
  const rates = parseCskvRates(p.villa);
  const villas = [...new Set([...p.home.matchAll(/cskv\.com\.br\/kite-villas-casa-(\d+)\//g)].map(m => m[1]))];
  const size = villa.match(/With (\d+) m² of/)?.[1] ?? null;
  const lagoon = /strip of sand running parallel to the coast for (\d+) km/i.exec(villa)?.[1] ?? null;
  const high = rates.seasons.find(s => s.season === 'high');
  const low = rates.seasons.find(s => s.season === 'low');
  const included = (villa.match(/INCLUDED SERVICES\n([\s\S]*?)\nVILLA \d+/)?.[1] ?? '')
    .split('\n').map(l => l.replace(/^✓\s*/, '').trim()).filter(l => l && l.length < 90);

  const rooms: ContentRoom[] = [
    {
      name: cskvUnit('villa', rates),
      description: `Beachfront villa${size ? ` of ${size} m2` : ''} with 2 master suites with ensuite bathrooms, a full kitchen with ocean view, a living room with panoramic windows, a covered terrace with private pool and direct beach access.`,
      features: [
        '2 master suites with ensuite bathrooms', 'Full kitchen', 'Private pool (exclusive use)', 'Direct beach access', 'Air conditioning', 'High-speed Wi-Fi', 'Daily cleaning',
        ...rates.seasons.map(s => `${s.season === 'high' ? 'High' : 'Low'} season ${MONTH_EN[s.startMonth]} - ${MONTH_EN[s.endMonth]}: BRL ${s.villa} per night`),
        ...(rates.minNights ? [`Minimum stay ${rates.minNights} nights`] : []),
      ],
    },
    {
      name: cskvUnit('suite', rates),
      description: 'One master suite with ensuite bathroom in a villa; the villa pool is shared if other guests are present and the kitchen is not available.',
      features: [
        'Ensuite bathroom', 'Shared pool', 'No kitchen', 'Air conditioning', 'High-speed Wi-Fi', 'Daily cleaning',
        ...rates.seasons.map(s => `${s.season === 'high' ? 'High' : 'Low'} season ${MONTH_EN[s.startMonth]} - ${MONTH_EN[s.endMonth]}: BRL ${s.suite} per night`),
        ...(rates.minNights ? [`Minimum stay ${rates.minNights} nights`] : []),
      ],
    },
  ];

  const summary = [
    `Casa Suiça Kite Villas (CSKV) rents ${villas.length || 3} beachfront villas at Praia do Farol in Itarema, Ceará, Brazil, where a sand strip 50 m offshore${lagoon ? ` runs ${lagoon} km along the coast and` : ''} forms a large lagoon of clear water.`,
    `Each villa${size ? ` (${size} m2)` : ''} has 2 master suites, a full kitchen and a covered terrace with private pool and is let whole (up to ${rates.villaPersons} persons) or per suite (${rates.suitePersons} persons, shared pool, no kitchen)${high && low ? `; rates are BRL ${high.villa} per villa or ${high.suite} per suite and night in the high season (${MONTH_EN[high.startMonth]} - ${MONTH_EN[high.endMonth]}) and BRL ${low.villa} / ${low.suite} in the low season` : ''}${rates.minNights ? `, minimum ${rates.minNights} nights` : ''}.`,
    'The Kite Point in front of the villas offers take-off and landing assistance, kitesurf and wing foil lessons on request and a beach bar serving à la carte breakfast and light food; guests also share a main pool, a tennis court and a restaurant.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'CSKV Casa Suiça Kite Villas',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Praia do Farol, Ceará',
    spot: 'Praia do Farol',
    spotCoords: null, // no map coordinates on the site
    itinerarySpots: [],
    durationDays: null,
    // kite point: "Whether you're a seasoned rider or just getting started" / "flying your first kite or landing a backroll"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /Kitesurf and wing foil lessons available on request/i.test(kp),
    equipmentRental: null,
    beginnerFriendly: /just getting started|first kite/i.test(kp) ? true : null,
    includedServices: included.length ? included.map(i => i.replace(/^Access to The Kite Point\..*$/, 'Access to The Kite Point')) : ['High-speed Wi-Fi', 'Air conditioning', 'Daily cleaning'],
    optionalServices: [
      'Kitesurf and wing foil lessons on request (The Kite Point)',
      'Take-off and landing assistance (The Kite Point)',
      'À la carte breakfast and lunch at The Kite Point beach bar',
      'Horseback riding and nature excursions',
      'Christmas, New Year and Carnival packages (prices on request)',
    ],
    accommodation: 'beachfront villas with private pool',
    mealPlan: 'room only (breakfast à la carte at the beach bar; full kitchen in the villas)',
    languages: [],
    rooms,
    imageUrls: cskvImages([[p.villa, 14], [p.kitePoint, 8], [p.home, 8]]),
    heroVideoUrl: null,
    sourceUrl: CSKV_VILLA_URL,
    bookingUrl: CSKV_VILLA_URL,
    sourceText: [
      `home: ${home.replace(/\n/g, ' ')}`,
      `villa 1: ${villa.replace(/\n/g, ' ')}`,
      `the kite point: ${kp.replace(/\n/g, ' ')}`,
      `rental villas: ${villas.join(', ')}`,
      `rates: ${rates.seasons.map(s => `${s.season} ${MONTH_EN[s.startMonth]}-${MONTH_EN[s.endMonth]} villa BRL ${s.villa} suite BRL ${s.suite}`).join('; ')}; min ${rates.minNights ?? '-'} nights`,
      `season bands (inferred year, ${today}): ${buildCskvSlots(rates, today).filter(s => s.key.startsWith('villa')).map(s => `${s.startDate}..${s.endDate}`).join(', ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const casaSuicaKiteVillasPraiaDoFarol: OfferAdapter = {
  key: 'casa-suica-kite-villas-praia-do-farol',
  name: 'CSKV Casa Suiça Kite Villas Praia do Farol',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'CSKV Casa Suiça Kite Villas',
    websiteUrl: SITE,
    rootDomain: 'cskv.com.br',
    contactEmail: 'cskv@brasilkite.ch',
    whatsapp: '+41792299743',
  },
  url: CSKV_VILLA_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'medium', // year-less season table (inferred year), request form
  async fetchContent() {
    const [home, villa, kitePoint] = [await page(CSKV_HOME_URL), await page(CSKV_VILLA_URL), await page(CSKV_KITE_POINT_URL)];
    return parseCskvContent({ home, villa, kitePoint });
  },
  async fetchSlots() {
    const rates = parseCskvRates(await page(CSKV_VILLA_URL));
    if (rates.seasons.length < 2) throw new Error(`cskv: season rate table not found on /kite-villas-casa-1/ (${rates.seasons.length} seasons parsed)`);
    return buildCskvSlots(rates, todayIso());
  },
};
