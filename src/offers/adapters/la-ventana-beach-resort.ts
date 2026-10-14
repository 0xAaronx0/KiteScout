// ---------------------------------------------------------------------------
// La Ventana Beach Resort (LVBR), La Ventana (Baja California Sur, Mexico) - beachfront boutique hotel with 14 suites
// on 3 levels plus "Residential" studio suites and apartments, beach cafe-bar LAKO, dive center (Venta Dive Center)
// and the KiteMex kitesurf and wing foil school at the resort (same address, Corredor Isla Cerralvo km 7.5; the
// site's "Wind Sports" menu item links to kitemex.com, whose home page says "Kitemex at La Ventana Beach Resort").
//
// Data path (checked 2026-10-14):
//   content  www.laventanabeachresort.com (Squarespace): / (intro, services, Google Maps place link with
//            !3d24.0467991!4d-109.9883454), /beachhotel (hotel rooms: name + "Accommodates up to N people." +
//            text), /residentials (Residential "A" / "B"); the Cloudbeds engine's public JSON-LD
//            us2.cloudbeds.com/booking/metadata?property_code=bDlV7d (room types, occupancy, photos; answers 200;
//            its geo 17.19,-92.16 is wrong (Chiapas) and is not used); kitemex.com/ (the on-site kite school:
//            "KITESURF and WING FOIL SCHOOL IN LA VENTANA", "Kitemex at La Ventana Beach Resort").
//   slots    none. Booking runs through Cloudbeds (us2.cloudbeds.com/reservation/bDlV7d); its availability call
//            POST /booking/availability_calendar answered HTTP 403 to our UA (2026-10-14, one probe, same AWS block
//            as at Keros Blue) -> not used. The site prints no room rates -> fetchSlots returns [] ("price on
//            request"). KiteMex's dated camp weeks with LVBR rooms are a separate adapter (kitemex-camp-la-ventana).
// Liveness: sitemap lastmod 2026-09-02 for /beachhotel and /residentials; KiteMex camp dates Dec 2026 - Mar 2027.
// robots.txt (2026-10-14): Squarespace default (/config, /search, /account, /api, /static, ?format=json ...
//   disallowed; named AI crawlers blocked, KiteScoutBot falls under `*`); us2.cloudbeds.com disallows only
//   /booking/prepare/, /reservas/finalizando/, /widget (+ localized); kitemex.com disallows /wp-admin/.
// Requests per run: content 5, slots 0.
// Known limits: no prices, no availability (confidence 'low').
// ---------------------------------------------------------------------------
import { fetchJson, fetchText } from '../http.js';
import { collapse, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.laventanabeachresort.com';
export const LVBR_HOME_URL = `${SITE}/`;
export const LVBR_HOTEL_URL = `${SITE}/beachhotel`;
export const LVBR_RESIDENTIALS_URL = `${SITE}/residentials`;
export const LVBR_CB_METADATA_URL = 'https://us2.cloudbeds.com/booking/metadata?property_code=bDlV7d';
export const LVBR_BOOKING_URL = 'https://us2.cloudbeds.com/reservation/bDlV7d';
export const KITEMEX_HOME_URL = 'https://kitemex.com/';

// --- local helpers ---------------------------------------------------------------------------
/** Block-level text lines of a page (scripts, styles, nav and footer dropped). */
export function lvbrLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, nav, header, footer')) el.remove();
  return root.structuredText.split('\n').map(l => collapse(l)).filter(Boolean);
}

