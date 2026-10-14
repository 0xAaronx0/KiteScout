// ---------------------------------------------------------------------------
// Hotel Hondo (Wahoo Wind Co.), Los Barriles (Baja California Sur, Mexico) - boutique hotel with six
// king-bed studios in central Los Barriles, about 600 m from the beach; sister company of the kite and
// wing school Wahoo Wind Co. (IKO/IWO instructors, at Pully's Beach Club), same owners (Tori & Patrick).
// School students get 10% off rooms (promo code WAHOO); the school sells "Learn & Stay" kite camps that
// include a private king room at Hotel Hondo.
//
// Data path (checked 2026-10-14): two Squarespace sites, English only.
//   content  www.hotelhondo.com/ (intro, studios, pool, contact), /rooms (room types, location, beach
//            distance), www.wahoowind.com/accommodations ("Learn & Stay" camps, sister-hotel text,
//            promo code), and the hotel's own Cloudbeds reservation page
//            hotels.cloudbeds.com/reservation/AjW0nK (server-rendered JSON-LD LodgingBusiness: geo
//            23.68866539,-109.70078278 -> map pin, photos). robots.txt hotels.cloudbeds.com
//            (2026-10-14) disallows only /booking/prepare/, /reservas/finalizando/ and /widget.
//   slots    www.wahoowind.com/lessons-shop/camps-clinics: Squarespace product list
//            (<div class="product-list" data-context="{items:[{title, price:{currency,value},
//            soldOut, description}]}">). The two kitesurf camps are slots: "5-Day Kitesurf Camp"
//            USD 1,750 (4-night stay, 9 h lessons/coaching) and "7-Day Kitesurf Camp" USD 2,150
//            (6 nights, 12 h); price per private king room for a solo traveller or a couple sharing
//            the hours, "16% Mexican taxes included", no dates (arranged on booking). The wing foil
//            camps go into optionalServices.
// Not used: room-only rates. They exist only in Cloudbeds; the reservation page's own data calls are
//   POST hotels.cloudbeds.com/booking/rooms and /booking/property_info (seen in a browser 2026-10-14),
//   i.e. the Cloudbeds /booking/* API that answers 403 to non-browser clients elsewhere (Keros Blue,
//   Kite Lodge Brazil) -> not called.
// robots.txt www.hotelhondo.com / www.wahoowind.com (Squarespace defaults, 2026-10-14): the pages we
//   read are allowed (/api/, ?format=json and /cart are disallowed and never touched).
// Requests per run: content 5, slots 1 (memoised: 5 in total when both run).
// Slots: key = product slug ("5-day-kitesurf-camp"), no dates, priceUnit 'package' with packageNights
//   from the description, priceBasis 'room', availability 'unknown' ('sold_out' when the store flags
//   the product soldOut).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, jsonLd, parse } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import { sqsBlocks, sqsImages } from './floras-lake-house-langlois.js';

const HONDO = 'https://www.hotelhondo.com';
export const HH_HOME_URL = `${HONDO}/`;
export const HH_ROOMS_URL = `${HONDO}/rooms`;
const WAHOO = 'https://www.wahoowind.com';
export const WW_ACCOMMODATIONS_URL = `${WAHOO}/accommodations`;
export const WW_CAMPS_URL = `${WAHOO}/lessons-shop/camps-clinics`;
export const HH_CLOUDBEDS_URL = 'https://hotels.cloudbeds.com/reservation/AjW0nK';

const memo = new Map<string, Promise<string>>();
function page(url: string): Promise<string> {
  let p = memo.get(url);
  if (!p) { p = fetchText(url, { accept: 'text/html' }); memo.set(url, p); p.catch(() => memo.delete(url)); }
  return p;
}
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const noEmoji = (s: string): string => collapse(s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ''));

// --- pure parsers -----------------------------------------------------------------------------
export interface WwCamp {
  title: string; price: number; currency: string; soldOut: boolean; url: string;
  nights: number | null; hours: number | null; taxesIncluded: boolean; description: string;
}

/** Products of the Squarespace "Camps & Clinics" list (data-context JSON). */
export function parseWwCamps(html: string): WwCamp[] {
  const el = parse(html).querySelector('.product-list[data-context]');
  if (!el) return [];
  const ctx = JSON.parse(el.getAttribute('data-context') ?? '{}') as {
    items?: Array<{ title: string; price?: { currency?: string; value?: string }; soldOut?: boolean; description?: string; fullUrl?: string }>;
  };
  return (ctx.items ?? []).map(it => {
    const description = clean(it.description ?? '');
    const value = Number(it.price?.value ?? NaN);
    return {
      title: it.title,
      price: value,
      currency: it.price?.currency ?? 'USD',
      soldOut: !!it.soldOut,
      url: new URL(it.fullUrl ?? '/lessons-shop/camps-clinics', WAHOO).toString(),
      nights: Number(description.match(/(\d+)-night stay/i)?.[1] ?? NaN) || null,
      hours: Number(description.match(/(\d+) hours of/i)?.[1] ?? NaN) || null,
      taxesIncluded: /taxes included/i.test(description),
      description,
    };
  }).filter(c => Number.isFinite(c.price) && c.price > 0);
}

