// ---------------------------------------------------------------------------
// New Spirit Dakhla, Dakhla Lagoon West (Morocco) - bungalow hotel (31 chalets in three categories) with full
// board and its own Kitesurf & Wingfoil Center "powered by KBC World" on the hotel's private lagoon beach.
//
// Data path (checked 2026-10-12), Wix site www.newspiritdakhla.com:
//   content  / (notice board, bungalow cards, "Hotel Facts" with chalet counts, services, contacts; the Wix
//            business-location coordinates sit in the page's site model script) and /kitesurf (VDWS-certified
//            teaching, F-ONE equipment, course and package prices in EUR).
//   slots    none. The site prints no room prices. Hotel booking runs on HotelRunner
//            (dakhla-spirit.hotelrunner.com/bv3/search, an Angular app): its JSON API
//            (/api/v1/bv3/search/availabilities.json, /calendars/occupancies.json) answered HTTP 422 to
//            stateless requests on 2026-10-12 - it needs the browser app's session handshake, which our
//            fetch layer (no cookies) does not do and which we do not emulate. Access would have to come from
//            the hotel / HotelRunner. fetchSlots therefore returns [] ("price on request") without a request.
//            (Seen in the built-in browser on 2026-10-12: rates in MAD, full board, e.g. Standard Bungalow
//            double MAD 1,900 per night, and hotel-wide availability per day for Oct/Nov 2026 - not stored.)
// robots.txt (2026-10-12): www.newspiritdakhla.com "Allow: /" (only *?lightbox= disallowed);
//   dakhla-spirit.hotelrunner.com has no robots.txt (404).
// Requests per run: content 2, slots 0.
// Known limits: no prices, no availability; the swimming pool was out of service (notice on the home page).
// Current operation 2026/27: booking engine live with Oct/Nov 2026 availability (browser check above),
//   "© 2026", and the operator's 12th Dakhla Downwind Challenge announced for 14-20 August 2027.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, meta } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.newspiritdakhla.com';
export const NS_HOME_URL = `${SITE}/`;
export const NS_KITE_URL = `${SITE}/kitesurf`;
const BOOKING_URL = 'https://dakhla-spirit.hotelrunner.com/bv3/search';
const WIX_OWNER = 'f417d2';

/** Visible text split at block tags (Wix rich text: one entry per paragraph / span). */
export function nsLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|select|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|span|a|button)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')).replace(/[​ ]/g, ' ').trim())
    .filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
/** Bungalow cards: name, "available as ..." line, description, features, until "Book Now". */
export function parseNsBungalows(html: string): ContentRoom[] {
  const ls = nsLines(html);
  const out: ContentRoom[] = [];
  for (let i = 0; i < ls.length - 1; i++) {
    if (!/^available (as|with) /i.test(ls[i + 1]) || ls[i].length > 30) continue;
    const room: ContentRoom = { name: ls[i], description: null, features: [ls[i + 1]] };
    for (let j = i + 2; j < ls.length && !/^Book Now$/i.test(ls[j]); j++) {
      if (ls[j].length > 60 && !room.description) room.description = ls[j];
      else if (ls[j].length > 60) room.description += ` ${ls[j]}`;
      else room.features.push(ls[j]);
    }
    if (!out.some(r => r.name === room.name)) out.push(room);
  }
  return out;
}

/** "Hotel Facts": chalet counts per category ("17 Standard Chalets for up to 2 guests", ...). */
export function parseNsCounts(html: string): { total: number | null; byCategory: Record<string, number> } {
  const t = nsLines(html).join(' ').replace(/\s+/g, ' ');
  const total = t.match(/(\d+) cozy chalets/i)?.[1];
  const byCategory: Record<string, number> = {};
  for (const m of t.matchAll(/(\d+) (Standard|Deluxe|Premium Sea View) Chalets?/gi)) {
    const k = m[2].replace(/ Sea View/i, '');
    byCategory[k] = (byCategory[k] ?? 0) + Number(m[1]);
  }
  return { total: total ? Number(total) : null, byCategory };
}

/** Course / package price lines on /kitesurf ("Kitesurf Basic Course 8h" + "450 €"). */
export function parseNsKitePrices(html: string): Array<{ item: string; amount: number }> {
  const ls = nsLines(html);
  const out: Array<{ item: string; amount: number }> = [];
  for (let i = 1; i < ls.length; i++) {
    const m = ls[i].match(/^(\d[\d.,]*)\s*€$/);
    if (!m || /€/.test(ls[i - 1])) continue;
    const amount = Number(m[1].replace(/[.,](?=\d{3}$)/, '').replace(',', '.'));
    if (amount > 0 && !out.some(x => x.item === ls[i - 1])) out.push({ item: ls[i - 1], amount });
  }
  return out;
}

