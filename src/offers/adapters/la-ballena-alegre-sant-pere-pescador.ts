// ---------------------------------------------------------------------------
// La Ballena Alegre, Sant Pere Pescador (Costa Brava, Catalonia, Spain) - camping & bungalow resort on the
// beach of the Bay of Roses; the ION Club Golf de Roses kite / windsurf / wingfoil / SUP center is located on
// the campsite. 14 bungalow types, rented by the week with fixed change-over days in high season.
//
// Data path (checked 2026-10-12):
//   content  www.ballena-alegre.com/costabrava/en/feel-at-home/ (WordPress): the script "los-alojamientos-js-before"
//            holds var OTROS_ELEMENTOS_OBJECT = [...] with every bungalow page (title, subtitle, description, area,
//            capacity, layout, change-over day, facilities, gallery, and the printed "From 223€/night" in the
//            post content); /en/ (season "Open from May 8th to October 18th, 2026", kite school block "ION CLUB
//            Golf de Roses"), /en/experiences/nautical/ (ION Club text). The campsite coordinates come from the
//            booking engine's own property record (geoPosition, degrees/minutes/seconds).
//   slots    MasterCamping booking engine (the site's widget, idProperty 10), public JSON without login:
//            GET rsv4.mastercamping.com/api/info?idProperty=10&lang=en -> products (one per bungalow type and season
//                year, e.g. "Bungalow e-Devesa (2027)"), included guests;
//            GET rsv4.mastercamping.com/api/availability?agregate=PRODUCT&idProperty=10 -> per product
//                {firstBookableDate, matrix}: matrix[i] = bit mask of the stay lengths bookable when arriving on
//                firstBookableDate + i (bit n = n+1 nights; the widget's checkoutIsSelectable reads it the same way);
//            GET booking.ballena-alegre.com/api/budgets?checkin&checkout&guestAges=18,18&lang=en&idProperty=10 ->
//                totalPrice (EUR, VAT incl., tourist tax extra) and free units per product for that stay; the engine
//                only prices products whose change-over day matches the check-in day.
//            Per change-over day (Fri / Sat / Sun / Mon) and month we search ONE sample 7-night stay: the first
//            arrival of the month on which most bungalow types of that group can book 7 nights.
// robots.txt (2026-10-12): www.ballena-alegre.com disallows /wp-*, /*? etc. (not the pages we read);
//   rsv4.mastercamping.com has no rules (content signals only); booking.ballena-alegre.com serves its SPA for
//   /robots.txt (no rules).
// Requests per run: content 4 (3 pages + info, memoised), slots 1 info + 1 availability + up to 4 groups x months
//   with weekly arrivals (24 for the 2027 season May-Oct).
// Parsed: bands per bungalow type with real limits (runsOf over the nights of each weekly arrival): price = the
//   month's sample price for a 7-night stay (priceUnit 'package', packageNights 7, priceBasis 'room'),
//   availability 'available' when a 7-night stay can start that week, 'limited' when the sample week had <= 2
//   free units, 'sold_out' for change-over weeks inside the season without a bookable 7-night stay.
// Rooms: engine products are linked to the site's bungalow rooms via BA_ROOMS (slot.room); "Cortal" and "Empúries"
//   price both their Garden and Pool bungalows, so those slots are repeated per room (shared availability).
// Known limits: prices are sampled once per month and group (the engine prices by exact stay); short stays at
//   season start/end and weekend offers are ignored; tourist tax (0.50 EUR pp/night) is extra.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, runsOf, todayIso } from '../parse.js';
import type { Availability, ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const WEB = 'https://www.ballena-alegre.com/costabrava';
export const BA_HOME_URL = `${WEB}/en/`;
export const BA_BUNGALOWS_URL = `${WEB}/en/feel-at-home/`;
export const BA_NAUTICAL_URL = `${WEB}/en/experiences/nautical/`;
const MC = 'https://rsv4.mastercamping.com';
const PROPERTY = 10;
export const BA_INFO_URL = `${MC}/api/info?idProperty=${PROPERTY}&lang=en`;
export const BA_AVAILABILITY_URL = `${MC}/api/availability?agregate=PRODUCT&idProperty=${PROPERTY}`;
const ENGINE = 'https://booking.ballena-alegre.com';
export const baBudgetsUrl = (checkin: string, checkout: string): string =>
  `${ENGINE}/api/budgets?checkin=${checkin}&checkout=${checkout}&guestAges=18,18&lang=en&idProperty=${PROPERTY}`;
const BOOKING_URL = `${ENGINE}/search?lang=en`;
const HORIZON_MONTHS = 12;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per URL per 10 minutes: fetchContent + fetchSlots in the same run share the info record */
function get(url: string, accept: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const addDays = (d: string, n: number): string => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const weekday = (d: string): number => new Date(`${d}T00:00:00Z`).getUTCDay();
/** Visible text lines (scripts, styles, SVGs dropped), split at block tags. */
export function baLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|a|button|figure)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- site parsers -----------------------------------------------------------------------------
export interface BaBungalow {
  id: number; title: string; url: string; subtitle: string | null; description: string | null;
  changeover: string | null; area: string | null; capacity: string | null; layout: string | null;
  facilities: string[]; gallery: string[]; fromPerNight: number | null;
}

const CHANGEOVER: Record<string, string> = {
  'domingo a domingo': 'Sunday to Sunday', 'lunes a lunes': 'Monday to Monday', 'viernes a viernes': 'Friday to Friday',
  'sábado a sábado': 'Saturday to Saturday', 'sabado a sabado': 'Saturday to Saturday',
};

function jsVar(script: string, name: string): unknown {
  const m = script.match(new RegExp(`var ${name} = ([\\s\\S]*?);\\n`));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** Bungalow records of the overview page (deduplicated by post id, in page order). */
export function parseBaBungalows(html: string): BaBungalow[] {
  const script = html.match(/<script id="los-alojamientos-js-before">([\s\S]*?)<\/script>/)?.[1] ?? '';
  const list = jsVar(script, 'OTROS_ELEMENTOS_OBJECT');
  const labels = (jsVar(script, 'OTROS_ELEMENTOS_STRINGS') ?? {}) as Record<string, string>;
  if (!Array.isArray(list)) return [];
  const out: BaBungalow[] = [];
  for (const raw of list as Array<Record<string, unknown>>) {
    const id = Number(raw.ID);
    if (!id || out.some(b => b.id === id)) continue;
    const acf = (raw.acf ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string | null => (typeof v === 'string' && clean(v)) || null;
    const fil = acf.filtros_instalaciones;
    const facilityKeys = Array.isArray(fil) ? fil.map(String) : fil && typeof fil === 'object'
      ? Object.entries(fil as Record<string, unknown>).filter(([, v]) => v === true).map(([k]) => k) : [];
    const price = String(raw.post_content ?? '').match(/class=\\?"precio\\?">\s*([\d.,]+)\s*(?:€|&euro;|\\u20ac)/);
    const ch = str(acf.fechas_alquiler_alojamiento);
    out.push({
      id,
      title: str(raw.title) ?? str(raw.post_title) ?? '',
      url: String(raw.url ?? ''),
      subtitle: str(acf.subtitulo_alojamiento),
      description: str(acf.descripcion_alojamiento),
      changeover: ch ? CHANGEOVER[ch.toLowerCase()] ?? ch : null,
      area: str(acf.area_alojamiento),
      capacity: str(acf.capacidad_alojamiento),
      layout: str(acf.habitaciones_alojamiento),
      facilities: facilityKeys.map(k => clean(labels[k] ?? k)).filter(Boolean),
      gallery: Array.isArray(raw.galeria_alojamiento) ? (raw.galeria_alojamiento as unknown[]).filter((u): u is string => typeof u === 'string') : [],
      fromPerNight: price ? Number(price[1].replace(',', '.')) : null,
    });
  }
  return out.filter(b => b.title);
}

const MONTH_EN: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
/** "Open from May 8th to October 18th, 2026" -> ISO dates. */
export function parseBaSeason(html: string): { from: string; to: string; text: string } | null {
  const t = baLines(html).find(l => /^Open from /i.test(l));
  const m = t?.match(/Open from ([A-Za-z]+) (\d{1,2})(?:st|nd|rd|th)? to ([A-Za-z]+) (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})/i);
  if (!m || !MONTH_EN[m[1].toLowerCase()] || !MONTH_EN[m[3].toLowerCase()]) return null;
  return { from: iso(+m[5], MONTH_EN[m[1].toLowerCase()], +m[2]), to: iso(+m[5], MONTH_EN[m[3].toLowerCase()], +m[4]), text: t! };
}

/** ION Club paragraph(s) of the nautical page. */
export function parseBaIonClub(html: string): string[] {
  return baLines(html).filter(l => /ION Club Golf de Roses is|designated areas for each sport/i.test(l));
}

// --- engine parsers ---------------------------------------------------------------------------
export interface McProduct { id: number; name: string; unit: string; year: number | null; categoryId: number | null; includedAdults: number | null; shortDescription: string | null }

/** Bungalow products of /api/info (weekend offers and pitches excluded). */
export function parseMcProducts(json: string): McProduct[] {
  const info = JSON.parse(json) as { products?: Array<Record<string, unknown>>; categories?: Array<Record<string, unknown>>; categoryGroups?: Array<Record<string, unknown>> };
  const groupIds = new Set((info.categoryGroups ?? []).filter(g => /bungalow/i.test(String(g.name ?? ''))).map(g => Number(g.idCategoryGroup)));
  const bungalowCats = new Set((info.categories ?? []).filter(c => groupIds.has(Number(c.idCategoryGroup))).map(c => Number(c.idCategory)));
  const out: McProduct[] = [];
  for (const p of info.products ?? []) {
    const name = clean(String(p.name ?? ''));
    const cats = Array.isArray(p.categories) ? (p.categories as unknown[]).map(Number) : [];
    if (!/^Bungalow\b/i.test(name) || /weekend/i.test(name)) continue;
    if (bungalowCats.size && !cats.some(c => bungalowCats.has(c))) continue;
    const year = Number(name.match(/\((20\d{2})\)\s*$/)?.[1] ?? NaN) || null;
    const unit = name.replace(/\s*\(20\d{2}\)\s*$/, '').replace(/\(\s*duplex\s*\)/i, '(duplex)').replace(/\s+/g, ' ').trim();
    const inc = (p.includedPeople ?? {}) as Record<string, unknown>;
    out.push({ id: Number(p.idProduct), name, unit, year, categoryId: cats[0] ?? null, includedAdults: typeof inc.includedAdults === 'number' ? inc.includedAdults : null, shortDescription: typeof p.shortDescription === 'string' ? clean(p.shortDescription) || null : null });
  }
  return out;
}

/** geoPosition {lat: 'N42º 09´08"', long: 'E003º 06´42"'} -> decimal degrees. */
export function parseMcGeo(json: string): { lat: number; lng: number } | null {
  const g = (JSON.parse(json) as { geoPosition?: { lat?: string; long?: string } }).geoPosition;
  const dms = (s: string | undefined): number | null => {
    const m = s?.match(/([NSEW])\s*(\d+)\D+(\d+)\D+(\d+(?:[.,]\d+)?)/);
    if (!m) return null;
    const v = Number(m[2]) + Number(m[3]) / 60 + Number(m[4].replace(',', '.')) / 3600;
    return Math.round((/[SW]/.test(m[1]) ? -v : v) * 1e5) / 1e5;
  };
  const lat = dms(g?.lat); const lng = dms(g?.long);
  return lat !== null && lng !== null ? { lat, lng } : null;
}

export interface McArrival { date: string; stays: number[] }

/** /api/availability: per product the arrivals with their bookable stay lengths (nights). */
export function parseMcAvailability(json: string): Map<number, McArrival[]> {
  const raw = JSON.parse(json) as Record<string, { firstBookableDate?: string; matrix?: unknown[] }>;
  const out = new Map<number, McArrival[]>();
  for (const [pid, v] of Object.entries(raw)) {
    const first = v.firstBookableDate?.slice(0, 10);
    if (!first || !Array.isArray(v.matrix)) continue;
    const list: McArrival[] = [];
    v.matrix.forEach((mask, i) => {
      const n = typeof mask === 'number' ? mask : 0;
      if (!n) return;
      const stays: number[] = [];
      for (let b = 0; b < 31; b++) if (n & (1 << b)) stays.push(b + 1);
      list.push({ date: addDays(first, i), stays });
    });
    out.set(Number(pid), list);
  }
  return out;
}

export interface McBudget { idProduct: number; totalPrice: number; touristTax: number | null; available: number | null }
export function parseMcBudgets(json: string): McBudget[] {
  const r = JSON.parse(json) as { budgets?: Array<Record<string, unknown>> };
  return (r.budgets ?? []).map(b => ({
    idProduct: Number(b.idProduct),
    totalPrice: Number(b.totalPrice),
    touristTax: typeof b.touristTax === 'number' ? b.touristTax : null,
    available: typeof b.accommodationAvailable === 'number' ? b.accommodationAvailable : null,
  })).filter(b => b.idProduct && b.totalPrice > 0);
}

// --- sampling + slots -------------------------------------------------------------------------
/** Weekly arrivals (a 7-night stay is bookable) of one product, from `today` on. */
const weekly = (arr: McArrival[] | undefined, today: string): string[] => (arr ?? []).filter(a => a.date >= today && a.stays.includes(7)).map(a => a.date);

/** Change-over weekday of a product = the most common weekday of its weekly arrivals. */
export function changeoverDay(arrivals: string[]): number | null {
  if (!arrivals.length) return null;
  const n = new Array(7).fill(0);
  for (const d of arrivals) n[weekday(d)]++;
  return n.indexOf(Math.max(...n));
}

export interface BaSample { day: number; month: string; checkin: string; checkout: string; products: number[] }

/** One sample 7-night stay per change-over weekday and month: the arrival on which most products of the group can book. */
export function baSamples(products: McProduct[], avail: Map<number, McArrival[]>, today: string, horizonMonths = HORIZON_MONTHS): BaSample[] {
  const lastDay = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + horizonMonths); return d.toISOString().slice(0, 10); })();
  const groups = new Map<number, Array<{ id: number; dates: Set<string> }>>();
  for (const p of products) {
    const dates = weekly(avail.get(p.id), today).filter(d => d <= lastDay);
    const day = changeoverDay(dates);
    if (day === null) continue;
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push({ id: p.id, dates: new Set(dates.filter(d => weekday(d) === day)) });
  }
  const out: BaSample[] = [];
  for (const [day, members] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const byMonth = new Map<string, string[]>();
    for (const d of new Set(members.flatMap(m => [...m.dates]))) {
      const ym = d.slice(0, 7);
      if (!byMonth.has(ym)) byMonth.set(ym, []);
      byMonth.get(ym)!.push(d);
    }
    for (const [month, dates] of [...byMonth.entries()].sort()) {
      const best = dates.sort().map(d => ({ d, n: members.filter(m => m.dates.has(d)).length })).sort((a, b) => b.n - a.n || a.d.localeCompare(b.d))[0];
      out.push({ day, month, checkin: best.d, checkout: addDays(best.d, 7), products: members.filter(m => m.dates.has(best.d)).map(m => m.id) });
    }
  }
  return out;
}

