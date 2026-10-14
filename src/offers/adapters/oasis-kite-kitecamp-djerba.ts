// ---------------------------------------------------------------------------
// Oasis Kite - Kitecamp Djerba (Tunisia): Saturday-to-Saturday kite camp weeks of the German kite school
// Oasis Kite (Oasis Kite GbR, Magdeburg) with 7 nights in its two-storey Kite Villa (pool, air-conditioned
// double rooms, roof terrace, beach 200 m away), 7 breakfasts + 5 dinners, airport and spot transfers.
// Packages: Beginner/Advanced (20 h course), Rider (6 days equipment pool, supervised kiting), Rider PLUS
// (5 h progression course + video analysis); each as double or single room. KIND = 'camp'.
//
// Data path (checked 2026-10-14):
//   content  oasiskite.com/kitecamp/ (WordPress + Elementor, German): week plan, package boxes
//            ("Beginner/ Advanced Package 1090 €" + inclusions), Rider PLUS room note, "Nicht ... enthalten",
//            "Die Kitecamp-Termine 2027", spot text (40 km2 lagoon), villa text + amenities, FAQ (wind),
//            photo carousels (lazy `data-bg`); /impressum/ (operator, "Kontakt Tunesien: Midoun, Djerba ...
//            Q3J2+XC El Haddad" = a short Google plus code -> spotCoords, see below); the Leão category page.
//   slots    booking engine = Leão Booking (myleao.com), the site's "Jetzt buchen" link:
//            GET www.myleao.com/selfservice/category/2132        -> the camp's products (name, price, id);
//            GET www.myleao.com/api/event/product/<id>/lang/de   -> the product's dated camp weeks, the call
//                the engine's own calendar page (/calendar/product/<id>/de) makes anonymously:
//                [{startdate, enddate, maxParticipants, participants, availMsg, price "1.090,00", currency,
//                  bookable, ...}] - public JSON, no login, no session, no token.
//            The yoga products of the same category (yoga add-on, "Yoga und Abenteuer Camp") are not kite
//            camps and are skipped (the add-on price goes to optionalServices).
// robots.txt (2026-10-14): oasiskite.com WordPress/Yoast default (only wp-admin, WooCommerce paths);
//   www.myleao.com/robots.txt is 404 (= allow all).
// Requests per run: content 3 (camp page, Impressum, category), slots 1 + 6 kite products = 7 (the category
//   page is memoised, so a full run makes 9). The camp page answered after > 30 s once: 60 s timeout.
// Parsed: slot = package x room x camp week (key "beginner-advanced-double|2027-04-24"), EUR per person for
//   the 7-night package (priceUnit 'package', packageNights 7), occupancy 2 (double) / 1 (single);
//   spotsLeft = maxParticipants - participants of that product's week; availability: 0 left or "ausgebucht"
//   -> sold_out, <= 2 left -> limited ("Nur noch 2 Plätze frei."), else available; bookable != 1 -> closed.
//   Each product has its own allocation per week (e.g. Rider single room: 1 place), so the spots of the
//   six products are not one shared camp capacity.
// Known limits:
//   - Rider PLUS: the camp page says its EUR 990 holds for a triple room (double 1090, single 1290), while the
//     engine sells "Rider PLUS - Doppelzimmer" at 990 and "- Einzelzimmer" at 1190. Slots carry the engine's
//     prices (what a guest books); the page wording is kept in the room features.
//   - The engine lists one more week than the page (29.05.-05.06.2027).
//   - spotCoords = the Impressum's Tunisian contact (plus code Q3J2+XC near El Haddad / Midoun, decoded
//     locally, recovered nearest to Djerba): the villa's area, not the lagoon (about 15 min by car, guest
//     review). The page does not name the lagoon.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, iso, parse, parseAmount, todayIso } from '../parse.js';
import type { Availability, ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://oasiskite.com';
export const OK_CAMP_URL = `${SITE}/kitecamp/`;
export const OK_IMPRESSUM_URL = `${SITE}/impressum/`;
const LEAO = 'https://www.myleao.com';
export const OK_CATEGORY_URL = `${LEAO}/selfservice/category/2132`;
export const okEventsUrl = (productId: number): string => `${LEAO}/api/event/product/${productId}/lang/de`;
const CAMP_NIGHTS = 7;
/** reference for recovering the short plus code (Djerba; any point within 0.5 deg gives the same cell) */
const DJERBA_REF = { lat: 33.8, lng: 10.9 };

// --- local helpers ------------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the category page */
function page(url: string, accept = 'text/html'): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept, timeoutMs: 60_000 });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines (scripts, styles, svg dropped), split at block tags. */
export function okLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|table|header|footer|span|a|button)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

