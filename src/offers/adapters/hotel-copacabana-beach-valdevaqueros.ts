// ---------------------------------------------------------------------------
// Hotel Copacabana Beach, Valdevaqueros (Tarifa, Cadiz, Andalusia, Spain) - hotel on the N-340 km 75 opposite
// Valdevaqueros beach: 34 rooms of 10 types, restaurant, bar, free parking, pet friendly. Kite link: the services page
// presents "Live to Fly Tarifa - Kitesurf, Wingfoil, and Surf School & Surf Shop" with the Pata Negra Kitesurf School
// "located right next to Hotel Copacabana" ("School Base: Hotel Copacabana, N-340 km 76, Valdevaqueros Beach").
//
// Data path (checked 2026-10-12): WordPress built by Mirai (webs.mirai.com), English pages under /en/.
//   content  /en/ (hotel, kite connection), /en/rooms/ (room cards), /en/services/ (restaurant, Live to Fly / Pata Negra,
//            pets), /en/gallery/ (photos).
//   slots    /en/rooms/: per room card ".room-price": "From 38€ per night" and "0 people from 31 May to 30 November"
//            (the Mirai CMS from-price of the room for that window; "0 people" is printed as is). The window has NO
//            year: like the other year-less tables (docs/offer-adapters.md) it is anchored on the page's own JSON-LD
//            dateModified (2026-03-05 on 2026-10-12): the window that contains or follows that date (31.05.-30.11.2026)
//            becomes the band; once it has passed the offer drops to "price on request" until the page is edited.
// Booking engine: Mirai (static.mirai.com core widget, hotel 100378668). Its calendar price endpoint
//   index-price.mirai.com/getAvaCalendar answered HTTP 403 to our UA on 2026-10-12 (blocked, not retried); the other
//   Mirai APIs send a fixed Basic-auth credential from the widget code -> not used. hotel.copacabanatarifa.com's
//   robots.txt disallows /bookingstep1-3/ and every URL with "?". Availability stays 'unknown'.
// robots.txt (2026-10-12): Mirai default (booking steps, "/*?", search, feeds disallowed) - the /en/ pages are allowed.
// Requests per run: content 4, slots 1 (the rooms page, memoised).
// Parsed: slot = room type x window ("double-room-with-terrace|2026-05-31"), EUR per room per night (the printed
//   "From" price = the lowest rate in the window), availability 'unknown'.
// Known limits: from-prices only (the real rate depends on dates and occupancy); no map pin on the site.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, iso, jsonLd, monthOf, parse, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://hotel.copacabanatarifa.com';
export const COPA_HOME_URL = `${SITE}/en/`;
export const COPA_ROOMS_URL = `${SITE}/en/rooms/`;
export const COPA_SERVICES_URL = `${SITE}/en/services/`;
export const COPA_GALLERY_URL = `${SITE}/en/gallery/`;

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots share the rooms page */
function get(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Visible text lines (scripts, styles, SVGs dropped), split at block tags. */
export function copaLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|a|button|figure)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
export interface CopaRoom {
  name: string; maxPersons: number | null; beds: string | null; description: string | null; image: string | null;
  fromPrice: number | null; currency: string | null; window: { m1: number; d1: number; m2: number; d2: number } | null; priceText: string | null;
}

/** "from 31 May to 30 November" -> month/day pairs (year-less). */
export function parseCopaWindow(text: string): CopaRoom['window'] {
  const m = clean(text).match(/from (\d{1,2}) ([A-Za-z]+) to (\d{1,2}) ([A-Za-z]+)/i);
  if (!m || !monthOf(m[2]) || !monthOf(m[4])) return null;
  return { d1: Number(m[1]), m1: monthOf(m[2])!, d2: Number(m[3]), m2: monthOf(m[4])! };
}

/** /en/rooms/ cards. */
export function parseCopaRooms(html: string): CopaRoom[] {
  const out: CopaRoom[] = [];
  for (const card of parse(html).querySelectorAll('.room-item')) {
    const name = clean(card.querySelector('.room-detail h3')?.text);
    if (!name || out.some(r => r.name === name)) continue;
    const details = card.querySelectorAll('.room-detail li').map(li => collapse(li.text));
    const priceText = clean(card.querySelector('.box-price')?.text) || null;
    const amount = priceText?.match(/From\s*([\d.,]+)\s*€/i)?.[1];
    const window = parseCopaWindow(card.querySelector('.price-description')?.text ?? '');
    out.push({
      name,
      maxPersons: Number(details.join(' ').match(/Max\.\s*(\d+)\s*(?:persons?|people)/i)?.[1]) || null,
      beds: details.find(d => /bed/i.test(d)) ?? null,
      description: clean(card.querySelector('.room-description')?.text) || null,
      image: card.querySelector('img')?.getAttribute('src') ?? null,
      fromPrice: amount ? parseAmount(amount) : null,
      currency: amount ? 'EUR' : null,
      window,
      priceText: priceText ? `${priceText}${window ? ` (${clean(card.querySelector('.price-description')?.text).replace(/^0 people\s*/i, '')})` : ''}` : null,
    });
  }
  return out;
}

