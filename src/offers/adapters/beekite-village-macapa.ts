// ---------------------------------------------------------------------------
// Beekite Village, Praia do Macapá (Luís Correia, Piauí, Brazil) - 11 beach chalets (built 2023) on the
// grounds of the Beekite kitesurf station (courses, Duotone rental, gear storage, compressor, beach boys).
//
// Inclusion: Aaron's decision of 2026-10-12. The own site shows no explicit 2026/27 dates or prices (brief
//   rule 5(b) waived for this property); it is listed as "price on request". Kite link (rule 5(a)) on the own
//   site: the chalets are "on the premises of the Beekite Village kitesurfing Station" (pousada page). Newest
//   sign of life: the pousada pages in all four languages were edited 2026-07-28 (Yoast dateModified).
//
// Data path (checked 2026-10-12): www.kitesurf-brasil.eu, WordPress (theme kitesurf_brasil), server-rendered,
//   English pages:
//   content  /en/pousada-beekite-village-2/ (chalet text, gallery of originals, request form),
//            /en/about-beekite-village/ (station: storage, compressor, beach boys, Duotone gear, beach bar),
//            /en/spot-kitesurf/ (Macapá lagoons, river mouth, Maramar, Parnaíba),
//            /en/booking-request/ (Contact Form 7 selects: tours, courses, rental, member fees in EUR),
//            /en/map-beekite-village/ (Google Maps initMap myLatLng = spotCoords).
//   slots    none: the site prints no chalet price; chalets are booked through the request form (dates,
//            guests). fetchSlots re-reads the pousada page (memoised) and returns [] (offer = "price on
//            request"); it notes when an amount shows up there so the adapter can be extended.
//   Not used: windloop-macapa.com (HTTP 403 to our bot), bstoked / booksurfcamps / portals (hints only).
// robots.txt (2026-10-12): kitesurf-brasil.eu 301 -> www.; Yoast default "Disallow:" (allow all).
// Requests per run: content 5, slots 1 (0 extra when content ran in the same process).
// Known limits: the gallery photos are 2021 uploads ("Hospedagem_BeeKite") while the text says the chalets
//   were built in 2023; no season dates or room prices on the site; the course/rental/tour prices of the
//   request form are kept as optional services, not slots.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, findPrices, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kitesurf-brasil.eu';
export const BKV_POUSADA_URL = `${SITE}/en/pousada-beekite-village-2/`;
export const BKV_ABOUT_URL = `${SITE}/en/about-beekite-village/`;
export const BKV_SPOT_URL = `${SITE}/en/spot-kitesurf/`;
export const BKV_BOOKING_URL = `${SITE}/en/booking-request/`;
export const BKV_MAP_URL = `${SITE}/en/map-beekite-village/`;

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share it */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** paragraphs of the page body (drops scripts, forms and the site chrome) */
function paragraphs(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, form')) el.remove();
  const body = root.querySelector('.pagecontent') ?? root.querySelector('body') ?? root;
  return body.querySelectorAll('h1, h2, h3, h4, p').map(e => collapse(e.text)).filter(Boolean);
}