const OLC = '23456789CFGHJMPQRVWX';
/**
 * Short Open Location Code ("Q3J2+XC", the first four characters dropped) -> centre of its cell, recovered
 * as the 1-degree cell nearest to `ref` (the standard recoverNearest for 4 dropped characters).
 */
export function decodeShortPlusCode(code: string, ref: { lat: number; lng: number }): { lat: number; lng: number } | null {
  const m = code.toUpperCase().match(/^([2-9CFGHJMPQRVWX]{4})\+([2-9CFGHJMPQRVWX]{2})$/);
  if (!m) return null;
  const d = (m[1] + m[2]).split('').map(c => OLC.indexOf(c));
  const res = [0.05, 0.0025, 0.000125];
  let lat = res[2] / 2;
  let lng = res[2] / 2;
  for (let i = 0; i < 3; i++) { lat += d[2 * i] * res[i]; lng += d[2 * i + 1] * res[i]; }
  const nearest = (off: number, r: number): number => {
    const base = Math.floor(r);
    return [base - 1, base, base + 1].map(b => b + off).reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a));
  };
  const round = (x: number) => Math.round(x * 1e6) / 1e6;
  return { lat: round(nearest(lat, ref.lat)), lng: round(nearest(lng, ref.lng)) };
}

// --- Leão products + events --------------------------------------------------------------------------
export type OkPackage = 'beginner-advanced' | 'rider' | 'rider-plus';
export type OkRoom = 'double' | 'single' | 'triple';
export const OK_PACKAGE_LABEL: Record<OkPackage, string> = {
  'beginner-advanced': 'Beginner/Advanced package',
  rider: 'Rider package',
  'rider-plus': 'Rider PLUS package',
};
const ROOM_OCCUPANCY: Record<OkRoom, number> = { double: 2, single: 1, triple: 3 };

export interface OkProduct {
  id: number;
  name: string;
  teaser: string;
  price: number | null;
  /** null = not a kite camp product (yoga add-on, yoga camp) */
  pkg: OkPackage | null;
  room: OkRoom | null;
}

export function okPackageOf(name: string): OkPackage | null {
  if (/yoga/i.test(name)) return null;
  if (/rider\s*plus/i.test(name)) return 'rider-plus';
  if (/\brider\b/i.test(name)) return 'rider';
  if (/beginner|advanced/i.test(name)) return 'beginner-advanced';
  return null;
}
export function okRoomOf(name: string): OkRoom | null {
  if (/doppelzimmer|double/i.test(name)) return 'double';
  if (/einzelzimmer|single/i.test(name)) return 'single';
  if (/dreibett|triple/i.test(name)) return 'triple';
  return null;
}
export function okUnit(pkg: OkPackage, room: OkRoom): string { return `${OK_PACKAGE_LABEL[pkg]}, ${room} room`; }

/** Products of the Leão category page (name, teaser, price, product id of the "Termin wählen"/"Buchen" button). */
export function parseOkCategory(html: string): OkProduct[] {
  const out: OkProduct[] = [];
  for (const item of parse(html).querySelectorAll('.event-calendar-item')) {
    const id = Number(item.querySelector('a.leao-product-btn')?.getAttribute('id')?.match(/book-button-(\d+)/)?.[1]);
    const name = collapse(item.querySelector('.leao-product-name strong')?.text ?? item.querySelector('.leao-product-name')?.text ?? '');
    if (!id || !name) continue;
    out.push({
      id,
      name,
      teaser: collapse(item.querySelector('.leao-product-teaser')?.text ?? ''),
      price: parseAmount(collapse(item.querySelector('.leao-product-price')?.text ?? '')),
      pkg: okPackageOf(name),
      room: okRoomOf(name),
    });
  }
  return out;
}