export interface BaPriced { sample: BaSample; budgets: McBudget[] }

/**
 * Engine product -> content room(s) where the names differ (content rooms are "Bungalow <site title>", see
 * parseBallenaContent; checked against the 2026-10-12 fixture). "Cortal" and "Empúries" are one engine product each
 * for the Garden and Pool bungalows of that type: same size, same description and the same printed "from" price
 * per night on the site, so the product price is each bungalow's price and the slot is repeated per room.
 */
export const BA_ROOMS: Record<string, string[]> = {
  'Bungalow Cortal': ['Bungalow Cortal Garden', 'Bungalow Cortal Pool'],
  'Bungalow Empúries': ['Bungalow Empúries Garden', 'Bungalow Empúries Pool'],
  'Bungalow Empúries SUITES': ['Bungalow Empuries Suite'],
  'Bungalow Fluvià Saturday': ['Bungalow Fluvia Saturday'],
  'Bungalow Fluvià Special': ['Bungalow Fluvia Especial'],
  'Bungalow Xaloc (duplex)': ['Bungalow Xaloc'],
  'Bungalow e-Devesa': ['Bungalow E-Devesa'],
};

/** Link slots to their content room (slot.room); one copy per room (key + "|<room>") for shared products. */
export function withBaRooms(slots: Slot[]): Slot[] {
  return slots.flatMap(s => {
    const rooms = s.unit ? BA_ROOMS[s.unit] : undefined;
    if (!rooms) return [s];
    return rooms.length === 1 ? [{ ...s, room: rooms[0] }] : rooms.map(room => ({ ...s, key: `${s.key}|${room}`, room }));
  });
}

