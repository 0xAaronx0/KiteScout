// ---------------------------------------------------------------------------
// Amagali Pousada, Galinhos (Rio Grande do Norte, Brazil) - 18-unit pousada (opened 2009) on the river arm of the
// Galinhos peninsula, 165 km north of Natal; the site has a kitesurf page (4 spots by season, best October to
// March, 20-30 knots) and says its team helps kitesurfers of every level.
//
// Data path (checked 2026-10-12):
//   content  amagali.com (static HTML template, Portuguese): / (history, 18 rooms, room teasers, "Kitesurf em
//            Galinhos"), /room.html (the three room types with sizes and equipment), /passeios.html (tours and the
//            Kitesurf block: spots per season, wind) + the Omnibees hotel page
//            book.omnibees.com/chain/9872/hotel/18649?lang=en-US (the NEW Omnibees page layout: description
//            #hotel-info, room cards .card with full names in the photo alt, amenities, hours, map pin
//            .google_map data-lat/data-lng, photos media.omnibees.com/Images/18649/...).
//   slots    Omnibees booking engine (hotel 18649; chain 9872 for the page path and the results c= parameter, the
//            hotel page's `chainId = "9872"`; currency id 16 = BRL). The site's "Reservar" buttons open
//            book.omnibees.com/hotel/18649?currencyId=16. Engine code: src/offers/engines/omnibees.ts.
// robots.txt (2026-10-12): amagali.com has none (404 = allow all); book.omnibees.com does not list hotel 18649 or
//   chain 9872.
// Requests per run: content 4, slots 2 calendar + up to 6 results = 8.
// Parsed: calendar bands ("lowest|2026-10-12", hotel-wide lowest price for 2 adults) + room type x month samples
//   ("roof-top-apartment|2026-11"), BRL per room per night for 2 adults.
// Shared here: parseOmnibeesPageV2() reads the new Omnibees hotel-page layout (the engine's parseRoomCards only
//   knows the old .hotel-landing__* layout); oiti-beach-resort-tutoia.ts imports it. Candidate for
//   src/offers/engines/omnibees.ts.
// Known limits: kite link = the site's kitesurf texts (no own school, storage or rental named); the own site still
//   carries template filler (menu and services sections) that is ignored.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent } from '../types.js';
import { fetchOmnibeesSlots, hotelUrl, originalImage, type OmnibeesHotel } from '../engines/omnibees.js';

export const AMG_HOTEL: OmnibeesHotel = { hotelId: 18649, chainPath: 9872, chainId: 9872, currencyId: 16 /* BRL, data-curr="16" */, currency: 'BRL', adults: 2, months: 6 };
export const AMG_HOTEL_URL = hotelUrl(AMG_HOTEL);
const SITE = 'https://amagali.com';
export const AMG_PAGES = { home: `${SITE}/`, rooms: `${SITE}/room.html`, tours: `${SITE}/passeios.html` } as const;

// --- new Omnibees hotel-page layout (shared with oiti-beach-resort-tutoia.ts) ---------------------
export interface OmnibeesPageV2 {
  description: string;
  coords: { lat: number; lng: number } | null;
  rooms: Array<{ name: string; maxGuests: number | null; view: string | null; photo: string | null }>;
  amenities: Array<{ group: string; items: string[] }>;
  hours: string;
  photos: string[];
}