export interface LeaoEvent {
  event_id: string;
  product_id: string;
  startdate: string;
  enddate: string;
  maxParticipants: string | number;
  participants: string | number;
  availMsg: string;
  availCssClass?: string;
  price: string;
  currency: string;
  bookable: string | number;
  name: string;
  bookingLink?: string;
}

/** GET /api/event/product/<id>/lang/<lang> -> the product's dated events. */
export function parseLeaoEvents(json: string): LeaoEvent[] {
  const d = JSON.parse(json) as { status?: number; data?: unknown };
  if (d.status !== 1 && d.status !== undefined) throw new Error(`leao events: status ${String(d.status)}`);
  return (Array.isArray(d.data) ? d.data : []).filter((e): e is LeaoEvent =>
    !!e && typeof e === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(String((e as LeaoEvent).startdate)) && /^\d{4}-\d{2}-\d{2}$/.test(String((e as LeaoEvent).enddate)));
}

export function eventAvailability(e: LeaoEvent): { availability: Availability; spotsLeft: number | null; text: string | null } {
  const max = Number(e.maxParticipants);
  const taken = Number(e.participants);
  const spotsLeft = Number.isFinite(max) && Number.isFinite(taken) ? Math.max(0, max - taken) : null;
  const text = clean(e.availMsg) || null;
  let availability: Availability;
  if (String(e.bookable) !== '1') availability = 'closed';
  else if (spotsLeft === 0 || /ausgebucht|booked out|sold out/i.test(text ?? '')) availability = 'sold_out';
  else if (spotsLeft !== null && spotsLeft <= 2) availability = 'limited';
  else if (spotsLeft !== null) availability = 'available';
  else availability = 'unknown';
  return { availability, spotsLeft: availability === 'closed' ? null : spotsLeft, text };
}

const nightsBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** One slot per kite product x event (camp week) that starts today or later. */
export function buildOkSlots(products: OkProduct[], events: Map<number, LeaoEvent[]>, today: string): Slot[] {
  const out: Slot[] = [];
  for (const p of products) {
    if (!p.pkg || !p.room) continue;
    for (const e of (events.get(p.id) ?? []).filter(x => x.startdate >= today).sort((x, y) => x.startdate.localeCompare(y.startdate))) {
      const price = parseAmount(String(e.price ?? ''));
      const currency = /^[A-Z]{3}$/.test(String(e.currency ?? '')) ? String(e.currency) : null;
      const nights = nightsBetween(e.startdate, e.enddate);
      const st = eventAvailability(e);
      out.push({
        key: `${p.pkg}-${p.room}|${e.startdate}`,
        startDate: e.startdate,
        endDate: e.enddate,
        unit: okUnit(p.pkg, p.room),
        price: price && currency ? price : null,
        currency: price && currency ? currency : null,
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: ROOM_OCCUPANCY[p.room],
        availability: st.availability,
        availabilityText: st.text,
        spotsLeft: st.spotsLeft,
        packageNights: nights > 0 && nights <= 60 ? nights : CAMP_NIGHTS,
      });
    }
  }
  return out;
}

// --- page parsers ------------------------------------------------------------------------------------
export interface OkPagePackage { name: string; price: number | null; items: string[] }

/** Package boxes of the camp page: heading line, price line ("1090"), "€", inclusions until "Jetzt buchen". */
export function parseOkPackages(lines: string[]): OkPagePackage[] {
  const heads: Array<[RegExp, string]> = [
    [/^Beginner\s*\/\s*Advanced$/i, 'Beginner/Advanced'],
    [/^Rider Package$/i, 'Rider'],
    [/^Rider PLUS Package$/i, 'Rider PLUS'],
  ];
  const out: OkPagePackage[] = [];
  for (const [re, name] of heads) {
    const i = lines.findIndex(l => re.test(l));
    if (i < 0) continue;
    const priceAt = lines.slice(i + 1, i + 4).findIndex(l => /^\d[\d.,]*$/.test(l));
    const price = priceAt >= 0 ? parseAmount(lines[i + 1 + priceAt]) : null;
    const from = priceAt >= 0 ? i + 1 + priceAt + 1 : i + 1;
    const items: string[] = [];
    for (const l of lines.slice(from, from + 20)) {
      if (/^Jetzt buchen$/i.test(l)) break;
      if (l === '€' || /^Package$/i.test(l)) continue;
      items.push(l.replace(/​/g, '').trim());
    }
    out.push({ name, price, items: items.filter(Boolean) });
  }
  return out;
}