/** Owner photos from Wix <img> tags (original size), skipping PNG graphics. */
export function nsImages(html: string): string[] {
  const out: string[] = [];
  const og = meta(html, 'og:image');
  for (const src of [og ?? '', ...[...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1])]) {
    const id = src.replace(/%7E/gi, '~').match(new RegExp(`${WIX_OWNER}_[0-9a-f]{32}~mv2\\.(?:jpe?g|webp)`, 'i'))?.[0];
    if (!id) continue;
    const u = `https://static.wixstatic.com/media/${id}`;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export interface NsPages { home: string; kite: string }

export function parseNewSpiritContent(p: NsPages): OfferContent {
  const home = nsLines(p.home);
  const kite = nsLines(p.kite);
  const counts = parseNsCounts(p.home);
  const prices = parseNsKitePrices(p.kite);
  const coords = p.home.match(/"businessLocationCoordinates":\{"latitude":(-?\d+\.\d+),"longitude":(-?\d+\.\d+)\}/);
  const poolNotice = home.find(l => /swimming pool is currently out of service/i.test(l)) ?? null;
  const dwc = home.find(l => /Stay tuned for the \d+\w* Dakhla Downwind Challenge/i.test(l)) ?? null;
  const rooms = parseNsBungalows(p.home).map(r => {
    const n = counts.byCategory[r.name.replace(/ Seaview$/i, '')];
    return { ...r, description: [n ? `${n} chalets.` : null, r.description].filter(Boolean).join(' ') || null };
  });
  const basic = prices.find(x => /^Kitesurf Basic Course/i.test(x.item));
  const priv = prices.find(x => /^2h Kitesurf Private Training$/i.test(x.item));
  const imgs: string[] = [];
  for (const html of [p.home, p.kite]) for (const u of nsImages(html)) if (!imgs.includes(u)) imgs.push(u);

  const summary = [
    `New Spirit Dakhla is a bungalow hotel on a terraced hillside on the north-west side of the Dakhla Lagoon in southern Morocco, with ${counts.total ?? 31} chalets in three categories (Standard, Deluxe and Premium Sea View, 12-13 m²) and full board included.`,
    'Its own Kitesurf & Wingfoil Center, powered by KBC World, sits on the hotel\'s private sandy beach with a shallow zone at low tide; the lagoon offers flat, sheltered water.',
    `The center teaches with VDWS-certified instructors and F-ONE equipment${basic ? ` (basic course 8 h EUR ${basic.amount})` : ''}, rents equipment and stores guests' gear; the airport transfer is included.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'New Spirit Dakhla',
    summary,
    continent: 'Africa',
    country: 'Morocco',
    region: 'Dakhla-Oued Ed-Dahab',
    spot: 'Dakhla Lagoon',
    spotCoords: coords ? { lat: Number(coords[1]), lng: Number(coords[2]) } : null, // Wix business location of the site
    itinerarySpots: [],
    durationDays: null,
    // kite page: "ideal conditions for riders of all levels"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: kite.some(l => /Kitesurf Courses/i.test(l)),
    equipmentRental: kite.some(l => /rental/i.test(l)),
    beginnerFriendly: kite.some(l => /^Beginner$/i.test(l)),
    includedServices: ['Full board (buffet breakfast, lunch, dinner; table water)', 'Airport transfer (about 30 minutes)', 'Wi-Fi'],
    optionalServices: [
      basic ? `Kitesurf courses (VDWS; basic course 8 h EUR ${basic.amount}, course + rental packages)` : 'Kitesurf courses (VDWS)',
      priv ? `Private kite training (2 h EUR ${priv.amount})` : 'Private kite training',
      'Kite and wingfoil equipment rental (F-ONE)', 'Supervised gear storage at the water sports center', 'Wingfoil and pocket wing courses',
    ],
    accommodation: 'bungalow chalets (Standard, Deluxe, Premium Sea View)',
    mealPlan: 'full_board',
    languages: ['en', 'de', 'fr', 'es'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: NS_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home.filter(l => l.length > 2 && !/^Click here$/i.test(l)).join(' | ')}`,
      `kite: ${kite.filter(l => l.length > 2).join(' | ')}`,
      `kite prices: ${prices.map(x => `${x.item} ${x.amount} EUR`).join('; ')}`,
      `notice: ${poolNotice ?? '-'}`,
      `operator event: ${dwc ?? '-'}`,
      `coords (Wix business location): ${coords ? `${coords[1]},${coords[2]}` : '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const newSpiritDakhla: OfferAdapter = {
  key: 'new-spirit-dakhla',
  name: 'New Spirit Dakhla',
  kind: 'accommodation',
  operator: {
    name: 'New Spirit Dakhla',
    websiteUrl: SITE,
    rootDomain: 'newspiritdakhla.com',
    contactEmail: 'booking@NewSpiritDakhla.com',
    whatsapp: '+212661909841',
    phone: '+212661909841',
  },
  url: NS_HOME_URL,
  slotMethod: 'booking_engine',
  fetchBudget: 2,
  confidence: 'low', // no prices or availability readable (HotelRunner API needs a browser session)
  async fetchContent() {
    const [home, kite] = [
      await fetchText(NS_HOME_URL, { accept: 'text/html' }),
      await fetchText(NS_KITE_URL, { accept: 'text/html' }),
    ];
    return parseNewSpiritContent({ home, kite });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    ctx.note('new-spirit-dakhla: no room prices on the site; the HotelRunner API needs a browser session (HTTP 422 stateless, 2026-10-12) - price on request');
    return [];
  },
};
