// ---------------------------------------------------------------------------
// Camping Tarifa, Los Lances (Tarifa, Cadiz, Andalusia, Spain) - campsite on the N-340 km 78.870 with direct access
// through a pine wood to Los Lances beach. Bookable in advance are only its bungalows, apartments and Kampaoh tents
// ("NO RESERVAMOS PARCELAS EN ACAMPADA ORDINARIA"); listed here: bungalows and apartments (no pitches; the Kampaoh
// tents are run and sold by Kampaoh, a separate company). Kite link: the kite and windsurf school "Laduna Tarifa
// Center" is one of the campsite's facilities (menu "Instalaciones > Escuela"; IKO and FAV licensed, lessons and
// rental of kite, windsurf, SUP and surf gear).
//
// Data path (checked 2026-10-12): WordPress (The7 / Elementor, Spanish only).
//   content  / (campsite, school block, price list "PRECIOS BUNGALOWS Y APARTAMENTOS, PRECIO DIARIO: estancia desde
//            80.00 €", facilities, contact), /bungalows/, /apartamentos/, /escuela/ (Laduna).
//   slots    /bungalows/ and /apartamentos/: the "tarifas" table (Temporada | Entre semana | Fin de semana / tramo
//            especial), e.g. "Junio | Lunes a jueves: 90 € | Viernes a domingo: 150 €", the daily price of the unit.
//            The table has NO year: like the other year-less tables (docs/offer-adapters.md, Mounu) the seasons are
//            anchored on the page's own JSON-LD dateModified (2026-07-21 on 2026-10-12): the season containing that
//            date plus the following seasons for one 12-month cycle (inferred), bands that ended before today are
//            dropped. Holy Week rows ("Marzo (Semana Santa)", first Holy Week weekend) have no dates on the page; their
//            prices go into the March slots' text, not into bands of their own.
// Booking engine: the RESERVAR buttons link to Thelis (thelisresa.webcamp.fr/list.php) - its robots.txt disallows
//   everything -> not called, availability 'unknown'.
// robots.txt (2026-10-12): Yoast default, allows everything. NOTE: the site's nginx cache answers our UA's default
//   Accept-Encoding (gzip/br) with a cached copy of robots.txt for every URL (X-Cache-Status: HIT, 174 bytes); with
//   "Accept-Encoding: identity" the cache is bypassed and the real page comes back. Not a block, so we ask for
//   identity encoding on every request.
// Requests per run: 4 (home, bungalows, apartments, school; memoised, slots reuse the two price pages).
// Parsed: slot = unit (bungalow / apartment) x season band x weekday class ("bungalow|2027-06|mon-thu"), EUR per unit
//   and day (priceUnit 'per_day' as the site says "precio diario"), availability 'unknown'.
// Known limits: year inferred from the page edit (after the last inferred band the offer drops to "price on request"
//   until the page is edited again); no prices for October to February on the page; no map pin on the site.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, iso, jsonLd, parse, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://campingtarifa.es';
export const CT_HOME_URL = `${SITE}/`;
export const CT_BUNGALOWS_URL = `${SITE}/bungalows/`;
export const CT_APARTMENTS_URL = `${SITE}/apartamentos/`;
export const CT_SCHOOL_URL = `${SITE}/escuela/`;
const KITE_SCHOOL_URL = 'https://www.tarifawindsurfing.com/';

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes (content + slots share the price pages); identity encoding, see header */
function get(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html', headers: { 'Accept-Encoding': 'identity' } }).then(html => {
    if (/^# START YOAST BLOCK/.test(html.trimStart())) throw new Error(`campingtarifa.es answered ${url} with its robots.txt (cache)`);
    return html;
  });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Visible text lines (scripts, styles, SVGs dropped), split at block tags. */
export function ctLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|a|button|figure)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}
const after = (lines: string[], head: RegExp): string | null => {
  const i = lines.findIndex(l => head.test(l));
  return i >= 0 ? lines[i + 1] ?? null : null;
};

// --- price table ------------------------------------------------------------------------------
const MES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const DAY_EN: Record<string, string> = { lunes: 'Monday', martes: 'Tuesday', 'miércoles': 'Wednesday', miercoles: 'Wednesday', jueves: 'Thursday', viernes: 'Friday', 'sábado': 'Saturday', sabado: 'Saturday', domingo: 'Sunday' };

