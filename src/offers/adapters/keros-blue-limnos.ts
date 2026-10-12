// ---------------------------------------------------------------------------
// Keros Blue, Keros Bay (Limnos / Lemnos, Greece) - 16 deluxe rooms + 7 two-bedroom apartments on the
// kite beach, KBC Limnos kite & wingfoil center on site (season June 1 to end of September).
//
// Data path (checked 2026-10-09):
//   content  kerosblue.com (WordPress/Divi): home (about, services, room texts), /about-us/ (the spot),
//            /kitesurf-wingfoil/ (KBC Limnos), /gallery/ (80 photos) + Cloudbeds' public JSON-LD
//            GET hotels.cloudbeds.com/booking/metadata?property_code=8S4HCi (room types, occupancy,
//            room photos) - answers 200 to our UA.
//   slots    Cloudbeds booking engine, property 199881 (code 8S4HCi). The engine (hotels.cloudbeds.com/
//            reservation/8S4HCi) loads availability with
//              POST /booking/availability_calendar  body end_date=..&property_id=199881&start_date=..
//            -> { "YYYY-MM-DD": [ {room_type_id, package_id, rate_id, rate, avail, closed, cta, ctd,
//                 min_l, max_l}, ... ] }  (field mapping from Cloudbeds' own calendar code,
//            useStartOfWeek.chunk.js); an empty list = no bookable rate that day. One call covers 12
//            months.
// BLOCKER: every /booking/* XHR (POST calendar, POST rooms, even GET amenities) answers HTTP 403 from
//   the AWS load balancer to any non-browser client (our UA, curl's default UA, with or without
//   Referer/Origin) - a bot block, which we do not work around. fetchSlots therefore throws a clear
//   error live. The parser is tested against the calendar captured in the built-in browser on
//   2026-10-09 (all 357 days empty: no online rates loaded for Oct 2026 - Sep 2027; /booking/rooms
//   also returned 0 room types for Oct 2026, Jun and Jul 2027).
// robots.txt (2026-10-09): kerosblue.com disallows only /wp-admin/; hotels.cloudbeds.com disallows
//   /booking/prepare/, /widget and localized variants - the calendar path itself is allowed.
// Requests per run: content 5, slots 2 (metadata + calendar).
// Parsed: slot = Cloudbeds room type x month ("double-deluxe|2027-07"), EUR per room per night (lowest
//   base-package rate of the month), available / limited (<= 2 rooms) / sold_out (rates but no
//   inventory) / closed (no rate loaded for any day of the month).
// ---------------------------------------------------------------------------
import { BlockedByHost, fetchText } from '../http.js';
import { collapse, imageCandidates, iso, ldOfType, parse, todayIso } from '../parse.js';
import type { Availability, ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://kerosblue.com';
const CB = 'https://hotels.cloudbeds.com';
const PROPERTY_ID = 199881;
const PROPERTY_CODE = '8S4HCi';
export const KB_METADATA_URL = `${CB}/booking/metadata?property_code=${PROPERTY_CODE}`;
export const KB_CALENDAR_URL = `${CB}/booking/availability_calendar`;
const BOOKING_URL = `${CB}/reservation/${PROPERTY_CODE}`;
const MONTHS = 12;

export interface KbRoomType { id: string; name: string; maxGuests: number | null; minGuests: number | null; images: string[] }
interface CbDayEntry { room_type_id?: string | number; package_id?: string | number; rate?: string | number; avail?: number; closed?: number }

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function daysIn(year: number, month: number): number { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
const langValue = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    const en = v.find(x => x && typeof x === 'object' && (x as Record<string, unknown>)['@language'] === 'en') ?? v[0];
    return en && typeof en === 'object' ? String((en as Record<string, unknown>)['@value'] ?? '') : String(en ?? '');
  }
  return '';
};

