// ---------------------------------------------------------------------------
// Filho do Vento Kite Lodge, Barra do Cunhaú (Canguaretama, Rio Grande do Norte, Brazil) - 14-room beachfront
// hotel in front of a kitesurf break, with its own Kitmaster School and a nautical-sports programme.
//
// Data path (checked 2026-10-12):
//   content  filhodovento.com.br (WordPress/Elementor, English under /en/): /en/ (intro, rooms teaser,
//            kite break), /en/rooms (14 rooms, the three room types), /en/nautical-sports (Kitmaster School,
//            wing foiling, downwind, other water sports) + the Omnibees hotel page
//            book.omnibees.com/chain/9873/hotel/18650?lang=en-US (English description, room cards, amenities,
//            hours, map pin #map-wrap data-lat/data-long, photos media.omnibees.com/Images/18650/...).
//   slots    Omnibees booking engine (hotel 18650; chain 9873 for the page path and the results c= parameter,
//            the hotel page's `chainId = "9873"`; currency id 16 = BRL). The site's "Book your stay" buttons
//            open book.omnibees.com/hotel/18650?currencyId=16. Engine code: src/offers/engines/omnibees.ts.
// robots.txt (2026-10-12): filhodovento.com.br disallows only /wp-admin/; book.omnibees.com does not list hotel
//   18650 or chain 9873 (checked with robotsAllows for the hotel page, calendar and results paths).
// Requests per run: content 4, slots 2 calendar + up to 6 results = 8.
// Parsed: calendar bands ("lowest|2026-10-12", hotel-wide lowest price for 2 adults) + room type x month samples
//   ("superior-deluxe-apartment|2026-11"), BRL per room per night for 2 adults.
// Known limits: the "3 for 2" stay offer and the kite packages are not modelled; no contact e-mail or phone is
//   published on the own site (WhatsApp widget only).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent } from '../types.js';
import { fetchOmnibeesSlots, hotelUrl, originalImage, parseRoomCards, type OmnibeesHotel } from '../engines/omnibees.js';

export const FDV_HOTEL: OmnibeesHotel = { hotelId: 18650, chainPath: 9873, chainId: 9873, currencyId: 16 /* BRL, data-curr="16" */, currency: 'BRL', adults: 2, months: 6 };
export const FDV_HOTEL_URL = hotelUrl(FDV_HOTEL);
const SITE = 'https://filhodovento.com.br';
export const FDV_PAGES = { home: `${SITE}/en/`, rooms: `${SITE}/en/rooms`, sports: `${SITE}/en/nautical-sports` } as const;

export interface FdvPages { home: string; rooms: string; sports: string; hotel: string }

function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, form, template')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text)
    .replace(/\s*About Us Press FOLLOW US[\s\S]*$/, '').trim();
}

/** Room texts of /en/rooms: "<name> <text> Read More" blocks. */
export function parseFdvRooms(roomsHtml: string): Array<{ name: string; text: string }> {
  const t = pageText(roomsHtml);
  const names = ['Superior Deluxe Room', 'Deluxe Room', 'Accessible Double Room'];
  const out: Array<{ name: string; text: string }> = [];
  for (const name of names) {
    const m = t.match(new RegExp(`(?<!Superior )${name} (Our [\\s\\S]*?|Discover [\\s\\S]*?)\\s*Read More`));
    if (m) out.push({ name, text: m[1].trim() });
  }
  return out;
}

const ROOM_MAP: Array<{ omnibees: RegExp; site: string }> = [
  { omnibees: /superior/i, site: 'Superior Deluxe Room' },
  { omnibees: /adapted|accessible/i, site: 'Accessible Double Room' },
  { omnibees: /ground floor|^deluxe/i, site: 'Deluxe Room' },
];

