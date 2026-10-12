// ---------------------------------------------------------------------------
// The Rascals Kite Resort, Anawasal / Kalpitiya (Sri Lanka) - 11-room kite resort (5 Tropical Cabanas,
// 4 Oyster Rooms, 2 Jungalows) with pool, full board and its own kite school (Duotone Pro Center), kite shop
// and rental on the Kalpitiya lagoon.
//
// Data path (checked 2026-10-12), Wix site www.rascalskiteresort.com (server-rendered text):
//   content  / (Organization JSON-LD with the Google Maps place link = coordinates), /stay (room counts),
//            /rooms (room texts + features), /kite (school, team, spots, shop, rental), /info (transfer,
//            check-in / check-out, payment).
//   slots    /rooms: per room type a "RATES / Prices below include breakfast, lunch and dinner" block with
//            "Single Occupancy: 90 EUR", "Double Occupancy: 130 EUR", "Triple Occupancy: N/A | 200 EUR".
//            No season, no dates, no year -> one slot per room x occupancy without dates (like Michael's).
// Booking: "BOOK NOW" goes to /booking-now (contact page); the Wix Hotels app is installed in the site's app
//   list but no widget is placed on any page we read -> no engine, availability 'on_request'.
// robots.txt (2026-10-12): "User-agent: * / Allow: /", only "*?lightbox=" disallowed.
// Requests per run: content 5, slots 1.
// Parsed: slot = room type x occupancy ("oyster-room-2p"), EUR per room per night, full board.
// Known limits / inferred: the rate blocks do not say "per night" (read as nightly room rates, full board);
//   the footer still says "© 2023" and the site prints no 2026/27 date - current operation is inferred from
//   the site being republished 2026-07-21 (pages sitemap lastmod) and a new home-page video uploaded
//   2026-10-11 (VideoObject JSON-LD). Room names are matched by the last room keyword before each rate
//   block (the Wix text order interleaves the "VIEW THIS ROOM" buttons of the previous card).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, ldOfType, meta, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.rascalskiteresort.com';
export const RK_HOME_URL = `${SITE}/`;
export const RK_STAY_URL = `${SITE}/stay`;
export const RK_ROOMS_URL = `${SITE}/rooms`;
export const RK_KITE_URL = `${SITE}/kite`;
export const RK_INFO_URL = `${SITE}/info`;
const BOOKING_URL = `${SITE}/booking-now`;
const WIX_OWNER = 'c24c9d';

const ROOM_TYPES: Array<{ name: string; re: RegExp }> = [
  { name: 'Oyster Room', re: /oyster/gi },
  { name: 'Tropical Cabana', re: /tropical cabana/gi },
  { name: 'Jungalow', re: /jungalow/gi },
];

export interface RkRoom { name: string; descriptions: string[]; features: string[]; rates: Array<{ occupancy: number; amount: number; currency: string }>; ratesNote: string | null }

const keyPart = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Visible text split at block tags (Wix rich text: one entry per paragraph / span). */
export function rkLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|select|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|span|a|button)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')).replace(/[​ ]/g, ' ').trim())
    .filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
/** /rooms: each "RATES" block belongs to the room type mentioned last before it. */
export function parseRkRooms(html: string): RkRoom[] {
  const ls = rkLines(html);
  const out: RkRoom[] = [];
  let segStart = Math.max(0, ls.findIndex(l => /^BOOK NOW$/i.test(l)) + 1);
  for (let i = segStart; i < ls.length; i++) {
    if (ls[i] !== 'RATES') continue;
    const seg = ls.slice(segStart, i);
    const text = seg.join('\n');
    let best: { name: string; at: number } | null = null;
    for (const t of ROOM_TYPES) {
      const hits = [...text.matchAll(t.re)];
      const at = hits.length ? hits[hits.length - 1].index! : -1;
      if (at >= 0 && (!best || at > best.at)) best = { name: t.name, at };
    }
    const descStart = seg.findIndex(l => l.length > 80);
    const descriptions = seg.filter(l => l.length > 80);
    const lastDesc = seg.reduce((n, l, k) => (l.length > 80 ? k : n), -1);
    const features = descStart >= 0 ? seg.slice(lastDesc + 1).filter(l => l.length < 50 && l !== l.toUpperCase()) : [];
    const room: RkRoom = { name: best?.name ?? `Room ${out.length + 1}`, descriptions, features, rates: [], ratesNote: null };
    let j = i + 1;
    for (; j < ls.length && !/^VIEW THIS ROOM$|^BOOK NOW$/i.test(ls[j]); j++) {
      const r = ls[j].match(/^(Single|Double|Triple|Quadruple) Occupancy:\s*(.+)$/i);
      if (r) {
        const occ = { single: 1, double: 2, triple: 3, quadruple: 4 }[r[1].toLowerCase() as 'single'];
        const amount = /\d/.test(r[2]) ? parseAmount(r[2]) : null;
        if (amount) room.rates.push({ occupancy: occ, amount, currency: /EUR|€/.test(r[2]) ? 'EUR' : /USD|\$/.test(r[2]) ? 'USD' : 'EUR' });
      } else if (/^Prices below include/i.test(ls[j])) room.ratesNote = ls[j];
    }
    out.push(room);
    segStart = j;
    i = j;
  }
  return out;
}