const MONTH_EN = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** [7, 8, 9] -> "July, August and September" */
export function ctSeasonEn(months: number[]): string {
  const names = months.map(m => MONTH_EN[m]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
}

export interface CtCell { days: string; price: number }
export interface CtRow { season: string; months: number[]; special: boolean; weekday: CtCell | null; weekend: CtCell | null }

/** "Lunes a jueves: 80 €" -> { days: 'Monday to Thursday', price: 80 }; "—" -> null. */
function cell(text: string): CtCell | null {
  const m = clean(text).match(/^([A-Za-zÁÉÍÓÚáéíóúñ]+) a ([A-Za-zÁÉÍÓÚáéíóúñ]+):\s*([\d.,]+)\s*€/);
  if (!m) return null;
  const a = DAY_EN[m[1].toLowerCase()];
  const b = DAY_EN[m[2].toLowerCase()];
  const price = parseAmount(m[3]);
  return a && b && price ? { days: `${a} to ${b}`, price } : null;
}

/** The "tarifas" table of /bungalows/ or /apartamentos/. */
export function parseCtTable(html: string): CtRow[] {
  const table = parse(html).querySelectorAll('table').find(t => /Temporada/i.test(t.querySelector('thead')?.text ?? t.text));
  if (!table) return [];
  const out: CtRow[] = [];
  for (const tr of table.querySelectorAll('tbody tr')) {
    const tds = tr.querySelectorAll('td').map(td => clean(td.text));
    if (tds.length < 3) continue;
    const season = tds[0];
    const special = /\(/.test(season);
    const months = special ? [] : [...season.toLowerCase().matchAll(/[a-záéíóú]+/g)].map(m => MES[m[0]]).filter((x): x is number => !!x);
    out.push({ season, months, special, weekday: cell(tds[1]), weekend: cell(tds[2]) });
  }
  return out;
}

/** Year anchor of the year-less table: the page's own JSON-LD dateModified. */
export function ctModified(html: string): string | null {
  const page = jsonLd(html).find(o => o['@type'] === 'WebPage' && typeof o.dateModified === 'string');
  return page ? String(page.dateModified).slice(0, 10) : null;
}

export interface CtBand { season: string; start: string; end: string; row: CtRow }

/** Month seasons -> dated bands for one 12-month cycle starting at the season that contains (or follows) `anchor`. */
export function ctBands(rows: CtRow[], anchor: string): CtBand[] {
  const y0 = Number(anchor.slice(0, 4));
  const all: CtBand[] = [];
  for (const r of rows.filter(r => !r.special && r.months.length)) {
    const m1 = Math.min(...r.months);
    const m2 = Math.max(...r.months);
    for (const y of [y0, y0 + 1]) all.push({ season: r.season, start: iso(y, m1, 1), end: iso(y, m2, lastDay(y, m2)), row: r });
  }
  all.sort((a, b) => a.start.localeCompare(b.start));
  const first = all.find(b => b.start <= anchor && b.end >= anchor) ?? all.find(b => b.start > anchor);
  if (!first) return [];
  const cycleEnd = iso(Number(first.start.slice(0, 4)) + 1, Number(first.start.slice(5, 7)), 1);
  return all.filter(b => b.start >= first.start && b.start < cycleEnd);
}

const eur = (n: number): string => `EUR ${n}`;
/** Holy Week rows of the table as one line (they have no dates on the page). */
function holyWeek(rows: CtRow[]): string | null {
  const parts = rows.filter(r => r.special).map(r => {
    const label = /primer fin de semana/i.test(r.season) ? 'first Holy Week weekend' : 'Holy Week';
    const cells = [r.weekday, r.weekend].filter((c): c is CtCell => !!c).map(c => `${c.days} ${eur(c.price)}`);
    return cells.length ? `${label}: ${cells.join(', ')}` : null;
  }).filter(Boolean);
  return parts.length ? `${parts.join('; ')} per day` : null;
}

export function buildCtSlots(unit: string, rows: CtRow[], anchor: string, today: string): Slot[] {
  const hw = holyWeek(rows);
  const out: Slot[] = [];
  for (const b of ctBands(rows, anchor).filter(b => b.end >= today)) {
    for (const [cls, c] of [['mon-thu', b.row.weekday], ['fri-sun', b.row.weekend]] as const) {
      if (!c) continue;
      out.push({
        key: `${keyPart(unit)}|${b.start.slice(0, 7)}|${cls}`,
        startDate: b.start,
        endDate: b.end,
        unit: `${unit} (${c.days})`,
        price: c.price,
        currency: 'EUR',
        priceUnit: 'per_day',
        priceBasis: 'room',
        occupancy: null,
        availability: 'unknown',
        availabilityText: [`${ctSeasonEn(b.row.months)}: ${c.days} ${eur(c.price)} per day`, b.row.months.includes(3) && hw ? hw : null].filter(Boolean).join('; '),
        spotsLeft: null,
      });
    }
  }
  return out;
}

export async function fetchCtSlots(ctx: FetchContext, today: string): Promise<Slot[]> {
  const out: Slot[] = [];
  for (const [unit, url] of [['Bungalow', CT_BUNGALOWS_URL], ['Apartment', CT_APARTMENTS_URL]] as const) {
    const html = await get(url);
    const rows = parseCtTable(html);
    const anchor = ctModified(html);
    if (rows.length < 3) throw new Error(`camping-tarifa: price table on ${url} not found or changed (${rows.length} rows)`);
    if (!anchor) { ctx.note(`no dateModified on ${url}: the year-less table cannot be dated`); continue; }
    const slots = buildCtSlots(unit, rows, anchor, today);
    if (!slots.length) ctx.note(`${unit}: every season of the table (anchored ${anchor}) has passed - price on request until the page is edited`);
    out.push(...slots);
  }
  return out;
}

// --- content ----------------------------------------------------------------------------------
export interface CtPages { home: string; bungalows: string; apartments: string; school: string }

export function parseCampingTarifaContent(p: CtPages): OfferContent {
  const home = ctLines(p.home);
  const bung = ctLines(p.bungalows);
  const apt = ctLines(p.apartments);
  const school = ctLines(p.school);
  const intro = after(home, /^SITUADO A PIE DE LA PLAYA/i) ?? '';
  const schoolHome = after(home, /ESCUELA "?LADUNA/i) ?? '';
  const schoolPage = school.find(l => /licencia IKO/i.test(l)) ?? '';
  const schoolLevels = school.find(l => /clases para todos los niveles/i.test(l)) ?? '';
  const fromPrice = home.join(' ').match(/PRECIO DIARIO:\s*estancia desde\s*([\d.,]+)\s*€/i);
  const noPitches = home.some(l => /NO RESERVAMOS PARCELAS/i.test(l));
  const bungRefuge = after(bung, /^BIENVENIDO A TU REFUGIO/i) ?? '';
  const bungCard = after(home, /^BUNGALOWS$/) ?? '';
  const aptStay = after(apt, /^Una estancia cómoda/i) ?? '';
  const aptKit = after(apt, /^intimidad, comodidad y espacio/i) ?? '';
  const size = bungRefuge.match(/(\d+)\s*m²/)?.[1] ?? null;
  const rows = parseCtTable(p.bungalows);
  const prices = rows.flatMap(r => [r.weekday?.price, r.weekend?.price]).filter((x): x is number => !!x);

  const rooms: ContentRoom[] = [
    {
      name: 'Bungalow',
      description: `${size ? `${size} m² wooden bungalow` : 'Wooden bungalow'} with one bedroom, living room, equipped kitchen, full bathroom, heating and a private terrace, for 3 to 4 people.`,
      features: [size ? `${size} m²` : null, '1 bedroom + living room', 'Equipped kitchen', 'Full bathroom', 'Heating', 'TV', 'Private terrace',
        'Kitchenware, towels and bed linen included', 'For 3-4 people'].filter((x): x is string => !!x),
    },
    {
      name: 'Apartment',
      description: 'Studios for couples up to two-bedroom apartments for families or groups, with an equipped kitchen, heating and air conditioning.',
      features: ['Studio to 2 bedrooms', 'Kitchen with microwave, fridge and freezer', 'Heating', 'Air conditioning'],
    },
  ].map(r => ({ ...r, features: [...r.features, ...rows.filter(x => !x.special).map(x => `${ctSeasonEn(x.months)}: ${[x.weekday, x.weekend].filter((c): c is CtCell => !!c).map(c => `${c.days} EUR ${c.price}`).join(', ')} per day`)] }));

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const [html, base] of [[p.bungalows, CT_BUNGALOWS_URL], [p.apartments, CT_APARTMENTS_URL], [p.home, CT_HOME_URL], [p.school, CT_SCHOOL_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 30)) {
      if (!/\/wp-content\/uploads\//.test(u) || /\.svg$|logo|icon|mapa|foto-kampaoh/i.test(u)) continue;
      const k = u.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
      if (seen.has(k)) continue;
      seen.add(k); imageUrls.push(u);
    }
  }

  const summary = [
    `Camping Tarifa is a campsite on the N-340 at Los Lances, Tarifa, with direct access through a pine wood to Los Lances beach; besides pitches it rents bungalows and apartments${noPitches ? ' (only these and Kampaoh tents can be booked in advance)' : ''}.`,
    `The ${size ? `${size} m² ` : ''}bungalows have one bedroom, a living room, kitchen, bathroom, heating and a terrace for up to 4 people, the apartments range from studios to two bedrooms with kitchen, heating and air conditioning${prices.length ? `; both cost EUR ${Math.min(...prices)} to ${Math.max(...prices)} per day from March to September, more at weekends` : fromPrice ? `; stays from EUR ${fromPrice[1]} per day` : ''}.`,
    `The Laduna Tarifa Center school, one of the campsite's facilities, teaches kitesurf and windsurf (IKO and FAV licensed) and rents kite, windsurf, SUP and surf gear; a restaurant, supermarket, pool and playground are on site.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Camping Tarifa',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Los Lances, Tarifa',
    spot: 'Los Lances',
    itinerarySpots: [],
    durationDays: null,
    // escuela: "clases para todos los niveles, clases privadas o grupales"
    skillLevels: /todos los niveles/i.test(schoolLevels) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: /clases de kitesurf|clases de windsurf y kitesurf|windsurf y kitesurf/i.test(`${schoolHome} ${schoolPage}`),
    equipmentRental: /alquiler/i.test(`${schoolHome} ${schoolPage}`),
    beginnerFriendly: /todos los niveles/i.test(schoolLevels) ? true : null,
    includedServices: ['Kitchenware, towels and bed linen (bungalows)', 'Swimming pool', 'Playground, sports facilities and games room', 'Direct beach access'],
    optionalServices: [
      'Kitesurf and windsurf lessons, private or group (Laduna Tarifa Center, IKO and FAV licensed)',
      'Kite, windsurf, SUP and surf equipment rental (Laduna)',
      'Restaurant El Ronkio (pizzas, burgers, lunchtime stews) and supermarket',
    ],
    accommodation: 'campsite bungalows and apartments',
    mealPlan: 'self_catering',
    languages: [],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: CT_HOME_URL,
    bookingUrl: CT_BUNGALOWS_URL,
    sourceText: [
      `home: ${intro} | school: ${schoolHome} | price list: ${fromPrice?.[0] ?? '-'} | no pitches in advance: ${noPitches}`,
      `bungalows: ${bungRefuge} | ${bungCard}`,
      `apartments: ${aptStay} | ${aptKit}`,
      `table (bungalows, modified ${ctModified(p.bungalows) ?? '-'}): ${rows.map(r => `${r.season}: ${r.weekday ? `${r.weekday.days} ${r.weekday.price}` : '-'} / ${r.weekend ? `${r.weekend.days} ${r.weekend.price}` : '-'}`).join('; ')}`,
      `school (${KITE_SCHOOL_URL}): ${schoolPage} ${schoolLevels}`,
    ].join('\n'),
  };
}

export const campingTarifaLosLances: OfferAdapter = {
  key: 'camping-tarifa-los-lances',
  name: 'Camping Tarifa',
  kind: 'accommodation',
  operator: {
    name: 'Camping Tarifa',
    websiteUrl: SITE,
    rootDomain: 'campingtarifa.es',
    contactEmail: 'info@campingtarifa.es',
    phone: '+34956684778',
    whatsapp: '+34676653689',
  },
  url: CT_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 5,
  confidence: 'medium', // year-less table, year inferred from the page edit
  async fetchContent() {
    const home = await get(CT_HOME_URL);
    const bungalows = await get(CT_BUNGALOWS_URL);
    const apartments = await get(CT_APARTMENTS_URL);
    const school = await get(CT_SCHOOL_URL);
    return parseCampingTarifaContent({ home, bungalows, apartments, school });
  },
  async fetchSlots(ctx) {
    return fetchCtSlots(ctx, todayIso());
  },
};
