// ---------------------------------------------------------------------------
// Rancho do Peixe, Praia do Preá (Cruz, Ceará, Brazil) - 26 beach bungalows 12 km from Jericoacoara with
// its own Water Sports Center (kitesurf, kitefoil, wingfoil school, rental, storage, downwinders).
//
// Data path (checked 2026-10-12):
//   content  ranchodopeixe.com.br (WordPress/Avada, Portuguese only): home (intro, transfer, awards),
//            /o-rancho-do-peixe/ (26 bungalows: 12 beach-view, 14 in the coconut grove, facilities),
//            /bangalos/ (the two bungalow types), /water-sports-center/ (school, rental, storage, seasons,
//            Google Maps pin "Rancho do Peixe") + the Omnibees hotel page
//            book.omnibees.com/chain/1881/hotel/3088?lang=en-US (English description, room types,
//            amenities, photos media.omnibees.com/Images/3088/<Property|RoomTypes>/<id>.jpg).
//   slots    Omnibees booking engine (hotel 3088, chain 1881 for both the page path and the results
//            c= parameter, currency id 16 = BRL; the site's "RESERVE AGORA" button opens
//            /hotelresults?q=3088). Engine code: src/offers/engines/omnibees.ts (calendar bands + one
//            sample stay per month on the results page).
// robots.txt (2026-10-12): ranchodopeixe.com.br disallows only /wp-admin/; book.omnibees.com does not
//   list hotel 3088 or chain 1881 (only /extras, /bookdetails and other properties' ids).
// Requests per run: content 5, slots 2 calendar + up to 6 results = 8.
// Parsed: calendar bands ("lowest|2026-10-12", hotel-wide lowest price for 2 adults) + room type x month
//   samples ("beach-bungalow|2026-11"), BRL per bungalow per night for 2 adults, availability from the
//   room's inventory text or the calendar.
// Known limits: the own site gives two sizes for the beach bungalows (64 m2 on /o-rancho-do-peixe/,
//   80 m2 on /bangalos/) - no size is published for them here. Prices exclude taxes and fees
//   (Omnibees: "Taxes and fees not included").
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent } from '../types.js';
import { fetchOmnibeesSlots, hotelUrl, originalImage, parseRoomCards, type OmnibeesHotel } from '../engines/omnibees.js';

export const RP_HOTEL: OmnibeesHotel = { hotelId: 3088, chainPath: 1881, chainId: 1881, currencyId: 16 /* BRL, data-curr="16" */, currency: 'BRL', adults: 2, months: 6 };
export const RP_HOTEL_URL = hotelUrl(RP_HOTEL);
const SITE = 'https://ranchodopeixe.com.br';
export const RP_PAGES = {
  home: `${SITE}/`,
  rancho: `${SITE}/o-rancho-do-peixe/`,
  bungalows: `${SITE}/bangalos/`,
  wsc: `${SITE}/water-sports-center/`,
} as const;

export interface RpPages { home: string; rancho: string; bungalows: string; wsc: string; hotel: string }

/** Avada pages: the post content sits between the author/date line and the footer navigation. */
function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav, form, template')) el.remove();
  const t = collapse((root.querySelector('main') ?? root.querySelector('#main') ?? root.querySelector('body') ?? root).text);
  return t.replace(/\s*Toggle Navigation[\s\S]*$/, '').trim();
}

const IMG_JUNK = /mobile|header[-_]|banner-cam|conde\d|tchotel|braztoa|rodape|selo|xodo|e-group|-PB\.|circuito|cadastrur|naturakaiak|richards|\/baixa\.|\/alta\.|\/ssf\.|temporada|logo|favicon|\.svg|\.png/i;