/** Coordinates of the first Google Maps place link with !3d<lat>!4d<lng> (the place pin, not the @ viewport). */
export function mapsPin(html: string): { lat: number; lng: number } | null {
  const m = html.match(/google\.[a-z.]+\/maps\/place\/[^"'\s]*?!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

export interface LvbrRoom { name: string; maxGuests: number | null; description: string }

/** /beachhotel: "<name>" + "Accommodates up to N people|guests." + description lines, until the next room. */
export function parseLvbrHotelRooms(html: string): LvbrRoom[] {
  const lines = lvbrLines(html);
  const start = lines.findIndex(l => /^Hotel Rooms and Suites$/i.test(l));
  const out: LvbrRoom[] = [];
  for (let i = Math.max(start, 0); i < lines.length; i++) {
    const acc = lines[i].match(/^Accommodates up to (\d+)/i);
    if (!acc || i === 0) continue;
    const desc: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (/^Accommodates up to/i.test(lines[j + 1] ?? '') || /^(Yoga and Movement|Mountain Biking|Spa Services|Our Services)/i.test(lines[j])) break;
      desc.push(lines[j]);
    }
    // bullet lines ("· 2 Matrimonial Beds") become a comma list, prose lines stay sentences
    const description = desc.map(d => d.replace(/^·\s*/, '')).join(desc.every(d => d.startsWith('·')) ? ', ' : ' ').trim();
    out.push({ name: lines[i - 1].replace(/\s+#\s*/, ' #'), maxGuests: Number(acc[1]), description });
    i = j - 1;
  }
  return out;
}

/** /residentials: 'Residential "A"' + description line (before "Book now"). */
export function parseLvbrResidentials(html: string): LvbrRoom[] {
  const lines = lvbrLines(html);
  const out: LvbrRoom[] = [];
  lines.forEach((l, i) => {
    const m = l.match(/^Residential\s*[“"]([A-Z])[”"]$/);
    if (m && lines[i + 1] && !/^Book now/i.test(lines[i + 1])) out.push({ name: `Residential ${m[1]}`, maxGuests: null, description: lines[i + 1] });
  });
  return out;
}

const langValue = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    const en = v.find(x => x && typeof x === 'object' && (x as Record<string, unknown>)['@language'] === 'en') ?? v[0];
    return en && typeof en === 'object' ? String((en as Record<string, unknown>)['@value'] ?? '') : String(en ?? '');
  }
  return '';
};

export interface LvbrEngine { description: string; images: string[]; rooms: Array<{ name: string; maxGuests: number | null; images: string[] }> }

/** Cloudbeds metadata JSON-LD (LodgingBusiness + containsPlace HotelRoom). */
export function parseLvbrEngine(json: unknown): LvbrEngine {
  const o = (json ?? {}) as Record<string, unknown>;
  const imgs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string') : []);
  const places = (o.containsPlace as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    description: collapse(langValue(o.description)),
    images: imgs(o.image),
    rooms: places.filter(p => p['@type'] === 'HotelRoom').map(p => ({
      name: collapse(langValue(p.name)),
      maxGuests: typeof (p.occupancy as Record<string, unknown> | undefined)?.maxValue === 'number' ? (p.occupancy as Record<string, number>).maxValue : null,
      images: imgs(p.image),
    })),
  };
}

// --- content -------------------------------------------------------------------------------------
export interface LvbrPages { home: string; hotel: string; residentials: string; engine: unknown; kitemex: string }

export function parseLvbrContent(p: LvbrPages): OfferContent {
  const home = lvbrLines(p.home);
  const hotelRooms = parseLvbrHotelRooms(p.hotel);
  const resid = parseLvbrResidentials(p.residentials);
  const engine = parseLvbrEngine(p.engine);
  const kitemex = lvbrLines(p.kitemex);
  const pin = mapsPin(p.home);
  const homeText = home.join('\n');
  const suites = homeText.match(/boutique with (\d+) suites/i)?.[1] ?? null;
  const kitemexAtResort = kitemex.some(l => /Kitemex at La Ventana Beach Resort/i.test(l));
  const kitemexSeason = kitemex.join(' ').match(/wind conditions from (\w+ to \w+)/i)?.[1] ?? null;

  const rooms: ContentRoom[] = [...hotelRooms, ...resid].map(r => ({
    name: r.name,
    description: r.description || null,
    features: r.maxGuests ? [`Up to ${r.maxGuests} guests`] : [],
  }));

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  const candidates = [
    ...imageCandidates(p.home, LVBR_HOME_URL, null, 30),
    ...imageCandidates(p.hotel, LVBR_HOTEL_URL, null, 30),
    ...imageCandidates(p.residentials, LVBR_RESIDENTIALS_URL, null, 20),
    ...engine.images,
    ...engine.rooms.flatMap(r => r.images),
  ];
  for (const u of candidates) {
    if (/\.svg|logo|IMAGOTIPO|icon|favicon|static1\.squarespace\.com/i.test(u)) continue;
    const k = u.replace(/\?.*$/, '');
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }

  const summary = [
    `La Ventana Beach Resort is a beachfront boutique hotel on La Ventana Bay (Sea of Cortez, Baja California Sur) with ${suites ?? '14'} suites on three levels, beachfront double rooms and Residential studio suites and apartments with kitchens, plus the beach cafe-bar LAKO, yoga classes and a dive center.`,
    `${kitemexAtResort ? 'The KiteMex kitesurf and wing foil school works from the resort' : 'The KiteMex kitesurf and wing foil school is linked from the site'}, with private and group lessons by certified instructors, equipment rental and jet ski support${kitemexSeason ? `; the wind season runs from ${kitemexSeason}` : ''}.`,
    'Rooms are booked through the hotel\'s online booking engine; the site prints no rates.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'La Ventana Beach Resort',
    summary,
    continent: 'North America',
    country: 'Mexico',
    region: 'La Ventana, Baja California Sur',
    spot: 'La Ventana',
    ...(pin ? { spotCoords: pin } : {}),
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: kitemex.some(l => /kitesurf|kiteboarding/i.test(l)),
    equipmentRental: kitemex.some(l => /Equipment Rental/i.test(l)),
    beginnerFriendly: true,
    includedServices: ['Wi-Fi', 'Air conditioning'],
    optionalServices: [
      'Kitesurf and wing foil lessons, rental and jet ski support (KiteMex school at the resort)',
      'Scuba diving, freediving, spearfishing and sport fishing trips',
      'Yoga and movement classes',
      'Spa services',
      'Mountain bike rental',
      'Beach cafe-bar LAKO (breakfast, lunch, dinner)',
    ],
    accommodation: 'beachfront hotel suites and residential apartments',
    mealPlan: null,
    languages: ['en', 'es'],
    rooms,
    imageUrls: imageUrls.slice(0, 40),
    heroVideoUrl: null,
    sourceUrl: LVBR_HOTEL_URL,
    bookingUrl: LVBR_BOOKING_URL,
    sourceText: [
      `home: ${homeText}`,
      `hotel rooms: ${hotelRooms.map(r => `${r.name} (up to ${r.maxGuests}): ${r.description}`).join(' | ')}`,
      `residentials: ${resid.map(r => `${r.name}: ${r.description}`).join(' | ')}`,
      `engine description: ${engine.description}`,
      `engine room types: ${engine.rooms.map(r => `${r.name} (max ${r.maxGuests ?? '?'})`).join('; ')}`,
      `kitemex: ${kitemex.filter(l => /La Ventana Beach Resort|wind conditions|Km 7\.5/i.test(l)).join(' ')}`,
      pin ? `pin (Google Maps place link): ${pin.lat},${pin.lng}` : '',
    ].filter(Boolean).join('\n'),
  };
}

export const laVentanaBeachResort: OfferAdapter = {
  key: 'la-ventana-beach-resort',
  name: 'La Ventana Beach Resort',
  kind: 'accommodation',
  operator: {
    name: 'La Ventana Beach Resort',
    websiteUrl: SITE,
    rootDomain: 'laventanabeachresort.com',
    contactEmail: 'info@laventanabeachresort.com',
    whatsapp: '+52 612 141 4011',
    phone: '+52 612 141 4011',
  },
  url: LVBR_HOTEL_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 6,
  confidence: 'low',
  async fetchContent() {
    const home = await fetchText(LVBR_HOME_URL, { accept: 'text/html' });
    const hotel = await fetchText(LVBR_HOTEL_URL, { accept: 'text/html' });
    const residentials = await fetchText(LVBR_RESIDENTIALS_URL, { accept: 'text/html' });
    const engine = await fetchJson(LVBR_CB_METADATA_URL);
    const kitemex = await fetchText(KITEMEX_HOME_URL, { accept: 'text/html' });
    return parseLvbrContent({ home, hotel, residentials, engine, kitemex });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    ctx.note('la-ventana-beach-resort: Cloudbeds availability answers 403 to our UA; the site prints no rates -> price on request');
    return [];
  },
};