// --- pure parsers -----------------------------------------------------------------------------
/** Cloudbeds JSON-LD (LodgingBusiness.containsPlace[HotelRoom]). Works on the metadata JSON or a page embedding it. */
export function parseKbRoomTypes(jsonOrHtml: string): KbRoomType[] {
  let lodging: Record<string, unknown> | undefined;
  try { lodging = JSON.parse(jsonOrHtml) as Record<string, unknown>; } catch { lodging = ldOfType(jsonOrHtml, 'LodgingBusiness')[0]; }
  const places = (lodging?.containsPlace as Array<Record<string, unknown>> | undefined) ?? [];
  return places.filter(p => p['@type'] === 'HotelRoom').map(p => {
    const occ = (p.occupancy ?? {}) as Record<string, unknown>;
    return {
      id: String(p['@id'] ?? '').match(/rid=(\d+)/)?.[1] ?? '',
      name: collapse(langValue(p.name)),
      maxGuests: typeof occ.maxValue === 'number' ? occ.maxValue : null,
      minGuests: typeof occ.minValue === 'number' ? occ.minValue : null,
      images: Array.isArray(p.image) ? (p.image as unknown[]).filter((u): u is string => typeof u === 'string') : [],
    };
  }).filter(r => r.id && r.name);
}

/** Calendar window: first day of the current month .. last day of month +11. */
export function kbCalendarBody(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const ey = y + Math.floor((m - 1 + MONTHS - 1) / 12);
  const em = ((m - 1 + MONTHS - 1) % 12) + 1;
  // field order as the engine sends it (alphabetical)
  return `end_date=${iso(ey, em, daysIn(ey, em))}&property_id=${PROPERTY_ID}&start_date=${iso(y, m, 1)}`;
}

/** /booking/availability_calendar JSON -> room type x month slots (months present in the answer only). */
export function parseKbCalendar(json: string, rooms: KbRoomType[]): Slot[] {
  const cal = JSON.parse(json) as Record<string, CbDayEntry[] | unknown>;
  const byMonth = new Map<string, Array<[string, CbDayEntry[]]>>();
  for (const [date, v] of Object.entries(cal)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const list = Array.isArray(v) ? (v as CbDayEntry[]) : [];
    const ym = date.slice(0, 7);
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym)!.push([date, list]);
  }
  const out: Slot[] = [];
  for (const [ym, days] of [...byMonth.entries()].sort()) {
    const y = Number(ym.slice(0, 4)); const m = Number(ym.slice(5, 7));
    for (const room of rooms) {
      const entries = days.flatMap(([, list]) => list.filter(e => String(e.room_type_id) === room.id));
      const open = entries.filter(e => (e.avail ?? 0) > 0 && e.closed !== 1);
      const baseRates = open.filter(e => String(e.package_id ?? 0) === '0').map(e => Number(e.rate)).filter(r => Number.isFinite(r) && r > 0);
      const price = baseRates.length ? Math.min(...baseRates) : null;
      const maxAvail = open.length ? Math.max(...open.map(e => e.avail ?? 0)) : 0;
      const openDays = new Set(days.filter(([, list]) => list.some(e => String(e.room_type_id) === room.id && (e.avail ?? 0) > 0 && e.closed !== 1)).map(([d]) => d)).size;
      let availability: Availability;
      let text: string;
      if (entries.length === 0) { availability = 'closed'; text = `no online rate loaded for ${ym}`; }
      else if (open.length === 0) { availability = 'sold_out'; text = `no room available in ${ym}`; }
      else if (maxAvail <= 2) { availability = 'limited'; text = `at most ${maxAvail} room(s) free; bookable on ${openDays} of ${days.length} days`; }
      else { availability = 'available'; text = `bookable on ${openDays} of ${days.length} days`; }
      out.push({
        key: `${keyPart(room.name)}|${ym}`,
        startDate: iso(y, m, 1),
        endDate: iso(y, m, daysIn(y, m)),
        unit: room.name,
        price,
        currency: price !== null ? 'EUR' : null,
        priceUnit: price !== null ? 'per_night' : null,
        priceBasis: 'room',
        occupancy: room.minGuests,
        availability,
        availabilityText: text,
        spotsLeft: availability === 'limited' ? maxAvail : null,
      });
    }
  }
  return out;
}

