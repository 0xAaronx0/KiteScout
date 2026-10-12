// ---------------------------------------------------------------------------
// Kitesurf Tofo, Praia do Tofo (Inhambane, Mozambique) - IKO kite school with its own small hostel: a 4-bed bunk room
// (lockers, shared bathroom and kitchen), a queen room and two en-suite king/twin rooms; lessons in Tofo bay, rentals
// for Tofinho (waves) and the Barra lagoon (flat water), light-wind gear (hydrofoils, foil kites).
//
// Liveness (checked 2026-10-12): WordPress modified dates (wp-json) - accommodation page 2026-08-06T12:21:25, lessons
//   page and the three room pages 2026-05-07, home 2026-03-10; 132 photos uploaded 2026/03; footer + Google map pin on
//   the home page. Booking via WhatsApp.
// Kite link: own IKO school ("All our lessons are given by certified IKO-instructors"), courses and rental on the
//   lessons page; the accommodation page is the school's own "Stay with us".
//
// Data path (checked 2026-10-12): kitesurftofo.com, WordPress + WPBakery.
//   content  /accommodation-tofo-mozambique-hostel-kitesurfing-stay-with-us/ (room cards), /lessons-and-rentals/
//            (courses, rental prices in USD), / (Google Maps embed with the "!3d<lat>!2d<lng>" pin).
//   slots    the accommodation page: per room card an <h3> name, <p> facts, then "700 mzn per peron/night." /
//            "1800 mzn per night." - meticais (MZN), no dates, no season, no inventory -> 'on_request'.
// robots.txt (2026-10-12): Yoast default, nothing disallowed.
// Requests per run: content 3, slots 1.
// Parsed: one slot per room card, MZN per night; the bunk room is priced per person (per bed), the other rooms per room.
// Known limits: no season or dates on the site; lesson / rental prices (USD) go into the services, not into slots.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, parseAmount } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://kitesurftofo.com';
export const KST_STAY_URL = `${SITE}/accommodation-tofo-mozambique-hostel-kitesurfing-stay-with-us/`;
export const KST_LESSONS_URL = `${SITE}/lessons-and-rentals/`;
export const KST_HOME_URL = `${SITE}/`;
const PHONE = '+258850671729';

/** Visible text split at block tags (script/style bodies dropped). */
export function kstLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|article|header|footer|nav)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

const keyPart = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// --- pure parsers -----------------------------------------------------------------------------
export interface KstRoom { name: string; facts: string[]; amount: number | null; perPerson: boolean; priceText: string | null }

