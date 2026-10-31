// ---------------------------------------------------------------------------
// Villa Rasa, Praia Rasa (Armação dos Búzios, Rio de Janeiro, Brazil) - beachfront pousada of 35 apartments and
// suites in two buildings (Villa da Praia on the sea side, Villa do Jardim across the street); surf, kitesurf and
// wing foil lessons are booked at the reception.
//
// Data path (checked 2026-10-12):
//   content  villarasa.com.br (WordPress, Portuguese with an English home /home-en/): /home-en/ (intro, "Wind and
//            Sea - Kite Surf" teaser, address and contacts), /experiencias/ ("KITESURF E WING FOIL ... aulas de Surf,
//            Kitesurf e Wing Foil. Agende sua aula diretamente na recepção"), /acomodacoes/ (the eight room types:
//            size, number of units, bed, maximum guests, amenities) + the Omnibees hotel page
//            book.omnibees.com/chain/11108/hotel/21103?lang=en-US (English description, room cards, amenities,
//            hours, map pin #map-wrap data-lat/data-long, photos media.omnibees.com/Images/21103/...).
//   slots    Omnibees booking engine (hotel 21103; chain 11108 for the page path and the results c= parameter, the
//            hotel page's `chainId = "11108"`; currency id 16 = BRL). The site's "Reservar" buttons open
//            book.omnibees.com/hotel/21103. Engine code: src/offers/engines/omnibees.ts.
// robots.txt (2026-10-12): villarasa.com.br disallows only /wp-admin/ and one plugin file; book.omnibees.com does not
//   list hotel 21103 or chain 11108.
// Requests per run: content 4, slots 2 calendar + up to 6 results = 8.
// Parsed: calendar bands ("lowest|2026-10-12", hotel-wide lowest price for 2 adults) + room type x month samples
//   ("master-suite|2026-11"), BRL per room per night for 2 adults.
// Known limits: the kite lessons are run by coaches the reception books (no school name, no prices on the site);
//   the own-site room texts are Portuguese, so room descriptions are built from the parsed facts (size, units,
//   guests, amenities).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent } from '../types.js';
import { fetchOmnibeesSlots, hotelUrl, originalImage, parseRoomCards, type OmnibeesHotel } from '../engines/omnibees.js';

export const VR_HOTEL: OmnibeesHotel = { hotelId: 21103, chainPath: 11108, chainId: 11108, currencyId: 16 /* BRL, data-curr="16" */, currency: 'BRL', adults: 2, months: 6 };
export const VR_HOTEL_URL = hotelUrl(VR_HOTEL);
const SITE = 'https://villarasa.com.br';
export const VR_PAGES = { home: `${SITE}/home-en/`, experiences: `${SITE}/experiencias/`, rooms: `${SITE}/acomodacoes/` } as const;

export interface VrPages { home: string; experiences: string; rooms: string; hotel: string }

/** Block-level visible lines (scripts, styles, navigation and forms dropped). */
function blockLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|select|svg|header|footer|nav|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|button|span)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, form, template')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text)
    .replace(/^Hit enter to search or ESC to close\s*/, '')
    .replace(/\s*VILLA RASA Desfrute do prazer[\s\S]*$/, '').trim();
}

export interface VrRoom { name: string; units: number | null; size: string | null; maxGuests: number | null; amenities: string[]; text: string }

const AMENITY = /^(TV de tela plana|Frigobar|Cofre eletrônico|Vista para a praia|Hidro Ofurô|Varanda|Chinelo|Roupão|Vista interna|Localizado na vila do jardim.*)$/;

/** /acomodacoes/: the tab names, then per room "<text> (Quantidade: n) <size>m² ... Máximo de hóspedes: n RESERVE AGORA Comodidades <amenities>". */
export function parseVrRooms(roomsHtml: string): VrRoom[] {
  const lines = blockLines(roomsHtml);
  const start = lines.indexOf('Acomodações', 1);
  const names: string[] = [];
  let i = start + 1;
  while (i < lines.length && /^(Suíte|Apartamento)\b/.test(lines[i]) && lines[i].length < 40) names.push(lines[i++]);
  const out: VrRoom[] = [];
  let cur: string[] = [];
  let amen: string[] | null = null;
  const flush = () => {
    if (!cur.length || out.length >= names.length) return;
    const t = cur.join(' ');
    out.push({
      name: names[out.length],
      units: Number(t.match(/\(Quantidade: (\d+)\)/)?.[1]) || null,
      size: t.match(/(\d+(?:\s?–\s?\d+)?)\s?m²/)?.[1]?.replace(/\s?–\s?/, '-') ?? null,
      maxGuests: Number(t.match(/Máximo de hóspedes:\s*(\d+)/)?.[1]) || null,
      amenities: [],
      text: t.replace(/\s*Tipos de cama:[\s\S]*$/, '').trim(),
    });
    amen = out[out.length - 1].amenities;
    cur = [];
  };
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l === 'RESERVE AGORA') { flush(); continue; }
    if (l === 'Comodidades') continue;
    if (amen && AMENITY.test(l)) { (amen as string[]).push(l); continue; }
    amen = null;
    if (out.length >= names.length) break;
    cur.push(l);
  }
  return out;
}

