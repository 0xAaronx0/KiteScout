// ---------------------------------------------------------------------------
// Jaguaríndia Village, Praia Canoé (Fortim, Ceará, Brazil) - boutique hotel of bungalows and villas on a 50,000 m2
// plot where the Jaguaribe River meets the sea, with JaG restaurant, bars, Ywi Spa and pools; kite partner school
// Duotone Pro Center Fortim on the beach in front of the kite area. Sister hotel of Jaguaribe Lodge & Kite (same
// owners, same Omnibees chain 10325): the shared helpers live in ./jaguaribe-lodge-fortim.ts.
//
// Data path (checked 2026-10-12):
//   content  www.jaguarindiavillage.com (PHP site, PT default with ?lang=en|es|fr; the English pages are read):
//            /sobre?lang=en (concept, restaurant, bars, spa, activities), /acomodacoes?lang=en (10 accommodation
//            cards: name, size, capacity, photo), /kitesurf?lang=en (partner school, Jaguaribe Kite Experience)
//            + the Omnibees hotel page book.omnibees.com/chain/10325/hotel/13994?lang=en-US (English description,
//            room types, amenities, hours, map pin #map-wrap data-lat / data-long, photos
//            media.omnibees.com/Images/13994/<Property|RoomTypes>/<id>.jpg).
//   slots    Omnibees booking engine (hotel 13994; the site's "Book" buttons open book.omnibees.com/hotelresults?q=13994,
//            which redirects to chain 10325; results page c=10325; currency id 16 = BRL). Engine code:
//            src/offers/engines/omnibees.ts (calendar bands + one sample stay per month).
// Liveness (rule 5b): the Omnibees calendar sells nights through March 2027 (checked 2026-10-12); the home page links
//   a "reveillon-2027" special (seen 2026-10-12, not read per run).
// robots.txt (2026-10-12): www.jaguarindiavillage.com has none (404 = allow all); book.omnibees.com does not list
//   hotel 13994 or chain 10325 (checked with the http.ts robots matcher for the calendar and results URLs).
// Requests per run: content 4, slots 2 calendar + up to 6 results = 8.
// Parsed: calendar bands ("lowest|2026-10-12", hotel-wide lowest price for 2 adults) + room type x month samples
//   ("coconut-bungalow|2026-11"), BRL per unit per night for 2 adults; double-encoded "&" in Omnibees room names is
//   decoded (fixOmnibeesUnits).
// Known limits: the own site's names (Portuguese "Bangalô Coqueiral") and the engine's room names ("Coconut
//   Bungalow") differ; content rooms follow the own site, slots the engine; JV_ROOMS links each engine room to its
//   own-site type (slot.room). The kite school is a partner on the
//   beach, not part of the hotel.
// ---------------------------------------------------------------------------
import { collapse, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent } from '../types.js';
import { fetchOmnibeesSlots, hotelUrl, type OmnibeesHotel } from '../engines/omnibees.js';
import { JAGUARIBE_CHAIN, blockLines, fixOmnibeesUnits, parseOmnibeesHotelPage, sisterPage, withOmnibeesRooms } from './jaguaribe-lodge-fortim.js';

const SITE = 'https://www.jaguarindiavillage.com';
export const JV_HOTEL: OmnibeesHotel = { hotelId: 13994, chainPath: JAGUARIBE_CHAIN, chainId: JAGUARIBE_CHAIN, currencyId: 16 /* BRL, data-curr="16" */, currency: 'BRL', adults: 2, months: 6 };
export const JV_HOTEL_URL = hotelUrl(JV_HOTEL);
export const JV_PAGES = {
  about: `${SITE}/sobre?lang=en`,
  rooms: `${SITE}/acomodacoes?lang=en`,
  kite: `${SITE}/kitesurf?lang=en`,
} as const;

// --- pure parsers -----------------------------------------------------------------------------
/**
 * Omnibees room (decoded) -> own-site accommodation card (names as parseJvUnits() reads them). Coqueiral = coconut
 * grove, Jardim = garden, Família = family; "Bungalow Familiar" (no pool) is the Bangalô Família. "Double Room"
 * (up to 3 guests, "Ocean View") stays unlinked: only elimination points at the Bangalô Oceano, the engine does
 * not name it.
 */
