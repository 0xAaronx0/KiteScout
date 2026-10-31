// ---------------------------------------------------------------------------
// TAIGA Tarifa Valdevaqueros (Tarifa, Cadiz, Andalusia, Spain) - campsite and resort of the Spanish TAIGA chain on the
// N-340 km 75.5, 400 m from Valdevaqueros beach in the Strait Natural Park. Besides pitches it rents bungalows, tiny
// homes, glamping tents and a holiday house; the campsite has its own kite and wind foil school with equipment
// rental ("We have our own school at Taiga Valdevaqueros ... book kite or wind foil lessons directly at our school").
// Only the rental units are listed, not the pitches.
//
// This file also holds the shared Paraty Tech engine code; taiga-tarifa-punta-paloma.ts imports it.
//
// Data path (checked 2026-10-12):
//   content  www.taigaresorts.com/en/taiga-tarifa-valdevaqueros.html (Paraty CMS, English): unit cards
//            (.desc_wrapper: short text, "25 m2" / "2 rooms" / "Max. 4 people", the engine's unit name in
//            a.button-promotion[data-smartroomorder], a pop-up with the long text, features and photos), facilities,
//            JSON-LD (two blocks: a Hotel with a precise geo and a Campground @graph whose geo sits 3 km further west;
//            spotCoords take the Hotel block, see TG_GEO_NOTE) + /en/kite-surf-and-wind-foil-at-taiga-valdevaqueros.html
//            (the campsite's own kite school).
//   slots    Paraty Tech booking engine of the chain. The site's own booking form posts anonymously (no cookie, token
//            or login) to POST www.taigaresorts.com/booking1 with namespace=taiga-valdevaqueros, startDate/endDate
//            (DD/MM/YYYY), numRooms, adultsRoom1, childrenRoom1, babiesRoom1, language; the answer is the step-1 page,
//            server-rendered with a JSON-LD Hotel whose containsPlace lists every bookable unit for that stay with its
//            rate plans (Offer: price = total of the stay incl. 21% VAT, priceCurrency, availability, rate name,
//            checkinTime/checkoutTime). The engine's price calendar (taiga-valdevaqueros-dot-q10-campings.appspot.com)
//            needs the session id of that page -> not used.
//            One sample stay per month: 7 nights for 2 adults, arriving the first Saturday on or after the 12th (or
//            after tomorrow in the current month), 12 months ahead.
// robots.txt (2026-10-12): www.taigaresorts.com "User-agent: *" without rules (allow all) + sitemap + llms.txt.
// Requests per run: content 2, slots 12 (one POST per sample month).
// Parsed: slot = rental unit x month ("bungalow-1-3|2026-11"), the cheapest rate plan of the sample stay (EUR per unit
//   for 7 nights, priceUnit 'package', packageNights 7, occupancy 2), availability 'available' when the engine offers
//   it InStock, 'sold_out' when it lists the unit without a bookable rate; units the engine does not list for a
//   sample (closed season, minimum stay, booked up) get no slot that month.
// Known limits: one sample week per month (prices change within a month); pitches are not listed; tourist tax and
//   extras (pets, extra vehicles) are not included.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, imageCandidates, iso, jsonLd, parse, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.taigaresorts.com';
export const TG_PAGE_URL = `${SITE}/en/taiga-tarifa-valdevaqueros.html`;
export const TG_KITE_URL = `${SITE}/en/kite-surf-and-wind-foil-at-taiga-valdevaqueros.html`;
export const TG_NAMESPACE = 'taiga-valdevaqueros';
const TG_GEO_NOTE = 'Hotel JSON-LD geo (36.0693, -5.6803, N-340 km 75.5); the Campground block says 36.0665, -5.7135';

// =============================================================================================
// Paraty Tech engine (shared with taiga-tarifa-punta-paloma.ts)
// =============================================================================================
export const PARATY_BOOKING_URL = `${SITE}/booking1`;
export const PARATY_NIGHTS = 7;
export const PARATY_ADULTS = 2;
export const PARATY_HORIZON_MONTHS = 12;

export interface ParatyOffer { rate: string; price: number; currency: string; inStock: boolean }
export interface ParatyRoom { name: string; offers: ParatyOffer[] }
export interface ParatyResult { namespace: string | null; checkIn: string | null; checkOut: string | null; rooms: ParatyRoom[] }
export interface ParatySample { month: string; checkIn: string; checkOut: string }
export interface ParatyUnitRules {
  /** rental units only (bungalows, tiny homes, glamping ...), never pitches */
  isRental(engineName: string): boolean;
  /** engine name -> the unit name the site shows ("Bungalow Superior 13" -> "Superior Bungalow 13") */
  unitName(engineName: string): string;
}