/** "34 rooms of 10 types" + the shared room facilities above the cards. */
export function parseCopaCommon(html: string): { rooms: number | null; types: number | null; features: string[] } {
  const box = parse(html).querySelector('.common-features');
  const m = clean(box?.querySelector('p')?.text).match(/(\d+) rooms of (\d+) types/i);
  return {
    rooms: m ? Number(m[1]) : null,
    types: m ? Number(m[2]) : null,
    features: (box?.querySelectorAll('.common-services li') ?? []).map(li => collapse(li.text)).filter(Boolean),
  };
}

/** Anchor of the year-less window: the page's JSON-LD WebPage dateModified. */
export function copaModified(html: string): string | null {
  const page = jsonLd(html).find(o => o['@type'] === 'WebPage' && typeof o.dateModified === 'string');
  return page ? String(page.dateModified).slice(0, 10) : null;
}

/** The window (month/day pairs) that contains or follows `anchor`, as ISO dates. */
export function copaBand(w: NonNullable<CopaRoom['window']>, anchor: string): { start: string; end: string } {
  const y = Number(anchor.slice(0, 4));
  for (const yy of [y - 1, y]) {
    const start = iso(yy, w.m1, w.d1);
    const end = iso(w.m2 < w.m1 ? yy + 1 : yy, w.m2, w.d2);
    if (end >= anchor) return { start, end };
  }
  return { start: iso(y + 1, w.m1, w.d1), end: iso(w.m2 < w.m1 ? y + 2 : y + 1, w.m2, w.d2) };
}

export function buildCopaSlots(rooms: CopaRoom[], anchor: string, today: string): Slot[] {
  const out: Slot[] = [];
  for (const r of rooms) {
    if (!r.window || r.fromPrice === null) continue;
    const band = copaBand(r.window, anchor);
    if (band.end < today) continue;
    out.push({
      key: `${keyPart(r.name)}|${band.start}`,
      startDate: band.start,
      endDate: band.end,
      unit: r.name,
      price: r.fromPrice,
      currency: r.currency,
      priceUnit: 'per_night',
      priceBasis: 'room',
      occupancy: null,
      availability: 'unknown',
      availabilityText: r.priceText,
      spotsLeft: null,
    });
  }
  return out;
}

export async function fetchCopaSlots(ctx: FetchContext, today: string): Promise<Slot[]> {
  const html = await get(COPA_ROOMS_URL);
  const rooms = parseCopaRooms(html);
  const anchor = copaModified(html);
  if (rooms.length < 5) throw new Error(`hotel-copacabana: room cards not found or changed (${rooms.length})`);
  if (!anchor) { ctx.note('no dateModified on /en/rooms/: the year-less price window cannot be dated, price on request'); return []; }
  const slots = buildCopaSlots(rooms, anchor, today);
  if (!slots.length) ctx.note(`the from-price window (anchored ${anchor}) has passed: price on request until the page is edited`);
  return slots;
}

// --- content ----------------------------------------------------------------------------------
export interface CopaPages { home: string; rooms: string; services: string; gallery: string }

