// ---------------------------------------------------------------------------
// La Ventana Hotel (formerly La Ventana Hostel), La Ventana (Baja California Sur, Mexico) - small hotel since 2016,
// "10 private rooms and one shared room with 8 beds" (the site's own FAQ), community kitchen, rooftop deck with sea
// view, smoothie bar, a 5-minute walk to the beach and the main kite launch. Kite link: the site's own
// /kitesurfing page addresses kiters ("Private rooms and shared bunks for solo kiters, couples, and squads", "Book
// kite season"), the hotel "works with several reputable schools in town for IKO-certified lessons" and points
// guests to gear storage on request.
//
// Data path (checked 2026-10-14): Next.js site www.laventanahotel.mx (rebuilt from Wix, "© 2026").
//   content  / (JSON-LD Hotel with geo 24.05159187,-109.99124146, amenities; FAQ), /rooms (three room types: a meta
//            line "1 king bed · 2 guests", name, text, feature lines, "Best for", "Rate band"), /kitesurfing (season,
//            launches, kite FAQ), /gallery (photos).
//   slots    none. All rates live in Cloudbeds (hotels.cloudbeds.com/en/reservation/rmDkzN): "Cloudbeds shows live
//            rates, availability, and the exact booking policy before you confirm"; the site prints only "$" / "$$"
//            rate bands. Cloudbeds' availability call (/booking/*) answers HTTP 403 to non-browser clients (Keros
//            Blue on hotels.cloudbeds.com 2026-10-09, La Ventana Beach Resort on us2.cloudbeds.com 2026-10-14) ->
//            not used; fetchSlots returns [] ("price on request").
// robots.txt (2026-10-14): www.laventanahotel.mx allows / and disallows /api/ and /admin/ only.
// Requests per run: content 4, slots 0.
// Known limits: no prices, no availability (confidence 'low').
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, ldOfType, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';
import { unwrapNextImage } from './aqua-ventana-la-ventana.js';

const SITE = 'https://www.laventanahotel.mx';
export const LVH_HOME_URL = `${SITE}/`;
export const LVH_ROOMS_URL = `${SITE}/rooms`;
export const LVH_KITE_URL = `${SITE}/kitesurfing`;
export const LVH_GALLERY_URL = `${SITE}/gallery`;
const BOOKING_URL = 'https://hotels.cloudbeds.com/en/reservation/rmDkzN';

// --- local helpers ---------------------------------------------------------------------------
export function lvhLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, template, nav, header, footer')) el.remove();
  return root.structuredText.split('\n').map(l => collapse(l)).filter(Boolean);
}

export interface LvhHotel { geo: { lat: number; lng: number } | null; amenities: string[]; description: string | null }

export function parseLvhHotel(html: string): LvhHotel {
  const h = ldOfType(html, 'Hotel')[0];
  const g = h?.geo as Record<string, unknown> | undefined;
  const lat = Number(g?.latitude);
  const lng = Number(g?.longitude);
  return {
    geo: Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? { lat, lng } : null,
    amenities: Array.isArray(h?.amenityFeature)
      ? (h!.amenityFeature as unknown[]).map(x => (typeof x === 'string' ? x : String((x as Record<string, unknown>)?.name ?? ''))).filter(Boolean)
      : [],
    description: typeof h?.description === 'string' ? h.description : null,
  };
}

/** /rooms: "1 king bed · 2 guests" + name + text + feature lines (until "Best for") + "Rate band" words. */
export function parseLvhRooms(html: string): Array<ContentRoom & { rateBand: string | null }> {
  const lines = lvhLines(html);
  const out: Array<ContentRoom & { rateBand: string | null }> = [];
  for (let i = 0; i < lines.length - 2; i++) {
    if (!/(bed|bunk).*·/i.test(lines[i])) continue;
    const name = lines[i + 1];
    const description = lines[i + 2];
    const features: string[] = [lines[i].replace(/\s*·\s*/g, ', ')];
    let j = i + 3;
    for (; j < lines.length && !/^Best for$/i.test(lines[j]) && !/(bed|bunk).*·/i.test(lines[j]); j++) features.push(lines[j]);
    const rb = lines.findIndex((l, k) => k > j && /^Rate band$/i.test(l));
    const rateBand = rb > 0 && rb < j + 6 ? lines[rb + 1] : null;
    out.push({ name, description, features, rateBand });
    i = j;
  }
  return out;
}

// --- content -------------------------------------------------------------------------------------
export interface LvhPages { home: string; rooms: string; kite: string; gallery: string }

