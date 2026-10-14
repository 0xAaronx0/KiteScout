// ---------------------------------------------------------------------------
// Paje by Night, Paje (Zanzibar, Tanzania) - bungalow resort with 19 air-conditioned bungalows in a garden plot
// 70 m behind Paje Beach; its own kite centre, Hakuna Matata Kiteschool, sits on the beachfront 70 m away.
// Direct bookings include breakfast and a free kite locker (subject to availability).
//
// Data path (checked 2026-10-12):
//   content  pajebynight.net (WordPress/Divi): / (resort facts, amenities), /rooms/ (bungalow types, what direct
//            bookings include), /paje-by-kite/ (kite school, prices, wind seasons), /resort/ (layout, restaurant)
//            + the Nightsbridge establishment record (room types, sizes, room counts, map pin, photo gallery).
//   slots    Nightsbridge, the site's own booking engine ("Book Now" -> book.nightsbridge.com/38607). Its Angular
//            app (main + chunk bundles, read 2026-10-12) calls, without login, cookie or token:
//              GET  www.nightsbridge.com/bridge/api/5.0/establishment/38607         -> currency, room types
//              POST www.nightsbridge.com/bridge/api/5.0/availgrid  {bbid, startdate, enddate, nightsbridge:true,
//                   showroomcount/showrates/showextras:false, ...}                  -> per room type and day:
//                   roomrate, rates[n-1].paxrate (room price for n guests), noroomsfree, minstay, closeoutrs
//            with headers Content-Type: application/json, Cache-control: no-cache and bbid (the property id; the
//            app sends the same values, nothing is spoofed). One call returns at most 62 days (checked: a
//            200-day request answered 62), so a run asks for 3 windows of 62 days from today; on 2026-10-12 the
//            third window stopped at 2027-04-13 (60 days; looks like the engine's booking horizon, inferred).
// robots.txt (2026-10-12): pajebynight.net disallows only /wp-content/uploads/wpo/wpo-plugins-tables-list.json;
//   www.nightsbridge.com has none (404 -> allowed); book.nightsbridge.com answers the app shell (no rules).
// Requests per run: content 5 (4 pages + establishment), slots 4 (establishment + 3 grid windows).
// Parsed: per room type, bands where price, minimum stay or free/booked/closed changes (runsOf); USD per room
//   per night for 2 guests (the app's default party size; 1 guest for a single-occupancy type) as the engine
//   shows it - the "Direct Website" rate (10% below the original rate in the availability call) with Bed &
//   Breakfast; availability 'available' (rooms free every night of the band), 'sold_out' (no room free),
//   'closed' (closed out); minNights from minstay. Other party sizes go into availabilityText.
// Known limits: quote recipe not set (QuoteRecipe has no Nightsbridge variant); the $2 per person per night
//   city tax is not in the price (engine "conditions"); the engine's "Dinner, Bed & Breakfast" plan is not
//   sampled.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, imageCandidates, parse, runsOf, todayIso } from '../parse.js';
import type { Availability, ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://pajebynight.net';
export const PBN_HOME_URL = `${SITE}/`;
const PBN_ROOMS_URL = `${SITE}/rooms/`;
const PBN_KITE_URL = `${SITE}/paje-by-kite/`;
const PBN_RESORT_URL = `${SITE}/resort/`;
const NB_API = 'https://www.nightsbridge.com/bridge/api/5.0';
export const PBN_BBID = 38607;
export const PBN_ESTABLISHMENT_URL = `${NB_API}/establishment/${PBN_BBID}`;
export const PBN_GRID_URL = `${NB_API}/availgrid`;
const BOOKING_URL = `https://book.nightsbridge.com/${PBN_BBID}`;
export const PBN_GRID_DAYS = 62;
export const PBN_WINDOWS = 3;
const NB_HEADERS = { 'Cache-control': 'no-cache', bbid: String(PBN_BBID) };
const PBN_EMAIL = 'pajebynightbungalows@gmail.com'; // data-cfemail on the home page (decodeCfEmail), 2026-10-12

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const titleCase = (s: string): string => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()) : s);
const addDays = (d: string, n: number): string => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