export interface KbPages { home: string; about: string; kite: string; gallery: string; metadata: string }

function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav')) el.remove();
  return collapse((root.querySelector('#main-content') ?? root.querySelector('body') ?? root).text);
}
const between = (t: string, a: RegExp, b: RegExp): string => {
  const s = t.search(a); if (s < 0) return '';
  const rest = t.slice(s);
  const e = rest.slice(1).search(b);
  return collapse(e < 0 ? rest : rest.slice(0, e + 1));
};
/** Divi text modules with a <ul>: room facilities, included services, services with extra charge. */
export function kbLists(homeHtml: string): { double: string[]; apartment: string[]; included: string[]; extra: string[] } {
  const res = { double: [] as string[], apartment: [] as string[], included: [] as string[], extra: [] as string[] };
  for (const mod of parse(homeHtml).querySelectorAll('.et_pb_text_inner')) {
    const ul = mod.querySelector('ul');
    if (!ul) continue;
    const items = ul.querySelectorAll('li').map(li => collapse(li.text)).filter(Boolean);
    const label = collapse(mod.text).slice(0, 200);
    if (/extra charge/i.test(label)) res.extra = items;
    else if (/apartments? consists/i.test(label)) res.apartment = items;
    else if (/deluxe rooms offer/i.test(label)) res.double = items;
    else if (res.included.length === 0 && /reception|wi-?fi|maid/i.test(items.join(' '))) res.included = items;
  }
  return res;
}