export function buildWwSlots(camps: WwCamp[]): Slot[] {
  return camps.filter(c => /kite/i.test(c.title)).map(c => ({
    key: slug(c.title),
    startDate: null,
    endDate: null,
    unit: `${c.title}${c.nights ? ` (${c.nights} nights at Hotel Hondo${c.hours ? `, ${c.hours} h lessons or coaching` : ''})` : ''}`,
    price: c.price,
    currency: c.currency,
    priceUnit: 'package',
    priceBasis: 'room',
    occupancy: null, // "for solo travelers or couples traveling together" (private king room)
    availability: c.soldOut ? 'sold_out' : 'unknown',
    availabilityText: c.soldOut ? 'Sold out' : null,
    spotsLeft: null,
    packageNights: c.nights,
  }));
}

/** Hotel geo + photos from the JSON-LD of the hotel's own Cloudbeds reservation page. */
export function parseHhCloudbeds(html: string): { pin: { lat: number; lng: number } | null; images: string[] } {
  const lodging = jsonLd(html).find(o => o['@type'] === 'LodgingBusiness');
  const geo = lodging?.geo as { latitude?: number; longitude?: number } | undefined;
  const lat = Number(geo?.latitude), lng = Number(geo?.longitude);
  const pin = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  const images = (Array.isArray(lodging?.image) ? lodging!.image as string[] : []).filter(u => typeof u === 'string' && !/logo/i.test(u));
  return { pin, images };
}

/** Room types on /rooms: "<h4>Garden Rooms 🌺</h4>" + description paragraph. */
export function parseHhRooms(html: string): ContentRoom[] {
  const blocks = sqsBlocks(html);
  const all = (() => { const i = blocks.findIndex(b => /^All Rooms/i.test(b.text)); return i >= 0 ? blocks.slice(i + 1).filter(b => b.tag === 'p').slice(0, 2).map(b => b.text) : []; })();
  const out: ContentRoom[] = [];
  blocks.forEach((b, i) => {
    if (!/^h[1-6]$/.test(b.tag) || !/^(Garden|Poolside|Patio) Rooms/i.test(b.text)) return;
    const desc = blocks[i + 1]?.tag === 'p' ? blocks[i + 1].text : null;
    out.push({ name: noEmoji(b.text).replace(/Rooms$/, 'Room'), description: desc, features: ['king-bed studio', ...all] });
  });
  return out;
}

export interface HhPages { home: string; rooms: string; wahooAccommodations: string; camps: string; cloudbeds: string | null }