/** findPrices misses a trailing euro sign ("90 €", "420,00 €": its `\b` after € never matches); catch those too */
function amounts(text: string): string[] {
  const out = findPrices(text).map(p => p.raw);
  for (const m of text.matchAll(/\d[\d.,]*\s?€/g)) if (!out.some(r => r.includes(m[0].trim()))) out.push(m[0]);
  return out;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface BkvChalets { text: string; count: number | null; built: number | null; features: string[] }

export function parseBkvChalets(pousadaHtml: string): BkvChalets {
  const paras = paragraphs(pousadaHtml).filter(p => !/^(Pousada|Booking request)$/i.test(p));
  const text = paras.join(' ');
  const count = Number(text.match(/All (\d+) chalets/i)?.[1] ?? text.match(/(\d+) chalets were/i)?.[1]) || null;
  const built = Number(text.match(/built in (20\d{2})/i)?.[1]) || null;
  const has = (re: RegExp) => re.test(text);
  const features = [
    has(/up to 3-4 people/i) ? 'Up to 3-4 guests' : null,
    has(/stand on stilts/i) ? 'On stilts' : null,
    has(/own bathroom/i) ? 'Private bathroom' : null,
    has(/king size bed/i) ? 'King-size bed' : null,
    has(/outside shower/i) ? 'Outdoor shower' : null,
    has(/own terrace/i) ? 'Own terrace' : null,
    has(/air conditioning/i) ? 'Air conditioning' : null,
    has(/warm shower/i) ? 'Hot shower' : null,
    has(/refrigerator/i) ? 'Refrigerator' : null,
  ].filter((x): x is string => !!x);
  return { text, count, built, features };
}

/** Contact Form 7 selects of /en/booking-request/: category -> options as printed ("Base Course - 420,00 €"). */
export function parseBkvOptions(bookingHtml: string): Record<string, string[]> {
  const labels: Record<string, string> = { touren: 'Tours', kurse: 'Kite courses', verleih: 'Rental', mitglieder: 'Member' };
  const out: Record<string, string[]> = {};
  const root = parse(bookingHtml);
  for (const [name, label] of Object.entries(labels)) {
    const opts = root.querySelectorAll(`select[name="${name}"] option`)
      .filter(o => o.getAttribute('value') !== '0')
      .map(o => collapse(o.text).replace(/[–—]/g, '-').replace(/(\S)-\s+(\d[\d.,]* €)$/, '$1 - $2'))
      .filter(t => t && !/bitte ausw|^-+$/i.test(t));
    if (opts.length) out[label] = opts;
  }
  return out;
}

/** Google Maps embed of /en/map-beekite-village/: `var myLatLng = {lat: -2.90.., lng: -41.45..}`. */
export function parseBkvCoords(mapHtml: string): { lat: number; lng: number } | null {
  const m = mapHtml.match(/myLatLng\s*=\s*\{\s*lat:\s*(-?\d+\.\d+)\s*,\s*lng:\s*(-?\d+\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]); const lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** gallery originals (lightbox links) first, then the other content photos of the pousada page */
export function bkvImages(pousadaHtml: string): string[] {
  const root = parse(pousadaHtml);
  const gallery = root.querySelectorAll('.wp-block-gallery figure a')
    .map(a => a.getAttribute('href') ?? '')
    .filter(h => /\/wp-content\/uploads\/.+\.(jpe?g|png|webp)$/i.test(h));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of [...gallery, ...imageCandidates(pousadaHtml, BKV_POUSADA_URL, null, 80)]) {
    if (/\/themes\/|favicon|logo|\.svg|\.gif/i.test(u)) continue;
    const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); out.push(u);
  }
  return out;
}

export interface BkvPages { pousada: string; about: string; spot: string; booking: string; map: string }

export function parseBeekiteContent(p: BkvPages): OfferContent {
  const chalets = parseBkvChalets(p.pousada);
  const about = paragraphs(p.about).join(' ');
  const spot = paragraphs(p.spot).join(' ');
  const options = parseBkvOptions(p.booking);
  const coords = parseBkvCoords(p.map);
  const courses = options['Kite courses'] ?? [];

  const rooms: ContentRoom[] = [{
    name: 'Beach chalet',
    description: `${chalets.count ?? 11} chalets on stilts on the station grounds, at most 200 m from the water${chalets.built ? `, built in ${chalets.built}` : ''}.`,
    features: chalets.features,
  }];

  const summary = [
    `Beekite Village is a kitesurf station with ${chalets.count ?? 11} beach chalets on its grounds at Praia do Macapá, a small fishing village in Luís Correia (Piauí, north-east Brazil); every chalet is at most 200 m from the water.`,
    `The chalets${chalets.built ? `, built in ${chalets.built},` : ''} stand on stilts, sleep up to 3-4 people and have a private bathroom, king-size bed, outdoor shower, terrace, air conditioning and fridge; breakfast is served on the terrace or as a buffet, dinner is cooked on request.`,
    `The station runs kite courses and Duotone rental and has gear storage with a compressor, beach boys and a small beach bar; at low tide the lagoons and the river mouth have flat, shallow water.`,
    'Stays are booked through a request form; the site publishes no chalet prices.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Beekite Village',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Piauí',
    spot: 'Praia do Macapá',
    // Google Maps embed on /en/map-beekite-village/ (checked 2026-10-12)
    spotCoords: coords,
    itinerarySpots: [],
    durationDays: null,
    // spot page: "a perfect area for beginners", river mouth "a paradise for freestylers"; courses up to jumping
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: courses.length > 0 || /kite school|courses/i.test(about),
    equipmentRental: (options.Rental ?? []).length > 0 || /rental material/i.test(about),
    beginnerFriendly: /perfect area for beginners|for beginners/i.test(spot),
    includedServices: [
      /breakfast/i.test(chalets.text) ? 'Breakfast (terrace or buffet on the breakfast deck)' : null,
    ].filter((x): x is string => !!x),
    optionalServices: [
      /cook for you/i.test(chalets.text) ? 'Dinner cooked on request' : null,
      /storage area/i.test(about) ? 'Kite gear storage at the station with compressor, rinse lawn and beach boys' : null,
      ...Object.entries(options).map(([cat, list]) => `${cat}: ${list.join('; ')}`),
    ].filter((x): x is string => !!x),
    accommodation: 'beach chalets on stilts on the kite station grounds',
    mealPlan: 'breakfast',
    languages: [],
    rooms,
    imageUrls: bkvImages(p.pousada).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: BKV_POUSADA_URL,
    bookingUrl: `${BKV_POUSADA_URL}#booking`,
    sourceText: [
      `pousada: ${chalets.text}`,
      `station: ${about}`,
      `spot: ${spot}`,
      `request form options: ${Object.entries(options).map(([c, l]) => `${c}: ${l.join(' | ')}`).join(' || ')}`,
      `map: ${coords ? `${coords.lat},${coords.lng}` : '-'}`,
    ].join('\n'),
  };
}

/** No published chalet price: [] (price on request). Returns the amounts if the pousada page starts printing some. */
export function bkvVisiblePrices(pousadaHtml: string): string[] {
  return amounts(paragraphs(pousadaHtml).join(' '));
}

// --- adapter ----------------------------------------------------------------------------------
export const beekiteVillageMacapa: OfferAdapter = {
  key: 'beekite-village-macapa',
  name: 'Beekite Village Praia do Macapá',
  kind: 'accommodation',
  operator: {
    name: 'Beekite Village',
    websiteUrl: SITE,
    rootDomain: 'kitesurf-brasil.eu',
    contactEmail: 'info@kitesurf-brasil.eu',
    phone: '+393394373751',
  },
  url: BKV_POUSADA_URL,
  slotMethod: 'price_table',
  fetchBudget: 6,
  confidence: 'low', // Aaron 2026-10-12: listed without 2026/27 proof, no prices on the site, request form only
  async fetchContent() {
    const [pousada, about, spot, booking, map] = [
      await page(BKV_POUSADA_URL), await page(BKV_ABOUT_URL), await page(BKV_SPOT_URL),
      await page(BKV_BOOKING_URL), await page(BKV_MAP_URL),
    ];
    return parseBeekiteContent({ pousada, about, spot, booking, map });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await page(BKV_POUSADA_URL);
    if (!/chalet/i.test(html)) throw new Error('beekite-village: chalet text missing on the pousada page (layout changed?)');
    const prices = bkvVisiblePrices(html);
    if (prices.length) ctx.note(`prices appeared on the pousada page (${prices.slice(0, 5).join(', ')}): extend the adapter`);
    return [];
  },
};
