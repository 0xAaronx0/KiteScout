// ---------------------------------------------------------------------------
// Jaguaribe Lodge & Kite, Praia Canoé (Fortim, Ceará, Brazil) - 23 eco-lodges on stilts over the dunes where the
// Jaguaribe River meets the sea, with its own kite center next door (Jaguaribe Kite: school for adults and children,
// 10 instructors, rental, shop, wing foil), semi-Olympic pool, spa, restaurant and bakery. Sister hotel of
// Jaguaríndia Village (same owners, same Omnibees chain 10325; adapter jaguarindia-village-fortim imports the shared
// helpers below).
//
// Data path (checked 2026-10-12):
//   content  jaguaribelodge.com (WordPress/Elementor, PT default with ?lang=en|fr|es; the English pages are read):
//            /hotel/?lang=en (the hotel, kite center, facilities), /lodges/?lang=en (lodge types with size,
//            capacity, furnishing; desktop + mobile copies, de-duplicated), /kitesurf/?lang=en (Jaguaribe Kite center)
//            + the Omnibees hotel page book.omnibees.com/chain/10325/hotel/19604?lang=en-US (English description,
//            room types, amenities, hours, photos media.omnibees.com/Images/19604/<Property|RoomTypes>/<id>.jpg).
//            Map pin = the site's own Google Maps place link in the footer ("@-4.4203648,-37.7689256").
//   slots    Omnibees booking engine (hotel 19604; the site's "Reservas" button opens book.omnibees.com/hotelresults?q=19604,
//            which redirects to chain 10325; the hotel page sets chainId = "10325" for the results page; currency
//            id 16 = BRL). Engine code: src/offers/engines/omnibees.ts (calendar bands + one sample stay per month).
// Liveness (rule 5b): the Omnibees calendar sells nights through March 2027 (checked 2026-10-12); the own site's
//   footer carries a "TripAdvisor Awards 2026" badge and the "DPC Fortim / Jaguaribe Kite" logo uploaded 2026/10.
// robots.txt (2026-10-12): jaguaribelodge.com disallows only WooCommerce/wp-admin paths; book.omnibees.com does not
//   list hotel 19604 or chain 10325 (checked with the http.ts robots matcher for the calendar and results URLs).
// Requests per run: content 4, slots 2 calendar + up to 6 results = 8.
// Parsed: calendar bands ("lowest|2026-10-12", hotel-wide lowest price for 2 adults) + room type x month samples
//   ("lodge-vista-mar|2026-11"), BRL per lodge per night for 2 adults. Omnibees double-encodes "&" in some room names
//   ("Ocean &amp;amp; Pool"); the shared fixOmnibeesUnits() decodes unit names and keys once.
// Known limits: the own site's lodge types ("Sea View Lodge") and the engine's room names ("Lodge Vista Mar") differ;
//   content rooms follow the own site, slots the engine. No air conditioning and no TV in the lodges (by design).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';
import { fetchOmnibeesSlots, hotelUrl, originalImage, parseRoomCards, type OmnibeesHotel, type OmnibeesRoomCard } from '../engines/omnibees.js';

