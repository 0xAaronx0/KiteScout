// ---------------------------------------------------------------------------
// Campione Univela, Campione del Garda (Lake Garda, Lombardy, Italy) - lakefront hostel / B&B with private
// beach, run by the sailing club Univela Sailing: single to family rooms, beds in 4- and 6-bed hostel rooms
// and apartments; kitesurf courses with Garda Kitesurf, free kiteboard deposit, gear wash and a video-
// monitored drying room for wet equipment.
//
// Data path (checked 2026-10-12): ProcessWire site www.campioneunivela.it (English pages):
//   content  /en/accomodation/univela-campione-del-garda-lakefront-hotel-with-private-beach-for-sport-and-
//            relaxation/ (sport stay: kite launch area, gear wash and drying zone, services),
//            /en/accomodation/rooms/ (room options, included services), /en/courses/kite-surf/ (kite courses
//            "In collaboration with" Garda Kitesurf, prices in EUR), /en/offers/ (packages with "Starting
//            from" prices).
//   slots    none. The site prints no room rates ("To get the best price please check the availability");
//            they live only in the booking engine booking.campioneunivela.it, whose robots.txt is
//            "User-agent: * / Disallow: /" (2026-10-12) -> we do not call it. fetchSlots returns []
//            ("price on request") without a request. (Seen in the built-in browser on 2026-10-12: the engine
//            offers dates from 12/10/2026 and the banner "PROMO 2026: 48 hours of discounts for the entire
//            season!" - not stored.)
// robots.txt www.campioneunivela.it: none (HTTP 404 = allow all, 2026-10-12).
// Requests per run: content 4, slots 0.
// Known limits: no room prices, no availability. The packages on /en/offers/ (e.g. "Islands of Garda": one
//   night in a lake-view room for two with breakfast and a boat excursion, from EUR 300) bundle activities,
//   so they are listed as optional services, not as room prices. Year evidence is 2026 only (engine promo,
//   2026 regatta news); no 2027 dates were published on 2026-10-12.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, meta } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.campioneunivela.it';
export const UV_SPORT_URL = `${SITE}/en/accomodation/univela-campione-del-garda-lakefront-hotel-with-private-beach-for-sport-and-relaxation/`;
const ROOMS_URL = `${SITE}/en/accomodation/rooms/`;
const KITE_URL = `${SITE}/en/courses/kite-surf/`;
const OFFERS_URL = `${SITE}/en/offers/`;
const BOOKING_URL = 'https://booking.campioneunivela.it/';

/** Visible text split at block tags. */
export function uvLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg|select)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|span|a|button|table)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

/** Lines between a heading and the next stop line. */
function block(ls: string[], from: RegExp, stop: RegExp): string[] {
  const i = ls.findIndex(l => from.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < ls.length && !stop.test(ls[j]); j++) out.push(ls[j]);
  return out;
}

// --- pure parsers -----------------------------------------------------------------------------
/** Kite course prices: "<Course name>" ... "Price: €280 + €20 membership ..." pairs. */
export function parseUvKiteCourses(html: string): Array<{ course: string; price: number; text: string }> {
  const ls = uvLines(html);
  const out: Array<{ course: string; price: number; text: string }> = [];
  let course: string | null = null;
  for (const l of ls) {
    if (/^(Try-Out Course|Basic Course|Kitesurfing Start Course|Complete Course|Single Lesson)$/i.test(l)) { course = l; continue; }
    const m = l.match(/^Price:\s*€\s?(\d+)/i);
    if (m && course) { out.push({ course, price: Number(m[1]), text: l }); course = null; }
  }
  return out;
}

/** Packages on /en/offers/: title, description, "Starting from:", "€ 1.480,00". */
export function parseUvOffers(html: string): Array<{ title: string; from: number }> {
  const ls = uvLines(html);
  const out: Array<{ title: string; from: number }> = [];
  ls.forEach((l, i) => {
    const price = ls[i + 1]?.match(/^€\s?(\d{1,3}(?:\.\d{3})*),\d{2}$/);
    if (!/^Starting from:?$/i.test(l) || !price || i < 2) return;
    const title = ls[i - 2];
    if (!out.some(o => o.title === title)) out.push({ title, from: Number(price[1].replace(/\./g, '')) });
  });
  return out;
}

const PHOTO_JUNK = /logo|diapositiva|book_now|eu4eu|favicon|\.0x100\./i;

