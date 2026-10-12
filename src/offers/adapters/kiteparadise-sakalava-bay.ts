// ---------------------------------------------------------------------------
// KiteParadise Madagascar, Sakalava Bay near Diego Suarez (Antsiranana, Madagascar) - kite, windsurf and wing foil
// hotel on the beach facing the Sakalava sand bar (flat spot in front of the rooms, reef waves 600 m out) with its
// own kite & windsurf school (Reedin / Ozone gear, rental), Paradise Lounge, restaurant-pizzeria, gym; 11 units in
// four types (Chameleon Suites, Baobab Suites, Zebu Bungalows, Maki A-frame bungalows), breakfast included, kite
// storage. A different property from Sakalava Lodge (sakalava.com, adapter sakalava-lodge-diego-suarez). Found via a
// former bstoked listing - bstoked is a hint only, nothing is read from it.
//
// Data path (checked 2026-10-12): Squarespace site, English pages (the French ones carry the same content).
//   content  /home (hotel, season, spot), /accommodation (room overview, what the price includes), /kitespot (wind
//            by month), /kiteschool (lessons, rental), /faq (opening, capacity, deposit) + the four room pages.
//   slots    the four room pages (/chameleon-suite, /baobab-suite, /zebu-bungalow, /maki-bungalow): "PRICE - 75€",
//            "Price for 2 guests, including breakfasts", "15€ per additional guest", "Maximum 3 guests". No dates,
//            no season prices, no engine: a Squarespace booking form, e-mail or WhatsApp -> 'on_request'.
// ASSUMPTION per_night: no page prints the price unit ("PRICE - 75€ / Price for 2 guests, including breakfasts").
//   Stored as EUR per room per night because breakfasts are "included in your room' price", the FAQ's cancellation
//   rules count "the nights you cancelled" and the hotel is "open all year round" without season prices. Hence
//   confidence 'medium'.
// Liveness (rule 5b, Aaron 2026-10-12): sitemap.xml lastmod 2026-08-19 (/faq), 2026-07-09 (/maki-bungalow),
//   2026-06-06 (menus), 2026-04-10 (/explore), 2026-03-12 (/zebu-bungalow); kite school gear "Reedin 2024 and
//   Ozone 2025".
// robots.txt (2026-10-12): Squarespace default - one group for "*" (and a list of AI crawlers) disallowing /config,
//   /search, /account, /api/, /static/ and ?format=json / ?view= style queries; the plain pages are allowed.
// Requests per run: content 9 (room pages memoised), slots 4.
// Map pin: the site's own Squarespace location (mapLat/mapLng in the page context, "KiteParadise Madagascar, Sakalava
//   Bay, Antsiranana Province"); the place link in the announcement bar (!3d-12.2679669!4d49.3912102) is ~130 m away.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kiteparadise-madagascar.com';
export const KP_HOME_URL = `${SITE}/home`;
export const KP_ACCOMMODATION_URL = `${SITE}/accommodation`;
export const KP_SPOT_URL = `${SITE}/kitespot`;
export const KP_SCHOOL_URL = `${SITE}/kiteschool`;
export const KP_FAQ_URL = `${SITE}/faq`;
export const KP_ROOMS: Array<{ slug: string; name: string }> = [
  { slug: 'chameleon-suite', name: 'Chameleon Suite' },
  { slug: 'baobab-suite', name: 'Baobab Suite' },
  { slug: 'zebu-bungalow', name: 'Zebu Bungalow' },
  { slug: 'maki-bungalow', name: 'Maki Bungalow' },
];
export const kpRoomUrl = (slug: string): string => `${SITE}/${slug}`;

export interface KpRoom {
  slug: string;
  name: string;
  description: string | null;
  features: string[];
  price: number | null;
  guests: number | null;
  extraGuest: number | null;
  minGuests: number | null;
  maxGuests: number | null;
  priceText: string | null;
}

// --- memoised page fetch (content and slots share the room pages) ------------------------------------
const pageCache = new Map<string, Promise<string>>();
function page(url: string): Promise<string> {
  if (!pageCache.has(url)) {
    const p = fetchText(url, { accept: 'text/html' });
    p.catch(() => pageCache.delete(url));
    pageCache.set(url, p);
  }
  return pageCache.get(url)!;
}

/** Visible text split at block tags (one entry per heading / paragraph / list item). */
export function kpLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|select|svg|header|footer|nav)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|button)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}
const kpText = (html: string): string => kpLines(html).join(' ');