const AMENITY_EN: Record<string, string> = {
  'Vista para a praia': 'Sea view', 'Hidro Ofurô': 'Hot tub', Varanda: 'Balcony', 'TV de tela plana': 'Flat-screen TV',
  Frigobar: 'Minibar', 'Cofre eletrônico': 'Safe', 'Vista interna': 'Inside view',
};
const ROOM_MAP: Array<[RegExp, string]> = [
  [/^villa suite/i, 'Suíte da Villa'], [/^master suite with bathtub/i, 'Suíte Master com Banheira'], [/^master suite$/i, 'Suíte Master'],
  [/^luxury suite/i, 'Suíte Luxo'], [/^superior apartment with balcony/i, 'Apartamento Superior com Varanda'],
  [/^superior apartment$/i, 'Apartamento Superior'], [/^garden suite/i, 'Suíte Jardim'], [/^standard apartment/i, 'Apartamento Standard'],
];

/** Omnibees cuts long card names ("Garden Suite - (Need to Cross the Street..."); the card photo's alt keeps the full one. */
export function vrCardNames(hotelHtml: string): string[] {
  return parse(hotelHtml).querySelectorAll('.hotel-landing__room-card').map(card => {
    const shown = collapse(card.querySelector('.hotel-landing__room-name')?.text ?? '');
    const alt = collapse(card.querySelector('img')?.getAttribute('alt') ?? '').replace(/ of Villa Rasa$/i, '');
    return shown.endsWith('...') && alt.startsWith(shown.slice(0, -3)) ? alt : shown;
  }).filter(Boolean);
}

function roomDescription(r: VrRoom): string {
  const parts = [
    r.units ? `${r.units} ${r.units === 1 ? 'unit' : 'units'}` : null,
    r.size ? `${r.size} m2` : null,
    r.maxGuests ? `up to ${r.maxGuests} guests` : null,
    r.amenities.some(a => /^Localizado na vila do jardim/.test(a)) || /outro lado da rua/i.test(r.text) ? 'in Villa do Jardim across the street' : null,
  ].filter(Boolean);
  return parts.join(', ');
}