export const paratyKey = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const lastDayOf = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
const ddmmyyyy = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const dm = (d: string): string => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;

/** Form body as the site's booking widget posts it (2 adults, 1 unit). */
export function paratyBody(namespace: string, checkIn: string, checkOut: string, adults = PARATY_ADULTS): string {
  return new URLSearchParams({
    namespace, language: 'ENGLISH', startDate: ddmmyyyy(checkIn), endDate: ddmmyyyy(checkOut),
    numRooms: '1', adultsRoom1: String(adults), childrenRoom1: '0', babiesRoom1: '0',
  }).toString();
}

/** One sample stay per month: arrival on the first Saturday on/after the 12th (current month: after tomorrow). */
export function paratySamples(today: string, months = PARATY_HORIZON_MONTHS, nights = PARATY_NIGHTS): ParatySample[] {
  const out: ParatySample[] = [];
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const tomorrow = addDays(today, 1);
  for (let i = 0; i < months; i++) {
    const from = iso(y, m, 12) > tomorrow ? iso(y, m, 12) : tomorrow;
    let d = from;
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 6) d = addDays(d, 1);
    if (d.slice(0, 7) === iso(y, m, 1).slice(0, 7)) out.push({ month: d.slice(0, 7), checkIn: d, checkOut: addDays(d, nights) });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** step-1 page -> the JSON-LD Hotel's units and rate plans for the searched stay. */
export function parseParatyResults(html: string): ParatyResult {
  const hotel = jsonLd(html).find(o => o['@type'] === 'Hotel' && Array.isArray(o.containsPlace));
  const res: ParatyResult = { namespace: null, checkIn: null, checkOut: null, rooms: [] };
  if (!hotel) return res;
  res.namespace = typeof hotel.identifier === 'string' ? hotel.identifier : null;
  for (const p of hotel.containsPlace as Array<Record<string, unknown>>) {
    const name = clean(String(p.name ?? ''));
    const offers: ParatyOffer[] = [];
    for (const o of (Array.isArray(p.offers) ? p.offers : []) as Array<Record<string, unknown>>) {
      const price = Number(o.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      offers.push({
        rate: clean(String(o.name ?? '')),
        price,
        currency: String(o.priceCurrency ?? 'EUR'),
        inStock: /InStock$/i.test(String(o.availability ?? '')),
      });
      res.checkIn ??= typeof o.checkinTime === 'string' ? o.checkinTime.slice(0, 10) : null;
      res.checkOut ??= typeof o.checkoutTime === 'string' ? o.checkoutTime.slice(0, 10) : null;
    }
    if (name && !res.rooms.some(r => r.name === name)) res.rooms.push({ name, offers });
  }
  return res;
}

const rateLabel = (rate: string): string =>
  /no reembolsable|non.?refundable/i.test(rate) ? 'non-refundable rate' : /flexib/i.test(rate) ? 'flexible rate' : rate;
const eur = (n: number, c: string): string => `${c} ${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** Sample results -> one slot per rental unit and month. */
export function buildParatySlots(samples: Array<ParatySample & { result: ParatyResult | null }>, rules: ParatyUnitRules): Slot[] {
  const out: Slot[] = [];
  for (const s of samples) {
    if (!s.result) continue;
    const y = Number(s.month.slice(0, 4));
    const m = Number(s.month.slice(5, 7));
    for (const r of s.result.rooms) {
      if (!rules.isRental(r.name)) continue;
      const unit = rules.unitName(r.name);
      const open = r.offers.filter(o => o.inStock).sort((a, b) => a.price - b.price);
      const best = open[0] ?? null;
      const flex = open.find(o => /flexib/i.test(o.rate) && o !== best) ?? null;
      const nights = Math.round((Date.parse(s.checkOut) - Date.parse(s.checkIn)) / 86400000);
      const stay = `${nights}-night sample stay ${dm(s.checkIn)}-${dm(s.checkOut)}${s.checkOut.slice(0, 4)} for ${PARATY_ADULTS} adults`;
      out.push({
        key: `${paratyKey(unit)}|${s.month}`,
        startDate: iso(y, m, 1),
        endDate: iso(y, m, lastDayOf(y, m)),
        unit,
        price: best ? best.price : null,
        currency: best ? best.currency : null,
        priceUnit: best ? 'package' : null,
        priceBasis: 'room',
        occupancy: PARATY_ADULTS,
        availability: best ? 'available' : 'sold_out',
        availabilityText: best
          ? `${stay}: ${rateLabel(best.rate)}${flex ? `; flexible rate ${eur(flex.price, flex.currency)}` : ''}`
          : `${stay}: listed without a bookable rate`,
        spotsLeft: null,
        datePrecision: 'month',
        packageNights: best ? nights : null,
      });
    }
  }
  return out;
}

/** One POST per sample month; a failed month is skipped (partial delivery), a run without any unit fails. */
export async function fetchParatySlots(ctx: FetchContext, namespace: string, today: string, rules: ParatyUnitRules, label: string): Promise<Slot[]> {
  const samples = paratySamples(today);
  const results: Array<ParatySample & { result: ParatyResult | null }> = [];
  let failed = 0;
  for (const s of samples) {
    let result: ParatyResult | null = null;
    try {
      const html = await fetchText(PARATY_BOOKING_URL, {
        method: 'POST', body: paratyBody(namespace, s.checkIn, s.checkOut),
        contentType: 'application/x-www-form-urlencoded', accept: 'text/html',
      });
      result = parseParatyResults(html);
      if (result.namespace && result.namespace !== namespace) throw new Error(`engine answered for ${result.namespace}`);
      if (result.checkIn && result.checkIn !== s.checkIn) { ctx.note(`${label}: engine moved the ${s.month} sample to ${result.checkIn}; month skipped`); result = null; }
    } catch (e) {
      failed++;
      ctx.note(`${label}: sample ${s.checkIn} failed: ${(e as Error).message}`);
    }
    results.push({ ...s, result });
  }
  if (failed) ctx.incomplete(`${failed} of ${samples.length} sample months failed`);
  const slots = buildParatySlots(results, rules);
  if (slots.length === 0 && failed < samples.length) throw new Error(`${label}: no rental unit in ${samples.length} sample months (engine layout changed?)`);
  return slots;
}

// =============================================================================================
// TAIGA property pages (shared parsers)
// =============================================================================================
export interface TgUnit {
  name: string;          // the unit name the site shows (= engine name in English)
  title: string | null;  // pop-up title
  summary: string | null;
  description: string | null;
  size: string | null;
  bedrooms: string | null;
  capacity: string | null;
  features: string[];
  images: string[];
}

/** Visible text lines (scripts, styles, SVGs dropped), split at block tags. */
export function tgLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|a|button|figure|span)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

/** Unit cards (.desc_wrapper) in page order; `imageNs` keeps only the property's own photos (cdn2.paraty.es/<ns>/). */
export function parseTgUnits(html: string, imageNs: string): TgUnit[] {
  const out: TgUnit[] = [];
  for (const w of parse(html).querySelectorAll('.desc_wrapper')) {
    const name = clean(w.querySelector('a.button-promotion[data-smartroomorder]')?.getAttribute('data-smartroomorder'));
    if (!name || out.some(u => u.name === name)) continue;
    const icons = w.querySelectorAll('.info_icons_wrapper .icon_fixed_description').map(e => collapse(e.text)).filter(Boolean);
    const popup = w.querySelector('.rooms_popup');
    const features = (popup ?? w).querySelectorAll('.icon_description').map(e => collapse(e.text)).filter(Boolean);
    const images = (popup?.querySelectorAll('img') ?? [])
      .map(i => i.getAttribute('data-src') ?? i.getAttribute('src') ?? '')
      .filter(u => u.startsWith(`https://cdn2.paraty.es/${imageNs}/images/`));
    out.push({
      name,
      title: clean(popup?.querySelector('.popup_title')?.text) || null,
      summary: clean(w.querySelector('.desc')?.text) || null,
      description: clean(popup?.querySelector('.popup_desc')?.text) || null,
      size: icons.find(t => /m2|m²/i.test(t)) ?? null,
      bedrooms: icons.find(t => /\b(rooms?|hab)\b/i.test(t)) ?? null,
      capacity: icons.find(t => /people|person/i.test(t)) ?? null,
      features: [...new Set(features)],
      images: [...new Set(images)],
    });
  }
  return out;
}

