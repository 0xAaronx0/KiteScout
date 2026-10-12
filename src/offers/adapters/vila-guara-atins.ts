// ---------------------------------------------------------------------------
// Pousada Vila Guará, Atins (Lençóis Maranhenses, Maranhão, Brazil) - beachfront chalets with own kite school.
//
// Data path (checked 2026-10-09):
//   content  www.vilaguara.com/en (Duda site: texts, gallery, hero video) + the Omnibees hotel page
//            book.omnibees.com/chain/2706/hotel/18675?lang=en-US (description, room cards, amenities,
//            original-size photos media.omnibees.com/Images/18675/<Property|RoomTypes>/<id>.jpg).
//   slots    Omnibees booking engine (hotel 18675, chain 9888, currency id 16 = BRL):
//            GET /availability_v4/q/18675/16/<from>/<to>/2/0/0 (X-Requested-With: XMLHttpRequest)
//                -> per day: status (Open/OnRequest/...), hotel-wide lowest price, min-stay restriction;
//                   the engine answers at most ~3 months per call (7 months returned []).
//            GET /hotelresults?q=18675&c=9888&lang=en-US&currencyId=16&version=4&CheckIn=ddMMyyyy
//                &CheckOut=ddMMyyyy&ad=2&ch=0&ag=  -> per room type: rate plans with daily rates
//                   (data-daily-rates), bookable count (data-max-quantity) and "There are 2 rooms left".
//            Per month we search ONE sample stay: the cheapest open arrival day of the month that
//            satisfies its min-stay, for that many nights, 2 adults.
// robots.txt (2026-10-09): book.omnibees.com only disallows /extras, /bookdetails and other hotels'
//   ids (not 18675 / chain 9888 / 2706); www.vilaguara.com allows everything.
// Requests per run: content 2, slots 2 calendar + up to 6 results = 8.
// Parsed: slot = room type x month ("kite-house|2026-11"), BRL per room per night for 2 adults incl.
//   breakfast, price = lowest daily rate of the sample stay, availability from the room's inventory
//   ("rooms left" -> limited) or the month's calendar (no open day -> sold_out).
// Known limits: one sample stay per month (the hotel-wide calendar is exact per day, per-room prices
//   are sampled); a room missing from the sample stay is "unknown" for that month.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';
import {
  buildRoomMonthSlots, buildRunSlots, calendarUrl, calendarWindows, fetchOmnibeesSlots, hotelUrl, originalImage, parseCalendar,
  parseResults, parseRoomCards, resultsUrl, sampleStay, type OmnibeesDay, type OmnibeesHotel, type OmnibeesRoomCard, type OmnibeesRoomRate,
} from '../engines/omnibees.js';

const VG: OmnibeesHotel = { hotelId: 18675, chainPath: 2706, chainId: 9888, currencyId: 16 /* BRL, data-curr="16" */, currency: 'BRL', adults: 2, months: 6 };
export const VG_HOTEL_URL = hotelUrl(VG);
export const VG_SITE_URL = 'https://www.vilaguara.com/en';

// Engine code lives in ../engines/omnibees.ts; these names stay for the tests and the bands test.
export type VgDay = OmnibeesDay;
export type VgRoomRate = OmnibeesRoomRate;
export type VgRoomCard = OmnibeesRoomCard;
export const vgCalendarUrl = (from: string, to: string): string => calendarUrl(VG, from, to);
export const vgResultsUrl = (checkIn: string, checkOut: string): string => resultsUrl(VG, checkIn, checkOut);
export const vgCalendarWindows = (today: string) => calendarWindows(today, VG.months);
export const parseVgCalendar = parseCalendar;
export const vgSampleStay = sampleStay;
export const parseVgResults = parseResults;
export const buildVgSlots = (roomNames: string[], days: VgDay[], months: Parameters<typeof buildRoomMonthSlots>[3]): Slot[] =>
  buildRoomMonthSlots(VG, roomNames, days, months);
export const buildVgRunSlots = (days: VgDay[]): Slot[] => buildRunSlots(VG, days);
export const parseVgRoomCards = parseRoomCards;
const omnibeesOriginal = originalImage;

