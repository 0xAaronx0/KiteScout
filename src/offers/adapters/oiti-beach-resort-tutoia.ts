// ---------------------------------------------------------------------------
// Oiti Beach Resort, Praia de São José (Tutóia, Maranhão, Brazil) - 56-apartment beach resort at the Parnaíba delta
// with the Kitesurf Life kite school and shop inside the hotel (lessons beginner to advanced, downwinders to
// Arpoador, Paulino Neves and Atins, rental, supervision, 4x4 transfers).
//
// Data path (checked 2026-10-12):
//   content  www.oitibeachresort.com (Duda one-pager, Portuguese: resort intro, amenities, "Os 56 apartamentos ...
//            Deluxe, Luxo, Superior e Classic", "Kitesurf Life - Escola e Loja de Kitesurf" with its service list,
//            spa, contacts) + the Omnibees hotel page book.omnibees.com/chain/10117/hotel/19145?lang=en-US (NEW
//            Omnibees layout: English description, nine room types, amenities, hours, map pin, photos), read with
//            parseOmnibeesPageV2 from amagali-pousada-galinhos.ts.
//   slots    Omnibees booking engine (hotel 19145; chain 10117 for the page path and the results c= parameter, the
//            hotel page's `chainId = "10117"`; currency id 16 = BRL). The site's "Reservar" buttons open
//            book.omnibees.com/hotelresults?q=19145. Engine code: src/offers/engines/omnibees.ts.
// robots.txt (2026-10-12): www.oitibeachresort.com has an empty `User-agent: *` group (allow all);
//   book.omnibees.com does not list hotel 19145 or chain 10117.
// Requests per run: content 2, slots 2 calendar + up to 6 results = 8.
// Parsed: calendar bands ("lowest|2026-10-12", hotel-wide lowest price for 2 adults) + room type x month samples
//   ("luxury-couple|2026-11"), BRL per room per night for 2 adults.
// Known limits: the kite school prints no prices; Duda answers JSON when Accept lists application/json, so pages
//   are fetched with accept text/html; Duda photos are the 970w/1920w renditions the page links.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent } from '../types.js';
import { fetchOmnibeesSlots, hotelUrl, type OmnibeesHotel } from '../engines/omnibees.js';
import { parseOmnibeesPageV2 } from './amagali-pousada-galinhos.js';

export const OITI_HOTEL: OmnibeesHotel = { hotelId: 19145, chainPath: 10117, chainId: 10117, currencyId: 16 /* BRL, data-curr="16" */, currency: 'BRL', adults: 2, months: 6 };
export const OITI_HOTEL_URL = hotelUrl(OITI_HOTEL);
const SITE = 'https://www.oitibeachresort.com';
export const OITI_HOME_URL = `${SITE}/`;

/** Block-level visible lines (scripts, styles, navigation and forms dropped; Duda slider filler removed). */
function blockLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|select|svg|header|footer|nav|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|button)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(l => l && !/^(Título do Slide|Escreva sua legenda aqui|Botão|Button)$/.test(l));
}

export interface OitiKite { title: string; lines: string[]; services: string[]; shopSellsGear: boolean }

/** "Kitesurf Life - Escola e Loja de Kitesurf" up to the SPA block. */
export function parseOitiKite(homeHtml: string): OitiKite | null {
  const lines = blockLines(homeHtml);
  const at = lines.findIndex(l => /^Kitesurf Life\s*[–-]\s*Escola/i.test(l));
  if (at < 0) return null;
  const end = lines.findIndex((l, i) => i > at && /^SPA$/.test(l));
  const block = lines.slice(at + 1, end > at ? end : at + 40);
  const svcStart = block.findIndex(l => /^Nossos serviços incluem:?$/.test(l));
  const services: string[] = [];
  for (let i = svcStart + 1; svcStart >= 0 && i < block.length && /^-\s/.test(block[i]); i++) services.push(block[i].replace(/^-\s*/, ''));
  return { title: lines[at].replace(/\s*[–-]\s*/, ' - '), lines: block, services, shopSellsGear: block.some(l => /Equipamento completo de kitesurf/i.test(l)) };
}

const SERVICE_EN: Array<[RegExp, string]> = [
  [/^Aulas do zero ao avançado/i, 'Kite lessons from zero to advanced'],
  [/^Aulas de Downwind/i, 'Downwind lessons'],
  [/^Downwinders guiados \(([^)]+)\)/i, 'Guided downwinders ($1)'],
  [/^Aluguel de equipamentos/i, 'Equipment rental'],
  [/^Aluguel supervisionado/i, 'Supervised rental'],
  [/^Supervisão para praticantes independentes/i, 'Supervision for independent riders'],
  [/^Transfers e suporte local \(([^)]+)\)/i, 'Transfers and local support ($1)'],
];
const en = (s: string) => {
  for (const [re, t] of SERVICE_EN) if (re.test(s)) return s.replace(re, t).replace(/\be\b/g, 'and').replace(/\bem\b/g, 'in').replace(/quadriciclos/g, 'quad bikes');
  return s;
};