/** "Die Kitecamp-Termine 2027" list: "17.04. - 24.04. (Ausgebucht)". */
export function parseOkPageWeeks(lines: string[]): Array<{ start: string; end: string; note: string | null }> {
  const at = lines.findIndex(l => /Kitecamp-Termine\s+20\d{2}/i.test(l));
  if (at < 0) return [];
  const year = Number(lines[at].match(/(20\d{2})/)![1]);
  const out: Array<{ start: string; end: string; note: string | null }> = [];
  for (const l of lines.slice(at + 1, at + 30)) {
    if (/^Der Kitespot$/i.test(l)) break;
    const m = l.match(/^(\d{1,2})\.(\d{1,2})\.\s*-\s*(\d{1,2})\.(\d{1,2})\.(?:\s*\(([^)]+)\))?$/);
    if (!m) continue;
    const start = iso(year, +m[2], +m[1]);
    let end = iso(year, +m[4], +m[3]);
    if (end < start) end = iso(year + 1, +m[4], +m[3]);
    out.push({ start, end, note: m[5]?.trim() ?? null });
  }
  return out;
}

const AMENITY_EN: Record<string, string> = {
  pool: 'Pool', wifi: 'Wi-Fi', klimaanlage: 'Air conditioning', 'föhn': 'Hair dryer', 'küche': 'Kitchen',
  waschmaschine: 'Washing machine', yogamatte: 'Yoga mats', 'privater zugang zum garten oder balkon': 'Private access to the garden or a balcony',
};
/** Villa amenity headings (German) -> English; unknown ones are kept as printed. */
export function okAmenities(lines: string[]): string[] {
  return lines.map(l => AMENITY_EN[l.toLowerCase()] ?? l);
}

/** Lines between a start line and the first line matching `stop` (exclusive). */
function between(lines: string[], start: RegExp, stop: RegExp, max = 20): string[] {
  const i = lines.findIndex(l => start.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(i + 1, i + 1 + max)) { if (stop.test(l)) break; out.push(l); }
  return out;
}

/** Elementor carousel photos (lazy `data-bg`), page order, de-duplicated. */
export function okImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<div data-bg="(https:\/\/oasiskite\.com\/wp-content\/uploads\/[^"]+?\.(?:jpe?g|png|webp))" class="elementor-carousel-image/gi)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Impressum: "Kontakt Tunesien: Midoun, Djerba Midun, Tunesien Q3J2+XC El Haddad". */
export function parseOkImpressum(html: string): { company: string | null; email: string | null; tunisia: string | null; plusCode: string | null } {
  const lines = okLines(html);
  const t = lines.join('\n');
  const at = lines.findIndex(l => /^Kontakt Tunesien:?$/i.test(l));
  const tunisia = at >= 0 ? lines.slice(at + 1, at + 3).join(', ') : null;
  return {
    company: t.match(/F\s*l\s*orian Schmitz & Samantha Günther GbR/) ? 'Florian Schmitz & Samantha Günther GbR' : null,
    email: t.match(/\b([\w.+-]+@oasiskite\.com)\b/)?.[1] ?? null,
    tunisia,
    plusCode: tunisia?.match(/\b([2-9CFGHJMPQRVWX]{4}\+[2-9CFGHJMPQRVWX]{2})\b/)?.[1] ?? null,
  };
}

export interface OkPages { camp: string; impressum: string; category: string }