/** "Services and facilities" list (ul.services_list). */
export function parseTgServices(html: string): string[] {
  return [...new Set(parse(html).querySelectorAll('.services_list .service_item').map(e => collapse(e.text)).filter(Boolean))];
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "Pool open from 01/06 to 30/09" (DD/MM) or "Pool hours from 06/01 to 09/30" (MM/DD, English page) -> "June to September". */
export function parseTgPoolSeason(lines: string[]): string | null {
  const m = lines.join('\n').match(/Pool (?:open|hours) from (\d{2})\/(\d{2}) to (\d{2})\/(\d{2})/i);
  if (!m) return null;
  const monthFirst = Number(m[4]) > 12;
  const [m1, m2] = monthFirst ? [Number(m[1]), Number(m[3])] : [Number(m[2]), Number(m[4])];
  return MONTHS[m1] && MONTHS[m2] ? `${MONTHS[m1]} to ${MONTHS[m2]}` : null;
}

/** JSON-LD Hotel geo (precise); null when missing or outside the Strait of Gibraltar area (the Punta Paloma page's is in the Atlantic). */
export function parseTgHotelGeo(html: string): { lat: number; lng: number } | null {
  const hotel = jsonLd(html).find(o => o['@type'] === 'Hotel' && o.geo);
  const g = (hotel?.geo ?? {}) as Record<string, unknown>;
  const lat = Number(g.latitude);
  const lng = Number(g.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return lat > 35.9 && lat < 36.2 && lng > -5.9 && lng < -5.5 ? { lat, lng } : null;
}

export function tgRoom(u: TgUnit): ContentRoom {
  return {
    name: u.name,
    description: u.description ?? u.summary,
    features: [...new Set([u.size, u.bedrooms?.replace(/\brooms?\b/i, 'bedroom(s)').replace(/\bhab\.?/i, 'bedroom(s)'), u.capacity, ...u.features]
      .filter((x): x is string => !!x).map(x => x.replace(/\bm2\b/, 'm²')))],
  };
}

// --- Valdevaqueros ----------------------------------------------------------------------------
const VAL_RENTAL = /bungalow|tiny home|glamping|holiday house|casa vacacional/i;
const VAL_ALIAS: Record<string, string> = { 'casa vacacional': 'Holiday House' };
/** engine "Bungalow Superior 13" -> site "Superior Bungalow 13"; "Casa Vacacional" -> "Holiday House". */
export function tgUnitName(engineName: string, siteNames: string[]): string {
  const alias = VAL_ALIAS[engineName.toLowerCase()];
  if (alias) return alias;
  const sig = (s: string) => s.toLowerCase().split(/\s+/).sort().join(' ');
  return siteNames.find(n => sig(n) === sig(engineName)) ?? engineName;
}

export const VAL_SITE_UNITS = [
  'Bungalow 1-3', 'Bungalow 4', 'Bungalow 5', 'Bungalow 6-7', 'Bungalow 8', 'Bungalow 9', 'Bungalow 10',
  'Superior Bungalow 11', 'Superior Bungalow 12', 'Superior Bungalow 13', 'Superior Bungalow 14',
  'Glamping Kala', 'Glamping Siroa', 'Glamping Oasis', 'Glamping Bruma', 'Tiny Home Duna', 'Tiny Home Aura', 'Tiny Home Brisa', 'Holiday House',
];
export const valRules: ParatyUnitRules = {
  isRental: n => VAL_RENTAL.test(n),
  unitName: n => tgUnitName(n, VAL_SITE_UNITS),
};

export interface TgValPages { page: string; kite: string }

export function parseTaigaValdevaquerosContent(p: TgValPages): OfferContent {
  const lines = tgLines(p.page);
  const kiteLines = tgLines(p.kite);
  const all = lines.join('\n');
  const units = parseTgUnits(p.page, TG_NAMESPACE).filter(u => VAL_RENTAL.test(u.name));
  const count = (re: RegExp) => units.filter(u => re.test(u.name)).length;
  const [nBung, nTiny, nGlamp] = [count(/bungalow/i), count(/tiny home/i), count(/glamping/i)];
  const facilities = parseTgServices(p.page);
  const discover = lines.find(l => /^This is the perfect spot/.test(l)) ?? '';
  const school = kiteLines.find(l => /^We have our own school/.test(l)) ?? '';
  const poolText = parseTgPoolSeason(lines);
  const restaurantClosed = /Hippie awaits you[\s\S]{0,400}?Temporarily closed/.test(all);

  const imageUrls: string[] = [];
  for (const u of [...units.flatMap(u => u.images.slice(0, 2)), ...units.flatMap(u => u.images.slice(2)),
    ...imageCandidates(p.page, TG_PAGE_URL, null, 120).filter(x => x.startsWith(`https://cdn2.paraty.es/${TG_NAMESPACE}/images/`))]) {
    if (!imageUrls.includes(u)) imageUrls.push(u);
  }

  const summary = [
    `TAIGA Tarifa Valdevaqueros is a campsite of the Spanish TAIGA chain on the N-340 at Valdevaqueros, Tarifa, 400 m from the kitesurf beach in the Strait Natural Park.`,
    `Besides pitches it rents ${nBung} bungalow types, ${nTiny} tiny homes, ${nGlamp} glamping tents and a holiday house; bungalows and tiny homes have a kitchen, private bathroom and terrace, and pets are allowed.`,
    `The campsite runs its own kite and wind foil school with equipment rental${poolText ? `; a pool (${poolText})` : ''}, supermarket and tennis court are on site.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'TAIGA Tarifa Valdevaqueros',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Valdevaqueros, Tarifa',
    spot: 'Valdevaqueros',
    spotCoords: parseTgHotelGeo(p.page),
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // kite page: "If you are just starting out ... learn properly"; "if you already know how to ride, we also rent out equipment"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /book kite or wind foil lessons/i.test(school),
    equipmentRental: /rent out equipment/i.test(school),
    beginnerFriendly: kiteLines.some(l => /just starting out/i.test(l)),
    includedServices: facilities
      .filter(f => !/^(Tourist activities|Car wash|Toilets|Tennis court)$/i.test(f) && !(restaurantClosed && /restaurant/i.test(f)))
      .map(f => (/pool/i.test(f) && poolText ? `${f} (${poolText})` : f)),
    optionalServices: [
      'Kite and wind foil lessons at the campsite school',
      'Kite and wind foil equipment rental',
      'Tennis court (EUR 4 per hour)',
      'Excursions booked at reception: horse riding in the Strait Natural Park, whale watching, diving course, bike rental',
      ...(restaurantClosed ? [] : ['Restaurant']),
    ],
    accommodation: 'campsite bungalows, tiny homes, glamping tents and a holiday house',
    mealPlan: 'self_catering',
    languages: [],
    rooms: units.map(tgRoom),
    imageUrls: imageUrls.slice(0, 40),
    heroVideoUrl: null,
    sourceUrl: TG_PAGE_URL,
    bookingUrl: TG_PAGE_URL,
    sourceText: [
      `discover: ${discover}`,
      `facilities: ${facilities.join(', ')}`,
      `pool: ${poolText ?? '-'}; restaurant temporarily closed: ${restaurantClosed}`,
      `kite school: ${school}`,
      `units: ${units.map(u => `${u.name} (${[u.size, u.bedrooms, u.capacity].filter(Boolean).join(', ')}): ${u.summary ?? ''}`).join(' | ')}`,
      `geo: ${TG_GEO_NOTE}`,
    ].join('\n'),
  };
}

export async function fetchTaigaValdevaquerosSlots(ctx: FetchContext, today: string): Promise<Slot[]> {
  return fetchParatySlots(ctx, TG_NAMESPACE, today, valRules, 'taiga-tarifa-valdevaqueros');
}

export const taigaTarifaValdevaqueros: OfferAdapter = {
  key: 'taiga-tarifa-valdevaqueros',
  name: 'TAIGA Tarifa Valdevaqueros',
  kind: 'accommodation',
  operator: {
    name: 'TAIGA Campings & Resorts',
    websiteUrl: SITE,
    rootDomain: 'taigaresorts.com',
    contactEmail: 'hola.valdevaqueros@taigaresorts.com',
    phone: '+34951204531',
  },
  url: TG_PAGE_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 15,
  async fetchContent() {
    const page = await fetchText(TG_PAGE_URL, { accept: 'text/html' });
    const kite = await fetchText(TG_KITE_URL, { accept: 'text/html' });
    return parseTaigaValdevaquerosContent({ page, kite });
  },
  async fetchSlots(ctx) {
    return fetchTaigaValdevaquerosSlots(ctx, todayIso());
  },
};
