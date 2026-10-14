// ---------------------------------------------------------------------------
// Kilombo Villas, Praia de Sibaúma (Tibau do Sul, Rio Grande do Norte, Brazil) - small 5-star hotel with ten
// villas on the beach 10 minutes from Pipa; the site presents Sibaúma as "An exclusive spot for Kite" and lists
// kitesurfing among the guest experiences (no own kite school on the site).
//
// Data path (checked 2026-10-12):
//   content  www.kilombovillas.com/en/ (Next.js, server-rendered: intro, the ten villa cards with teasers, Kibo
//            restaurant, experiences incl. the kite block, FAQ, contact e-mails and phone) + the Omnibees hotel
//            page book.omnibees.com/chain/1009/hotel/1088?lang=en-US (English description, room cards,
//            amenities, hours, map pin #map-wrap data-lat/data-long, photos media.omnibees.com/Images/1088/...).
//   slots    Omnibees booking engine (hotel 1088; chain 1009 for the page path and the results c= parameter, the
//            hotel page's `chainId = "1009"`; currency id 16 = BRL). The site's "Book now" buttons open
//            book.omnibees.com/hotel/1088. Engine code: src/offers/engines/omnibees.ts.
// robots.txt (2026-10-12): www.kilombovillas.com has an empty `User-Agent: *` group (allow all);
//   book.omnibees.com does not list hotel 1088 or chain 1009.
// Requests per run: content 2, slots 2 calendar + up to 6 results = 8.
// Parsed: calendar bands ("lowest|2026-10-12", hotel-wide lowest price for 2 adults) + villa x month samples
//   ("villa-zumbi-ocean-suite|2026-11"), BRL per villa per night for 2 adults.
// Known limits: kite link is the site's spot text only (no school, storage or rental named); children only
//   from 8 years (FAQ).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent } from '../types.js';
import { fetchOmnibeesSlots, hotelUrl, originalImage, parseRoomCards, type OmnibeesHotel } from '../engines/omnibees.js';

export const KV_HOTEL: OmnibeesHotel = { hotelId: 1088, chainPath: 1009, chainId: 1009, currencyId: 16 /* BRL, data-curr="16" */, currency: 'BRL', adults: 2, months: 6 };
export const KV_HOTEL_URL = hotelUrl(KV_HOTEL);
const SITE = 'https://www.kilombovillas.com';
export const KV_HOME_URL = `${SITE}/en/`;