/**
 * Bands per bungalow type. Every change-over week from the first to the last weekly arrival is a 7-night block
 * (available / sold out); its price is the sample of its group and arrival month. Consecutive nights with the same
 * price and availability merge into one band (runsOf).
 */
export function buildBaSlots(products: McProduct[], avail: Map<number, McArrival[]>, priced: BaPriced[], today: string): Slot[] {
  const out: Slot[] = [];
  for (const p of products) {
    const dates = weekly(avail.get(p.id), today);
    const day = changeoverDay(dates);
    if (day === null) continue;
    const onDay = dates.filter(d => weekday(d) === day).sort();
    if (!onDay.length) continue;
    const free = new Set(onDay);
    type Night = { date: string; price: number | null; availability: Availability; text: string; spots: number | null };
    const nights: Night[] = [];
    for (let w = onDay[0]; w <= onDay[onDay.length - 1]; w = addDays(w, 7)) {
      const sample = priced.find(x => x.sample.day === day && x.sample.month === w.slice(0, 7));
      const b = sample?.budgets.find(x => x.idProduct === p.id) ?? null;
      const isSampleWeek = sample?.sample.checkin === w;
      let availability: Availability = free.has(w) ? 'available' : 'sold_out';
      let spots: number | null = null;
      if (availability === 'available' && isSampleWeek && b?.available !== null && b?.available !== undefined && b.available <= 2) {
        availability = 'limited'; spots = b.available;
      }
      const text = availability === 'sold_out'
        ? `no 7-night stay bookable from ${WEEKDAYS[day]} ${w} in the booking engine`
        : `${WEEKDAYS[day]} to ${WEEKDAYS[day]}, 7 nights${spots !== null ? `; ${spots} bungalow(s) of this type free in the sample week ${w}` : ''}`;
      // a sold-out week has no price of its own (the sample belongs to another week of the month)
      const price = availability === 'sold_out' ? null : b?.totalPrice ?? null;
      for (let i = 0; i < 7; i++) nights.push({ date: addDays(w, i), price, availability, text, spots });
    }
    for (const run of runsOf(nights, n => `${n.availability}|${n.price}|${n.spots}`)) {
      const n = run.first;
      out.push({
        key: `${keyPart(p.unit)}|${run.start}`,
        startDate: run.start,
        endDate: run.end,
        unit: p.unit,
        price: n.price,
        currency: n.price !== null ? 'EUR' : null,
        priceUnit: n.price !== null ? 'package' : null,
        priceBasis: 'room',
        occupancy: null, // the bungalow price includes up to p.includedAdults guests (sampled for 2 adults)
        availability: n.availability,
        availabilityText: n.text,
        spotsLeft: n.spots,
        packageNights: 7,
        minNights: 7,
      });
    }
  }
  return out;
}