// --- pure parsers -------------------------------------------------------------------------------------
/** One room page: description, size/bed lines, "PRICE - 75€", "Price for 2 guests", extra guest, min/max. */
export function parseKpRoom(html: string, slug: string, name: string): KpRoom {
  const ls = kpLines(html);
  const sizeAt = ls.findIndex(l => /^Size\s*:/i.test(l));
  const priceAt = ls.findIndex(l => /^PRICE\s*-\s*\d/i.test(l));
  const description = (sizeAt > 0 ? ls.slice(0, sizeAt) : []).filter(l => l.length > 80 && !/—/.test(l)).join(' ') || null;
  const features = sizeAt >= 0 && priceAt > sizeAt ? ls.slice(sizeAt, priceAt).map(l => l.replace(/\s*!$/, '')) : [];
  const after = priceAt >= 0 ? ls.slice(priceAt, priceAt + 6).join(' ') : '';
  const num = (re: RegExp): number | null => { const m = after.match(re); return m ? Number(m[1]) : null; };
  return {
    slug,
    name,
    description,
    features,
    price: priceAt >= 0 ? parseAmount(ls[priceAt].replace(/^PRICE\s*-\s*/i, '')) : null,
    guests: num(/Prices?\s+(?:is\s+)?for\s+(\d+)\s+guests/i),
    extraGuest: num(/(\d+)\s*€\s*per additional guest/i),
    minGuests: num(/Minimum:?\s*(\d+)\s*guests/i),
    maxGuests: num(/Maximum:?\s*(\d+)\s*guests/i),
    priceText: priceAt >= 0 ? ls.slice(priceAt, priceAt + 2).join(' / ') : null,
  };
}

export function buildKpSlots(rooms: KpRoom[]): Slot[] {
  const out: Slot[] = [];
  for (const r of rooms) {
    if (r.price === null || r.guests === null) continue;
    out.push({
      key: `${r.slug}|${r.guests}p`,
      startDate: null,
      endDate: null,
      unit: `${r.name} (${r.guests} guests, breakfast)`,
      price: r.price,
      currency: 'EUR',
      priceUnit: 'per_night', // assumption, see header: the site prints no unit
      priceBasis: 'room',
      occupancy: r.guests,
      availability: 'on_request',
      availabilityText: 'booking form, e-mail or WhatsApp; 50% deposit to confirm',
      spotsLeft: null,
    });
  }
  return out;
}

/** Squarespace website location (mapLat / mapLng) from the page context. */
export function parseKpCoords(html: string): { lat: number; lng: number } | null {
  const lat = html.match(/"mapLat":(-?\d+\.\d+)/)?.[1];
  const lng = html.match(/"mapLng":(-?\d+\.\d+)/)?.[1];
  return lat && lng ? { lat: Number(lat), lng: Number(lng) } : null;
}

export interface KpPages { home: string; accommodation: string; spot: string; school: string; faq: string; rooms: Record<string, string> }