export function parseVilaGuaraContent(siteHtml: string, hotelHtml: string): OfferContent {
  const site = parse(siteHtml);
  for (const el of site.querySelectorAll('script, style, noscript, header, nav')) el.remove();
  const siteText = collapse(site.text);
  const hotel = parse(hotelHtml);
  const description = collapse(hotel.querySelector('.hotel-landing__description')?.text ?? '');
  const amenities = hotel.querySelectorAll('.amenity-group').map(g => ({
    group: collapse(g.querySelector('.amenity-category-text')?.text ?? ''),
    items: g.querySelectorAll('.amenity-item').map(i => collapse(i.text)).filter(Boolean),
  }));
  const hours = collapse(hotel.querySelector('.hotel-landing__hours')?.text ?? '');
  const fromPrice = collapse(hotel.querySelector('.hotel-landing__price-value')?.text ?? '');
  const cards = parseVgRoomCards(hotelHtml);

  const kite = siteText.match(/KITESURFING\s+(Located[\s\S]*?unforgettable for kiters\.)/)?.[1] ?? '';
  const season = kite.match(/between\s+([A-Z][a-z]+)\s+and\s+([A-Z][a-z]+)/);
  const knots = kite.match(/(\d+)\s+to\s+(\d+)\s+knots/);
  const restaurant = siteText.match(/RESTAURANT\s+(With regional[\s\S]*?your day\.)/)?.[1] ?? '';
  const others = siteText.match(/OTHERS ACTIVITIES\s+([\s\S]*?scenery of Atins\.)/)?.[1] ?? '';
  const chalets = siteText.match(/(The wooden chalets[\s\S]*?getaway in Maranhão\.)/)?.[1] ?? '';

  const summary = [
    'Pousada Vila Guará is a small beachfront guesthouse in Atins, at the edge of the Lençóis Maranhenses National Park in Maranhão, Brazil, with a bar and restaurant, a spa and its own fully equipped kitesurf school.',
    `Guests stay in naturally ventilated wooden chalets (fans and mosquito nets, no air conditioning) with private balcony and bathroom; ${cards.length ? `${cards.length} room types (${cards.map(c => c.name).join(', ')}) are bookable and ` : ''}breakfast is included.`,
    season || knots ? `The kite season runs ${season ? `from ${season[1]} to ${season[2]}` : ''}${knots ? ` with ${knots[1]} to ${knots[2]} knots` : ''} on the Preguiças river delta's lagoons and sandbanks.` : null,
  ].filter(Boolean).join(' ');

  const rooms: ContentRoom[] = cards.map(c => ({
    name: c.name,
    description: null,
    features: [...c.features, 'Private balcony', 'Private bathroom with hot shower', 'Fan and mosquito nets', 'Minibar', 'Wi-Fi', 'Breakfast included'],
  }));

  // images: own site gallery (minus logos/flags), then Omnibees originals (property + room types)
  const own: string[] = [];
  const seen = new Set<string>();
  for (const cand of imageCandidates(siteHtml, VG_SITE_URL, null, 80)) {
    const u = cand.match(/https:\/\/irp\.cdn-website\.com\/[^"'\\\s%]+/)?.[0];
    if (!u || /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/.test(u) || /\.svg|flags|whatsapp/i.test(u)) continue;
    const k = u.split('/').pop()!.replace(/-\d+w(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); own.push(u);
  }
  const ob: string[] = [];
  for (const m of hotelHtml.matchAll(/https:\/\/media\.omnibees\.com\/Images\/\d+\/(?:Property|RoomTypes)\/\d+x\d+\/\d+\.jpg/g)) {
    const u = omnibeesOriginal(m[0]);
    if (!ob.includes(u)) ob.push(u);
  }
  const video = siteHtml.match(/https:\/\/vid\.cdn-website\.com\/[^"'\s]+\.mp4/)?.[0] ?? null;

  const sourceLines = [
    `omnibees description: ${description}`,
    `from price: ${fromPrice}`,
    `rooms: ${cards.map(c => `${c.name} (${c.features.join(', ')})`).join('; ')}`,
    ...amenities.map(a => `${a.group}: ${a.items.join(', ')}`),
    `hours: ${hours}`,
    `chalets: ${chalets}`,
    `restaurant: ${restaurant}`,
    `kitesurfing: ${kite}`,
    `other activities: ${others}`,
  ];
  const included = ['Breakfast', 'Wi-Fi', 'Parking', 'Kite equipment storage (Kite Wardrobe)'];
  return {
    kind: 'accommodation',
    title: 'Pousada Vila Guará',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Maranhão',
    spot: 'Atins',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    // "a fully equipped kitesurfing school - perfect for those who want to learn or already practice" (Omnibees, 2026-10-09)
    kiteLessons: /kitesurf(?:ing)? school/i.test(description) || /school/i.test(kite),
    equipmentRental: null,
    beginnerFriendly: /want to learn/i.test(description) ? true : null,
    includedServices: included,
    optionalServices: ['Kitesurf lessons (own school)', 'Massage / spa', 'Restaurant lunch and dinner', 'Stand-up paddle', 'Tours to the Lençóis Maranhenses dunes and lagoons'],
    accommodation: 'beachfront wooden chalets',
    mealPlan: 'breakfast',
    languages: ['en', 'pt', 'fr'], // vilaguara.com language switch EN / PT / FR (2026-10-09)
    rooms,
    imageUrls: [...own, ...ob].slice(0, 30),
    heroVideoUrl: video,
    sourceUrl: VG_HOTEL_URL,
    bookingUrl: VG_HOTEL_URL,
    sourceText: sourceLines.join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const vilaGuaraAtins: OfferAdapter = {
  key: 'vila-guara-atins',
  name: 'Pousada Vila Guará Atins',
  kind: 'accommodation',
  operator: {
    name: 'Pousada Vila Guará',
    websiteUrl: 'https://www.vilaguara.com',
    rootDomain: 'vilaguara.com',
    contactEmail: 'admin@vilaguara.com',
    phone: '+5598992325200',
  },
  url: VG_HOTEL_URL,
  quote: { engine: 'omnibees', hotelId: VG.hotelId, chainId: VG.chainId, currencyId: VG.currencyId, currency: VG.currency },
  slotMethod: 'booking_engine',
  fetchBudget: 10,
  async fetchContent() {
    // Duda answers a JSON payload instead of HTML when Accept lists application/json (http.ts default)
    const site = await fetchText(VG_SITE_URL, { accept: 'text/html' });
    const hotel = await fetchText(VG_HOTEL_URL, { accept: 'text/html' });
    return parseVilaGuaraContent(site, hotel);
  },
  async fetchSlots(ctx) {
    return fetchOmnibeesSlots(VG, ctx, 'vila-guara');
  },
};
