// ---------------------------------------------------------------------------
// Praseban Resort, Pak Nam Pran (Pranburi, Prachuap Khiri Khan, Thailand) - small beachfront resort (14 rooms and
// villas, Thai-Balinese style, pool, Kanang Sari restaurant) on the Pranburi kite beach. No own kite school: the
// resort hosts kiters explicitly (a /kitesurfing/ page "beachfront rooms and villas that puts you right in the middle
// of the action", with the two wind seasons) and its reception arranges "kitesurfing lessons and rentals ... with top
// local schools near the resort" (/resort-directory/activities/). Found via a former bstoked listing - bstoked is a
// hint only, nothing is read from it.
//
// Data path (checked 2026-10-12): WordPress (Elementor), English only.
//   content  / (resort, rooms count, footer address/phone, Google Maps embed), /kitesurfing/ (seasons),
//            /resort-directory/activities/ (kite lessons and rental via reception), /resort-directory/
//            resort-information/ (pool, check-out, laundry), /rooms/ (7 room types) + the 7 room pages
//            (/rooms/<slug>/: description, "Room Information" size / bedrooms / beds / floor, amenities),
//            /stay-offers/costal-living-monthly-stay/ (monthly stay, breakfast at the Kanang Sari restaurant).
//   slots    none: the site prints no room prices. "BOOK NOW" opens the Cloudbeds engine
//            (hotels.cloudbeds.com/en/reservation/y3WYrT), whose /booking/* endpoints answer 403 to non-browser
//            clients (known, see keros-blue-limnos) -> not tried. fetchSlots returns [] ("price on request") without
//            a request.
// Liveness (rule 5b, Aaron 2026-10-12): wp-sitemap lastmod 2026-09-22 (/resort-directory/travel/), 2026-09-17 (home and
//   /kanangsari-menu/), 2026-02-15 (/stay-offers/, monthly-stay offer "available year round"); footer "(c)2026".
// robots.txt (2026-10-12): disallows only /wp-admin/ (admin-ajax allowed).
// Requests per run: content 13, slots 0.
// Map pin: the site's own Google Maps embed for "Praseban Resort" (!3d12.3482028 !2d99.9973775).
// Known limits: the /kitesurfing/ page itself was last edited 2024-05-23 (still in the sitemap, not in the menu); the
//   2025-10-19 activities page carries the current kite statement. Stock photos (pexels-*) are not used.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://prasebanresort.com';
export const PSB_HOME_URL = `${SITE}/`;
export const PSB_KITE_URL = `${SITE}/kitesurfing/`;
export const PSB_ACTIVITIES_URL = `${SITE}/resort-directory/activities/`;
export const PSB_INFO_URL = `${SITE}/resort-directory/resort-information/`;
export const PSB_ROOMS_URL = `${SITE}/rooms/`;
export const PSB_MONTHLY_URL = `${SITE}/stay-offers/costal-living-monthly-stay/`;
const BOOKING_URL = 'https://hotels.cloudbeds.com/en/reservation/y3WYrT/';

export interface PsbRoom { slug: string; name: string; description: string | null; info: string[]; amenities: string[] }

// --- memoised page fetch ----------------------------------------------------------------------------
const pageCache = new Map<string, Promise<string>>();
function page(url: string): Promise<string> {
  if (!pageCache.has(url)) {
    const p = fetchText(url, { accept: 'text/html' });
    p.catch(() => pageCache.delete(url));
    pageCache.set(url, p);
  }
  return pageCache.get(url)!;
}

/** Visible text split at block tags; header/nav/footer dropped (the footer is read separately). */
export function psbLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|select|svg|header|footer|nav|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|button)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}
const psbText = (html: string): string => psbLines(html).join(' ');

// --- pure parsers -------------------------------------------------------------------------------------
/** /rooms/: the room page links in page order. */
export function parsePsbRoomLinks(html: string): Array<{ slug: string; url: string }> {
  const out: Array<{ slug: string; url: string }> = [];
  for (const m of html.matchAll(/href="(https:\/\/prasebanresort\.com\/rooms\/([a-z0-9-]+)\/)"/g)) {
    if (!out.some(r => r.slug === m[2])) out.push({ slug: m[2], url: m[1] });
  }
  return out;
}