export const JV_ROOMS: Record<string, string> = {
  'Coconut Bungalow': 'Bangalô Coqueiral',
  'Coqueiral Bungalow & Swimming Pool': 'Bangalô Coqueiral & Pool',
  'Bungalow Familiar': 'Bangalô Família',
  'Family Bungalow & Swimming Pool': 'Bangalô Família & Pool',
  'Ocean & Pool Bungalow': 'Bangalô Oceano & Pool',
  'Garden villa': 'Villa Jardim',
  'Superior Garden Villa': 'Villa Jardim Superior',
  'Grand Villa Garden Superior': 'Grand Villa Jardim Superior',
};

export interface JvUnit { name: string; text: string; sizeM2: number | null; maxGuests: number | null; photo: string | null }

/** /acomodacoes: cards <div data-reveal="rise"> with <h3> name, <p> text ("— 120 m² for up to 4 guests") and photo. */
export function parseJvUnits(html: string): JvUnit[] {
  const main = parse(html).querySelector('main');
  if (!main) return [];
  return main.querySelectorAll('[data-reveal="rise"]').map(card => {
    const text = collapse(card.querySelector('p')?.text ?? '');
    const size = text.match(/(\d+) m²/)?.[1];
    const max = text.match(/up to (\d+) guests?/i)?.[1];
    const src = card.querySelector('img')?.getAttribute('src') ?? null;
    return {
      name: collapse(card.querySelector('h3')?.text ?? ''),
      text,
      sizeM2: size ? Number(size) : null,
      maxGuests: max ? Number(max) : null,
      photo: src ? new URL(src, SITE).toString() : null,
    };
  }).filter(u => u.name);
}

export function unitFeatures(u: JvUnit): string[] {
  return [
    u.sizeM2 ? `${u.sizeM2} m2` : null,
    u.maxGuests ? `Up to ${u.maxGuests} guests` : null,
    /private pool/i.test(u.text) ? 'Private pool' : null,
    /two suites/i.test(u.text) ? 'Two suites' : /three accommodations/i.test(u.text) ? 'Three rooms' : null,
    /sea views?|panoramic sea/i.test(u.text) ? 'Sea view' : null,
    /coconut grove/i.test(u.text) ? 'Coconut grove view' : null,
    /veranda/i.test(u.text) ? 'Veranda' : null,
  ].filter((x): x is string => !!x);
}