/** New layout (2026): #hotel-info, .google_map[data-lat][data-lng], .rooms .card (img alt = full room name). */
export function parseOmnibeesPageV2(html: string, hotelId: number): OmnibeesPageV2 {
  const root = parse(html);
  const map = root.querySelector('.google_map[data-lat]');
  const lat = Number(map?.getAttribute('data-lat'));
  const lng = Number(map?.getAttribute('data-lng'));
  const rooms = root.querySelectorAll('.rooms .card').map(card => {
    const img = card.querySelector('img.room-image');
    const shown = collapse(card.querySelector('.single-room-title')?.text ?? '');
    const alt = collapse(img?.getAttribute('alt') ?? '');
    const icons = card.querySelectorAll('.icons img.adults').length;
    const plural = Number(card.querySelector('.icons .plural')?.text.replace(/\D/g, ''));
    const view = collapse(card.querySelector('.room-bed-name')?.text ?? '') || null;
    return {
      name: shown.endsWith('...') && alt ? alt : shown,
      maxGuests: plural > 0 ? plural : icons > 0 ? icons : null,
      view,
      photo: img?.getAttribute('src') ?? null,
    };
  }).filter(r => r.name);
  const amenities = root.querySelectorAll('.amenity-group').map(g => ({
    group: collapse(g.querySelector('.amenity-category-text')?.text ?? ''),
    items: g.querySelectorAll('.amenity-item').map(i => collapse(i.text).replace(/^✓\s*/, '')).filter(Boolean),
  }));
  const hours = root.querySelectorAll('.info-title').map(t => {
    const vals = (t.parentNode?.querySelectorAll('.info-hours') ?? []).map(h => collapse(h.text));
    return `${collapse(t.text)}: ${vals.join(' ')}`;
  }).join('; ');
  const photos: string[] = [];
  const re = new RegExp(`https://media\\.omnibees\\.com/Images/${hotelId}/(?:Property|RoomTypes)/(?:\\d+x\\d+/)?\\d+\\.jpe?g`, 'g');
  for (const m of html.matchAll(re)) {
    const u = originalImage(m[0]);
    if (!photos.includes(u)) photos.push(u);
  }
  return {
    description: clean(root.querySelector('#hotel-info')?.innerHTML ?? ''),
    coords: Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? { lat, lng } : null,
    rooms,
    amenities,
    hours,
    photos,
  };
}

// --- own site -------------------------------------------------------------------------------------
/** Block-level visible lines (scripts, styles, navigation and forms dropped). */
function blockLines(html: string): string[] {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|select|svg|header|footer|nav|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|button)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

export interface AmgKite { intro: string | null; spot: string[]; seasons: Array<{ months: string; spots: string }> }

/** passeios.html "Kitesurf" block + the home page's "1. Kitesurf em Galinhos" paragraph. */
export function parseAmgKite(toursHtml: string, homeHtml: string): AmgKite {
  const lines = blockLines(toursHtml);
  const at = lines.indexOf('Kitesurf');
  const block: string[] = [];
  for (let i = at + 1; at >= 0 && i < lines.length && !/^(Número|Email|Links úteis)/.test(lines[i]); i++) block.push(lines[i].replace(/\s*Saiba Mais\s*$/, ''));
  const seasons: Array<{ months: string; spots: string }> = [];
  for (let i = 0; i < block.length - 1; i++) {
    const m = block[i].match(/^([A-Za-zçã]+ a [A-Za-zçã]+): (\d+) Sport$/);
    if (m) seasons.push({ months: m[1], spots: block[i + 1] });
  }
  const intro = blockLines(homeHtml).find(l => /^1\. Kitesurf em Galinhos/.test(l)) ?? null;
  return { intro, spot: block.filter(l => !/Sport$|^Temporadas|^\+\d|@/.test(l) && !seasons.some(s => s.spots === l)), seasons };
}

export interface AmgRoom { name: string; text: string }
/** room.html: "<name> <equipment list> <name> tem uma área de ..." blocks ending in "Saiba Mais". */
export function parseAmgRooms(roomsHtml: string): AmgRoom[] {
  const out: AmgRoom[] = [];
  let heading: string | null = null;
  for (const l of blockLines(roomsHtml)) {
    if (/^(?:Chalé|Apartamento) [A-Z][A-Za-z ]+$/i.test(l) && l.length < 40) { heading = l; continue; }
    if (heading && l.length > 80 && /\d+\s?m2/.test(l)) { out.push({ name: heading, text: l.replace(/\s*Saiba Mais\s*$/, '') }); heading = null; }
  }
  return out;
}

