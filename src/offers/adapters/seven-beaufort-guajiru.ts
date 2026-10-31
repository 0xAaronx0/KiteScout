// ---------------------------------------------------------------------------
// 7 Beaufort Brasil, Ilha do Guajiru (Itarema, Ceará, Brazil) - pousada in the front row of the kite
// lagoon with its own VDWS-certified kite school (Core kites, lessons, rental, beach boy service).
//
// Data path (checked 2026-10-12): hand-built static site (jQuery/Bootstrap), English pages:
//   slots    /rooms.html - one `.room-wrapper` per room category (data-images JSON, <h1> name, short
//            description) with a price table: <thead> = seasons with day ranges but NO year
//            ("Low season 1 01.07 - 24.09", "Main season 25.09 - 05.12 | 25.12 - 05.01", ...),
//            <tbody> rows = occupancy ("1 Bed, 2 Persons"), cells = EUR per room per night ("??? €" =
//            not published). Rates include breakfast and the kite station.
//   content  / (home), /rooms.html (room texts, photos), /kiteschool.html (VDWS school, courses with
//            prices), /contact.html (address, e-mail, Google Maps embed = spotCoords).
// Booking engine: the site's own (POST /findMatchingRoom.php, JSON {dateFrom:"dd.mm.yyyy", dateTo, adults,
//   kids, babies, bedType, beds} -> HTML room list with "price per night" + total). Probed twice on
//   2026-10-12: 11.-15.01.2027 returned all 6 categories at the table's Low season 2 prices (so the table
//   is the 2026/27 table), 15.-22.11.2026 "No rooms are available". Not used per run: it answers one stay at
//   a time, the table gives the bands.
// robots.txt (2026-10-12): none (404) -> everything allowed.
// Requests per run: content 4, slots 1.
// Parsed: slot = room x occupancy x season band with real date limits for the next occurrence of each band
//   (bands whose end is still ahead of today; the year is inferred because the table prints none),
//   EUR per room per night (the dorm per bed), availability 'unknown' (no inventory on the page).
// Known limits: the year is inferred; the "Main season" has two ranges (two bands); cells "??? €" give no slot.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, parse, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot, SlotPriceBasis } from '../types.js';

const SITE = 'https://7beaufort.com';
const HOME_URL = `${SITE}/`;
export const SB_ROOMS_URL = `${SITE}/rooms.html`;
const SCHOOL_URL = `${SITE}/kiteschool.html`;
const CONTACT_URL = `${SITE}/contact.html`;
const BOOKING_URL = `${SITE}/traveldates.html`;

export interface SbSeason { name: string; ranges: Array<{ sd: number; sm: number; ed: number; em: number; label: string }> }
export interface SbRate { persons: number; beds: number; label: string; prices: Array<number | null> }
export interface SbRoom { name: string; description: string; images: string[]; seasons: SbSeason[]; rates: SbRate[] }
export interface SbBand { season: string; label: string; start: string; end: string; col: number }
export interface SbCourse { name: string; hours: number; individual: number; perStudentOfTwo: number }

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// --- pure parsers -----------------------------------------------------------------------------
/** Room categories with their price tables (rooms.html). */
export function parseSbRooms(html: string): SbRoom[] {
  const root = parse(html);
  return root.querySelectorAll('.room-wrapper').map(w => {
    const name = collapse(w.querySelector('h1')?.text ?? '').replace(/\.$/, '');
    const description = collapse(w.querySelector('p.fw-semibold')?.text ?? w.querySelector('p')?.text ?? '');
    let images: string[] = [];
    try { images = (JSON.parse(w.getAttribute('data-images') ?? '[]') as string[]).map(u => new URL(u, `${SITE}/`).toString()); } catch { /* none */ }
    const seasons: SbSeason[] = w.querySelectorAll('thead th').slice(1).map(th => {
      const label = collapse(th.querySelector('p')?.text ?? '');
      const ranges = [...label.matchAll(/(\d{1,2})\.(\d{1,2})\.?\s*-\s*(\d{1,2})\.(\d{1,2})\.?/g)]
        .map(m => ({ sd: +m[1], sm: +m[2], ed: +m[3], em: +m[4], label: m[0].trim() }));
      return { name: collapse(collapse(th.text).replace(label, '')), ranges };
    });
    const rates: SbRate[] = w.querySelectorAll('tbody tr').map(tr => {
      const label = collapse(tr.querySelector('th')?.text ?? '');
      const m = label.match(/(\d+)\s+Beds?,\s*(\d+)\s+Persons?/i);
      return {
        persons: m ? +m[2] : 0,
        beds: m ? +m[1] : 0,
        label,
        prices: tr.querySelectorAll('td').map(td => (/\d/.test(td.text) ? parseAmount(td.text) : null)),
      };
    }).filter(r => r.persons > 0);
    return { name, description, images, seasons, rates };
  }).filter(r => r.name && r.rates.length);
}