export function parseKerosBlueContent(p: KbPages): OfferContent {
  const home = pageText(p.home);
  const about = pageText(p.about);
  const kite = pageText(p.kite);
  const roomTypes = parseKbRoomTypes(p.metadata);
  const lodging = (() => { try { return JSON.parse(p.metadata) as Record<string, unknown>; } catch { return {}; } })();

  const aboutBlock = between(home, /Keros Blue is a seaside complex/, /\bRead more\b/);
  const servicesBlock = between(home, /Services Keros Blue offer/, /Double Deluxe Room/);
  const lists = kbLists(p.home);
  const doubleText = between(home, /Double Deluxe Room Our deluxe rooms/, /\bRead more\b/);
  const aptText = between(home, /Family Luxury Apartments? Apartments consists/, /\bRead more\b/);
  const spot = between(about, /The Spot Keros/, /Keros Beach Keros beach/);
  const season = kite.match(/Season:\s*([A-Z][a-z]+ \d+(?:st|nd|rd|th)? to [^A-Z]*?[A-Z][a-z]+)/)?.[1] ?? null;
  const nRooms = aboutBlock.match(/(\d+) deluxe rooms/)?.[1];
  const nApts = aboutBlock.match(/(\d+) two-bedroom apartments/)?.[1];

  const roomDescFor = (name: string) => (/apart/i.test(name) ? aptText : doubleText).split(/Facilities\s*:/)[0].replace(/^(Double Deluxe Room|Family Luxury Apartments?)\s*/, '').trim() || null;
  const rooms: ContentRoom[] = roomTypes.map(r => ({
    name: r.name,
    description: roomDescFor(r.name),
    features: [r.maxGuests ? `Up to ${r.maxGuests} guests` : null, ...(/apart/i.test(r.name) ? lists.apartment : lists.double)]
      .filter((x): x is string => !!x),
  }));

  // images: Cloudbeds room photos, then the gallery round-robin across its categories
  const cbImages = roomTypes.flatMap(r => r.images);
  const gallery = imageCandidates(p.gallery, `${SITE}/gallery/`, null, 120).filter(u => /gallery-/.test(u));
  const cats = ['room', 'villa', 'beach', 'activities', 'place'];
  const buckets = cats.map(c => gallery.filter(u => u.includes(`gallery-${c}`)));
  const mixed: string[] = [];
  for (let i = 0; mixed.length < gallery.length && i < 100; i++) for (const b of buckets) if (b[i]) mixed.push(b[i]);
  const imageUrls = [...new Set([...cbImages, ...mixed])].slice(0, 30);

  const geo = (lodging.geo ?? {}) as Record<string, unknown>;
  const summary = [
    `Keros Blue is a seaside hotel opened in 2020 on Keros Bay, a 10 km sand beach with dunes on the Greek island of Limnos (Lemnos) in the north Aegean; the bay has a sandy bottom, a large shallow standing area and steady Meltemi wind.`,
    `It has ${nRooms ?? '16'} deluxe double rooms and ${nApts ?? '7'} two-bedroom apartments in stone buildings with verandas, a restaurant, a kite-shaped pool and a private beach with a small bar.`,
    `The KBC Limnos kite and wingfoil center on the beach offers courses, F-ONE rental, storage and rescue${season ? ` (season ${season})` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Keros Blue',
    summary,
    continent: 'Europe',
    country: 'Greece',
    region: 'North Aegean',
    spot: 'Keros Bay, Limnos',
    itinerarySpots: [],
    durationDays: null,
    // "perfect for beginners with the huge standing area up to the pro riders who want to freestyle" (/about-us/, 2026-10-09)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /BEGINNER COURSE|PRIVATE COURSE/i.test(kite),
    equipmentRental: /EQUIPMENT RENTAL/i.test(kite),
    beginnerFriendly: /perfect for beginners|ideal for kitesurfing beginners/i.test(`${about} ${kite}`),
    includedServices: lists.included,
    optionalServices: lists.extra,
    accommodation: 'deluxe double rooms and two-bedroom apartments',
    mealPlan: null, // breakfast buffet + a la carte restaurant exist; the site does not say what a rate includes
    languages: ['en'],
    rooms,
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: `${SITE}/`,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `about: ${aboutBlock}`,
      `services: ${servicesBlock}`,
      `double: ${doubleText}`,
      `apartment: ${aptText}`,
      `spot: ${spot}`,
      `kite center: ${kite}`,
      `geo: ${geo.latitude ?? ''},${geo.longitude ?? ''}`,
      `cloudbeds rooms: ${roomTypes.map(r => `${r.id} ${r.name} ${r.minGuests}-${r.maxGuests}`).join('; ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const kerosBlueLimnos: OfferAdapter = {
  key: 'keros-blue-limnos',
  name: 'Keros Blue Limnos',
  kind: 'accommodation',
  operator: {
    name: 'Keros Blue',
    websiteUrl: SITE,
    rootDomain: 'kerosblue.com',
    contactEmail: 'info@kerosblue.com',
    phone: '+306976732211',
  },
  url: `${SITE}/`,
  slotMethod: 'booking_engine',
  fetchBudget: 7,
  async fetchContent() {
    const [home, about, kite, gallery] = [
      await fetchText(`${SITE}/`, { accept: 'text/html' }),
      await fetchText(`${SITE}/about-us/`, { accept: 'text/html' }),
      await fetchText(`${SITE}/kitesurf-wingfoil/`, { accept: 'text/html' }),
      await fetchText(`${SITE}/gallery/`, { accept: 'text/html' }),
    ];
    const metadata = await fetchText(KB_METADATA_URL, { accept: 'application/json' });
    return parseKerosBlueContent({ home, about, kite, gallery, metadata });
  },
  async fetchSlots() {
    let json: string;
    try {
      json = await fetchText(KB_CALENDAR_URL, {
        method: 'POST',
        body: kbCalendarBody(todayIso()),
        contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
        accept: 'application/json',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
    } catch (e) {
      if (e instanceof BlockedByHost) {
        throw new Error('keros-blue: Cloudbeds blocks non-browser clients on /booking/* (HTTP 403 from the AWS load balancer, checked 2026-10-09) - slots need the property\'s Cloudbeds API access or a feed from the hotel', { cause: e });
      }
      throw e;
    }
    const rooms = parseKbRoomTypes(await fetchText(KB_METADATA_URL, { accept: 'application/json' }));
    if (rooms.length === 0) throw new Error('keros-blue: no HotelRoom in the Cloudbeds metadata');
    return parseKbCalendar(json, rooms);
  },
};