const PT_MONTH: Record<string, string> = { janeiro: 'January', fevereiro: 'February', março: 'March', abril: 'April', maio: 'May', junho: 'June', julho: 'July', agosto: 'August', setembro: 'September', outubro: 'October', novembro: 'November', dezembro: 'December' };
const enMonths = (s: string) => s.replace(/[A-Za-zçã]+/g, w => PT_MONTH[w.toLowerCase()] ?? (w === 'a' ? 'to' : w));

export interface AmgPages { home: string; rooms: string; tours: string; hotel: string }

export function parseAmagaliContent(p: AmgPages): OfferContent {
  const home = blockLines(p.home);
  const kite = parseAmgKite(p.tours, p.home);
  const siteRooms = parseAmgRooms(p.rooms);
  const ob = parseOmnibeesPageV2(p.hotel, AMG_HOTEL.hotelId);
  const nRooms = home.join(' ').match(/(\d+) Quartos/)?.[1] ?? null;
  const opened = home.join(' ').match(/em (20\d\d) tivemos a inauguração/)?.[1] ?? null;
  const spotText = kite.spot.join(' ');
  const best = spotText.match(/melhores meses para kitesurf são de ([a-zçã]+) a ([a-zçã]+)/i);
  const knots = spotText.match(/(\d+) a (\d+) nós/);
  const nSpots = spotText.match(/navegar em (\d+) spots/)?.[1] ?? null;

  const ROOM_MAP: Array<[RegExp, RegExp]> = [
    [/roof top/i, /Roof Top/i], [/classic/i, /Classic/i], [/charming (?:family )?chalet/i, /Chalé Charme/i],
  ];
  const rooms: ContentRoom[] = ob.rooms.map(r => {
    const site = siteRooms.find(s => ROOM_MAP.some(([o, si]) => o.test(r.name) && si.test(s.name)));
    const family = /family/i.test(r.name);
    // the 30 m2 of room.html belong to the couple chalet; the family chalet text only gives its beds
    const size = family ? null : site?.text.match(/(\d+)\s?m2/)?.[1] ?? null;
    return {
      name: r.name,
      description: [
        size ? `${size} m2` : null,
        family && /chalé Família com dois quartos/i.test(site?.text ?? '') ? 'two bedrooms (one king-size bed, two single beds) sharing one bathroom' : null,
        r.view ? r.view.toLowerCase() : null,
        /prédio principal/.test(site?.text ?? '') ? 'in the main building' : /ao lado da piscina/.test(site?.text ?? '') ? 'next to the pool' : null,
      ].filter(Boolean).join(', ') || null,
      features: [r.maxGuests ? `Up to ${r.maxGuests} guests` : null, r.view, 'Air conditioning', 'Minibar', 'Solar-heated hot water'].filter((x): x is string => !!x),
    };
  });

  const own: string[] = [];
  for (const [html, base] of [[p.home, AMG_PAGES.home], [p.rooms, AMG_PAGES.rooms], [p.tours, AMG_PAGES.tours]] as const) {
    for (const m of html.matchAll(/src="(\.?\/?img\/[^"]+\.(?:jpe?g|webp))"/gi)) {
      if (/icon|logo|testimonial|wpp|flag|removebg/i.test(m[1])) continue;
      const u = new URL(m[1], base).toString();
      if (!own.includes(u)) own.push(u);
    }
  }

  const summary = [
    `Amagali Pousada is a small pousada with ${nRooms ?? '18'} rooms${opened ? `, opened in ${opened},` : ''} on the river arm of the Galinhos peninsula, 165 km north of Natal (Rio Grande do Norte, Brazil), reached by boat or across the dunes; it has a pool, a bar and a restaurant on a 20,000 m2 coconut grove.`,
    'Guests stay in chalets by the pool (including a two-bedroom family chalet) or apartments in the main building, with air conditioning and solar-heated water; breakfast is served daily.',
    `The site describes Galinhos as a kitesurf destination with ${nSpots ?? 'several'} spots for all levels${best ? `, best from ${PT_MONTH[best[1].toLowerCase()] ?? best[1]} to ${PT_MONTH[best[2].toLowerCase()] ?? best[2]}` : ''}${knots ? ` with ${knots[1]} to ${knots[2]} knots` : ''}, and says the Amagali team helps kitesurfers of any level; it names no own kite school.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Amagali Pousada',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Galinhos, Rio Grande do Norte',
    spot: 'Galinhos',
    // Omnibees hotel page map pin (.google_map data-lat / data-lng, 2026-10-12)
    spotCoords: ob.coords,
    itinerarySpots: [],
    durationDays: null,
    // passeios.html: "kitesurfistas de todos os níveis encontrarão o que procuram" (2026-10-12)
    skillLevels: /todos os níveis/i.test(spotText) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: null,
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: ['Breakfast', 'Pool'],
    optionalServices: [
      'Canoe tour with oyster tasting', 'Buggy tour of the dunes', 'Kayak trails (R$ 70 per person)', 'Sunset carriage ride to the lighthouse',
      'Yoga class and massage (partners)', 'Boat access to the kite spots (Presídio beach)',
    ],
    accommodation: 'pousada chalets and apartments',
    mealPlan: 'breakfast',
    languages: ['pt'],
    rooms,
    imageUrls: [...own, ...ob.photos].slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: AMG_PAGES.home,
    bookingUrl: AMG_HOTEL_URL,
    sourceText: [
      `home: ${home.filter(l => !/blind texts|Far far away/.test(l)).join(' ').slice(0, 5000)}`,
      `kite intro: ${kite.intro ?? '-'}`,
      `kite spot: ${spotText}`,
      `kite seasons: ${kite.seasons.map(s => `${enMonths(s.months)}: ${s.spots}`).join(' | ')}`,
      `site rooms: ${siteRooms.map(r => r.text).join(' | ')}`,
      `omnibees description: ${ob.description}`,
      `omnibees rooms: ${ob.rooms.map(r => `${r.name} (max ${r.maxGuests ?? '-'}, ${r.view ?? '-'})`).join('; ')}`,
      ...ob.amenities.map(a => `${a.group}: ${a.items.join(', ')}`),
      `hours: ${ob.hours}`,
      `map pin: ${ob.coords ? `${ob.coords.lat},${ob.coords.lng}` : '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const amagaliPousadaGalinhos: OfferAdapter = {
  key: 'amagali-pousada-galinhos',
  name: 'Amagali Pousada Galinhos',
  kind: 'accommodation',
  operator: {
    name: 'Amagali Pousada',
    websiteUrl: SITE,
    rootDomain: 'amagali.com',
    contactEmail: 'info@amagali.com',
    phone: '+5584994521317',
  },
  url: AMG_PAGES.home,
  quote: { engine: 'omnibees', hotelId: AMG_HOTEL.hotelId, chainId: AMG_HOTEL.chainId, currencyId: AMG_HOTEL.currencyId, currency: AMG_HOTEL.currency },
  slotMethod: 'booking_engine',
  fetchBudget: 12,
  async fetchContent() {
    const home = await fetchText(AMG_PAGES.home, { accept: 'text/html' });
    const rooms = await fetchText(AMG_PAGES.rooms, { accept: 'text/html' });
    const tours = await fetchText(AMG_PAGES.tours, { accept: 'text/html' });
    const hotel = await fetchText(AMG_HOTEL_URL, { accept: 'text/html' });
    return parseAmagaliContent({ home, rooms, tours, hotel });
  },
  async fetchSlots(ctx) {
    return fetchOmnibeesSlots(AMG_HOTEL, ctx, 'amagali');
  },
};