export function parseKiteParadiseContent(p: KpPages): OfferContent {
  const home = kpText(p.home);
  const acc = kpText(p.accommodation);
  const spot = kpText(p.spot);
  const school = kpText(p.school);
  const faq = kpText(p.faq);
  const rooms = KP_ROOMS.filter(r => p.rooms[r.slug]).map(r => parseKpRoom(p.rooms[r.slug], r.slug, r.name));

  const capacity = faq.match(/accommodate (\d+) people maximum in (\d+) rooms/i);
  const gear = school.match(/Brand new gear\s*:\s*([^!]+?)!/i)?.[1] ?? null;
  const lesson = school.match(/PRIVATE LESSONS.*?01 h -- (\d+)€/i)?.[1] ?? null;
  const rentDay = school.match(/FULL EQUIPMENT.*?Full day -- (\d+)€/i)?.[1] ?? null;
  const rentWeek = school.match(/FULL EQUIPMENT.*?7 days -- (\d+)€/i)?.[1] ?? null;
  const own = /cannot accept accommodation reservations for people taking lessons or renting their equipment from another establishment/i.test(school);
  const peaks = /peaks between June and September/i.test(spot);
  const prices = rooms.filter(r => r.price !== null);
  const minPrice = prices.length ? Math.min(...prices.map(r => r.price!)) : null;

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: r.description,
    features: [
      ...r.features,
      ...(r.price !== null && r.guests ? [`EUR ${r.price} for ${r.guests} guests incl. breakfast (unit not printed, read as per night)`] : []),
      ...(r.extraGuest ? [`EUR ${r.extraGuest} per additional guest`] : []),
      ...(r.minGuests ? [`Minimum ${r.minGuests} guests`] : []),
      ...(r.maxGuests ? [`Maximum ${r.maxGuests} guests`] : []),
    ],
  }));

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of [
    ...imageCandidates(p.home, KP_HOME_URL, null, 40),
    ...imageCandidates(p.accommodation, KP_ACCOMMODATION_URL, null, 40),
    ...KP_ROOMS.flatMap(r => (p.rooms[r.slug] ? imageCandidates(p.rooms[r.slug], kpRoomUrl(r.slug), null, 30) : [])),
    ...imageCandidates(p.spot, KP_SPOT_URL, null, 20),
    ...imageCandidates(p.school, KP_SCHOOL_URL, null, 20),
  ]) {
    if (/logo|artboard|static1\.squarespace\.com|\.svg|\.gif/i.test(u)) continue;
    const k = u.replace(/\?.*$/, '');
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }

  const summary = [
    `KiteParadise Madagascar is a kite, windsurf and wing foil hotel on the beach of Sakalava Bay in northern Madagascar, 20 km from Diego Suarez, facing the bay's sand bar: the flat-water spot is in front of the rooms and reef waves break about 600 m out.`,
    `Its own kite and windsurf school${gear ? ` (${gear.replace(/\s+/g, ' ').trim()} gear)` : ''} offers lessons and rental${own ? ', and guests who take lessons or rent gear must do so with the in-house school' : ''}.`,
    `${capacity ? `The ${capacity[2]} units` : 'The units'} are Chameleon family suites, Baobab suites, Zebu bungalows and Maki A-frame bungalows (the Makis share two bathrooms); breakfast and kite storage are included${minPrice !== null ? `, from EUR ${minPrice} for two guests` : ''}, other meals are à la carte.`,
    `The wind season runs from mid-March to mid-December${peaks ? ', strongest from June to September' : ''}; the hotel is open all year.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'KiteParadise Madagascar',
    summary,
    continent: 'Africa',
    country: 'Madagascar',
    region: 'Diana (Diego Suarez)',
    spot: 'Sakalava Bay',
    spotCoords: parseKpCoords(p.home),
    itinerarySpots: [],
    durationDays: null,
    // "this is the perfect spot for beginners" (/kitespot); private lessons "BEGINNER OR ADVANCED"; freestyle / wave / foil coaching
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /KITESURFING SCHOOL/i.test(school),
    equipmentRental: /EQUIPMENT AND GEARS RENTAL/i.test(school),
    beginnerFriendly: /perfect spot for (learning|beginners)/i.test(spot),
    includedServices: ['Breakfast', 'Towels and bed linen', 'Kite storage', 'Wi-Fi (Starlink)', 'Gym and massage room access'],
    optionalServices: [
      lesson ? `Private kite lessons (beginner or advanced): EUR ${lesson} per hour, gear included` : 'Kite lessons',
      rentDay ? `Kite rental (full equipment): EUR ${rentDay} per day${rentWeek ? `, EUR ${rentWeek} per 7 days` : ''}` : 'Kite rental',
      'Windsurf lessons and rental',
      'Assistance for riders who cannot yet go upwind',
      'Restaurant and pizzeria (à la carte, no board plans)',
      'Laundry service',
      'Massages',
      'Airport pick-up in Diego Suarez',
    ],
    accommodation: 'beachfront suites and bungalows, A-frame bungalows facing the forest',
    mealPlan: 'breakfast',
    languages: /French and English-speaking instructors/i.test(school) ? ['fr', 'en'] : [],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 40),
    heroVideoUrl: null,
    sourceUrl: KP_ACCOMMODATION_URL,
    bookingUrl: kpRoomUrl('zebu-bungalow'),
    sourceText: [
      `home: ${home}`,
      `accommodation: ${acc}`,
      ...rooms.map(r => `${r.name}: ${r.description ?? ''} | ${r.features.join('; ')} | ${r.priceText ?? 'no price'} | extra guest ${r.extraGuest ?? '?'} | min ${r.minGuests ?? '-'} max ${r.maxGuests ?? '?'}`),
      `kitespot: ${spot}`,
      `kiteschool: ${school}`,
      `faq: ${faq}`,
    ].join('\n'),
  };
}

export const kiteparadiseSakalavaBay: OfferAdapter = {
  key: 'kiteparadise-sakalava-bay',
  name: 'KiteParadise Madagascar (Sakalava Bay)',
  kind: 'accommodation',
  operator: {
    name: 'KiteParadise Madagascar',
    websiteUrl: SITE,
    rootDomain: 'kiteparadise-madagascar.com',
    contactEmail: 'info@kiteparadise-madagascar.com', // footer mailto, 2026-10-12
    whatsapp: '+261345786716',                       // footer "HOTEL BOOKINGS & INQUIRIES ... WHATSAPP"
    phone: '+261345786716',
  },
  url: KP_ACCOMMODATION_URL,
  slotMethod: 'price_table',
  fetchBudget: 9,
  confidence: 'medium',
  async fetchContent() {
    const home = await page(KP_HOME_URL);
    const accommodation = await page(KP_ACCOMMODATION_URL);
    const rooms: Record<string, string> = {};
    for (const r of KP_ROOMS) rooms[r.slug] = await page(kpRoomUrl(r.slug));
    const spot = await page(KP_SPOT_URL);
    const school = await page(KP_SCHOOL_URL);
    const faq = await page(KP_FAQ_URL);
    return parseKiteParadiseContent({ home, accommodation, spot, school, faq, rooms });
  },
  async fetchSlots(ctx) {
    const rooms: KpRoom[] = [];
    for (const r of KP_ROOMS) {
      try {
        rooms.push(parseKpRoom(await page(kpRoomUrl(r.slug)), r.slug, r.name));
      } catch (err) {
        ctx.incomplete(`room page /${r.slug} failed: ${(err as Error).message}`);
      }
    }
    for (const r of rooms) if (r.price === null || r.guests === null) ctx.note(`no "PRICE - x€ / Price for n guests" on /${r.slug}`);
    const slots = buildKpSlots(rooms);
    if (slots.length === 0) throw new Error('kiteparadise: no room price found on the room pages (layout changed?)');
    return slots;
  },
};