/** ProcessWire photos: /site/assets/files/<page>/<name>[.WxH].jpg -> the original <name>.jpg. */
export function uvImages(pages: string[], max = 30): string[] {
  const out: string[] = [];
  for (const html of pages) {
    const og = meta(html, 'og:image');
    for (const raw of [og ?? '', ...[...html.matchAll(/\/site\/assets\/files\/\d+\/[^"'()\s]+?\.(?:jpe?g|webp)/gi)].map(m => m[0])]) {
      if (!raw || PHOTO_JUNK.test(raw)) continue;
      const u = new URL(raw.replace(/\.\d+x\d+(?=\.(?:jpe?g|webp)$)/i, ''), SITE).toString();
      if (!out.includes(u)) out.push(u);
    }
  }
  return out.slice(0, max);
}

export interface UvPages { sport: string; rooms: string; kite: string; offers: string }

export function parseUnivelaContent(p: UvPages): OfferContent {
  const sport = uvLines(p.sport);
  const rooms = uvLines(p.rooms);
  const kite = uvLines(p.kite);
  const offers = uvLines(p.offers);
  const sportText = sport.join(' ');
  const options = block(rooms, /^Accommodation Options$/i, /^All private rooms|^Services included$/i);
  const included = block(rooms, /^All the following services are free of charge/i, /^Gallery$/i);
  const courses = parseUvKiteCourses(p.kite);
  const packages = parseUvOffers(p.offers);
  const partner = kite.some(l => /^In collaboration with$/i.test(l)) && /logo-garda-kite/i.test(p.kite) ? 'Garda Kitesurf' : null;
  const roomFeatures = rooms.find(l => /^All rooms have a balcony/i.test(l)) ?? null;

  const contentRooms: ContentRoom[] = options.map(name => ({
    name,
    description: /hostel/i.test(name) ? 'Bed in a shared hostel room with 4 or 6 beds.' : roomFeatures,
    features: /hostel/i.test(name) ? ['Breakfast buffet included (bed & breakfast)'] : ['Breakfast buffet included (bed & breakfast)', 'Lake view available for all private rooms'],
  }));

  const basic = courses.find(c => /^Basic/i.test(c.course));
  const summary = [
    'Campione Univela is a lakefront hostel with private beach in Campione del Garda on the west shore of Lake Garda (Lombardy, Italy), run by the sailing club Univela Sailing; the village is reached through a tunnel and lies off the main lakeside road.',
    `It offers bed & breakfast in single, double, triple, quadruple and family rooms (some with lake view), beds in 4- and 6-bed hostel rooms and apartments, with a restaurant-pizzeria on the beach and a gym.`,
    `Kitesurfers and wingfoilers use the dedicated launch area, free kiteboard deposit, gear wash and video-monitored drying room; kite courses run${partner ? ` with ${partner}` : ''}${basic ? ` (basic course EUR ${basic.price} plus EUR 20 membership)` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Campione Univela',
    summary,
    continent: 'Europe',
    country: 'Italy',
    region: 'Lombardy',
    spot: 'Campione del Garda',
    itinerarySpots: [],
    durationDays: null,
    // kite course page: "Level: Beginner, Intermediate, Advanced"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: courses.length > 0,
    equipmentRental: /equipment rental/i.test(sportText),
    beginnerFriendly: courses.some(c => /Try-Out|Basic/i.test(c.course)),
    includedServices: included.filter(l => l.length < 80),
    optionalServices: [
      ...courses.map(c => `Kitesurf ${c.course.toLowerCase()}: EUR ${c.price} + EUR 20 membership and insurance`),
      'Wingfoil, sailing, catamaran, SUP and kayak courses and rentals',
      'Lunch and dinner at the Univela Beach restaurant-pizzeria',
      ...packages.map(o => `${o.title} (from EUR ${o.from.toLocaleString('en-US')})`),
    ],
    accommodation: 'lakefront hostel: private rooms, hostel beds in 4- and 6-bed rooms, apartments',
    mealPlan: 'breakfast',
    languages: ['it', 'en', 'de'],
    rooms: contentRooms,
    imageUrls: uvImages([p.sport, p.kite, p.rooms]),
    heroVideoUrl: null,
    sourceUrl: UV_SPORT_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `sport stay: ${sportText}`,
      `rooms: ${rooms.join(' ')}`,
      `kite courses: ${kite.join(' ')}`,
      `offers: ${offers.join(' ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const univelaCampioneDelGarda: OfferAdapter = {
  key: 'univela-campione-del-garda',
  name: 'Campione Univela',
  kind: 'accommodation',
  operator: {
    name: 'Univela Sailing',
    websiteUrl: SITE,
    rootDomain: 'campioneunivela.it',
    contactEmail: 'info@campioneunivela.it',
    phone: '+390365791102',
  },
  url: UV_SPORT_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  fetchBudget: 4,
  confidence: 'low',
  async fetchContent() {
    const [sport, rooms, kite, offers] = [
      await fetchText(UV_SPORT_URL, { accept: 'text/html' }),
      await fetchText(ROOMS_URL, { accept: 'text/html' }),
      await fetchText(KITE_URL, { accept: 'text/html' }),
      await fetchText(OFFERS_URL, { accept: 'text/html' }),
    ];
    return parseUnivelaContent({ sport, rooms, kite, offers });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    ctx.note('room rates only in booking.campioneunivela.it (robots.txt "Disallow: /") - price on request');
    return [];
  },
};