export function parseFdvContent(p: FdvPages): OfferContent {
  const home = pageText(p.home);
  const roomsText = pageText(p.rooms);
  const sports = pageText(p.sports);
  const hotel = parse(p.hotel);
  const description = collapse(hotel.querySelector('.hotel-landing__description')?.text ?? '');
  const fromPrice = collapse(hotel.querySelector('.hotel-landing__price-value')?.text ?? '');
  const hours = collapse(hotel.querySelector('.hotel-landing__hours')?.text ?? '');
  const amenities = hotel.querySelectorAll('.amenity-group').map(g => ({
    group: collapse(g.querySelector('.amenity-category-text')?.text ?? ''),
    items: g.querySelectorAll('.amenity-item').map(i => collapse(i.text)).filter(Boolean),
  }));
  const cards = parseRoomCards(p.hotel);
  const siteRooms = parseFdvRooms(p.rooms);
  const mapWrap = hotel.querySelector('#map-wrap');
  const lat = Number(mapWrap?.getAttribute('data-lat'));
  const lng = Number(mapWrap?.getAttribute('data-long'));

  const nRooms = roomsText.match(/Each of our (\d+) rooms/)?.[1] ?? null;
  const supSize = roomsText.match(/with (\d+) sqm/)?.[1] ?? null;
  const kitmaster = /Kitmaster School/i.test(sports);
  const adventure = sports.match(/variety of activities: ([^.]+)\./)?.[1] ?? '';
  const wing = /wing foiling/i.test(adventure);
  const downwind = /downwind/i.test(adventure);

  const rooms: ContentRoom[] = cards.map(c => {
    const m = ROOM_MAP.find(x => x.omnibees.test(c.name));
    const site = m ? siteRooms.find(r => r.name === m.site) : undefined;
    return { name: c.name, description: site?.text ?? null, features: c.features };
  });

  const seen = new Set<string>();
  const own: string[] = [];
  for (const [html, base] of [[p.home, FDV_PAGES.home], [p.sports, FDV_PAGES.sports]] as const) {
    for (const u of imageCandidates(html, base, null, 60)) {
      if (!u.startsWith(`${SITE}/wp-content/uploads/`) || /\.png|logo|favicon/i.test(u)) continue;
      // nautical-sports page: only the water-sports photos (kids, culture and wellness tiles are off-topic)
      if (base === FDV_PAGES.sports && !/nauticalsports|surf-e-kitesurf/i.test(u)) continue;
      const k = u.split('/').pop()!.replace(/-[a-z0-9]{40,}(?=\.[a-z]+$)/i, '');
      if (seen.has(k)) continue;
      seen.add(k); own.push(u);
    }
  }
  const ob: string[] = [];
  for (const m of p.hotel.matchAll(/https:\/\/media\.omnibees\.com\/Images\/18650\/(?:Property|RoomTypes)\/(?:\d+x\d+\/)?\d+\.jpe?g/g)) {
    const u = originalImage(m[0]);
    if (!ob.includes(u)) ob.push(u);
  }

  const summary = [
    `Filho do Vento Kite Lodge is a beachfront hotel with ${nRooms ?? '14'} rooms in Barra do Cunhaú (Canguaretama, Rio Grande do Norte, Brazil), in front of a kitesurf break.`,
    `Its ${kitmaster ? 'Kitmaster School teaches kitesurfing' : 'water-sports team teaches kitesurfing'}; ${wing ? 'wing foiling, ' : ''}${downwind ? 'downwinders, ' : ''}stand-up paddle, wakeboard, surfing and Hawaiian canoe are also offered on site.`,
    `Rooms are Superior Deluxe rooms on the top floor${supSize ? ` (${supSize} m2, sea view, balcony)` : ' (sea view, balcony)'}, Deluxe rooms on the garden and an accessible double room; the hotel has a pool, the Cicchetti restaurant and a free daily activity programme.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Filho do Vento Kite Lodge',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Barra do Cunhaú, Rio Grande do Norte',
    spot: 'Barra do Cunhaú',
    // Omnibees hotel page map pin (#map-wrap data-lat / data-long, 2026-10-12)
    spotCoords: Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? { lat, lng } : null,
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: kitmaster || /kitesurf/i.test(adventure),
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: ['Wi-Fi', 'Parking', 'Daily activity programme (adventure, wellness, learning, culinary)'],
    optionalServices: [
      kitmaster ? 'Kitesurf lessons (Kitmaster School)' : 'Kitesurf lessons',
      ...(wing ? ['Wing foiling'] : []),
      ...(downwind ? ['Downwinders'] : []),
      'Stand-up paddle, wakeboard, Hawaiian canoe, Hobie Cat, surfing, water skiing',
      'Yoga, spa and massages',
      'Tours around Pipa',
      'Cicchetti restaurant',
    ],
    accommodation: 'beachfront hotel rooms',
    mealPlan: /Breakfast Hours/i.test(hours) ? 'breakfast' : null,
    languages: ['pt', 'en'],
    rooms,
    imageUrls: [...own, ...ob].slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: FDV_PAGES.home,
    bookingUrl: FDV_HOTEL_URL,
    sourceText: [
      `home: ${home}`,
      `rooms: ${roomsText}`,
      `nautical sports: ${sports}`,
      `omnibees description: ${description}`,
      `omnibees from price: ${fromPrice}`,
      `omnibees rooms: ${cards.map(c => `${c.name} (${c.features.join(', ')})`).join('; ')}`,
      ...amenities.map(a => `${a.group}: ${a.items.join(', ')}`),
      `hours: ${hours}`,
      `map pin: ${lat},${lng}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const filhoDoVentoBarraDoCunhau: OfferAdapter = {
  key: 'filho-do-vento-barra-do-cunhau',
  name: 'Filho do Vento Kite Lodge Barra do Cunhaú',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Filho do Vento Kite Lodge',
    websiteUrl: SITE,
    rootDomain: 'filhodovento.com.br',
  },
  url: FDV_PAGES.home,
  quote: { engine: 'omnibees', hotelId: FDV_HOTEL.hotelId, chainId: FDV_HOTEL.chainId, currencyId: FDV_HOTEL.currencyId, currency: FDV_HOTEL.currency },
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 12,
  async fetchContent() {
    const home = await fetchText(FDV_PAGES.home, { accept: 'text/html' });
    const rooms = await fetchText(FDV_PAGES.rooms, { accept: 'text/html' });
    const sports = await fetchText(FDV_PAGES.sports, { accept: 'text/html' });
    const hotel = await fetchText(FDV_HOTEL_URL, { accept: 'text/html' });
    return parseFdvContent({ home, rooms, sports, hotel });
  },
  async fetchSlots(ctx) {
    return fetchOmnibeesSlots(FDV_HOTEL, ctx, 'filho-do-vento');
  },
};