/** Next occurrence of every season range whose last night is today or later (the table has no year). */
export function sbBands(seasons: SbSeason[], today: string): SbBand[] {
  const out: SbBand[] = [];
  const y0 = Number(today.slice(0, 4));
  seasons.forEach((s, col) => {
    for (const r of s.ranges) {
      const crosses = r.em < r.sm || (r.em === r.sm && r.ed < r.sd);
      for (const y of [y0 - 1, y0, y0 + 1]) {
        const start = iso(y, r.sm, r.sd);
        const end = iso(crosses ? y + 1 : y, r.em, r.ed);
        if (end >= today) { out.push({ season: s.name, label: r.label, start, end, col }); break; }
      }
    }
  });
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export function buildSbSlots(rooms: SbRoom[], today: string): Slot[] {
  const out: Slot[] = [];
  for (const room of rooms) {
    // the dorm is sold per bed; every other category prices the room for 1..n guests
    const basis: SlotPriceBasis = /^dorm/i.test(room.name) ? 'person' : 'room';
    for (const band of sbBands(room.seasons, today)) {
      for (const rate of room.rates) {
        const price = rate.prices[band.col] ?? null;
        if (price === null) continue; // "??? €": no published price for this season
        out.push({
          key: `${keyPart(room.name)}-${rate.persons}p|${band.start}`,
          startDate: band.start,
          endDate: band.end,
          unit: room.name,
          price,
          currency: 'EUR',
          priceUnit: 'per_night',
          priceBasis: basis,
          occupancy: rate.persons,
          availability: 'unknown',
          availabilityText: `${band.season} (${band.label}); price table without year, applied to the next occurrence`,
          spotsLeft: null,
        });
      }
    }
  }
  return out;
}

/** Kite courses on kiteschool.html: name, hours, price for an individual lesson and per student with 2 per teacher. */
export function parseSbCourses(html: string): SbCourse[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav')) el.remove();
  const t = collapse(root.text);
  const out: SbCourse[] = [];
  const re = /(Beginner Basic|Complete Beginner|Refresher|Advanced Complete|Advanced|Intensive Course)\b[\s\S]*?(\d+)\s+hours[\s\S]*?Individual lessons\s*2 Students per Teacher\s+(\d[\d.,]*)\s*€\s+(\d[\d.,]*)\s*€/g;
  for (const m of t.matchAll(re)) out.push({ name: m[1], hours: +m[2], individual: parseAmount(m[3])!, perStudentOfTwo: parseAmount(m[4])! });
  return out;
}

/** Google Maps embed on the contact page: !2d<lng>!3d<lat>. */
export function parseSbCoords(contactHtml: string): { lat: number; lng: number } | null {
  const m = contactHtml.match(/google\.com\/maps\/embed\?pb=[^"']*?!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/);
  return m ? { lat: Math.round(+m[2] * 1e5) / 1e5, lng: Math.round(+m[1] * 1e5) / 1e5 } : null;
}

function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav, form')) el.remove();
  return collapse(root.querySelector('body')?.text ?? root.text);
}

export interface SbPages { home: string; rooms: string; school: string; contact: string }

export function parseSevenBeaufortContent(p: SbPages): OfferContent {
  const home = pageText(p.home);
  const roomsText = pageText(p.rooms);
  const school = pageText(p.school);
  const contact = pageText(p.contact);
  const rooms = parseSbRooms(p.rooms);
  const courses = parseSbCourses(p.school);
  const eur = (n: number) => `EUR ${n}`;

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: r.description || null,
    features: r.seasons.flatMap((s, col) => r.rates.map(rt => {
      const v = rt.prices[col];
      return `${s.name} (${s.ranges.map(x => x.label).join(' | ')}), ${rt.label}: ${v !== null && v !== undefined ? `${eur(v)} per night` : 'price not published'}`;
    })),
  }));

  const intro = roomsText.match(/(Our room rates include[\s\S]*?beach boy service[^.]*\.)/i)?.[1] ?? '';
  const windSeason = home.match(/Between ([a-z-]+ ?[A-Za-z]+) and ([a-z-]+ ?[A-Za-z]+), Ilha do Guajiru offers nearly 100% wind reliability/i);
  const cheapest = rooms.filter(r => !/^dorm/i.test(r.name)).flatMap(r => r.rates.flatMap(rt => rt.prices.filter((x): x is number => x !== null))).sort((a, b) => a - b)[0];
  const dorm = rooms.find(r => /^dorm/i.test(r.name))?.rates[0]?.prices.find((x): x is number => x !== null);

  const summary = [
    'Pousada 7 Beaufort Brasil sits in the village of Ilha do Guajiru (Itarema, Ceará, Brazil), in the front row of a 5 km long, 700 m wide flat-water kite lagoon, with its own VDWS-certified kite school, Core kites, rental, beach boy service and compressor.',
    `It has ${rooms.length || 'several'} room categories from a ${rooms.find(r => /^dorm/i.test(r.name)) ? 'four-bed dorm' : 'dorm'} to deluxe and family rooms with sea view${cheapest ? `; seasonal rates run from ${eur(cheapest)} per room per night${dorm ? ` (dorm bed ${eur(dorm)})` : ''}` : ''}, including the breakfast buffet and use of the kite station with storage.`,
    `There is a pool, restaurant and bar${windSeason ? `, and the wind season runs from ${windSeason[1]} to ${windSeason[2]}` : ''}.`,
  ].join(' ');

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  const push = (u: string) => {
    if (/logo|flags|icon|vdws\.png|lizenz|core\.png|\.svg/i.test(u)) return;
    const k = u.replace(/^https?:\/\/[^/]+/, '').replace(/^\/\.\//, '/');
    if (seen.has(k)) return;
    seen.add(k); imageUrls.push(new URL(k, `${SITE}/`).toString());
  };
  for (const u of imageCandidates(p.home, HOME_URL, null, 40)) push(u);
  // two photos per room category first, then the rest of the room galleries
  for (const r of rooms) r.images.slice(0, 2).forEach(push);
  for (let i = 2; i < 30; i++) for (const r of rooms) if (r.images[i]) push(r.images[i]);
  for (const u of imageCandidates(p.school, SCHOOL_URL, null, 20)) push(u);

  const email = p.contact.match(/[A-Za-z0-9._%+-]+@7beaufort\.com/)?.[0] ?? null;
  const coords = parseSbCoords(p.contact);

  return {
    kind: 'accommodation',
    title: '7 Beaufort Brasil',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Ceará',
    spot: 'Ilha do Guajiru',
    spotCoords: coords,
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // home: "the perfect kitespot for all skill levels" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kite lessons|kite courses/i.test(school),
    equipmentRental: /rental/i.test(school),
    beginnerFriendly: /all skill levels|perfect for beginners/i.test(`${home} ${school}`) ? true : null,
    includedServices: [
      'Breakfast buffet',
      'Kite station use: separate kite storage, compressor, outdoor showers, beach boy service, launch lawn',
      'Daily transfers to the low-tide kite spot',
      'Pool',
      'Wi-Fi',
    ],
    optionalServices: [
      ...courses.map(c => `${c.name.replace(/ Course$/, '')} kite course, ${c.hours} h incl. equipment: ${eur(c.individual)} individual, ${eur(c.perStudentOfTwo)} per student with 2 per teacher`),
      'Kite equipment rental (Core kites; boards from Core, Future, Nobile)',
      'VDWS kite license',
      'Downwinder trips and excursions',
      'Airport transfer (Fortaleza about 3 h, Jericoacoara about 1 h)',
      'Restaurant and bar',
    ],
    accommodation: 'pousada rooms (deluxe, family, superior, classic, garden house) and a dorm',
    mealPlan: 'breakfast',
    languages: ['de', 'en', 'pt', 'es'], // site language switch (2026-10-12)
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home}`,
      `rooms: ${intro}`,
      ...rooms.map(r => `room ${r.name}: ${r.description} | ${r.seasons.map(s => `${s.name} ${s.ranges.map(x => x.label).join('|')}`).join('; ')} | ${r.rates.map(rt => `${rt.label}: ${rt.prices.map(x => x ?? '???').join('/')}`).join('; ')}`),
      `kite school: ${school}`,
      `courses: ${courses.map(c => `${c.name} ${c.hours}h ${c.individual}/${c.perStudentOfTwo}`).join('; ')}`,
      `contact: ${contact}`,
      `email: ${email ?? ''}; map: ${coords ? `${coords.lat},${coords.lng}` : ''}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const sevenBeaufortGuajiru: OfferAdapter = {
  key: 'seven-beaufort-guajiru',
  name: '7 Beaufort Brasil Ilha do Guajiru',
  kind: 'accommodation',
  operator: {
    name: '7 Beaufort Brasil',
    websiteUrl: SITE,
    rootDomain: '7beaufort.com',
    contactEmail: 'contact@7beaufort.com',
    whatsapp: '+5588998241591', // wa.me link in the site header (2026-10-12)
  },
  url: HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 6,
  confidence: 'medium', // prices from a year-less table (the engine confirmed them for January 2027)
  async fetchContent() {
    const [home, rooms, school, contact] = [
      await fetchText(HOME_URL, { accept: 'text/html' }),
      await fetchText(SB_ROOMS_URL, { accept: 'text/html' }),
      await fetchText(SCHOOL_URL, { accept: 'text/html' }),
      await fetchText(CONTACT_URL, { accept: 'text/html' }),
    ];
    return parseSevenBeaufortContent({ home, rooms, school, contact });
  },
  async fetchSlots(ctx) {
    const rooms = parseSbRooms(await fetchText(SB_ROOMS_URL, { accept: 'text/html' }));
    if (rooms.length === 0) throw new Error('seven-beaufort: no .room-wrapper price tables on rooms.html (layout changed?)');
    if (rooms.some(r => r.seasons.length === 0 || r.seasons.some(s => s.ranges.length === 0))) ctx.note('a room table has a season without day ranges');
    return buildSbSlots(rooms, todayIso());
  },
};