/** Room cards: <h3> name, then <p> facts until the "... mzn per ..." price line. */
export function parseKstRooms(html: string): KstRoom[] {
  const s = html.replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ');
  const out: KstRoom[] = [];
  let cur: KstRoom | null = null;
  for (const m of s.matchAll(/<(h3|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = clean(m[2].replace(/<[^>]+>/g, ' '));
    if (!t) continue;
    if (m[1].toLowerCase() === 'h3') { cur = { name: t, facts: [], amount: null, perPerson: false, priceText: null }; out.push(cur); continue; }
    if (!cur) continue;
    const price = t.match(/(\d[\d.,\s]*)\s*mzn\s+per\s+(pe(?:r)?on|person|night)/i);
    if (price) {
      cur.amount = parseAmount(price[1]);
      cur.perPerson = /^pe(?:r)?on$|^person$/i.test(price[2]);
      cur.priceText = t;
    } else if (!/^Book directly/i.test(t) && cur.amount === null) cur.facts.push(t.replace(/\.$/, ''));
  }
  return out.filter(r => r.amount !== null);
}

/** Occupancy from the card facts: "accommodate 4 people" (bunk room, priced per bed), queen / king = 2. */
function kstOccupancy(r: KstRoom): number | null {
  if (r.perPerson) return 1;
  if (/queen|king|double|2 single/i.test(`${r.name} ${r.facts.join(' ')}`)) return 2;
  return null;
}

export function buildKstSlots(rooms: KstRoom[]): Slot[] {
  return rooms.map(r => ({
    key: keyPart(r.name),
    startDate: null,
    endDate: null,
    unit: r.name,
    price: r.amount,
    currency: 'MZN',
    priceUnit: 'per_night',
    priceBasis: r.perPerson ? 'person' : 'room',
    occupancy: kstOccupancy(r),
    availability: 'on_request',
    availabilityText: 'Book directly through Whatsapp',
    spotsLeft: null,
  }));
}

/** Google Maps embed pin "!3d<lat>!2d<lng>" is "!2d<lng>!3d<lat>" in this embed. */
export function kstCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/google\.com\/maps\/embed\?pb=[^"']*?!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/);
  if (!m) return null;
  const lat = Number(m[2]);
  const lng = Number(m[1]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 } : null;
}

function usd(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[1] : null;
}

export interface KstPages { stay: string; lessons: string; home: string }

export function parseKstContent(p: KstPages): OfferContent {
  const rooms = parseKstRooms(p.stay);
  const stayText = kstLines(p.stay).join(' ');
  const lessons = kstLines(p.lessons).join(' ');
  const discovery = usd(lessons, /DISCOVERY\s+3 hours course[\s\S]*?(\d+) dollar per person/i);
  const complete = usd(lessons, /COMPLETE\s+9 hours complete course[\s\S]*?(\d+) dollar per person/i);
  const private2h = usd(lessons, /ONE on ONE\s+Price per 2 hours[\s\S]*?(\d+) dollar/i);
  const fullRentHour = usd(lessons, /RENT FULL EQUIPMENT[\s\S]*?\$(\d+) per HOUR/i);

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: r.facts[0] ?? null,
    features: [...r.facts.slice(1), r.priceText ? r.priceText.replace(/peron/i, 'person').replace(/\.$/, '') : null]
      .filter((x): x is string => !!x),
  }));
  const fmt = (n: number) => n.toLocaleString('en-US');
  const bunk = rooms.find(r => r.perPerson);
  const priv = rooms.filter(r => !r.perPerson).map(r => r.amount!).sort((a, b) => a - b);

  const summary = [
    'Kitesurf Tofo is a kite school with its own small hostel in Praia do Tofo, Inhambane province, on the coast of southern Mozambique.',
    `Guests sleep in a four-bed bunk room with a locker per bed${bunk ? ` (${fmt(bunk.amount!)} meticais per person per night)` : ''}, a private queen room or one of two en-suite rooms with a king or two single beds${priv.length ? ` (${fmt(priv[0])} to ${fmt(priv[priv.length - 1])} meticais per room per night)` : ''}, with a shared kitchen and free Wi-Fi; bookings go through WhatsApp.`,
    'The school teaches the IKO method with certified instructors from discovery course to private coaching and rents kites, twin-tips and hydrofoils, with sessions in Tofo bay, waves at Tofinho and flat water in the Barra lagoon.',
  ].join(' ');

  const imgs: string[] = [];
  for (const [html, base] of [[p.stay, KST_STAY_URL], [p.home, KST_HOME_URL], [p.lessons, KST_LESSONS_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 80)) {
      if (!/kitesurftofo\.com\/wp-content\/uploads\//.test(u) || /logo|starlink|cropped-|icon|\.png$|\.svg$/i.test(u)) continue;
      const clean = u.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
      if (!imgs.includes(clean)) imgs.push(clean);
    }
  }

  return {
    kind: 'accommodation',
    title: 'Kitesurf Tofo',
    summary,
    continent: 'Africa',
    country: 'Mozambique',
    region: 'Inhambane',
    spot: 'Praia do Tofo',
    spotCoords: kstCoords(p.home),
    itinerarySpots: [],
    durationDays: null,
    // "The courses will be adjusted for beginners, intermediate and advanced level."
    skillLevels: /beginners, intermediate and advanced/i.test(lessons) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: /IKO/i.test(lessons),
    equipmentRental: /RENT/i.test(lessons),
    beginnerFriendly: /complete beginners/i.test(lessons),
    includedServices: [/FREE FAST WIFI/i.test(stayText) ? 'Free fast Wi-Fi' : null, 'Shared kitchen', /own locker/i.test(stayText) ? 'Locker per bed in the bunk room' : null]
      .filter((x): x is string => !!x),
    optionalServices: [
      discovery ? `IKO discovery course, 3 hours: ${discovery} USD per person` : null,
      complete ? `IKO complete course, 9 hours: ${complete} USD per person` : null,
      private2h ? `Private lesson, 2 hours: ${private2h} USD` : null,
      fullRentHour ? `Full kite equipment rental: ${fullRentHour} USD per hour` : null,
      'Hydrofoil and foil kite rental, surfboards, mountain bikes',
    ].filter((x): x is string => !!x),
    accommodation: 'kite school hostel (bunk room, private rooms)',
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms: contentRooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KST_STAY_URL,
    bookingUrl: `https://wa.me/${PHONE.replace('+', '')}`,
    sourceText: [
      `rooms: ${rooms.map(r => `${r.name}: ${r.facts.join('; ')}; ${r.priceText}`).join(' | ')}`,
      `lessons: ${kstLines(p.lessons).filter(l => l.length > 3).join(' | ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const kitesurfTofo: OfferAdapter = {
  key: 'kitesurf-tofo',
  name: 'Kitesurf Tofo',
  kind: 'accommodation',
  operator: {
    name: 'Kitesurf Tofo',
    websiteUrl: SITE,
    rootDomain: 'kitesurftofo.com',
    whatsapp: PHONE,
    phone: PHONE,
  },
  url: KST_STAY_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'medium', // undated room prices on a page edited 2026-08-06; booking by WhatsApp
  async fetchContent() {
    const stay = await fetchText(KST_STAY_URL, { accept: 'text/html' });
    const lessons = await fetchText(KST_LESSONS_URL, { accept: 'text/html' });
    const home = await fetchText(KST_HOME_URL, { accept: 'text/html' });
    return parseKstContent({ stay, lessons, home });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    const rooms = parseKstRooms(await fetchText(KST_STAY_URL, { accept: 'text/html' }));
    if (rooms.length === 0) throw new Error('kitesurf-tofo: no "... mzn per ..." room prices on the accommodation page (layout changed?)');
    if (rooms.length < 3) ctx.note(`only ${rooms.length} priced room cards (3 expected)`);
    return buildKstSlots(rooms);
  },
};