const fmt = (n: number) => n.toLocaleString('en-US');
const DE_MONTH: Record<string, string> = {
  januar: 'January', februar: 'February', märz: 'March', april: 'April', mai: 'May', juni: 'June', juli: 'July',
  august: 'August', september: 'September', oktober: 'October', november: 'November', dezember: 'December',
};
/** "April" -> "April", "Mitte Juli" -> "mid-July" (FAQ wording) */
export function okSeasonWord(de: string): string {
  const m = de.trim().match(/^(Anfang|Mitte|Ende)?\s*([A-Za-zä]+)$/i);
  if (!m) return de.trim();
  const month = DE_MONTH[m[2].toLowerCase()] ?? m[2];
  const pre = m[1] ? ({ anfang: 'early', mitte: 'mid', ende: 'late' } as Record<string, string>)[m[1].toLowerCase()] : null;
  return pre ? `${pre}-${month}` : month;
}

/** Rider PLUS note under the package boxes: "7 Nächte im Doppelzimmer – 1090 Euro" -> { double: 1090, single: 1290 } */
export function parseOkRiderPlusRooms(lines: string[]): Partial<Record<OkRoom, number>> {
  const out: Partial<Record<OkRoom, number>> = {};
  for (const l of lines) {
    const m = l.match(/^7 Nächte im (Doppelzimmer|Einzelzimmer|Dreibettzimmer)\s*[–—-]\s*([\d.,]+)\s*Euro$/i);
    const room = m ? okRoomOf(m[1]) : null;
    const v = m ? parseAmount(m[2]) : null;
    if (room && v) out[room] = v;
  }
  return out;
}