/** Live slots: info + availability + one budgets call per sample (change-over day x month). */
export async function fetchBaSlots(ctx: FetchContext, today: string): Promise<Slot[]> {
  const products = parseMcProducts(await get(BA_INFO_URL, 'application/json'));
  if (products.length < 5) throw new Error(`la-ballena-alegre: only ${products.length} bungalow products in the MasterCamping info`);
  const avail = parseMcAvailability(await get(BA_AVAILABILITY_URL, 'application/json'));
  const samples = baSamples(products, avail, today);
  const priced: BaPriced[] = [];
  let failed = 0;
  for (const s of samples) {
    try {
      priced.push({ sample: s, budgets: parseMcBudgets(await fetchText(baBudgetsUrl(s.checkin, s.checkout), { accept: 'application/json' })) });
    } catch (e) {
      failed++;
      ctx.note(`budgets ${s.checkin}: ${(e as Error).message}`);
    }
  }
  if (failed > 0) ctx.incomplete(`${failed} of ${samples.length} sample prices failed`);
  const slots = withBaRooms(buildBaSlots(products, avail, priced, today));
  if (samples.length > 0 && slots.length === 0) throw new Error('la-ballena-alegre: sample stays found but no bands built');
  return slots;
}

// --- content ----------------------------------------------------------------------------------
export interface BaPages { home: string; bungalows: string; nautical: string; info: string }