export function parseVillaRasaContent(p: VrPages): OfferContent {
  const home = pageText(p.home);
  const experiences = pageText(p.experiences);
  const siteRooms = parseVrRooms(p.rooms);
  const hotel = parse(p.hotel);
  const description = collapse(hotel.querySelector('.hotel-landing__description')?.text ?? '');
  const fromPrice = collapse(hotel.querySelector('.hotel-landing__price-value')?.text ?? '');
  const hours = collapse(hotel.querySelector('.hotel-landing__hours')?.text ?? '');
  const amenities = hotel.querySelectorAll('.amenity-group').map(g => ({
    group: collapse(g.querySelector('.amenity-category-text')?.text ?? ''),
    items: g.querySelectorAll('.amenity-item').map(i => collapse(i.text)).filter(Boolean),
  }));
  const fullNames = vrCardNames(p.hotel);
  const cards = parseRoomCards(p.hotel).map((c, i) => ({ ...c, name: fullNames[i] ?? c.name }));
  const mapWrap = hotel.querySelector('#map-wrap');
  const lat = Number(mapWrap?.getAttribute('data-lat'));
  const lng = Number(mapWrap?.getAttribute('data-long'));
  const kiteBlock = experiences.match(/KITESURF E WING FOIL ([^]*?recepção\.)/)?.[1] ?? null;
  const beachUnits = description.match(/there are (\d+) apartments and suites/)?.[1] ?? null;
  const gardenUnits = description.match(/with (\d+) more standard apartments/)?.[1] ?? null;

  const rooms: ContentRoom[] = cards.map(c => {
    const siteName = ROOM_MAP.find(([re]) => re.test(c.name))?.[1];
    const site = siteName ? siteRooms.find(r => r.name === siteName) : undefined;
    const feats = site ? site.amenities.map(a => AMENITY_EN[a]).filter((x): x is string => !!x) : [];
    return { name: c.name, description: site ? roomDescription(site) || null : null, features: [...new Set([...c.features, ...feats])] };
  });

  const own: string[] = [];
  for (const html of [p.rooms, p.home, p.experiences]) {
    for (const m of html.matchAll(/https?:\/\/villarasa\.com\.br\/wp-content\/uploads\/[^"' )&]+\.(?:jpe?g|webp)/gi)) {
      const u = m[0].replace(/^http:/, 'https:').replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
      if (/selos|popup|logo|BG2-01|05000002-m/i.test(u) || own.includes(u)) continue;
      own.push(u);
    }
  }
  const ob: string[] = [];
  for (const m of p.hotel.matchAll(/https:\/\/media\.omnibees\.com\/Images\/21103\/(?:Property|RoomTypes)\/(?:\d+x\d+\/)?\d+\.jpe?g/g)) {
    const u = originalImage(m[0]);
    if (!ob.includes(u)) ob.push(u);
  }
  // own-site photos: a few per room type (they come in long per-room runs), then the Omnibees originals
  const perRoom = new Map<string, number>();
  const ownPicked = own.filter(u => {
    const k = u.split('/').pop()!.replace(/-?\d*(?:-\d+)*\.(?:jpe?g|webp)$/i, '');
    const n = (perRoom.get(k) ?? 0) + 1;
    perRoom.set(k, n);
    return n <= 3;
  });

  const summary = [
    `Villa Rasa is a beachfront pousada on Praia Rasa in Armação dos Búzios (Rio de Janeiro state, Brazil) with ${beachUnits && gardenUnits ? Number(beachUnits) + Number(gardenUnits) : 35} apartments and suites in two buildings: Villa da Praia on the sea side and Villa do Jardim across the street.`,
    `Surf, kitesurf and wing foil lessons ${kiteBlock ? 'are booked directly at the reception' : 'are offered'}; the pousada also has a pool on each side, a spa, yoga classes, stand-up paddle and the Mero restaurant facing the beach.`,
    'Rooms range from 25 m2 apartments to a 90 m2 sea-view suite with a hot tub; breakfast is served daily.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Villa Rasa',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Búzios, Rio de Janeiro',
    spot: 'Praia Rasa',
    // Omnibees hotel page map pin (#map-wrap data-lat / data-long, 2026-10-12)
    spotCoords: Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? { lat, lng } : null,
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: kiteBlock ? /Kitesurf/i.test(kiteBlock) : /kite surf lessons/i.test(home),
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: ['Breakfast', 'Wi-Fi', 'Parking (limited spaces)', 'Pools'],
    optionalServices: [
      'Surf, kitesurf and wing foil lessons (booked at the reception)',
      'Spa and massages', 'Yoga classes on the beach', 'Stand-up paddle', 'Mero restaurant', 'Events and weddings',
    ],
    accommodation: 'beachfront pousada apartments and suites',
    mealPlan: /Breakfast Hours/i.test(hours) ? 'breakfast' : null,
    languages: ['pt', 'en', 'es'], // site language switch PT / EN / ES
    rooms,
    imageUrls: [...ownPicked, ...ob].slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: VR_PAGES.home,
    bookingUrl: VR_HOTEL_URL,
    sourceText: [
      `home: ${home}`,
      `experiences: ${experiences}`,
      `kite: ${kiteBlock ?? '-'}`,
      `site rooms: ${siteRooms.map(r => `${r.name}: ${r.text} [units ${r.units ?? '-'}, ${r.size ?? '-'} m2, max ${r.maxGuests ?? '-'}; ${r.amenities.join(', ')}]`).join(' | ')}`,
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
export const villaRasaBuzios: OfferAdapter = {
  key: 'villa-rasa-buzios',
  name: 'Villa Rasa Búzios',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Villa Rasa',
    websiteUrl: SITE,
    rootDomain: 'villarasa.com.br',
    contactEmail: 'reservas@villarasa.com.br',
    phone: '+552230959300',
  },
  url: VR_PAGES.home,
  quote: { engine: 'omnibees', hotelId: VR_HOTEL.hotelId, chainId: VR_HOTEL.chainId, currencyId: VR_HOTEL.currencyId, currency: VR_HOTEL.currency },
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 12,
  async fetchContent() {
    const home = await fetchText(VR_PAGES.home, { accept: 'text/html' });
    const experiences = await fetchText(VR_PAGES.experiences, { accept: 'text/html' });
    const rooms = await fetchText(VR_PAGES.rooms, { accept: 'text/html' });
    const hotel = await fetchText(VR_HOTEL_URL, { accept: 'text/html' });
    return parseVillaRasaContent({ home, experiences, rooms, hotel });
  },
  async fetchSlots(ctx) {
    return fetchOmnibeesSlots(VR_HOTEL, ctx, 'villa-rasa');
  },
};
