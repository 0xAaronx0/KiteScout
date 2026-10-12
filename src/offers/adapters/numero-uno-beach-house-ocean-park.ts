// ---------------------------------------------------------------------------
// Numero Uno Beach House, Ocean Park (San Juan, Puerto Rico) - boutique waterfront hotel on Ocean Park Beach
// with garden-view, deluxe and deluxe ocean-view rooms, beach apartments steps away, a beach bar and grill,
// and watersports from the beach (kiteboarding, efoiling, wakeboarding, tow-in surfing, downwinding); the
// hotel's "Explore watersports" button links the Kite Puerto Rico school.
//
// Data path (checked 2026-10-12): WordPress site numerounopr.com (rebuilt May 2026; pages modified
// 2026-05-27 per the site's WP REST API).
//   content  /hotel/ (room cards article.nu-card: <h3> name, <p> text, .nu-room-features spans; included
//            amenities list; kite band), /beach-house/ (intro, food, watersports cards), /watersports/
//            (activity list), /hotel/apartments/beach-apartments/ (apartments: 1-2 bedrooms, kitchenette,
//            "Room Capacity 4 Adults").
//   slots    none. The site prints no rates; "Book now" goes to the OpenHotel engine
//            hotel2625.openhotel.com/results.cfm, which answered HTTP 403 to our UA on 2026-10-12 (no
//            robots.txt there) -> not used; fetchSlots returns [] ("price on request").
// robots.txt (2026-10-12): numerounopr.com WordPress default (/wp-admin/ only).
// Requests per run: content 4, slots 0.
// Known limits: no prices, no availability (confidence 'low'); the site also sells a sister hotel in
//   Piñones and N1 Condos, which are not part of this offer.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://numerounopr.com';
export const NU_HOTEL_URL = `${SITE}/hotel/`;
export const NU_BEACH_HOUSE_URL = `${SITE}/beach-house/`;
export const NU_WATERSPORTS_URL = `${SITE}/watersports/`;
export const NU_APARTMENTS_URL = `${SITE}/hotel/apartments/beach-apartments/`;
const BOOKING_URL = 'https://hotel2625.openhotel.com/results.cfm';

export interface NuRoom { name: string; text: string; features: string[] }

/** visible text of <main> without scripts/styles/nav */
function mainText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, nav, link')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}

// --- pure parsers -----------------------------------------------------------------------------
/** /hotel/ room cards. */
export function parseNuRooms(hotelHtml: string): NuRoom[] {
  return parse(hotelHtml).querySelectorAll('article.nu-card').map(a => ({
    name: collapse(a.querySelector('h3')?.text ?? ''),
    text: collapse(a.querySelector('p')?.text ?? ''),
    features: a.querySelectorAll('.nu-room-features span').map(s => collapse(s.text)).filter(Boolean),
  })).filter(r => r.name);
}

/** /hotel/ "Included Amenities" list. */
export function parseNuAmenities(hotelHtml: string): string[] {
  const box = parse(hotelHtml).querySelector('.nu-amenities');
  return (box?.querySelectorAll('li') ?? []).map(li => collapse(li.text)).filter(Boolean);
}

/** Beach apartments page: description + "Room Capacity" (<p>Room Capacity</p><h2>4 Adults</h2>). */
export function parseNuApartments(html: string): { text: string; capacity: number | null } {
  const root = parse(html);
  const main = root.querySelector('main') ?? root;
  const text = main.querySelectorAll('p').map(p => collapse(p.text)).find(t => t.length > 80) ?? '';
  const capacity = Number(mainText(html).match(/Room Capacity\s*(\d+)\s*Adults/i)?.[1]) || null;
  return { text, capacity };
}

/** /watersports/ activity list ("Kiteboarding", "Efoiling", ...). */
export function parseNuWatersports(html: string): string[] {
  const main = parse(html).querySelector('main');
  return (main?.querySelectorAll('ul li') ?? []).map(li => collapse(li.text)).filter(t => t && t.length < 60);
}

export interface NuPages { hotel: string; beachHouse: string; watersports: string; apartments: string }