/** Room page: name (<h1>-like first line), description, "Room Information" lines, amenities. */
export function parsePsbRoom(html: string, slug: string): PsbRoom {
  const ls = psbLines(html).filter(l => !/Skip to content$/.test(l));
  const infoAt = ls.indexOf('Room Information');
  const amenAt = ls.indexOf('Room Features & Amenities');
  const name = ls[0] ?? slug;
  const description = ls[1] && ls[1] !== 'More Details' ? ls[1] : null;
  const info = infoAt >= 0 && amenAt > infoAt ? ls.slice(infoAt + 1, amenAt) : [];
  const amenities = amenAt >= 0 ? ls.slice(amenAt + 1).filter(l => l.length < 60 && !/^(Check In|Check Out|BOOK NOW|More Details)$/i.test(l)) : [];
  return { slug, name, description, info, amenities };
}

/** Google Maps embed of the resort: !2d<lng>!3d<lat>. */
export function parsePsbCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/google\.com\/maps\/embed\?pb=[^"]*?!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)[^"]*Praseban/i);
  return m ? { lat: Number(m[2]), lng: Number(m[1]) } : null;
}

/** Footer address ("173 Moo 4 Paknampran, Pranburi, Prachuab-kiri khan 77220, Thailand."). */
export function parsePsbAddress(html: string): string | null {
  const t = collapse(parse(html).text);
  return t.match(/PRASEBAN RESORT\s+(\d+ Moo \d+[^.]*Thailand)/i)?.[1] ?? null;
}

/** Best photo per base name: original file over the .webp copy over the largest size variant. */
export function psbImages(urls: string[]): string[] {
  const best = new Map<string, { url: string; score: number }>();
  const order: string[] = [];
  for (const u of urls) {
    if (/praseban\.png|FavLogo|logo|pexels-|thumb-|\.svg/i.test(u)) continue;
    const bare = u.replace(/\?.*$/, '');
    const size = bare.match(/-(\d+)x\d+(?=\.(?:jpe?g|png)(?:\.webp)?$)/i);
    // one key per photo: drop the WordPress size suffix, the .webp copy, "-scaled" and the "-e<timestamp>" edit marker
    const key = bare.replace(/(\.(?:jpe?g|png))\.webp$/i, '$1').replace(/-\d+x\d+(?=\.(?:jpe?g|png)$)/i, '')
      .replace(/-e\d{10,}(?=\.)/, '').replace(/-scaled(?=\.)/, '');
    const score = size ? Number(size[1]) : /\.webp$/i.test(bare) ? 9000 : bare !== u ? 9500 : 10000;
    const had = best.get(key);
    if (!had) { best.set(key, { url: u, score }); order.push(key); }
    else if (score > had.score) best.set(key, { url: u, score });
  }
  return order.map(k => best.get(k)!.url);
}

export interface PsbPages { home: string; kite: string; activities: string; info: string; rooms: string; monthly: string; roomPages: Record<string, string> }

