// ---------------------------------------------------------------------------
// Pousada BGK, Barra Grande (Cajueiro da Praia, Piauí, Brazil) - beachfront pousada in a coconut grove
// with its own kite school (BGKite School, ABK-accredited) on the beach in front of the kite spot.
//
// Data path (checked 2026-10-12):
//   content  bgk.com.br (WordPress/Elementor, Portuguese; found via the contact address on the Omnibees
//            page): home (about, services, the four accommodation types, Pé de Vento bar/restaurant,
//            school teaser) + /bgkite-school (ABK accreditation, season, compressor, kite garage,
//            school contact) + the Omnibees hotel page book.omnibees.com/chain/2706/hotel/17602?lang=en-US
//            (English description, room cards, amenities, map pin #map-wrap data-lat/data-long,
//            photos media.omnibees.com/Images/17602/<Property|RoomTypes>/<id>.jpg).
//   slots    Omnibees booking engine (hotel 17602; page path chain 2706, results page c=9431 from the
//            page's `chainId = "9431"`; currency id 16 = BRL). The site's "Reserve já" buttons open
//            book.omnibees.com/hotel/17602. Engine code: src/offers/engines/omnibees.ts.
// robots.txt (2026-10-12): bgk.com.br allows everything (Yoast default); book.omnibees.com does not list
//   hotel 17602 or chains 2706 / 9431.
// Requests per run: content 3, slots 2 calendar + up to 6 results = 8.
// Parsed: calendar bands ("lowest|2026-10-12", hotel-wide lowest price for 2 adults) + room type x month
//   samples ("bungalow-essence|2026-11"), BRL per room per night for 2 adults.
// Known limits: holiday packages on /pacotes (minimum 3-5 nights, "tarifas de Alta Estação") are not
//   modelled; the engine's min-stay restriction shows them in the calendar bands (minNights).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent } from '../types.js';
import { fetchOmnibeesSlots, hotelUrl, originalImage, parseRoomCards, type OmnibeesHotel } from '../engines/omnibees.js';

export const BGK_HOTEL: OmnibeesHotel = { hotelId: 17602, chainPath: 2706, chainId: 9431, currencyId: 16 /* BRL, data-curr="16" */, currency: 'BRL', adults: 2, months: 6 };
export const BGK_HOTEL_URL = hotelUrl(BGK_HOTEL);
const SITE = 'https://bgk.com.br';
export const BGK_PAGES = { home: `${SITE}/`, school: `${SITE}/bgkite-school` } as const;

export interface BgkPages { home: string; school: string; hotel: string }

/** Own-site accommodation cards (Elementor call-to-action: title + teaser). */
export function parseBgkSiteRooms(homeHtml: string): Array<{ title: string; text: string }> {
  return parse(homeHtml).querySelectorAll('.elementor-cta__content').map(c => ({
    title: collapse(c.querySelector('.elementor-cta__title')?.text ?? ''),
    text: collapse(c.querySelector('.elementor-cta__description')?.text ?? '').replace(/\.\.\.$/, '').trim(),
  })).filter(r => /bangal|chal/i.test(r.title));
}

/** English room descriptions from the own site's Portuguese teasers, keyed by the Omnibees room name. */
const ROOM_MAP: Array<{ omnibees: RegExp; site: RegExp; en: (t: string) => string }> = [
  { omnibees: /essence/i, site: /ess[eê]ncia/i, en: () => 'Wood-and-glass bungalow with a thatched roof in the first row facing the sea, with a jacuzzi in a private guest lounge and a large veranda.' },
  { omnibees: /beira-mar/i, site: /frente mar/i, en: () => 'Thatched bungalow facing the sea, with a veranda and a private lounge on the lower level.' },
  { omnibees: /coqueiral/i, site: /coqueiral/i, en: () => 'Thatched bungalow in the second row, in the coconut grove, with a veranda and a private lounge on the lower level.' },
  { omnibees: /standard|masonry/i, site: /chal[eé] standard/i, en: t => `${t.match(/^(\d+) Chalés/)?.[1] ?? 'Three'} masonry chalets with thatched roofs in the coconut grove.` },
];

function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav, form, template, .cmplz-cookiebanner')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}

const IMG_JUNK = /logo|avatar|whatsapp|IMG-20\d{6}|Grupo-de-mascara|Objeto|parceiros|pedevento|ponta-do-sardim|lapertim|\.png/i;