/** Villa cards of the home page: <a href="/en/<slug>"><h3>name</h3><div>teaser</div><p>View details</p></a>. */
export function parseKvVillas(homeHtml: string): Array<{ name: string; slug: string; text: string }> {
  const out: Array<{ name: string; slug: string; text: string }> = [];
  for (const a of parse(homeHtml).querySelectorAll('a')) {
    const h3 = a.querySelector('h3');
    if (!h3 || !/View details/i.test(a.text)) continue;
    const name = collapse(h3.text);
    const text = collapse(a.querySelector('div.line-clamp-1')?.text ?? '');
    const slug = (a.getAttribute('href') ?? '').replace(/^\/en\//, '');
    if (name && !out.some(v => v.name === name)) out.push({ name, slug, text });
  }
  return out;
}

/** The kite block ("An exclusive spot for Kite" + its sentence) and the SEO paragraph that names kitesurfing. */
export function parseKvKite(homeHtml: string): { title: string; text: string; seo: string | null } | null {
  const root = parse(homeHtml);
  const h3 = root.querySelectorAll('h3').find(h => /spot for kite/i.test(h.text));
  if (!h3) return null;
  const text = collapse(h3.parentNode?.querySelector('p')?.text ?? '');
  const seo = collapse(root.text).match(/Experiences include kitesurfing[^.]*\./)?.[0] ?? null;
  return { title: collapse(h3.text), text, seo };
}

function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, form, template')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}

/** Omnibees villa names -> own-site card names ("Villa Zumbi Master Suite" -> "Zumbi Master"). */
function siteVilla(villas: Array<{ name: string; text: string }>, omnibees: string): { name: string; text: string } | undefined {
  const n = omnibees.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const map: Array<[RegExp, string]> = [
    [/blue suite/, 'blue suite'], [/das rosas/, 'das rosas'], [/desideria/, 'desideria'],
    [/sibraama ocean/, 'sibraama ocean'], [/sibraama jardim/, 'sibraama jardim'],
    [/zumbi master/, 'zumbi master'], [/zumbi ocean/, 'zumbi ocean'], [/zumbi garden/, 'zumbi jardim'],
    [/jacu ocean/, 'jacu ocean'], [/jacu garden/, 'jacu jardim'],
  ];
  const hit = map.find(([re]) => re.test(n));
  return hit ? villas.find(v => norm(v.name) === hit[1]) : undefined;
}

export function parseKilomboContent(homeHtml: string, hotelHtml: string): OfferContent {
  const home = pageText(homeHtml);
  const villas = parseKvVillas(homeHtml);
  const kite = parseKvKite(homeHtml);
  const hotel = parse(hotelHtml);
  const description = collapse(hotel.querySelector('.hotel-landing__description')?.text ?? '');
  const fromPrice = collapse(hotel.querySelector('.hotel-landing__price-value')?.text ?? '');
  const hours = collapse(hotel.querySelector('.hotel-landing__hours')?.text ?? '');
  const amenities = hotel.querySelectorAll('.amenity-group').map(g => ({
    group: collapse(g.querySelector('.amenity-category-text')?.text ?? ''),
    items: g.querySelectorAll('.amenity-item').map(i => collapse(i.text)).filter(Boolean),
  }));
  const cards = parseRoomCards(hotelHtml);
  const mapWrap = hotel.querySelector('#map-wrap');
  const lat = Number(mapWrap?.getAttribute('data-lat'));
  const lng = Number(mapWrap?.getAttribute('data-long'));
  const children = home.match(/Children over (\d+) years old are welcome/)?.[1] ?? null;

  const rooms: ContentRoom[] = cards.map(c => ({ name: c.name, description: siteVilla(villas, c.name)?.text ?? null, features: c.features }));

  const seen = new Set<string>();
  const own: string[] = [];
  for (const cand of imageCandidates(homeHtml, KV_HOME_URL, null, 80)) {
    // Next.js image proxy (/_next/image?url=<static path>&w=..) -> the original static file
    const inner = cand.startsWith(`${SITE}/_next/image?`) ? new URL(cand).searchParams.get('url') : null;
    const u = inner ? new URL(inner, SITE).toString() : cand;
    if (!u.startsWith(`${SITE}/`) || /\.svg|logo|turtles|wedding|ogi\.jpg/i.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u); own.push(u);
  }
  const ob: string[] = [];
  for (const m of hotelHtml.matchAll(/https:\/\/media\.omnibees\.com\/Images\/1088\/(?:Property|RoomTypes)\/(?:\d+x\d+\/)?\d+\.jpe?g/g)) {
    const u = originalImage(m[0]);
    if (!ob.includes(u)) ob.push(u);
  }

  const summary = [
    `Kilombo Villas is a small luxury hotel with ${villas.length || 10} villas on Sibaúma beach in Tibau do Sul (Rio Grande do Norte, Brazil), about 10 minutes from Pipa.`,
    'The villas range from garden suites to sea-view duplexes, some with jacuzzi or a private balcony; breakfast is served in the villa, by the pool or by the ocean, and the Kibo restaurant serves local cuisine.',
    `The site presents Sibaúma as a kite spot with strong winds and lists kitesurfing among the guest experiences, together with horseback riding, boat trips and cycling; it names no own kite school${children ? `. Children are welcome from ${children} years` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Kilombo Villas',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Sibaúma, Rio Grande do Norte',
    spot: 'Praia de Sibaúma',
    // Omnibees hotel page map pin (#map-wrap data-lat / data-long, 2026-10-12)
    spotCoords: Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? { lat, lng } : null,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: null,
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: ['Breakfast', 'Wi-Fi', 'Parking', 'Pool', 'Air conditioning'],
    optionalServices: ['Airport transfer', 'Massages', 'Horseback riding, boat trips, bicycles', 'Day use', 'Kibo restaurant'],
    accommodation: 'beach villas and suites',
    mealPlan: 'breakfast',
    languages: /English, Spanish and Portuguese/i.test(home) ? ['en', 'es', 'pt'] : [],
    rooms,
    imageUrls: [...own, ...ob].slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KV_HOME_URL,
    bookingUrl: KV_HOTEL_URL,
    sourceText: [
      `home: ${home.slice(0, 6000)}`,
      `kite: ${kite ? `${kite.title}: ${kite.text} | ${kite.seo ?? '-'}` : '-'}`,
      `villas: ${villas.map(v => `${v.name}: ${v.text}`).join(' | ')}`,
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
export const kilomboVillasSibauma: OfferAdapter = {
  key: 'kilombo-villas-sibauma',
  name: 'Kilombo Villas Sibaúma',
  kind: 'accommodation',
  operator: {
    name: 'Kilombo Villas',
    websiteUrl: SITE,
    rootDomain: 'kilombovillas.com',
    contactEmail: 'reservas@kilombovillas.com',
    phone: '+5584991477595',
  },
  url: KV_HOME_URL,
  quote: { engine: 'omnibees', hotelId: KV_HOTEL.hotelId, chainId: KV_HOTEL.chainId, currencyId: KV_HOTEL.currencyId, currency: KV_HOTEL.currency },
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 10,
  async fetchContent() {
    const home = await fetchText(KV_HOME_URL, { accept: 'text/html' });
    if (!parseKvKite(home)) throw new Error('kilombo-villas: kite block missing on the home page (layout changed?)');
    const hotel = await fetchText(KV_HOTEL_URL, { accept: 'text/html' });
    return parseKilomboContent(home, hotel);
  },
  async fetchSlots(ctx) {
    return fetchOmnibeesSlots(KV_HOTEL, ctx, 'kilombo-villas');
  },
};