export function parseLvhContent(p: LvhPages): OfferContent {
  const hotel = parseLvhHotel(p.home);
  const home = lvhLines(p.home);
  const kite = lvhLines(p.kite);
  const rooms = parseLvhRooms(p.rooms);
  const homeText = home.join(' ');
  const kiteText = kite.join(' ');
  // FAQ (Spanish block on the home page): "Tenemos 10 cuartos privados y un cuarto compartido con 8 camas."
  const counts = homeText.match(/Tenemos (\d+) cuartos privados y un cuarto compartido con (\d+) camas/i);
  const iko = /schools in town for IKO-certified lessons/i.test(kiteText);
  const season = kiteText.match(/Peak El Norte season usually runs (\w+ through \w+)/i)?.[1] ?? null;

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const raw of [...imageCandidates(p.home, LVH_HOME_URL, null, 20), ...imageCandidates(p.rooms, LVH_ROOMS_URL, null, 10), ...imageCandidates(p.gallery, LVH_GALLERY_URL, null, 40)]) {
    const u = unwrapNextImage(raw);
    if (/\.svg|logo|icon|favicon/i.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u); imageUrls.push(u);
  }

  const summary = [
    `La Ventana Hotel (formerly La Ventana Hostel, open since 2016) is a small hotel in the village of La Ventana, Baja California Sur, a 5-minute walk from the beach and the main kite launch${counts ? `, with ${counts[1]} private rooms and a shared bunk room with ${counts[2]} beds` : ''}.`,
    'Guests share a full kitchen, a lounge, a rooftop deck with views over the Sea of Cortez and an on-site smoothie bar.',
    `The hotel caters to kiters in the El Norte season${season ? ` (${season.replace('through', 'to')})` : ''}${iko ? ' and works with local schools for IKO-certified lessons and gear rental' : ''}; rates are shown live in its online booking engine.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'La Ventana Hotel',
    summary,
    continent: 'North America',
    country: 'Mexico',
    region: 'La Ventana, Baja California Sur',
    spot: 'La Ventana',
    ...(hotel.geo ? { spotCoords: hotel.geo } : {}),
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: iko ? true : null,
    equipmentRental: /gear rental/i.test(kiteText) ? true : null,
    beginnerFriendly: /beginner through advanced/i.test(kiteText) ? true : null,
    includedServices: ['Free Wi-Fi', 'Community kitchen', 'Rooftop deck', 'Complimentary water', 'Coffee'],
    optionalServices: [
      ...(iko ? ['Kite lessons and gear rental through partner schools in town (IKO-certified)'] : []),
      'Airport transport, tours and lessons arranged on request',
      'Smoothie bar',
    ],
    accommodation: 'small hotel: private rooms and a shared bunk dorm',
    mealPlan: 'self_catering',
    languages: ['en', 'es'],
    rooms: rooms.map(({ rateBand, ...r }) => ({ ...r, features: [...r.features, ...(rateBand ? [`Rate band: ${rateBand.replace(/\s*[—–]\s*/g, ' - ')}`] : [])] })),
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: LVH_ROOMS_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${homeText}`,
      `amenities (JSON-LD): ${hotel.amenities.join(', ')}`,
      `rooms: ${rooms.map(r => `${r.name}: ${r.description} [${r.features.join('; ')}] rate band ${r.rateBand ?? '-'}`).join(' | ')}`,
      `kitesurfing: ${kiteText}`,
      hotel.geo ? `geo (JSON-LD): ${hotel.geo.lat},${hotel.geo.lng}` : '',
    ].filter(Boolean).join('\n'),
  };
}

export const laVentanaHotel: OfferAdapter = {
  key: 'la-ventana-hotel',
  name: 'La Ventana Hotel',
  kind: 'accommodation',
  operator: {
    name: 'La Ventana Hotel',
    websiteUrl: SITE,
    rootDomain: 'laventanahotel.mx',
    contactEmail: 'info@laventanahotel.mx',
    whatsapp: '+52 612 120 8803',
    phone: '+52 612 120 8803',
  },
  url: LVH_ROOMS_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 4,
  confidence: 'low',
  async fetchContent() {
    const home = await fetchText(LVH_HOME_URL, { accept: 'text/html' });
    const rooms = await fetchText(LVH_ROOMS_URL, { accept: 'text/html' });
    const kite = await fetchText(LVH_KITE_URL, { accept: 'text/html' });
    const gallery = await fetchText(LVH_GALLERY_URL, { accept: 'text/html' });
    return parseLvhContent({ home, rooms, kite, gallery });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    ctx.note('la-ventana-hotel: rates only in Cloudbeds (availability calls 403 to our UA); the site prints none -> price on request');
    return [];
  },
};