export function parseOasisKiteContent(p: OkPages): OfferContent {
  const lines = okLines(p.camp);
  const text = lines.join('\n');
  const packages = parseOkPackages(lines);
  const weeks = parseOkPageWeeks(lines);
  const products = parseOkCategory(p.category);
  const imp = parseOkImpressum(p.impressum);
  const coords = imp.plusCode ? decodeShortPlusCode(imp.plusCode, DJERBA_REF) : null;
  const notIncluded = between(lines, /^Nicht im Beginner-\/Advanced-\/Rider Package enthalten:?$/i, /Kitecamp-Termine/i, 8);
  const riderPlusTriple = lines.some(l => /^Der angegebene Paketpreis gilt für 7 Nächte im Dreibettzimmer\.?$/i.test(l));
  const riderPlusNote = between(lines, /^Der angegebene Paketpreis gilt für 7 Nächte im Dreibettzimmer\.?$/i, /^Nicht im/i, 4);
  const riderPlusRooms = parseOkRiderPlusRooms(riderPlusNote);
  const lagoon = text.match(/In der ca\. (\d+) km2 großen Lagune/i)?.[1] ?? null;
  const amenities = okAmenities(between(lines, /^Die Kite Villa$/i, /^\d{1,2}$/, 12).slice(1).filter(l => l.length < 60));
  const villaText = between(lines, /^Die Kite Villa$/i, /^Pool$/i, 3).join(' ');
  const seasonM = text.match(/beste Zeit für ein Kitecamp auf Djerba ist von ([A-Za-zä]+) bis ([A-Za-zä ]+?)\s*\./i);
  const season = seasonM ? [okSeasonWord(seasonM[1]), okSeasonWord(seasonM[2])] : null;
  const wind = text.match(/zwischen (\d+) und (\d+) Knoten/i);
  const yoga = products.find(x => /yoga package/i.test(x.name));
  const priceOf = (pkg: OkPackage, room: OkRoom) => products.find(x => x.pkg === pkg && x.room === room)?.price ?? null;
  const kite = products.filter(x => x.pkg && x.room);
  const cheapest = kite.length ? Math.min(...kite.map(x => x.price ?? Infinity)) : null;
  const pagePrice = (name: string) => packages.find(x => x.name === name)?.price ?? null;
  const year = weeks[0]?.start.slice(0, 4) ?? null;

  const roomFeatures = (room: OkRoom): string[] => (['beginner-advanced', 'rider', 'rider-plus'] as OkPackage[])
    .map(pkg => { const v = priceOf(pkg, room); return v ? `${OK_PACKAGE_LABEL[pkg]}: EUR ${fmt(v)} per person for 7 nights (booking engine)` : null; })
    .filter((x): x is string => !!x);

  const rooms: ContentRoom[] = [
    {
      name: 'Double room',
      description: 'Air-conditioned double room in the two-storey Kite Villa with pool, terraces and roof terrace, 200 m from the beach.',
      features: [...roomFeatures('double'), ...amenities],
    },
    {
      name: 'Single room',
      description: 'Single use of a villa room (surcharge on the double-room package price).',
      features: roomFeatures('single'),
    },
    ...(riderPlusTriple ? [{
      name: 'Triple room',
      description: 'The camp page quotes the Rider PLUS package price for a triple room.',
      features: [
        `Camp page: Rider PLUS ${pagePrice('Rider PLUS') ? `EUR ${fmt(pagePrice('Rider PLUS')!)} ` : ''}per person for 7 nights in a triple room`
          + (riderPlusRooms.double || riderPlusRooms.single
            ? ` (double room EUR ${riderPlusRooms.double ? fmt(riderPlusRooms.double) : '-'}, single room EUR ${riderPlusRooms.single ? fmt(riderPlusRooms.single) : '-'}); the booking engine sells Rider PLUS double at EUR ${priceOf('rider-plus', 'double') ? fmt(priceOf('rider-plus', 'double')!) : '-'} and single at EUR ${priceOf('rider-plus', 'single') ? fmt(priceOf('rider-plus', 'single')!) : '-'}`
            : ''),
      ],
    }] : []),
  ];

  const summary = [
    `Oasis Kite, a kite school from Magdeburg, runs Saturday-to-Saturday kite camp weeks on Djerba with seven nights in its two-storey Kite Villa (pool, air-conditioned double rooms, roof terrace, beach 200 m away), seven breakfasts and five dinners, and airport and spot transfers.`,
    `The Beginner/Advanced package adds a 20-hour course over six days with equipment, the Rider package six days of the equipment pool with supervised kiting, and Rider PLUS a 5-hour progression course with video analysis${cheapest && Number.isFinite(cheapest) ? `; packages start at EUR ${fmt(cheapest)} per person` : ''}.`,
    `The kite spot is a${lagoon ? ` roughly ${lagoon} km²` : ''} lagoon set aside for kiters, mostly standing depth, without waves, sea urchins or coral${season ? `; the school names ${season[0]} to ${season[1]} as the best wind season` : ''}.`,
    weeks.length ? `Camp weeks${year ? ` ${year}` : ''} run in April and May and are booked online through the school's Leão booking system.` : `Camp weeks are booked online through the school's Leão booking system.`,
  ].join(' ');

  const included = [
    'Airport transfers (Djerba-Zarzis)',
    'Transfers to the kite spot',
    '7 nights in the Kite Villa (double room; single room with surcharge)',
    '7 breakfasts and 5 dinners at the camp',
    'Equipment insurance (Materialabsicherung)',
    'No-wind programme (Houmt Souk, Djerbahood, yoga, beach hopping)',
    'Beginner/Advanced package: 20 h kite course over 6 days incl. equipment, at most 2 kites per instructor and 2 students per kite',
    'Rider package: 6 days use of the equipment pool, supervised kiting (requires riding upwind safely)',
    'Rider PLUS package: 6 days equipment pool, 5 h progression course, video analysis, supervised kiting',
  ];
  const optional = [
    ...(yoga?.price ? [`Yoga add-on (4 sessions, the 5th free): EUR ${fmt(yoga.price)}`] : []),
    'Paid activities: kayak, SUP, quad, dromedary, horse riding, golf, Flamingo Island, yoga, spa',
    'Two restaurant dinners outside the camp, other meals and drinks',
    'Professional photo and video shooting of your kite session',
    'Foilboard on request',
    'Private lesson with video analysis',
  ];

  return {
    kind: 'camp',
    title: 'Oasis Kite - Kitecamp Djerba',
    summary,
    continent: 'Africa',
    country: 'Tunisia',
    region: 'Djerba, Medenine',
    spot: 'Midoun / El Haddad, Djerba',
    // Impressum "Kontakt Tunesien ... Q3J2+XC El Haddad" (decoded plus code; the villa's area, not the lagoon)
    spotCoords: coords,
    itinerarySpots: [],
    durationDays: CAMP_NIGHTS + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: /Anfängern Sicherheit|für Anfänger/i.test(text),
    includedServices: included,
    optionalServices: optional,
    accommodation: 'two-storey Kite Villa with pool and roof terrace (double rooms, single on surcharge), 200 m from the beach',
    mealPlan: 'breakfast daily, 5 dinners per week',
    languages: ['de'],
    rooms,
    imageUrls: okImages(p.camp).slice(0, 40),
    heroVideoUrl: null,
    sourceUrl: OK_CAMP_URL,
    bookingUrl: OK_CATEGORY_URL,
    sourceText: [
      `packages (camp page): ${packages.map(x => `${x.name} ${x.price ?? '-'} EUR: ${x.items.join('; ')}`).join(' | ')}`,
      `Rider PLUS note: ${riderPlusNote.join('; ') || '-'}`,
      `not included: ${notIncluded.join('; ') || '-'}`,
      `weeks (camp page): ${weeks.map(w => `${w.start}..${w.end}${w.note ? ` (${w.note})` : ''}`).join(', ') || '-'}`,
      `booking engine products: ${products.map(x => `${x.name} ${x.price ?? '-'} EUR [${x.id}]`).join(', ')}`,
      `spot: ${lines.find(l => /^Wir befinden uns auf der Sonneninsel Djerba/i.test(l)) ?? '-'}`,
      `villa: ${villaText || '-'}; amenities: ${amenities.join(', ') || '-'}`,
      `wind: ${season ? `${season[0]} to ${season[1]}` : '-'}${wind ? `, ${wind[1]}-${wind[2]} knots` : ''}`,
      `operator: ${imp.company ?? '-'}, Magdeburg; Tunisia contact: ${imp.tunisia ?? '-'}; plus code ${imp.plusCode ?? '-'} -> ${coords ? `${coords.lat},${coords.lng}` : '-'}`,
    ].join('\n'),
  };
}