// --- engine types / parsers -------------------------------------------------------------------
export interface PbnRoomType { id: number; name: string; maxOccupancy: number; roomCount: number | null; sizeM2: number | null; description: string; mealPlans: string[] }
export interface PbnEstablishment { currency: string; rooms: PbnRoomType[]; lat: number | null; lng: number | null; gallery: string[]; conditions: string; checkIn: string | null; checkOut: string | null }
export interface PbnDay { date: string; rtid: number; paxRates: number[]; roomRate: number | null; free: number; minStay: number | null; closed: boolean; closeType: string | null }

export function parsePbnEstablishment(json: string): PbnEstablishment {
  const d = (JSON.parse(json) as { data?: Record<string, unknown> }).data ?? {};
  const c = (d.contentrs ?? {}) as Record<string, unknown>;
  const rts = (c.roomtypes as Array<Record<string, unknown>> | undefined) ?? [];
  const imgs = (d.images ?? {}) as Record<string, unknown>;
  const gallery = ((imgs.propertygallery as Array<Record<string, unknown>> | undefined) ?? [])
    .map(g => String(g.big ?? '')).filter(u => /^https:\/\//.test(u));
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    currency: String(c.currencycode ?? ''),
    rooms: rts.map(r => ({
      id: Number(r.roomtypeid),
      name: titleCase(collapse(String(r.roomtypename ?? ''))),
      maxOccupancy: Number(r.maxoccupancy) || 2,
      roomCount: num(r.roomcount),
      sizeM2: num(r.roomsizeinmeters),
      description: collapse(String(r.description ?? '')),
      mealPlans: ((r.roomtypemealplaninfo as Array<Record<string, unknown>> | undefined) ?? []).map(m => String(m.description ?? '')).filter(Boolean),
    })).filter(r => r.id && r.name),
    lat: num(c.lat),
    lng: num(c.lng),
    gallery,
    conditions: String(c.conditions ?? ''),
    checkIn: typeof c.checkintime === 'string' ? c.checkintime : null,
    checkOut: typeof c.checkouttime === 'string' ? c.checkouttime : null,
  };
}

/** Grid windows: today .. +62 days, x3 (the API caps one answer at 62 days; enddate is inclusive). */
export function pbnWindows(today: string): Array<{ start: string; end: string }> {
  return Array.from({ length: PBN_WINDOWS }, (_, i) => {
    const start = addDays(today, i * PBN_GRID_DAYS);
    return { start, end: addDays(start, PBN_GRID_DAYS - 1) };
  });
}

export function pbnGridBody(w: { start: string; end: string }): string {
  return JSON.stringify({
    bbid: PBN_BBID, extbbid: '', clientloginkey: null, startdate: w.start, enddate: w.end,
    nightsbridge: true, showroomcount: false, showrates: false, showextras: false,
  });
}