// --- shared helpers (also used by jaguarindia-village-fortim.ts) --------------------------------------
/** Omnibees chain of the Jaguaribe group (Jaguaribe Lodge, Jaguaríndia Village): page path and results c= */
export const JAGUARIBE_CHAIN = 10325;

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share it */
export function sisterPage(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible block lines of `scope` (default <main> / <body>); scripts, styles, header, footer, nav dropped. */
export function blockLines(html: string, scope?: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, [data-elementor-type="header"], [data-elementor-type="footer"]')) el.remove();
  const base = (scope ? root.querySelector(scope) : null) ?? root.querySelector('main') ?? root.querySelector('body') ?? root;
  return base.structuredText.split('\n').map(l => collapse(l)).filter(Boolean);
}

export interface OmnibeesHotelFacts {
  description: string;
  fromPrice: string;
  hours: string;
  amenities: Array<{ group: string; items: string[] }>;
  cards: OmnibeesRoomCard[];
  pin: { lat: number; lng: number } | null;
  photos: string[];
}

/** The Omnibees hotel landing page: description, "from" price, hours, amenities, room cards, map pin, original photos. */
export function parseOmnibeesHotelPage(html: string, hotelId: number): OmnibeesHotelFacts {
  const h = parse(html);
  const mapWrap = h.querySelector('#map-wrap');
  const lat = Number(mapWrap?.getAttribute('data-lat'));
  const lng = Number(mapWrap?.getAttribute('data-long'));
  const photos: string[] = [];
  const re = new RegExp(`https://media\\.omnibees\\.com/Images/${hotelId}/(?:Property|RoomTypes)/(?:\\d+x\\d+/)?\\d+\\.(?:jpe?g|png|webp)`, 'gi');
  for (const m of html.matchAll(re)) {
    const u = originalImage(m[0]);
    if (!photos.includes(u)) photos.push(u);
  }
  return {
    description: collapse(h.querySelector('.hotel-landing__description')?.text ?? ''),
    fromPrice: collapse(h.querySelector('.hotel-landing__price-value')?.text ?? ''),
    hours: collapse(h.querySelector('.hotel-landing__hours')?.text ?? ''),
    amenities: h.querySelectorAll('.amenity-group').map(g => ({
      group: collapse(g.querySelector('.amenity-category-text')?.text ?? ''),
      items: g.querySelectorAll('.amenity-item').map(i => collapse(i.text)).filter(Boolean),
    })),
    cards: parseRoomCards(html).map(c => ({ ...c, name: decodeTwice(c.name) })),
    pin: Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? { lat, lng } : null,
    photos,
  };
}

/** Omnibees double-encodes some names ("Ocean &amp;amp; Pool" -> "Ocean &amp; Pool" after parsing): decode the rest. */
export function decodeTwice(s: string): string {
  return /&(?:amp|quot|#\d+);/.test(s) ? clean(s) : s;
}
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Decode double-encoded room names in engine slots; room x month keys follow the decoded name. */
export function fixOmnibeesUnits(slots: Slot[]): Slot[] {
  return slots.map(s => {
    if (!s.unit || !/&(?:amp|quot|#\d+);/.test(s.unit)) return s;
    const unit = decodeTwice(s.unit);
    const ym = s.key.split('|')[1];
    return { ...s, unit, key: ym ? `${keyPart(unit)}|${ym}` : s.key };
  });
}

/** Google Maps place link "…/maps/place/<name>/@-4.4203648,-37.7689256,17z…" on the own site. */
export function mapsPlacePin(html: string): { lat: number; lng: number } | null {
  const m = html.match(/google\.[a-z.]+\/maps\/place\/[^"'\s]*?@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]); const lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

// --- Jaguaribe Lodge --------------------------------------------------------------------------------
const SITE = 'https://jaguaribelodge.com';
export const JL_HOTEL: OmnibeesHotel = { hotelId: 19604, chainPath: JAGUARIBE_CHAIN, chainId: JAGUARIBE_CHAIN, currencyId: 16 /* BRL, data-curr="16" */, currency: 'BRL', adults: 2, months: 6 };
export const JL_HOTEL_URL = hotelUrl(JL_HOTEL);
export const JL_PAGES = {
  hotel: `${SITE}/hotel/?lang=en`,
  lodges: `${SITE}/lodges/?lang=en`,
  kite: `${SITE}/kitesurf/?lang=en`,
} as const;

export interface JlLodge { name: string; text: string }

/** /lodges/: "OCEAN LODGE" headings with their paragraphs; the page repeats every block (desktop + mobile), and one
 *  copy of a block may carry an untranslated Portuguese line - the English copy wins. */
export function parseJlLodges(html: string): JlLodge[] {
  const out: JlLodge[] = [];
  let cur: JlLodge | null = null;
  const done: JlLodge[] = [];
  for (const l of blockLines(html)) {
    if (/^Acompanhe|^Follow on Instagram/i.test(l)) break;
    if (/^[A-Z][A-Z ]*LODGE$/.test(l) && !/^OUR LODGES$/.test(l)) {
      cur = { name: l.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()), text: '' };
      done.push(cur);
      continue;
    }
    if (/^OUR LODGES$/.test(l)) { cur = null; continue; }
    if (cur) cur.text = collapse(`${cur.text} ${l}`);
  }
  for (const d of done) {
    const at = out.findIndex(o => o.name === d.name);
    if (at < 0) out.push(d);
    else if (/pessoas|hóspedes/i.test(out[at].text) && !/pessoas|hóspedes/i.test(d.text)) out[at] = d;
  }
  return out;
}

export function lodgeFeatures(text: string): string[] {
  const size = text.match(/(\d+) m²/)?.[1];
  const max = text.match(/up to (\d+) guests/i)?.[1];
  return [
    size ? `${size} m2` : null,
    max ? `Up to ${max} guests` : null,
    /veranda with a hammock/i.test(text) ? 'Private veranda with hammock and lounge chairs' : null,
    /queen-size bed/i.test(text) ? 'Queen-size bed and sofa bed' : null,
    /attached suite/i.test(text) ? 'Attached suite with two single beds and bathroom' : null,
    /minibar/i.test(text) ? 'Minibar' : null,
    /Wi-Fi/i.test(text) ? 'Free Wi-Fi' : null,
    'No air conditioning (wooden lattice walls for the sea breeze)',
  ].filter((x): x is string => !!x);
}

/** Own-site photos (wp-content/uploads JPEGs, originals), logos, badges and the sister hotel's photos dropped. */
export function jlSiteImages(pages: string[], max = 18): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const html of pages) {
    for (const m of html.matchAll(/https:\/\/jaguaribelodge\.com\/wp-content\/uploads\/[^"' )?,]+\.(?:jpe?g|webp)/gi)) {
      const u = m[0].replace(/-\d+x\d+(\.[a-z]+)$/i, '$1');
      // WordPress keeps "<name>-scaled.jpg" (2560 px) next to the upload; one photo per name
      const k = u.split('/').pop()!.replace(/-scaled(?=[.-])/, '').toLowerCase();
      if (/logo|Vila-Selvagem|instagram|award/i.test(u) || seen.has(k)) continue;
      seen.add(k); out.push(u);
    }
  }
  return out.slice(0, max);
}

export interface JlPages { hotel: string; lodges: string; kite: string; omnibees: string }

export function parseJaguaribeLodgeContent(p: JlPages): OfferContent {
  const hotel = blockLines(p.hotel).join(' ');
  const kite = blockLines(p.kite).join(' ');
  const lodges = parseJlLodges(p.lodges);
  const ob = parseOmnibeesHotelPage(p.omnibees, JL_HOTEL.hotelId);
  const pin = mapsPlacePin(p.hotel) ?? ob.pin;
  const nLodges = hotel.match(/just (\d+) luxury bungalows/)?.[1] ?? blockLines(p.lodges).join(' ').match(/The (\d+) spacious lodges/)?.[1] ?? null;
  const area = hotel.match(/in an (\d+)-hectare area with a ([\d.,]+)-kilometer stretch of beach/);
  const km = hotel.match(/(\d+) km from Fortaleza/)?.[1] ?? null;
  const instructors = kite.match(/team of (\d+) instructors/)?.[1] ?? null;
  const breakfastHours = ob.hours.match(/Breakfast Hours From ([\d:]+ [AP]M) To ([\d:]+ [AP]M)/);

  const rooms: ContentRoom[] = lodges.map(l => ({ name: l.name, description: l.text || null, features: lodgeFeatures(l.text) }));
  const sizeOf = (l: JlLodge | undefined) => l?.text.match(/(\d+) m²/)?.[1] ?? null;
  const std = sizeOf(lodges.find(l => !/family/i.test(l.name)));
  const fam = sizeOf(lodges.find(l => /family/i.test(l.name)));

  const summary = [
    `Jaguaribe Lodge & Kite is a hotel of ${nLodges ?? 23} eco-lodges built on stilts over the dunes at Praia Canoé in Fortim, Ceará, Brazil${km ? `, ${km} km from Fortaleza` : ''}, where the Jaguaribe River meets the sea${area ? ` (${area[1]} hectares with ${area[2].replace(',', '.')} km of beach)` : ''}.`,
    `The ${std ? `${std} m2 ` : ''}lodges${fam ? ` (${fam} m2 family lodges with an attached suite)` : ''} face the sea, the river, the garden or the pool, sleep up to 4 or 6 guests and are cooled by the sea breeze through wooden lattice walls instead of air conditioning; the hotel has a semi-Olympic pool, a spa, a public restaurant and bar with sea view, a guests' restaurant and its own bakery.`,
    `Next door, the Jaguaribe Kite center${instructors ? ` (${instructors} instructors with fluent English)` : ''} runs a kite and wing foil school for adults and children, rents equipment, has a shop and supports riders on the beach.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Jaguaribe Lodge & Kite',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Fortim, Ceará',
    spot: 'Fortim',
    // own site's Google Maps place link (footer), same point as the Omnibees map pin (checked 2026-10-12)
    spotCoords: pin,
    itinerarySpots: [],
    durationDays: null,
    // kitesurf page: "for those who want to learn kitesurfing or improve their skills"; school for adults, young people and children
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /school for adults/i.test(kite),
    equipmentRental: /equipment rental|rent equipment/i.test(kite),
    beginnerFriendly: /want to learn kitesurfing/i.test(kite) ? true : null,
    includedServices: ['Breakfast', 'Free Wi-Fi', 'Free parking', 'Daily housekeeping', 'Semi-Olympic pool', 'Direct beach access'],
    optionalServices: [
      'Kitesurf and wing foil lessons at the Jaguaribe Kite center (adults and children)',
      'Kite and wing equipment rental, kite shop',
      'Spa and massages',
      'Restaurant and bar with sea view (open to the public), guests-only restaurant',
      'Beach tennis at the Jaguaribe Arena',
      'Stand up paddle, slackline and other beach activities at the kite center',
    ],
    accommodation: 'eco-lodges on stilts',
    mealPlan: 'breakfast',
    languages: ['pt', 'en', 'fr', 'es'], // site languages; Omnibees: "Multilingual staff"
    rooms,
    imageUrls: [...jlSiteImages([p.lodges, p.hotel, p.kite]), ...ob.photos].slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: JL_PAGES.hotel,
    bookingUrl: JL_HOTEL_URL,
    sourceText: [
      `hotel: ${hotel}`,
      `lodges: ${lodges.map(l => `${l.name}: ${l.text}`).join(' | ')}`,
      `kitesurf: ${kite}`,
      `omnibees description: ${ob.description}`,
      `omnibees from price: ${ob.fromPrice}; hours: ${ob.hours}${breakfastHours ? ` (breakfast ${breakfastHours[1]}-${breakfastHours[2]})` : ''}`,
      `omnibees rooms: ${ob.cards.map(c => `${c.name} (${c.features.join(', ')})`).join('; ')}`,
      ...ob.amenities.map(a => `${a.group}: ${a.items.join(', ')}`),
      `map pin: ${pin ? `${pin.lat},${pin.lng}` : '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const jaguaribeLodgeFortim: OfferAdapter = {
  key: 'jaguaribe-lodge-fortim',
  name: 'Jaguaribe Lodge & Kite Fortim',
  kind: 'accommodation',
  operator: {
    name: 'Jaguaribe Lodge & Kite',
    websiteUrl: SITE,
    rootDomain: 'jaguaribelodge.com',
    contactEmail: 'reservas@jaguaribelodge.com',
    phone: '+5588981210441',
  },
  url: JL_PAGES.hotel,
  quote: { engine: 'omnibees', hotelId: JL_HOTEL.hotelId, chainId: JL_HOTEL.chainId, currencyId: JL_HOTEL.currencyId, currency: JL_HOTEL.currency },
  slotMethod: 'booking_engine',
  fetchBudget: 13,
  async fetchContent() {
    const [hotel, lodges, kite, omnibees] = [await sisterPage(JL_PAGES.hotel), await sisterPage(JL_PAGES.lodges), await sisterPage(JL_PAGES.kite), await sisterPage(JL_HOTEL_URL)];
    return parseJaguaribeLodgeContent({ hotel, lodges, kite, omnibees });
  },
  async fetchSlots(ctx) {
    return fixOmnibeesUnits(await fetchOmnibeesSlots(JL_HOTEL, ctx, 'jaguaribe-lodge'));
  },
};