export function buildRkSlots(rooms: RkRoom[]): Slot[] {
  return rooms.flatMap(r => r.rates.map(x => ({
    key: `${keyPart(r.name)}-${x.occupancy}p`,
    startDate: null,
    endDate: null,
    unit: r.name,
    price: x.amount,
    currency: x.currency,
    priceUnit: 'per_night' as const,
    priceBasis: 'room' as const,
    occupancy: x.occupancy,
    availability: 'on_request' as const,
    availabilityText: null,
    spotsLeft: null,
  })));
}

/** Owner photos from Wix <img> tags (original size), skipping PNG graphics and the logo. */
export function rkImages(html: string, exclude: string[] = []): string[] {
  const out: string[] = [];
  const og = meta(html, 'og:image');
  for (const src of [og ?? '', ...[...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1])]) {
    const id = src.replace(/%7E/gi, '~').match(new RegExp(`${WIX_OWNER}_[0-9a-f]{32}~mv2\\.(?:jpe?g|webp)`, 'i'))?.[0];
    if (!id || exclude.some(e => e.includes(id))) continue;
    const u = `https://static.wixstatic.com/media/${id}`;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export interface RkPages { home: string; stay: string; rooms: string; kite: string; info: string }

export function parseRascalsContent(p: RkPages): OfferContent {
  const rooms = parseRkRooms(p.rooms);
  const stay = rkLines(p.stay).join(' ');
  const kite = rkLines(p.kite);
  const info = rkLines(p.info);
  const counts = stay.match(/(\d+) Tropical Cabanas?, (\d+) Oyster Rooms? and (\d+) Jungalows?/i);
  const total = stay.match(/Each of the (\d+) rooms/i)?.[1] ?? null;
  const countOf = (name: string): string | null => !counts ? null : name === 'Tropical Cabana' ? counts[1] : name === 'Oyster Room' ? counts[2] : counts[3];
  const org = ldOfType(p.home, 'Organization')[0] ?? {};
  const mapsUrl = ((org.sameAs ?? []) as string[]).find(u => /google\.com\/maps\/place/.test(u))
    ?? p.home.match(/https:\/\/www\.google\.com\/maps\/place\/[^"' ]+/)?.[0] ?? '';
  const pin = mapsUrl.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ?? mapsUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  const logo = String((ldOfType(p.home, 'LocalBusiness')[0] ?? {}).image ?? '');
  const video = ldOfType(p.home, 'VideoObject')[0];
  const transfer = info.find(l => /EUR for a van/i.test(l)) ?? null;
  const checkIn = info.find(l => /check-in anytime between/i.test(l)) ?? null;
  const school = kite.find(l => /Kite School and DUOTONE PRO CENTER/i.test(l)) ?? null;
  const students = kite.join(' ').match(/over (\d+) students/i)?.[1] ?? null;

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: [countOf(r.name) ? `${countOf(r.name)} units.` : null, ...r.descriptions].filter(Boolean).join(' ') || null,
    features: [...r.features, ...r.rates.map(x => `${['', 'Single', 'Double', 'Triple', 'Quadruple'][x.occupancy]} occupancy: ${x.currency} ${x.amount} (full board)`)],
  }));

  const imgs: string[] = [];
  for (const html of [p.home, p.rooms, p.stay, p.kite, p.info]) for (const u of rkImages(html, [logo])) if (!imgs.includes(u)) imgs.push(u);

  const all = rooms.flatMap(r => r.rates.map(x => x.amount));
  const summary = [
    `The Rascals Kite Resort is a kite resort in Anawasal, Kalpitiya, on the north-west coast of Sri Lanka, with ${total ?? '11'} rooms around a pool facing the home kite spot${counts ? ` (${counts[1]} Tropical Cabanas, ${counts[2]} Oyster Rooms, ${counts[3]} Jungalows)` : ''}.`,
    `Room rates include breakfast, lunch and dinner${all.length ? ` and run from EUR ${Math.min(...all)} to ${Math.max(...all)} per room depending on room type and occupancy` : ''}; bookings are made by request.`,
    `The resort runs its own kite school as a Duotone Pro Center${students ? ` (over ${students} students taught)` : ''}, with a kite shop, Duotone / ION rental and trips to the lagoon spots, wave spots and downwinders around Kalpitiya.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'The Rascals Kite Resort',
    summary,
    continent: 'Asia',
    country: 'Sri Lanka',
    region: 'North Western Province',
    spot: 'Kalpitiya',
    spotCoords: pin ? { lat: Number(pin[1]), lng: Number(pin[2]) } : null, // Google Maps place link in the site's Organization JSON-LD
    itinerarySpots: [],
    durationDays: null,
    // kite page: "offers kiteboarding lessons to suit every level of experience"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kiteboarding lessons/i.test(kite.join(' ')),
    equipmentRental: /rent kitesurfing gear|KITE RENTAL|Rental Rates/i.test(kite.join(' ')),
    beginnerFriendly: /prime place to learn/i.test(kite.join(' ')),
    includedServices: ['Breakfast, lunch and dinner', 'Taxes and service charges'],
    optionalServices: [
      'Kite lessons (Duotone Pro Center)',
      'Kite equipment rental (Duotone / ION)',
      'Kite shop (new and second-hand gear)',
      'Kite trips to lagoon spots, wave riding and downwinders',
      transfer ? `Airport transfer (${transfer.replace(/\s+/g, ' ')})` : 'Airport transfer',
      'Massage and yoga',
    ],
    accommodation: 'tropical cabanas, rooms and jungalow suites around a pool',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: contentRooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null, // home video is an HLS stream (m3u8), not a file
    sourceUrl: RK_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `stay: ${stay}`,
      `rooms: ${rooms.map(r => `${r.name}: ${r.descriptions.join(' ')} | ${r.features.join(', ')} | ${r.rates.map(x => `${x.occupancy}p ${x.amount} ${x.currency}`).join(', ')}`).join('\n')}`,
      `kite: ${kite.join(' | ')}`,
      `school: ${school ?? '-'}`,
      `info: ${[transfer, checkIn].filter(Boolean).join(' | ')}`,
      `maps pin: ${pin ? `${pin[1]},${pin[2]}` : '-'}`,
      `site activity: home video uploaded ${String(video?.uploadDate ?? '-')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const rascalsKiteResortKalpitiya: OfferAdapter = {
  key: 'rascals-kite-resort-kalpitiya',
  name: 'The Rascals Kite Resort Kalpitiya',
  kind: 'accommodation',
  operator: {
    name: 'The Rascals Kite Resort',
    websiteUrl: SITE,
    rootDomain: 'rascalskiteresort.com',
    contactEmail: 'info@rascalskiteresort.com',
    phone: '+94710107634',
  },
  url: RK_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 6,
  confidence: 'medium', // no year on the site; operation inferred from 2026 site edits
  async fetchContent() {
    const [home, stay, rooms, kite, info] = [
      await fetchText(RK_HOME_URL, { accept: 'text/html' }),
      await fetchText(RK_STAY_URL, { accept: 'text/html' }),
      await fetchText(RK_ROOMS_URL, { accept: 'text/html' }),
      await fetchText(RK_KITE_URL, { accept: 'text/html' }),
      await fetchText(RK_INFO_URL, { accept: 'text/html' }),
    ];
    return parseRascalsContent({ home, stay, rooms, kite, info });
  },
  async fetchSlots() {
    const rooms = parseRkRooms(await fetchText(RK_ROOMS_URL, { accept: 'text/html' }));
    const slots = buildRkSlots(rooms);
    if (rooms.length < 3 || slots.length < 6) throw new Error(`rascals: room rate blocks not found or changed (${rooms.length} rooms, ${slots.length} rates)`);
    return slots;
  },
};