export function parseBgkContent(p: BgkPages): OfferContent {
  const home = pageText(p.home);
  const school = pageText(p.school);
  const hotel = parse(p.hotel);
  const description = collapse(hotel.querySelector('.hotel-landing__description')?.text ?? '');
  const amenities = hotel.querySelectorAll('.amenity-group').map(g => ({
    group: collapse(g.querySelector('.amenity-category-text')?.text ?? ''),
    items: g.querySelectorAll('.amenity-item').map(i => collapse(i.text)).filter(Boolean),
  }));
  const cards = parseRoomCards(p.hotel);
  const siteRooms = parseBgkSiteRooms(p.home);
  const mapWrap = hotel.querySelector('#map-wrap');
  const lat = Number(mapWrap?.getAttribute('data-lat'));
  const lng = Number(mapWrap?.getAttribute('data-long'));
  const abk = /primeira escola CREDENCIADA pela (?:ABK )?Associação Brasileira de Kite/i.test(`${home} ${school}`);
  const seasonStart = /primeiros ventos,? que começam a entrar em julho|primeiros ventos em Julho/i.test(school);
  const seasonBest = /ideal entre agosto e novembro/i.test(school);
  const seasonEnd = /entre janeiro e fevereiro/i.test(school);

  const rooms: ContentRoom[] = cards.map(c => {
    const m = ROOM_MAP.find(x => x.omnibees.test(c.name));
    const site = m ? siteRooms.find(r => m.site.test(r.title)) : undefined;
    return {
      name: c.name,
      description: m && site ? m.en(site.text) : null,
      features: [...c.features, 'Split air conditioning', 'Hot water', 'Minibar'],
    };
  });

  const own: string[] = [];
  for (const m of p.home.matchAll(/https:\/\/bgk\.com\.br\/wp-content\/uploads\/[^"' )&]+\.(?:jpe?g|webp)/gi)) {
    const u = m[0];
    if (IMG_JUNK.test(u) || /-\d+x\d+\.(?:jpe?g|webp)$/i.test(u) || own.includes(u)) continue;
    own.push(u);
  }
  const ob: string[] = [];
  for (const m of p.hotel.matchAll(/https:\/\/media\.omnibees\.com\/Images\/17602\/(?:Property|RoomTypes)\/(?:\d+x\d+\/)?\d+\.jpg/g)) {
    const u = originalImage(m[0]);
    if (!ob.includes(u)) ob.push(u);
  }

  const season = seasonStart && seasonBest ? `the wind season starts in July, is best from August to November${seasonEnd ? ' and fades in January or February' : ''}` : null;
  const summary = [
    'Pousada BGK is a beachfront pousada in Barra Grande, Piauí, Brazil, set in a coconut grove facing Barra Grande beach, with a pool and guests-only bar, a beach bar and restaurant (Pé de Vento) open to the public, and its own kite school.',
    `Guests stay in thatched-roof bungalows (beachfront, coconut grove, or wood-and-glass "Essence" bungalows with a private jacuzzi lounge) or masonry chalets, all with split air conditioning, hot water and minibar; a daily breakfast buffet is served.`,
    `BGKite School sits on the beach in front of the kite spot${abk ? ', is accredited by the Brazilian Kite Association (ABK)' : ''} and offers an air compressor and a kite garage${season ? `; ${season}` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Pousada BGK',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Piauí',
    spot: 'Barra Grande',
    // Omnibees hotel page map pin (#map-wrap data-lat / data-long, 2026-10-12)
    spotCoords: Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? { lat, lng } : null,
    itinerarySpots: [],
    durationDays: null,
    // /bgkite-school: the spot "atrai velejadores do mundo inteiro ... além de ter as condições perfeitas para quem quer aprender" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /escola/i.test(school),
    equipmentRental: null,
    beginnerFriendly: /quem quer aprender|iniciar os alunos/i.test(school) ? true : null,
    includedServices: ['Breakfast buffet', 'Wi-Fi', 'Parking', 'Pool and guests-only bar'],
    optionalServices: ['Kite lessons at BGKite School (ABK-accredited)', 'Air compressor and kite garage at the school', 'Kayak rental', 'Pé de Vento beach bar and restaurant', 'Tours (Cavalo Marinho, manatee observatory, Cajueiro Rei)'],
    accommodation: 'beachfront thatched bungalows and masonry chalets',
    mealPlan: 'breakfast',
    languages: ['pt', 'en'], // own site: "Atendimento Bilingue"
    rooms,
    imageUrls: [...own, ...ob].slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: BGK_PAGES.home,
    bookingUrl: BGK_HOTEL_URL,
    sourceText: [
      `home: ${home.slice(0, 5000)}`,
      `kite school: ${school.slice(0, 3000)}`,
      `site rooms: ${siteRooms.map(r => `${r.title}: ${r.text}`).join(' | ')}`,
      `omnibees description: ${description}`,
      `omnibees rooms: ${cards.map(c => `${c.name} (${c.features.join(', ')})`).join('; ')}`,
      ...amenities.map(a => `${a.group}: ${a.items.join(', ')}`),
      `map pin: ${lat},${lng}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const pousadaBgkBarraGrande: OfferAdapter = {
  key: 'pousada-bgk-barra-grande',
  name: 'Pousada BGK Barra Grande',
  kind: 'accommodation',
  operator: {
    name: 'Pousada BGK',
    websiteUrl: SITE,
    rootDomain: 'bgk.com.br',
    contactEmail: 'contato@bgk.com.br',
    phone: '+558622210999',
    whatsapp: '+5586999899686',
  },
  url: BGK_PAGES.home,
  quote: { engine: 'omnibees', hotelId: BGK_HOTEL.hotelId, chainId: BGK_HOTEL.chainId, currencyId: BGK_HOTEL.currencyId, currency: BGK_HOTEL.currency },
  slotMethod: 'booking_engine',
  fetchBudget: 12,
  async fetchContent() {
    const home = await fetchText(BGK_PAGES.home, { accept: 'text/html' });
    const school = await fetchText(BGK_PAGES.school, { accept: 'text/html' });
    const hotel = await fetchText(BGK_HOTEL_URL, { accept: 'text/html' });
    return parseBgkContent({ home, school, hotel });
  },
  async fetchSlots(ctx) {
    return fetchOmnibeesSlots(BGK_HOTEL, ctx, 'pousada-bgk');
  },
};