// --- adapter ------------------------------------------------------------------------------------------
export const oasisKiteKitecampDjerba: OfferAdapter = {
  key: 'oasis-kite-kitecamp-djerba',
  name: 'Oasis Kite - Kitecamp Djerba',
  kind: 'camp',
  operator: {
    name: 'Oasis Kite',
    websiteUrl: SITE,
    rootDomain: 'oasiskite.com',
    contactEmail: 'info@oasiskite.com',
    whatsapp: '+21624458655', // camp page WhatsApp chat widget "0021624458655" (also on the Leão booking page header)
  },
  url: OK_CAMP_URL,
  slotMethod: 'booking_engine',
  fetchBudget: 12,
  async fetchContent() {
    const camp = await page(OK_CAMP_URL);
    if (!/Kitecamp Djerba/i.test(camp)) throw new Error('oasis-kite: "Kitecamp Djerba" missing on the camp page (layout changed?)');
    const impressum = await page(OK_IMPRESSUM_URL);
    const category = await page(OK_CATEGORY_URL);
    return parseOasisKiteContent({ camp, impressum, category });
  },
  async fetchSlots(ctx) {
    const products = parseOkCategory(await page(OK_CATEGORY_URL)).filter(p => p.pkg && p.room);
    if (products.length < 4) throw new Error(`oasis-kite: only ${products.length} kite camp products on the Leão category page`);
    const events = new Map<number, LeaoEvent[]>();
    let failed = 0;
    for (const p of products) {
      try {
        events.set(p.id, parseLeaoEvents(await fetchText(okEventsUrl(p.id), { accept: 'application/json' })));
      } catch (e) {
        failed++;
        ctx.note(`events ${p.name} [${p.id}]: ${(e as Error).message}`);
      }
    }
    if (failed > 0) ctx.incomplete(`${failed} of ${products.length} product event lists failed`);
    for (const p of products) {
      const list = events.get(p.id) ?? [];
      const off = list.filter(e => p.price && parseAmount(String(e.price)) !== p.price);
      if (off.length) ctx.note(`${p.name}: ${off.length} weeks priced differently from the list price ${p.price}`);
    }
    return buildOkSlots(products, events, todayIso());
  },
};