export function parseOitiContent(homeHtml: string, hotelHtml: string): OfferContent {
  const lines = blockLines(homeHtml);
  const kite = parseOitiKite(homeHtml);
  const ob = parseOmnibeesPageV2(hotelHtml, OITI_HOTEL.hotelId);
  const text = lines.join(' ');
  const nUnits = text.match(/Os (\d+) apartamentos/)?.[1] ?? null;
  const services = (kite?.services ?? []).map(en);

  const rooms: ContentRoom[] = ob.rooms.map(r => ({
    name: r.name,
    description: null,
    features: [r.maxGuests ? `Up to ${r.maxGuests} guests` : null, r.view && r.view !== 'Various views' ? r.view : null, 'Air conditioning', 'Minibar', 'Flat-screen TV']
      .filter((x): x is string => !!x),
  }));

  const own: string[] = [];
  const seen = new Set<string>();
  for (const u of imageCandidates(homeHtml, OITI_HOME_URL, null, 80)) {
    if (!/cdn-website\.com\/43ff3a92\//.test(u) || /Artboard|1200x630|WhatsApp|\.svg|\.png|favicon/i.test(u)) continue;
    const k = decodeURIComponent(u.split('/').pop()!).replace(/-\d+w(?=\.[a-z]+$)/i, '').toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); own.push(u);
  }

  const summary = [
    `Oiti Beach Resort is a beachfront hotel with ${nUnits ?? '56'} apartments on Praia de São José in Tutóia (Maranhão, Brazil), at the Parnaíba delta, with a large pool and pool bar, the Casa de Juja restaurant, a gym, a spa and a kids' area.`,
    `The Kitesurf Life kite school and shop is inside the hotel: lessons from beginner to advanced with internationally certified instructors, downwind lessons and guided downwinders${services.some(s => /Atins/.test(s)) ? ' (Delta, Arpoador, Paulino Neves, Atins)' : ''}, equipment rental, supervision and 4x4 or quad transfers to the spots.`,
    'Rooms come in four categories (Deluxe, Luxo, Superior and Classic) for two to four guests, with air conditioning and minibar; a buffet breakfast is served.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Oiti Beach Resort Tutóia',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Tutóia, Maranhão',
    spot: 'Praia de São José, Tutóia',
    // Omnibees hotel page map pin (.google_map data-lat / data-lng, 2026-10-12)
    spotCoords: ob.coords,
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // "Somos especializados em aulas do nível iniciante ao avançado" (Kitesurf Life block, 2026-10-12)
    skillLevels: kite && kite.lines.some(l => /iniciante ao avançado/i.test(l)) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: !!kite,
    equipmentRental: services.some(s => /rental/i.test(s)),
    beginnerFriendly: kite && kite.lines.some(l => /nunca praticou/i.test(l)) ? true : null,
    includedServices: ['Breakfast', 'Wi-Fi', 'Parking', 'Pool and pool bar', 'Gym'],
    optionalServices: [
      ...services.map(s => `Kitesurf Life: ${s}`),
      ...(kite?.shopSellsGear ? ['Kitesurf Life shop in the hotel (complete kite equipment and accessories)'] : []),
      'Spa (massages, lymphatic drainage)', 'Tours to the Parnaíba delta, Praia do Amor and Arpoador (buggy, quad, boat)', 'Room service',
    ],
    accommodation: 'beach resort apartments',
    mealPlan: 'breakfast',
    languages: ['pt'],
    rooms,
    imageUrls: [...own, ...ob.photos].slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: OITI_HOME_URL,
    bookingUrl: OITI_HOTEL_URL,
    sourceText: [
      `home: ${text.slice(0, 6000)}`,
      `kite: ${kite ? `${kite.title}: ${kite.lines.join(' ')}` : '-'}`,
      `omnibees description: ${ob.description}`,
      `omnibees rooms: ${ob.rooms.map(r => `${r.name} (max ${r.maxGuests ?? '-'}, ${r.view ?? '-'})`).join('; ')}`,
      ...ob.amenities.map(a => `${a.group}: ${a.items.join(', ')}`),
      `hours: ${ob.hours}`,
      `map pin: ${ob.coords ? `${ob.coords.lat},${ob.coords.lng}` : '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const oitiBeachResortTutoia: OfferAdapter = {
  key: 'oiti-beach-resort-tutoia',
  name: 'Oiti Beach Resort Tutóia',
  kind: 'accommodation',
  operator: {
    name: 'Oiti Beach Resort Tutóia',
    websiteUrl: SITE,
    rootDomain: 'oitibeachresort.com',
    contactEmail: 'reservas@oitibeach.com.br',
    phone: '+5598985569690',
  },
  url: OITI_HOME_URL,
  quote: { engine: 'omnibees', hotelId: OITI_HOTEL.hotelId, chainId: OITI_HOTEL.chainId, currencyId: OITI_HOTEL.currencyId, currency: OITI_HOTEL.currency },
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 10,
  async fetchContent() {
    // Duda answers a JSON payload instead of HTML when Accept lists application/json
    const home = await fetchText(OITI_HOME_URL, { accept: 'text/html' });
    if (!parseOitiKite(home)) throw new Error('oiti-beach-resort: Kitesurf Life block missing on the home page (layout changed?)');
    const hotel = await fetchText(OITI_HOTEL_URL, { accept: 'text/html' });
    return parseOitiContent(home, hotel);
  },
  async fetchSlots(ctx) {
    return fetchOmnibeesSlots(OITI_HOTEL, ctx, 'oiti-beach-resort');
  },
};