export function parseCopacabanaContent(p: CopaPages): OfferContent {
  const home = copaLines(p.home);
  const services = copaLines(p.services);
  const rooms = parseCopaRooms(p.rooms);
  const common = parseCopaCommon(p.rooms);
  const intro = home.find(l => /^At Hotel Copacabana Beach Tarifa/i.test(l)) ?? '';
  const svc = home.find(l => /^At the hotel, you will find/i.test(l)) ?? '';
  const school = services.find(l => /Pata Negra Kitesurf School/i.test(l)) ?? '';
  const base = services.find(l => /^School Base:/i.test(l)) ?? '';
  const shop = services.find(l => /^There is no need to carry heavy luggage/i.test(l)) ?? '';
  const restaurant = services.find(l => /^Enjoy a unique gastronomic experience/i.test(l)) ?? '';
  const pets = services.find(l => /^At Hotel Copacabana, your adventure partner/i.test(l)) ?? '';
  const hours = restaurant.match(/Open from (\d{2}:\d{2}) to (\d{2}:\d{2})/);
  const prices = rooms.map(r => r.fromPrice).filter((x): x is number => x !== null);
  const caps = rooms.map(r => r.maxPersons).filter((x): x is number => x !== null);

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: r.description,
    features: [r.maxPersons ? `Max. ${r.maxPersons} ${r.maxPersons === 1 ? 'person' : 'people'}` : null, r.beds, r.priceText].filter((x): x is string => !!x),
  }));

  // Elementor gallery: the lightbox links (a.e-gallery-item href) are the full-size photos
  const gallery = [...new Set(parse(p.gallery).querySelectorAll('a.e-gallery-item, [data-thumbnail]')
    .map(e => e.getAttribute('href') ?? e.getAttribute('data-thumbnail') ?? '')
    .filter(u => /^https:\/\/static-resources-elementor\.mirai\.com\/wp-content\/uploads\/.+\.(webp|jpe?g)$/i.test(u) && !/logo|icon/i.test(u)))];
  const roomImgs = rooms.map(r => r.image).filter((u): u is string => !!u && /^https:\/\/images\.mirai\.com\//.test(u));
  const imageUrls = [...new Set([...gallery.slice(0, 6), ...roomImgs, ...gallery.slice(6)])].slice(0, 30);

  const summary = [
    `Hotel Copacabana Beach is a hotel on the N-340 opposite Valdevaqueros beach in Tarifa with ${common.rooms ?? 34} rooms of ${common.types ?? rooms.length} types for ${caps.length ? `${Math.min(...caps)} to ${Math.max(...caps)}` : '1 to 4'} guests, from single rooms with terrace to family rooms with a private patio, all with air conditioning and free Wi-Fi.`,
    `It has a garden restaurant${hours ? ` (open ${hours[1]} to ${hours[2]})` : ''}, a bar and free parking and accepts pets${prices.length ? `; the website lists rooms from EUR ${Math.min(...prices)} per night` : ''}.`,
    `The Pata Negra kitesurf school of Live to Fly Tarifa has its base at the hotel and teaches kitesurf, wing foil and surf, with a surf shop for equipment on the beach.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Hotel Copacabana Beach',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Valdevaqueros, Tarifa',
    spot: 'Valdevaqueros',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: /Kitesurf School/i.test(school),
    equipmentRental: /all the necessary equipment|best gear right on the beach/i.test(shop) ? true : null,
    beginnerFriendly: null,
    includedServices: [...common.features.filter(f => /Wi-Fi|Air conditioning|safe|luggage/i.test(f)), 'Free parking'],
    optionalServices: [
      'Kitesurf, wing foil and surf lessons (Pata Negra Kitesurf School / Live to Fly Tarifa, based at the hotel)',
      'Surf shop with equipment on the beach',
      `Restaurant Copacabana Garden${hours ? ` (${hours[1]}-${hours[2]})` : ''} and bar`,
      'Pets: water and food bowls for a one-off EUR 20',
    ],
    accommodation: 'beach hotel rooms',
    mealPlan: null, // a la carte breakfast in the restaurant; the rate plans are not on the site
    languages: [],
    rooms: contentRooms,
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: COPA_HOME_URL,
    bookingUrl: COPA_ROOMS_URL,
    sourceText: [
      `home: ${intro} ${svc}`,
      `school: ${school} ${base}`,
      `surf shop: ${shop}`,
      `restaurant: ${restaurant}`,
      `pets: ${pets}`,
      `rooms (${common.rooms} of ${common.types} types): ${rooms.map(r => `${r.name}: max ${r.maxPersons}, ${r.beds}, ${r.priceText}`).join(' | ')}`,
    ].join('\n'),
  };
}

export const hotelCopacabanaBeachValdevaqueros: OfferAdapter = {
  key: 'hotel-copacabana-beach-valdevaqueros',
  name: 'Hotel Copacabana Beach',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Hotel Copacabana Beach Tarifa',
    websiteUrl: SITE,
    rootDomain: 'copacabanatarifa.com',
    contactEmail: 'info@copacabanatarifa.com',
    phone: '+34956065989',
  },
  url: COPA_HOME_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 5,
  confidence: 'medium', // year-less from-price window, year from the page edit
  async fetchContent() {
    const home = await get(COPA_HOME_URL);
    const rooms = await get(COPA_ROOMS_URL);
    const services = await get(COPA_SERVICES_URL);
    const gallery = await get(COPA_GALLERY_URL);
    return parseCopacabanaContent({ home, rooms, services, gallery });
  },
  async fetchSlots(ctx) {
    return fetchCopaSlots(ctx, todayIso());
  },
};