export function parseBallenaContent(p: BaPages): OfferContent {
  const bungalows = parseBaBungalows(p.bungalows);
  const season = parseBaSeason(p.home);
  const ion = parseBaIonClub(p.nautical);
  const home = baLines(p.home);
  const geo = parseMcGeo(p.info);
  const minStay = home.find(l => /minimum 1 week during high season/i.test(l)) ?? null;
  const ionBlock = (() => { const i = home.findIndex(l => /^ION CLUB Golf de Roses$/i.test(l)); return i >= 0 ? home.slice(i - 1, i + 4) : []; })();
  const prices = bungalows.map(b => b.fromPerNight).filter((x): x is number => x !== null);
  const areas = bungalows.map(b => Number(b.area?.match(/(\d+)/)?.[1] ?? NaN)).filter(Number.isFinite);
  const guests = bungalows.map(b => (b.capacity?.match(/\d+/g) ?? []).reduce((a, x) => a + Number(x), 0)).filter(n => n > 0);
  const edevesa = bungalows.find(b => /e-devesa/i.test(b.title));
  const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

  const rooms: ContentRoom[] = bungalows.map(b => ({
    name: `Bungalow ${b.title}`,
    description: b.description,
    features: [
      b.subtitle, b.area, b.capacity ? `Capacity ${b.capacity}` : null, b.layout,
      b.changeover ? `Rental ${b.changeover}` : null,
      b.fromPerNight !== null ? `From EUR ${b.fromPerNight} per night (as printed on the site)` : null,
      ...b.facilities,
    ].filter((x): x is string => !!x),
  }));

  const imageUrls: string[] = [];
  for (const b of bungalows) for (const u of b.gallery.slice(0, 3)) if (!/plano|plan-|logo/i.test(u) && !imageUrls.includes(u)) imageUrls.push(u);

  const summary = [
    `La Ballena Alegre is a camping and bungalow resort on the beach of Sant Pere Pescador in the Bay of Roses (Costa Brava, Catalonia, Spain)${season ? `, open from ${fmtDate(season.from)} to ${fmtDate(season.to)} ${season.from.slice(0, 4)}` : ''}.`,
    `The ION Club Golf de Roses kite, windsurf, wingfoil and SUP center is located on the campsite, with designated areas for each sport and a school for all levels; the wind comes from the thermal breeze and the Tramuntana.`,
    `The resort rents ${bungalows.length || 14} bungalow types${areas.length && guests.length ? ` (${Math.min(...areas)}-${Math.max(...areas)} m², ${Math.min(...guests)} to ${Math.max(...guests)} guests)` : ''}${edevesa ? `, among them the E-Devesa eco bungalows at the seafront close to the kitesurfing school` : ''}, by the week with fixed change-over days in high season${prices.length ? `, from EUR ${Math.min(...prices)} to ${Math.max(...prices)} per night as printed on the site` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'La Ballena Alegre',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Catalonia',
    spot: 'Sant Pere Pescador, Bay of Roses',
    spotCoords: geo, // geoPosition of the property in its own booking engine (MasterCamping)
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // nautical page: "school for all levels"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: ion.some(l => /kitesurfing/i.test(l)),
    equipmentRental: null, // the ION Club pages are external; rental is not stated on the campsite site
    beginnerFriendly: ion.some(l => /school for all levels/i.test(l)),
    includedServices: ['Sheets and towels', 'Air conditioning (cold/hot)', 'Wi-Fi', 'Parking next to the bungalow (most types)', 'Cot and high chair on request'],
    optionalServices: ['Kite, windsurf, wingfoil and SUP school and center (ION Club Golf de Roses)', 'Sailing school (Hobie Cat, funboats)', 'Diving center', 'Spa', 'Gym', 'Food packs delivered to the bungalow'],
    accommodation: 'bungalows on a camping resort',
    mealPlan: 'self_catering',
    languages: ['es', 'ca', 'en', 'fr', 'de', 'nl'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: BA_BUNGALOWS_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `season: ${season?.text ?? '-'}; ${minStay ?? '-'}`,
      `kite school: ${ionBlock.join(' | ')}`,
      `ion club: ${ion.join(' ')}`,
      ...bungalows.map(b => `bungalow ${b.title}: ${b.subtitle ?? ''}; ${b.area ?? ''}; ${b.capacity ?? ''}; ${b.layout ?? ''}; ${b.changeover ?? ''}; from ${b.fromPerNight ?? '-'} EUR/night; ${b.facilities.join(', ')}; ${b.description ?? ''}`),
      `coords (MasterCamping geoPosition): ${geo ? `${geo.lat},${geo.lng}` : '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const laBallenaAlegreSantPerePescador: OfferAdapter = {
  key: 'la-ballena-alegre-sant-pere-pescador',
  name: 'La Ballena Alegre Sant Pere Pescador',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'La Ballena Alegre',
    websiteUrl: BA_HOME_URL,
    rootDomain: 'ballena-alegre.com',
    contactEmail: 'info@ballena-alegre.com',
    phone: '+34972520302',
  },
  url: BA_BUNGALOWS_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 30,
  async fetchContent() {
    const bungalows = await get(BA_BUNGALOWS_URL, 'text/html');
    if (parseBaBungalows(bungalows).length < 8) throw new Error('la-ballena-alegre: OTROS_ELEMENTOS_OBJECT (bungalow records) not found on the overview page');
    const home = await get(BA_HOME_URL, 'text/html');
    const nautical = await get(BA_NAUTICAL_URL, 'text/html');
    const info = await get(BA_INFO_URL, 'application/json');
    return parseBallenaContent({ home, bungalows, nautical, info });
  },
  async fetchSlots(ctx) {
    return fetchBaSlots(ctx, todayIso());
  },
};