export function parseHhContent(p: HhPages): OfferContent {
  const home = sqsBlocks(p.home).map(b => b.text);
  const roomsLines = sqsBlocks(p.rooms).map(b => b.text);
  const wahoo = sqsBlocks(p.wahooAccommodations).map(b => b.text);
  const camps = parseWwCamps(p.camps);
  const rooms = parseHhRooms(p.rooms);
  const cb = p.cloudbeds ? parseHhCloudbeds(p.cloudbeds) : { pin: null, images: [] };
  const kiteCamps = camps.filter(c => /kite/i.test(c.title));
  const wingCamps = camps.filter(c => /wing/i.test(c.title));
  const usd = (c: WwCamp) => `${c.currency} ${c.price.toLocaleString('en-US')}`;
  const promo = wahoo.find(t => /promo code/i.test(t)) ?? null;
  const beach = roomsLines.find(t => /meters from the beautiful, sandy beach/i.test(t)) ?? null;
  const beachM = beach?.match(/about (\d+) meters/i)?.[1] ?? null;
  const campLine = kiteCamps.map(c => `${c.title.toLowerCase()} ${usd(c)} (${c.nights ?? '?'} nights, ${c.hours ?? '?'} h)`).join(', ');

  const summary = [
    `Hotel Hondo is a boutique hotel in central Los Barriles on the East Cape of Baja California Sur, with six king-bed studios with kitchenettes, a pool with a waterfall grotto, a BBQ lawn and Starlink Wi-Fi${beachM ? `, about ${beachM} m from the beach` : ''}.`,
    'It is the sister company of the kite and wing school Wahoo Wind Co. (IKO/IWO instructors, at Pully\'s Beach Club, same owners); school students and guests get 10% off rooms.',
    kiteCamps.length ? `The school's "Learn & Stay" kitesurf camps include a private king room at the hotel: ${campLine}, Mexican taxes included; room-only rates are only shown in the hotel's booking engine.` : null,
  ].filter(Boolean).join(' ');

  const imageUrls = [...new Set([...sqsImages(p.rooms, 30), ...sqsImages(p.home, 20), ...cb.images])];

  return {
    kind: 'accommodation',
    title: 'Hotel Hondo (Wahoo Wind Co.)',
    summary,
    continent: 'North America',
    country: 'Mexico',
    region: 'Los Barriles, Baja California Sur',
    spot: 'Los Barriles',
    spotCoords: cb.pin,
    itinerarySpots: [],
    durationDays: null,
    // wahoowind: "Kite camps are designed for all levels: from total beginners to pros" (2026-10-14)
    skillLevels: wahoo.some(t => /all levels: from total beginners to pros/i.test(t)) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: true,
    equipmentRental: wahoo.some(t => /^Equipment \+ gear$/i.test(t)) ? true : null,
    beginnerFriendly: wahoo.some(t => /total beginners/i.test(t)) ? true : null,
    includedServices: ['Kitchenette in every studio', 'Swimming pool with waterfall grotto', 'Gas BBQ grill on the community lawn', 'Starlink Wi-Fi'],
    optionalServices: [
      'Kite and wing lessons with Wahoo Wind Co. (IKO/IWO instructors)',
      ...kiteCamps.map(c => `${c.title}: ${usd(c)} incl. ${c.nights ?? '?'} nights at Hotel Hondo and ${c.hours ?? '?'} h lessons or coaching`),
      ...wingCamps.map(c => `${c.title}: ${usd(c)} incl. Hotel Hondo stay`),
      ...(promo ? ['10% off rooms for Wahoo Wind Co. students (promo code WAHOO)'] : []),
      'Sportfishing, sailing, hiking / mountain biking and horseback trips arranged by the hotel',
      'Side-by-side rental',
    ],
    accommodation: 'boutique hotel, six king-bed studios with kitchenettes',
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms: rooms.map(r => ({
      ...r,
      features: [...r.features, ...kiteCamps.map(c => `${c.title} incl. ${c.nights ?? '?'} nights: ${usd(c)} per private king room (solo or couple), 16% taxes included`)],
    })),
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: HH_ROOMS_URL,
    bookingUrl: HH_CLOUDBEDS_URL,
    sourceText: [
      `hotel home: ${home.filter(t => !/^(Skip to Content|Rooms & Rates|Activities|Vacation Guides|Contact|Book a Room|Check Availability)$/.test(t)).join(' | ')}`,
      `rooms: ${roomsLines.filter(t => !/^(Skip to Content|Rooms & Rates|Activities|Vacation Guides|Contact|Book a Room|Check Rates)$/.test(t)).join(' | ')}`,
      `wahoo accommodations: ${wahoo.filter(t => !/^(Skip to Content|Windsurf|Camps & Clinics|Shop All|Rentals|Accommodations|About|Contact|Book a Lesson)$/.test(t)).join(' | ')}`,
      `camps: ${camps.map(c => `${c.title} ${usd(c)}${c.soldOut ? ' (sold out)' : ''}: ${c.description}`).join(' | ')}`,
      cb.pin ? `cloudbeds geo: ${cb.pin.lat},${cb.pin.lng}` : '',
    ].filter(Boolean).join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const wahooWindHotelHondoLosBarriles: OfferAdapter = {
  key: 'wahoo-wind-hotel-hondo-los-barriles',
  name: 'Hotel Hondo (Wahoo Wind Co.)',
  kind: 'accommodation',
  operator: {
    name: 'Hotel Hondo',
    websiteUrl: HH_HOME_URL,
    rootDomain: 'hotelhondo.com',
    contactEmail: 'hola@hotelhondobaja.com', // site footer, 2026-10-14
    phone: '+19039181076',                   // "+1(903)918-1076"
    whatsapp: '+19039181076',                // wa.me/19039181076 link
  },
  url: HH_ROOMS_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 6,
  confidence: 'low',
  async fetchContent(ctx: FetchContext) {
    const [home, rooms, wahooAccommodations, camps] = [await page(HH_HOME_URL), await page(HH_ROOMS_URL), await page(WW_ACCOMMODATIONS_URL), await page(WW_CAMPS_URL)];
    let cloudbeds: string | null = null;
    try { cloudbeds = await page(HH_CLOUDBEDS_URL); } catch (e) { ctx.note(`Cloudbeds reservation page not readable (${(e as Error).message}); no map pin`); }
    return parseHhContent({ home, rooms, wahooAccommodations, camps, cloudbeds });
  },
  async fetchSlots(ctx: FetchContext) {
    const camps = parseWwCamps(await page(WW_CAMPS_URL));
    if (camps.length === 0) throw new Error('wahoo: no products in the Camps & Clinics list (data-context missing?)');
    const slots = buildWwSlots(camps);
    if (slots.length === 0) ctx.note('no kitesurf camp in the Camps & Clinics list; price on request');
    return slots;
  },
};