export function parseRanchoContent(p: RpPages): OfferContent {
  const home = pageText(p.home);
  const rancho = pageText(p.rancho);
  const bungalows = pageText(p.bungalows);
  const wsc = pageText(p.wsc);
  const hotel = parse(p.hotel);
  const description = collapse(hotel.querySelector('.hotel-landing__description')?.text ?? '');
  const fromPrice = collapse(hotel.querySelector('.hotel-landing__price-value')?.text ?? '');
  const amenities = hotel.querySelectorAll('.amenity-group').map(g => ({
    group: collapse(g.querySelector('.amenity-category-text')?.text ?? ''),
    items: g.querySelectorAll('.amenity-item').map(i => collapse(i.text)).filter(Boolean),
  }));
  const cards = parseRoomCards(p.hotel);

  const nBungalows = rancho.match(/Nossos (\d+) bangalôs/)?.[1] ?? bungalows.match(/São (\d+) bangalôs/)?.[1] ?? null;
  const nBeach = rancho.match(/temos (\d+) bangalôs/)?.[1] ?? null;
  const nGrove = rancho.match(/estão localizados (\d+) bangalôs/)?.[1] ?? null;
  const groveSize = rancho.match(/espaço de (\d+)\s?m2/)?.[1] ?? bungalows.match(/Bangalô Coqueiral Com (\d+) m²/)?.[1] ?? null;
  const yearsAtPrea = home.match(/Presente no Preá há (\d+) anos/)?.[1] ?? null;
  const PT_MONTH = '(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)';
  const low = wsc.match(new RegExp(`Baixa Temporada\\s*${PT_MONTH}\\s*-\\s*${PT_MONTH}`, 'i'));
  const high = wsc.match(new RegExp(`Alta Temporada\\s*${PT_MONTH}\\s*-\\s*${PT_MONTH}`, 'i'));
  const hours = wsc.match(/Horário de funcionamento:\s*([\dh ]+as [\dh]+)/)?.[1] ?? null;
  const ptMonth: Record<string, string> = { janeiro: 'January', fevereiro: 'February', março: 'March', abril: 'April', maio: 'May', junho: 'June', julho: 'July', agosto: 'August', setembro: 'September', outubro: 'October', novembro: 'November', dezembro: 'December' };
  const en = (m: string | undefined) => (m ? ptMonth[m.toLowerCase()] ?? m : '');
  const map = [p.wsc, p.rancho, p.home].map(h => h.match(/maps\/embed\?pb=[^"']*?!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/)).find(Boolean) ?? null;

  const isBeach = (name: string) => /beach|praia/i.test(name);
  const rooms: ContentRoom[] = cards.map(c => ({
    name: c.name,
    description: isBeach(c.name)
      ? `${nBeach ?? '12'} bungalows facing Preá beach on raised decks, built from wood and carnaúba straw and cooled by the wind (no air conditioning).`
      : `${nGrove ?? '14'} bungalows in the coconut grove${groveSize ? ` with ${groveSize} m2` : ''} and an extra deck with outdoor shower, built from wood and carnaúba straw and cooled by the wind (no air conditioning).`,
    features: [
      ...c.features,
      'Veranda with hammocks and loungers',
      '1 king-size bed and 2 single beds',
      'Ceiling fan, minibar, safe, espresso machine',
      'High-speed Wi-Fi',
      'No air conditioning or TV',
    ],
  }));

  const seen = new Set<string>();
  const own: string[] = [];
  for (const [html, base] of [[p.rancho, RP_PAGES.rancho], [p.bungalows, RP_PAGES.bungalows], [p.home, RP_PAGES.home], [p.wsc, RP_PAGES.wsc]] as const) {
    for (const u of imageCandidates(html, base, null, 60)) {
      if (!u.startsWith(`${SITE}/wp-content/uploads/`) || IMG_JUNK.test(u)) continue;
      // home: only the photo strip (the rest are award and partner badges)
      if (base === RP_PAGES.home && !/rancho-do-peixer-img-\d+\.jpg/.test(u)) continue;
      const k = u.replace(/\?.*$/, '').split('/').pop()!.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
      if (seen.has(k)) continue;
      seen.add(k); own.push(u.replace(/\?.*$/, ''));
    }
  }
  const ob: string[] = [];
  for (const m of p.hotel.matchAll(/https:\/\/media\.omnibees\.com\/Images\/3088\/(?:Property|RoomTypes)\/\d+x\d+\/\d+\.jpg/g)) {
    const u = originalImage(m[0]);
    if (!ob.includes(u)) ob.push(u);
  }

  const summary = [
    `Rancho do Peixe is a beach pousada on Praia do Preá, a fishing village in Ceará, Brazil, 12 km from Jericoacoara, with ${nBungalows ?? '26'} bungalows on a 64,000 m2 plot${yearsAtPrea ? ` that it has run for ${yearsAtPrea} years` : ''}.`,
    `The bungalows (${nBeach ?? '12'} facing the beach, ${nGrove ?? '14'} in a coconut grove, up to 4 guests each) are built from wood and carnaúba straw and cooled by the wind instead of air conditioning; breakfast, a 25 m pool, a restaurant and a beach bar for guests are on site.`,
    `Its own Water Sports Center teaches kitesurf and wingfoil for all levels, rents kite, kitefoil and wingfoil gear, stores guests' equipment for free and runs downwinders and coachings${high ? `; high season is ${en(high[1])} to ${en(high[2])}` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Rancho do Peixe',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Ceará',
    spot: 'Preá',
    // Google Maps embed on the own site, pin "Rancho do Peixe" (2026-10-12)
    spotCoords: map ? { lat: Number(map[2]), lng: Number(map[1]) } : null,
    itinerarySpots: [],
    durationDays: null,
    // /o-rancho-do-peixe/: "aulas de kitesurf e wingfoil para todos os níveis, desde iniciantes até avançados" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /aulas de kitesurf/i.test(rancho) || /Escola/i.test(wsc),
    equipmentRental: /aluguel de equipamentos/i.test(`${rancho} ${wsc}`),
    beginnerFriendly: /iniciantes/i.test(rancho) ? true : null,
    includedServices: ['Breakfast', 'Kite equipment storage (guarderia) at the Water Sports Center', 'Wi-Fi', 'Daily housekeeping', 'Pool and guest beach area'],
    optionalServices: [
      'Kitesurf, kitefoil and wingfoil lessons (Water Sports Center)',
      'Equipment rental and repairs',
      'Downwinders and coachings (with Surfin Sem Fim)',
      'Airport transfer from Fortaleza (FOR) and Jericoacoara (JJD)',
      'Massage',
      'Restaurant (regional cuisine)',
    ],
    accommodation: 'beach and coconut-grove bungalows',
    mealPlan: 'breakfast',
    languages: ['pt', 'en'], // own site Portuguese only; English booking engine
    rooms,
    imageUrls: [...own, ...ob].slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: RP_PAGES.rancho,
    bookingUrl: RP_HOTEL_URL,
    sourceText: [
      `home: ${home}`,
      `o rancho do peixe: ${rancho}`,
      `bangalos: ${bungalows}`,
      `water sports center: ${wsc}`,
      `water sports center hours: ${hours ?? '-'}; low season ${low ? `${en(low[1])}-${en(low[2])}` : '-'}; high season ${high ? `${en(high[1])}-${en(high[2])}` : '-'}`,
      `omnibees description: ${description}`,
      `omnibees from price: ${fromPrice}`,
      `omnibees rooms: ${cards.map(c => `${c.name} (${c.features.join(', ')})`).join('; ')}`,
      ...amenities.map(a => `${a.group}: ${a.items.join(', ')}`),
      `map pin: ${map ? `${map[2]},${map[1]}` : '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const ranchoDoPeixePrea: OfferAdapter = {
  key: 'rancho-do-peixe-prea',
  name: 'Rancho do Peixe Preá',
  kind: 'accommodation',
  operator: {
    name: 'Rancho do Peixe',
    websiteUrl: SITE,
    rootDomain: 'ranchodopeixe.com.br',
    contactEmail: 'reservas@ranchodopeixe.com.br',
    phone: '+5588997252875',
  },
  url: RP_PAGES.rancho,
  quote: { engine: 'omnibees', hotelId: RP_HOTEL.hotelId, chainId: RP_HOTEL.chainId, currencyId: RP_HOTEL.currencyId, currency: RP_HOTEL.currency },
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 14,
  async fetchContent() {
    const home = await fetchText(RP_PAGES.home, { accept: 'text/html' });
    const rancho = await fetchText(RP_PAGES.rancho, { accept: 'text/html' });
    const bungalows = await fetchText(RP_PAGES.bungalows, { accept: 'text/html' });
    const wsc = await fetchText(RP_PAGES.wsc, { accept: 'text/html' });
    const hotel = await fetchText(RP_HOTEL_URL, { accept: 'text/html' });
    return parseRanchoContent({ home, rancho, bungalows, wsc, hotel });
  },
  async fetchSlots(ctx) {
    return fetchOmnibeesSlots(RP_HOTEL, ctx, 'rancho-do-peixe');
  },
};