export function parseNumeroUnoContent(p: NuPages): OfferContent {
  const rooms = parseNuRooms(p.hotel);
  const amenities = parseNuAmenities(p.hotel);
  const apt = parseNuApartments(p.apartments);
  const sports = parseNuWatersports(p.watersports);
  const hotelText = mainText(p.hotel);
  const beach = mainText(p.beachHouse);
  const kiteBand = hotelText.match(/Enjoy kiteboarding, watersports[^.]*\./)?.[0] ?? '';
  const kiteLinked = /href="https:\/\/www\.kitepuertorico\.com"/.test(p.hotel);

  const contentRooms: ContentRoom[] = [
    ...rooms.map(r => ({ name: r.name, description: r.text, features: r.features })),
    ...(apt.text ? [{ name: 'Beach Apartment', description: apt.text, features: [apt.capacity ? `Up to ${apt.capacity} adults` : null, 'Kitchenette', 'Futon'].filter((x): x is string => !!x) }] : []),
  ];

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const [html, base] of [[p.hotel, NU_HOTEL_URL], [p.beachHouse, NU_BEACH_HOUSE_URL], [p.apartments, NU_APARTMENTS_URL], [p.watersports, NU_WATERSPORTS_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 60)) {
      if (!/numerounopr\.com\/wp-content\/uploads\//.test(u) || /logo|icon|food|\.svg|\.png$/i.test(u)) continue;
      const k = u.replace(/-(?:\d+x\d+|scaled)(?=[.-])/i, '').replace(/@2x/, '').toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); imageUrls.push(u);
    }
  }

  const list = (xs: string[]) => xs.join(', ').replace(/, ([^,]*)$/, ' and $1');
  const roomWords = rooms.map(r => r.name.replace(/\s*Room$/i, '').toLowerCase().replace(/ view\b/g, '-view'));
  const activities = sports.filter(s => !/rental|guidance/i.test(s)).map(s => s.toLowerCase());
  const rentals = sports.some(s => /rental/i.test(s));
  const summary = [
    `Numero Uno Beach House is a small boutique waterfront hotel on Ocean Park Beach in San Juan, Puerto Rico, with ${roomWords.length ? list(roomWords) : 'garden-view, deluxe and ocean-view'} rooms plus beach apartments with one or two bedrooms and a kitchenette a few steps away.`,
    'Its beach bar and kitchen serves breakfast and lunch, and rooms come with air conditioning, Wi-Fi, smart TV and beach towel service.',
    `Watersports start from the beach: ${activities.length ? list(activities) : 'kiteboarding, efoiling, wakeboarding, tow-in surfing and downwinding'}${rentals ? ', plus beach rentals and local guidance' : ''}${kiteLinked ? '; the hotel\'s "Explore watersports" link leads to the Kite Puerto Rico school' : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Numero Uno Beach House',
    summary,
    continent: 'North America',
    country: 'Puerto Rico',
    region: 'San Juan',
    spot: 'Ocean Park, San Juan',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: kiteLinked ? true : null, // the "Explore watersports" button links the Kite Puerto Rico school
    equipmentRental: /Rent, learn, ride/i.test(beach) ? true : null, // beach-house card "Rent, learn, ride and chase the wind from Ocean Park"
    beginnerFriendly: null,
    includedServices: amenities,
    optionalServices: [...sports.map(s => (s === 'Kiteboarding' && kiteLinked ? 'Kiteboarding (Kite Puerto Rico school)' : s)), 'Beach bar and grill (breakfast, lunch)'],
    accommodation: 'boutique beachfront hotel rooms and beach apartments',
    mealPlan: null, // the site does not say whether a rate includes breakfast
    languages: ['en'],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: NU_HOTEL_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `hotel: ${rooms.map(r => `${r.name}: ${r.text} (${r.features.join(', ')})`).join(' | ')} | amenities: ${amenities.join(', ')} | ${kiteBand}${kiteLinked ? ' [Explore watersports -> https://www.kitepuertorico.com]' : ''}`,
      `beach house: ${beach}`,
      `watersports: ${sports.join(', ')}`,
      `apartments: ${apt.text} (capacity ${apt.capacity ?? '?'})`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const numeroUnoBeachHouseOceanPark: OfferAdapter = {
  key: 'numero-uno-beach-house-ocean-park',
  name: 'Numero Uno Beach House Ocean Park',
  kind: 'accommodation',
  operator: {
    name: 'Numero Uno Puerto Rico',
    websiteUrl: SITE,
    rootDomain: 'numerounopr.com',
  },
  url: NU_HOTEL_URL,
  slotMethod: 'booking_engine',
  fetchBudget: 4,
  confidence: 'low',
  async fetchContent() {
    const hotel = await fetchText(NU_HOTEL_URL, { accept: 'text/html' });
    const beachHouse = await fetchText(NU_BEACH_HOUSE_URL, { accept: 'text/html' });
    const watersports = await fetchText(NU_WATERSPORTS_URL, { accept: 'text/html' });
    const apartments = await fetchText(NU_APARTMENTS_URL, { accept: 'text/html' });
    return parseNumeroUnoContent({ hotel, beachHouse, watersports, apartments });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    ctx.note('no slot source: the site prints no rates and its OpenHotel engine (hotel2625.openhotel.com) answered HTTP 403 to our UA (checked 2026-10-12)');
    return [];
  },
};