/** availgrid JSON -> one entry per room type and day (day i of a room type = startdate + i). */
export function parsePbnGrid(json: string): PbnDay[] {
  const d = (JSON.parse(json) as { data?: Record<string, unknown> }).data ?? {};
  const start = String(d.startdate ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return [];
  const out: PbnDay[] = [];
  for (const rt of (d.roomtypes as Array<Record<string, unknown>> | undefined) ?? []) {
    const days = (rt.availability as Array<Record<string, unknown>> | undefined) ?? [];
    days.forEach((day, i) => {
      const co = (day.closeoutrs ?? {}) as Record<string, unknown>;
      out.push({
        date: addDays(start, i),
        rtid: Number(rt.rtid),
        paxRates: ((day.rates as Array<Record<string, unknown>> | undefined) ?? []).map(r => Number(r.paxrate)).filter(n => Number.isFinite(n) && n > 0),
        roomRate: typeof day.roomrate === 'number' && day.roomrate > 0 ? day.roomrate : null,
        free: Number(day.noroomsfree) || 0,
        minStay: typeof day.minstay === 'number' && day.minstay > 0 ? day.minstay : null,
        closed: co.closedout === true,
        closeType: typeof co.closeouttype === 'string' && co.closeouttype !== 'NO_CLOSEOUT' ? co.closeouttype : null,
      });
    });
  }
  return out;
}

/** Price for a 2-guest stay (1 guest for single-occupancy types), per room per night. */
function pbnPrice(d: PbnDay, room: PbnRoomType): { guests: number; price: number | null } {
  const guests = Math.min(2, room.maxOccupancy);
  return { guests, price: d.paxRates[guests - 1] ?? d.roomRate };
}

/** "1-3 guests USD 117, 4 guests USD 135, 5 guests USD 153" from the per-party-size rates of a day. */
function paxText(rates: number[], currency: string): string {
  const parts: string[] = [];
  let i = 0;
  while (i < rates.length) {
    let j = i;
    while (j + 1 < rates.length && rates[j + 1] === rates[i]) j++;
    parts.push(`${i === j ? `${i + 1} guest${i ? 's' : ''}` : `${i + 1}-${j + 1} guests`} ${currency} ${rates[i]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

export function buildPbnSlots(est: PbnEstablishment, days: PbnDay[], today: string): Slot[] {
  const out: Slot[] = [];
  const currency = est.currency || 'USD';
  for (const room of est.rooms) {
    const list = days.filter(d => d.rtid === room.id && d.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const unique = list.filter((d, i) => i === 0 || d.date !== list[i - 1].date);
    const state = (d: PbnDay): string => {
      if (d.closed) return `closed|${d.closeType ?? ''}`;
      if (d.free <= 0) return 'booked';
      return `free|${d.paxRates.join('/')}|${d.roomRate}|${d.minStay ?? 1}`;
    };
    for (const run of runsOf(unique, state)) {
      const d = run.first;
      const st = state(d);
      const free = st.startsWith('free');
      const { guests, price } = pbnPrice(d, room);
      const availability: Availability = st.startsWith('closed') ? 'closed' : free ? 'available' : 'sold_out';
      const frees = run.days.map(x => x.free);
      const lo = Math.min(...frees); const hi = Math.max(...frees);
      out.push({
        key: `${keyPart(room.name)}|${run.start}`,
        startDate: run.start,
        endDate: run.end,
        unit: room.name,
        price: free ? price : null,
        currency: free && price !== null ? currency : null,
        priceUnit: free && price !== null ? 'per_night' : null,
        priceBasis: 'room',
        occupancy: guests,
        availability,
        availabilityText: availability === 'closed'
          ? `closed out in the Nightsbridge calendar${d.closeType ? ` (${d.closeType})` : ''}`
          : availability === 'sold_out'
            ? 'no bungalow of this type free in the Nightsbridge calendar'
            : `${lo === hi ? lo : `${lo}-${hi}`} of ${room.roomCount ?? '?'} free per night; Bed & Breakfast per night: ${paxText(d.paxRates, currency)}`,
        spotsLeft: null,
        minNights: free && d.minStay && d.minStay > 1 ? d.minStay : null,
      });
    }
  }
  return out;
}

// --- site content -------------------------------------------------------------------------------
/** Visible text split at block tags. */
export function pbnLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|article|header|footer|nav)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

/** Cloudflare-protected e-mail (data-cfemail): first byte is the XOR key. */
export function decodeCfEmail(hex: string): string {
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

/** Kite school prices from the /paje-by-kite/ text (USD, as printed). */
export function kiteOffers(kiteText: string): string[] {
  const t = kiteText.replace(/\s+/g, ' ');
  const m = (re: RegExp) => t.match(re)?.[0] ?? null;
  return [
    m(/1 PERSON \$\d+ 2 PEOPLE \$\d+ per person/) ? `Kite discovery lesson: ${m(/1 PERSON \$\d+ 2 PEOPLE \$\d+ per person/)!.replace('1 PERSON', '1 person').replace('2 PEOPLE', '/ 2 people')}` : null,
    m(/6 hrs Private one-on-one kitesurfing lessons \$\d+/) ? `Base course: ${m(/6 hrs Private one-on-one kitesurfing lessons \$\d+/)}` : null,
    m(/8 hrs Private one-on-one kitesurfing lessons \$\d+/) ? `Base course: ${m(/8 hrs Private one-on-one kitesurfing lessons \$\d+/)}` : null,
    m(/6 hrs shared lessons \$\d+ per person/) ? `Base course: ${m(/6 hrs shared lessons \$\d+ per person/)} (2 people, 1 instructor)` : null,
    m(/6 hrs private lessons \+ 3 days full gear rental \$\d+/) ? `Package: ${m(/6 hrs private lessons \+ 3 days full gear rental \$\d+/)}` : null,
    m(/1-2 hrs \$\d+ per hour 3-4 hrs \$\d+ per hour 5\+ hrs \$\d+ per hour/) ? `Private coaching: ${m(/1-2 hrs \$\d+ per hour 3-4 hrs \$\d+ per hour 5\+ hrs \$\d+ per hour/)}` : null,
    m(/PER HOUR: \$\d+ HALF DAY: \$\d+ FULL DAY: \$\d+ 3 DAYS: \$\d+ 6 DAYS: \$\d+/) ? `Rental (kite, bar, harness, twin-tip): ${m(/PER HOUR: \$\d+ HALF DAY: \$\d+ FULL DAY: \$\d+ 3 DAYS: \$\d+ 6 DAYS: \$\d+/)!.toLowerCase().replace(/: /g, ' ')}` : null,
  ].filter((x): x is string => !!x);
}

export interface PbnPages { home: string; rooms: string; kite: string; resort: string; establishment: string }

export function parsePajeContent(p: PbnPages): OfferContent {
  const home = pbnLines(p.home);
  const roomsLines = pbnLines(p.rooms);
  const kite = pbnLines(p.kite);
  const resort = pbnLines(p.resort);
  const est = parsePbnEstablishment(p.establishment);
  const homeText = home.join(' ');
  const kiteText = kite.join(' ');
  const roomsText = roomsLines.join(' ');
  const nBungalows = homeText.match(/(\d+) bungalows, set in pairs/)?.[1] ?? null;
  const includes = roomsText.match(/All direct bookings include:\s*(.*?)\s+Standard Bungalow/)?.[1] ?? null;
  const kiteYear = kiteText.match(/We started the school in (\d{4})/)?.[1] ?? null;
  const kiteSeason = kiteText.match(/the school is open from ([A-Z][a-z]+ \d+(?:st|nd|rd|th)? to [A-Z][a-z]+ \d+(?:st|nd|rd|th)?)/)?.[1] ?? null;

  const rooms: ContentRoom[] = est.rooms.map(r => ({
    name: r.name,
    description: r.description || null,
    features: [
      `Up to ${r.maxOccupancy} guests`,
      r.roomCount ? `${r.roomCount} bungalow${r.roomCount > 1 ? 's' : ''} of this type` : null,
      r.sizeM2 ? `${r.sizeM2} m²` : null,
      r.mealPlans.length ? `Meal plans: ${r.mealPlans.join(', ')}` : null,
    ].filter((x): x is string => !!x),
  }));

  const imgs: string[] = [];
  const seen = new Set<string>();
  const push = (u: string) => {
    const k = u.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
    const id = k.replace(/^https?:\/\/[^/]+/, '');
    if (seen.has(id)) return;
    seen.add(id); imgs.push(k);
  };
  est.gallery.forEach(push);
  for (const [html, base] of [[p.rooms, PBN_ROOMS_URL], [p.home, PBN_HOME_URL], [p.kite, PBN_KITE_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 60)) {
      if (!/pajebynight\.net\/wp-content\/uploads\//.test(u) || /logo|icon|favicon|cropped-|\.png$|\.svg/i.test(u)) continue;
      push(u);
    }
  }

  const summary = [
    `Paje by Night is a bungalow resort in Paje on the southeast coast of Zanzibar, Tanzania, set in a garden plot about 70 m behind Paje Beach, with ${nBungalows ?? '19'} air-conditioned bungalows, a pool with jacuzzi, restaurant and bar, a yoga studio and a spa hut.`,
    `Its own kite centre, Hakuna Matata Kiteschool${kiteYear ? ` (since ${kiteYear})` : ''}, sits on the beachfront 70 m away and runs IKO courses from discovery lessons to coaching plus gear rental; at low tide a knee-deep flat lagoon suits beginners, and the reef has waves at mid and high tide.`,
    `Direct bookings include breakfast and a free kite locker (subject to availability); rooms are booked online in the resort's Nightsbridge booking engine.`,
  ].join(' ');

  const homeAmenities = ['Free Wifi', 'Free Parking', 'Pool with jacuzzi', 'Pool Towel and Yoga Mat', 'Air Conditioned'].filter(a => homeText.includes(a));

  return {
    kind: 'accommodation',
    title: 'Paje by Night',
    summary,
    continent: 'Africa',
    country: 'Tanzania',
    region: 'Zanzibar',
    spot: 'Paje, Zanzibar',
    spotCoords: est.lat !== null && est.lng !== null ? { lat: est.lat, lng: est.lng } : null, // Nightsbridge establishment record
    itinerarySpots: [],
    durationDays: null,
    // kite page: "courses and lessons for beginners to advanced levels"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /BASE COURSE|lessons/i.test(kiteText),
    equipmentRental: /RENTAL/i.test(kiteText),
    beginnerFriendly: /perfect conditions for learning/i.test(kiteText),
    includedServices: [
      ...(includes ? includes.split(/\s+(?=Free kite locker|15 minutes free massage)/).map(s => s.trim()) : ['Breakfast', 'Free kite locker (up to availability)']),
      ...homeAmenities,
    ],
    optionalServices: [
      ...kiteOffers(kiteText),
      'Dinner, bed & breakfast plan (booking engine)',
      'Yoga classes', 'Massages (Bali Spa)', 'Tours', 'Laundry',
    ],
    accommodation: `${nBungalows ?? '19'} air-conditioned garden bungalows`,
    mealPlan: 'breakfast',
    languages: ['en'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: PBN_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home.join(' | ')}`,
      `rooms: ${roomsText}`,
      `kite: ${kiteText}${kiteSeason ? ` (school open ${kiteSeason})` : ''}`,
      `resort: ${resort.join(' | ')}`,
      `engine rooms: ${est.rooms.map(r => `${r.id} ${r.name} max ${r.maxOccupancy} x${r.roomCount ?? '?'} ${r.sizeM2 ?? '?'}m2`).join('; ')}`,
      `engine conditions: ${collapse(est.conditions)}`,
      `coords (engine): ${est.lat},${est.lng}`,
    ].join('\n'),
  };
}

function cfEmail(html: string): string | null {
  const hex = parse(html).querySelector('[data-cfemail]')?.getAttribute('data-cfemail');
  return hex ? decodeCfEmail(hex) : null;
}

// --- adapter ----------------------------------------------------------------------------------
async function establishment(): Promise<string> {
  return fetchText(PBN_ESTABLISHMENT_URL, { accept: 'application/json, text/plain, */*', headers: NB_HEADERS });
}

export const pajeByNightPaje: OfferAdapter = {
  key: 'paje-by-night-paje',
  name: 'Paje by Night',
  kind: 'accommodation',
  operator: {
    name: 'Paje by Night',
    websiteUrl: SITE,
    rootDomain: 'pajebynight.net',
    contactEmail: PBN_EMAIL,
    whatsapp: '+255772635066',
    phone: '+255772635066',
  },
  url: PBN_HOME_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 9,
  async fetchContent(ctx: FetchContext) {
    const home = await fetchText(PBN_HOME_URL, { accept: 'text/html' });
    const rooms = await fetchText(PBN_ROOMS_URL, { accept: 'text/html' });
    const kite = await fetchText(PBN_KITE_URL, { accept: 'text/html' });
    const resort = await fetchText(PBN_RESORT_URL, { accept: 'text/html' });
    const email = cfEmail(home);
    if (email && email !== PBN_EMAIL) ctx.note(`site e-mail changed: ${email}`);
    return parsePajeContent({ home, rooms, kite, resort, establishment: await establishment() });
  },
  async fetchSlots(ctx: FetchContext) {
    const est = parsePbnEstablishment(await establishment());
    if (est.rooms.length === 0) throw new Error('paje-by-night: no room types in the Nightsbridge establishment record');
    const today = todayIso();
    const days: PbnDay[] = [];
    for (const w of pbnWindows(today)) {
      try {
        const json = await fetchText(PBN_GRID_URL, {
          method: 'POST', body: pbnGridBody(w), contentType: 'application/json',
          accept: 'application/json, text/plain, */*', headers: NB_HEADERS,
        });
        days.push(...parsePbnGrid(json));
      } catch (e) {
        if (days.length === 0) throw e;
        ctx.incomplete(`grid window ${w.start}..${w.end} failed: ${(e as Error).message}`);
        break;
      }
    }
    if (days.length === 0) throw new Error('paje-by-night: Nightsbridge grid returned no days');
    return buildPbnSlots(est, days, today);
  },
};