/** Own photos (assets/images JPEGs: unit cards, layout photos, kite gallery); logos and award badges are PNG. */
export function jvSiteImages(pages: string[], max = 18): string[] {
  const out: string[] = [];
  for (const html of pages) {
    for (const m of html.matchAll(/https:\/\/www\.jaguarindiavillage\.com\/assets\/images\/(?:acomodacoes|layout|topo)\/[^"' )?,]+\.jpe?g/gi)) {
      if (/logo|og-default|popup/i.test(m[0]) || out.includes(m[0])) continue;
      out.push(m[0]);
    }
  }
  return out.slice(0, max);
}

export interface JvPages { about: string; rooms: string; kite: string; omnibees: string }

export function parseJaguarindiaContent(p: JvPages): OfferContent {
  const about = blockLines(p.about).join(' ');
  const kite = blockLines(p.kite).join(' ');
  const units = parseJvUnits(p.rooms);
  const ob = parseOmnibeesHotelPage(p.omnibees, JV_HOTEL.hotelId);
  const area = about.match(/Within this ([\d,.]+) m² space/)?.[1] ?? null;
  const partner = kite.match(/through the (Duotone Pro Center [A-Z][a-z]+)/)?.[1] ?? null;
  const kiteExp = kite.match(/Enjoy (\w+) days of full immersion, lessons at [^,]+, premium equipment, and accommodation at (Jaguaribe Lodge)/);
  const sizes = units.map(u => u.sizeM2).filter((n): n is number => n !== null);
  const guests = units.map(u => u.maxGuests).filter((n): n is number => n !== null);
  const pools = units.filter(u => /private pool/i.test(u.text)).length;

  const rooms: ContentRoom[] = units.map(u => ({ name: u.name, description: u.text || null, features: unitFeatures(u) }));

  const summary = [
    `Jaguaríndia Village is a boutique hotel at Praia Canoé in Fortim, Ceará, Brazil, on a ${area ?? '50,000'} m2 plot where the Jaguaribe River meets the sea, with the JaG restaurant (Franco-Brazilian menu), two bars, the Ywi Spa and pools.`,
    `It has ${units.length || 10} accommodation types, from bungalows to garden villas${sizes.length ? ` of ${Math.min(...sizes)} to ${Math.max(...sizes)} m2` : ''}${guests.length ? ` for ${Math.min(...guests)} to ${Math.max(...guests)} guests` : ''}${pools ? `, ${pools} of them with a private pool` : ''}.`,
    `The hotel's partner kite school${partner ? `, ${partner},` : ''} sits on the beach overlooking the kite area and teaches beginners to advanced riders with certified instructors and high-performance equipment${kiteExp ? `; its Jaguaribe Kite Experience is a ${kiteExp[1]}-day immersion programme with lessons and accommodation at the sister hotel ${kiteExp[2]}` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Jaguaríndia Village',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Fortim, Ceará',
    spot: 'Fortim',
    // Omnibees hotel page map pin (#map-wrap data-lat / data-long, 2026-10-12); the own site has no map coordinates
    spotCoords: ob.pin,
    itinerarySpots: [],
    durationDays: null,
    // kitesurf page: "From beginners to advanced riders, everyone will find ..."
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /partner school/i.test(kite),
    equipmentRental: null, // the partner school's rental is not stated on the hotel's site
    beginnerFriendly: /looking to learn|From beginners/i.test(kite) ? true : null,
    includedServices: ['Breakfast', 'Free Wi-Fi', 'Free parking', 'Daily housekeeping', 'Direct beach access'],
    optionalServices: [
      `Kitesurf lessons at the partner school${partner ? ` ${partner}` : ''}`,
      kiteExp ? `Jaguaribe Kite Experience (${kiteExp[1]} days of lessons, stay at ${kiteExp[2]})` : null,
      'Ywi Spa (massages and wellness rituals)',
      'JaG Restaurant, Keiji Bar, Kanui Bar',
      'Beach tennis, cycling, horseback riding, ATV and buggy rides',
    ].filter((x): x is string => !!x),
    accommodation: 'bungalows and garden villas',
    mealPlan: 'breakfast',
    languages: ['pt', 'en', 'es', 'fr'], // site languages; Omnibees: "Multilingual staff"
    rooms,
    imageUrls: [...jvSiteImages([p.rooms, p.kite, p.about]), ...ob.photos].slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: JV_PAGES.about,
    bookingUrl: JV_HOTEL_URL,
    sourceText: [
      `about: ${about}`,
      `accommodations: ${units.map(u => `${u.name}: ${u.text}`).join(' | ')}`,
      `kitesurf: ${kite}`,
      `omnibees description: ${ob.description}`,
      `omnibees from price: ${ob.fromPrice}; hours: ${ob.hours}`,
      `omnibees rooms: ${ob.cards.map(c => `${c.name} (${c.features.join(', ')})`).join('; ')}`,
      ...ob.amenities.map(a => `${a.group}: ${a.items.join(', ')}`),
      `map pin: ${ob.pin ? `${ob.pin.lat},${ob.pin.lng}` : '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const jaguarindiaVillageFortim: OfferAdapter = {
  key: 'jaguarindia-village-fortim',
  name: 'Jaguaríndia Village Fortim',
  kind: 'accommodation',
  operator: {
    name: 'Jaguaríndia Village',
    websiteUrl: SITE,
    rootDomain: 'jaguarindiavillage.com',
    contactEmail: 'reservas@jaguarindiavillage.com',
    phone: '+5588981450841',
    whatsapp: '+5588981450841',
  },
  url: JV_PAGES.about,
  quote: { engine: 'omnibees', hotelId: JV_HOTEL.hotelId, chainId: JV_HOTEL.chainId, currencyId: JV_HOTEL.currencyId, currency: JV_HOTEL.currency },
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 13,
  async fetchContent() {
    const [about, rooms, kite, omnibees] = [await sisterPage(JV_PAGES.about), await sisterPage(JV_PAGES.rooms), await sisterPage(JV_PAGES.kite), await sisterPage(JV_HOTEL_URL)];
    return parseJaguarindiaContent({ about, rooms, kite, omnibees });
  },
  async fetchSlots(ctx) {
    return withOmnibeesRooms(fixOmnibeesUnits(await fetchOmnibeesSlots(JV_HOTEL, ctx, 'jaguarindia-village')), JV_ROOMS);
  },
};