export function parsePrasebanContent(p: PsbPages): OfferContent {
  const home = psbText(p.home);
  const kite = psbText(p.kite);
  const act = psbText(p.activities);
  const info = psbText(p.info);
  const roomsIntro = psbText(p.rooms);
  const links = parsePsbRoomLinks(p.rooms);
  const rooms = links.filter(l => p.roomPages[l.slug]).map(l => parsePsbRoom(p.roomPages[l.slug], l.slug));
  const nRooms = home.match(/offers you (\d+) exclusively decorated/i)?.[1] ?? roomsIntro.match(/offers you (\d+) exclusively/i)?.[1] ?? null;
  const kiteSchools = act.match(/Kitesurfing (Whether you[^.]*\.)/)?.[1] ?? null;
  const winter = /November\s*[–-]\s*January Strong winds and big waves/i.test(kite);
  const spring = /February\s*[–-]\s*April\s*The best season of the year/i.test(kite);
  const address = parsePsbAddress(p.home);
  const monthly = psbText(p.monthly);
  const restaurant = monthly.match(/breakfast at ([A-Z][a-z]+ [A-Z][a-z]+) restaurant/)?.[1] ?? null;
  const minMonthly = monthly.match(/minimum stay of (\d+) nights/i)?.[1] ?? null;

  const contentRooms: ContentRoom[] = rooms.map(r => ({ name: r.name, description: r.description, features: [...r.info, ...r.amenities] }));

  const imageUrls = psbImages([
    ...imageCandidates(p.home, PSB_HOME_URL, null, 30),
    ...imageCandidates(p.rooms, PSB_ROOMS_URL, null, 30),
    ...links.flatMap(l => (p.roomPages[l.slug] ? imageCandidates(p.roomPages[l.slug], l.url, null, 20) : [])),
    ...imageCandidates(p.kite, PSB_KITE_URL, null, 10),
  ]);

  const summary = [
    `Praseban Resort is a small beachfront resort in Pak Nam Pran (Pranburi), south of Hua Hin in Thailand, with ${nRooms ?? '14'} Thai-Balinese style rooms and villas a few steps from the beach, a pool and ${restaurant ? `the ${restaurant} restaurant` : 'a restaurant'}.`,
    `It has no own kite school; it presents its beachfront rooms to kiters and its reception arranges kite lessons and rental with local schools near the resort.`,
    winter && spring ? 'November to January brings strong wind and bigger waves for experienced riders; February to April, which the resort calls the best season of the year, has warm, steady wind and flat water for beginners and advanced riders.' : '',
    'Bookings go through the resort\'s online booking engine; the site publishes no room prices.',
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Praseban Resort',
    summary,
    continent: 'Asia',
    country: 'Thailand',
    region: 'Prachuap Khiri Khan',
    spot: 'Pak Nam Pran, Pranburi',
    spotCoords: parsePsbCoords(p.home),
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // "Ideal for both beginners and experts"; Nov-Jan "suitable for more experienced riders"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: kiteSchools ? true : null,   // via local schools near the resort, not an own school
    equipmentRental: kiteSchools ? true : null,
    beginnerFriendly: /perfect kitesurfing conditions for both beginners/i.test(kite) ? true : null,
    includedServices: ['Swimming pool', 'Wi-Fi', 'Complimentary bicycles', 'Water, tea and coffee replenished daily'],
    optionalServices: [
      'Kite lessons and rental with local schools near the resort (arranged by reception)',
      restaurant ? `${restaurant} restaurant` : 'Restaurant',
      'Water activities on the beach (banana boat, jet ski)',
      'Massage',
      'Vehicle rental',
      'Laundry service',
      ...(minMonthly ? [`Monthly stay offer (minimum ${minMonthly} nights, daily breakfast, housekeeping 3 times a week)`] : []),
    ],
    accommodation: 'beachfront rooms, suites and villas',
    mealPlan: null, // the site does not say what a standard rate includes
    languages: [],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 40),
    heroVideoUrl: null,
    sourceUrl: PSB_KITE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home}`,
      `address: ${address ?? '?'}`,
      `kitesurfing: ${kite}`,
      `activities: ${act}`,
      `resort information: ${info}`,
      `rooms: ${roomsIntro}`,
      `monthly stay offer: ${monthly}`,
      ...rooms.map(r => `${r.name}: ${r.description ?? ''} | ${r.info.join('; ')} | ${r.amenities.join(', ')}`),
    ].join('\n'),
  };
}

export const prasebanResortPakNamPran: OfferAdapter = {
  key: 'praseban-resort-pak-nam-pran',
  name: 'Praseban Resort (Pak Nam Pran)',
  kind: 'accommodation',
  operator: {
    name: 'Praseban Resort',
    websiteUrl: SITE,
    rootDomain: 'prasebanresort.com',
    contactEmail: 'sales@prasebanresort.com', // footer, 2026-10-12
    whatsapp: '+66863321216',                 // home footer "Phone & WhatsApps +66 86 332 1216"
    phone: '+6632630590',                     // other pages' footer "Tel: +66 32 630 590"
  },
  url: PSB_KITE_URL,
  slotMethod: 'price_table', // no prices on the site, Cloudbeds /booking/* blocked: always [] (price on request)
  instantBooking: true,
  fetchBudget: 13,
  confidence: 'medium',
  async fetchContent() {
    const home = await page(PSB_HOME_URL);
    const kite = await page(PSB_KITE_URL);
    const activities = await page(PSB_ACTIVITIES_URL);
    const info = await page(PSB_INFO_URL);
    const rooms = await page(PSB_ROOMS_URL);
    const monthly = await page(PSB_MONTHLY_URL);
    const roomPages: Record<string, string> = {};
    for (const l of parsePsbRoomLinks(rooms)) roomPages[l.slug] = await page(l.url);
    return parsePrasebanContent({ home, kite, activities, info, rooms, monthly, roomPages });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    ctx.note('no prices on prasebanresort.com; the Cloudbeds engine (/booking/*) answers 403 to non-browser clients: price on request');
    return [];
  },
};
