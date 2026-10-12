// ---------------------------------------------------------------------------
// 35 Knots Brazil, Praia de Macapá (Luís Correia, Piauí, Brazil) - kite pousada of Boris: a 4-bedroom
// villa with private pool (groups up to 11) and 4 air-conditioned chalets (up to 4 guests each), restaurant
// and bar, garden with pool, gym and beach tennis; kite lessons and packages, a small kite shop, quad-bike
// shuttle to the kite spot, downwinders and kite trips.
//
// Liveness (re-check 2026-10-12, verdict LIVE): the pousada's Facebook page (search snippet, 2026-10-12)
//   announces the 2026 season from 1 August until after Carnival 2027; a BookSurfCamps guest review dated
//   December 2025 and a Tripadvisor restaurant listing (search snippets; platforms are hints only, not data).
//   The own site's footer "© 2023" is the Wix template line; its newest media date from 2024-09 and it
//   advertises the quad-bike shuttle as new.
//
// Data path (checked 2026-10-12): www.35knots-brazil.com, Wix (server-rendered text), English pages:
//   content  /en (about, services, spot, activities, contact), /en/chalets, /en/villa. Map pin = the Wix
//            site's own business location (businessLocationCoordinates in the page's site data,
//            "Praia de Macapá - Coqueiro, Luís Correia").
//   slots    none: rooms are only bookable in the Wix Hotels app (/en/book-a-room), which needs a signed
//            visitor-token handshake built in the browser - not used (never bypass). The pages print no
//            price. fetchSlots re-reads /en/chalets (memoised) and returns [] (offer = "price on request");
//            it notes when an amount shows up so the adapter can be extended.
// robots.txt (2026-10-12): Wix default (only "*?lightbox=" disallowed for all agents); the listed
//   /sitemap.xml answers 404.
// Requests per run: content 3, slots 1 (0 extra when content ran in the same process). Pages are
//   0.9-1.2 MB each (Wix); fixtures are trimmed to markup + the business-location fragment.
// Known limits: no season dates or prices on the own site; the business pin is labelled "Coqueiro" by
//   Google (neighbouring beach), so it may sit a few km from the pousada.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, findPrices, imageCandidates } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.35knots-brazil.com';
export const K35_HOME_URL = `${SITE}/en`;
export const K35_CHALETS_URL = `${SITE}/en/chalets`;
export const K35_VILLA_URL = `${SITE}/en/villa`;
const BOOKING_URL = `${SITE}/en/book-a-room`;
const PHONE = '+5586999515918';

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

/** Visible text lines of a Wix page (comments, scripts, styles, SVG dropped; zero-width spaces removed). */
export function k35Lines(html: string): string[] {
  const body = html.replace(/<!--[\s\S]*?-->|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, '');
  const lines = body.split(/<[^>]+>/).map(s => clean(s).replace(/​/g, '').trim()).filter(Boolean);
  const a = lines.findIndex(l => /^Use tab to navigate/i.test(l));
  const b = lines.findIndex((l, i) => i > a && /^CONTACT US$/i.test(l));
  return lines.slice(a + 1, b > a ? b : undefined);
}
const k35Text = (html: string): string => collapse(k35Lines(html).join(' ')).replace(/\s+([,.;:!?])/g, '$1');
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
const count = (s: string | undefined): number | null => (s ? (WORDS[s.toLowerCase()] ?? (Number.isFinite(Number(s)) ? Number(s) : null)) : null);

/** The Wix site's own business location (site data), e.g. {"latitude":-2.91,"longitude":-41.44}. */
export function k35Coords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/"businessLocationCoordinates":\{"latitude":(-?\d+\.\d+),"longitude":(-?\d+\.\d+)\}/);
  if (!m) return null;
  const lat = Number(m[1]); const lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? { lat, lng } : null;
}

export interface K35Facts {
  villaGuests: number | null; chalets: number | null; chaletGuests: number | null;
  villaBedrooms: number | null; villaBathrooms: number | null;
  windFrom: string | null; windTo: string | null; windAvg: string | null; windPeak: number | null;
  breakfastHours: string | null; wifiMbps: number | null;
}

export function parseK35Facts(home: string, villa: string): K35Facts {
  const n = (s: string | undefined) => (s ? Number(s) : null);
  const offer = home.match(/Villa with a pool for groups of up to (\d+) guests, and (\d+) air-conditioned Chalets\/Bungalows, each accommodating up to (\d+) guests/i);
  const wind = home.match(/strong trade winds from (\w+) to (\w+), with average wind speeds ranging from (\d+ to \d+) knots and thrilling peaks reaching up to (\d+) knots/i);
  return {
    villaGuests: n(offer?.[1]), chalets: n(offer?.[2]), chaletGuests: n(offer?.[3]),
    villaBedrooms: count(villa.match(/offers (\w+) air-conditioned bedrooms/i)?.[1]),
    villaBathrooms: count(villa.match(/(\w+) modern bathrooms/i)?.[1]),
    windFrom: wind?.[1] ?? null, windTo: wind?.[2] ?? null, windAvg: wind?.[3] ?? null, windPeak: n(wind?.[4]),
    breakfastHours: home.match(/breakfast with local products from (\d+ ?am ?- ?\d+ ?am)/i)?.[1] ?? null,
    wifiMbps: n(home.match(/(\d+) Mbps download/i)?.[1]),
  };
}

/** Wix originals (transform path dropped), PNG icons and duplicates removed. */
export function k35Images(pages: Array<[string, string]>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [html, base] of pages) {
    for (const u of imageCandidates(html, base, null, 80)) {
      const id = decodeURIComponent(u).match(/static\.wixstatic\.com\/media\/([^/~.]+)/)?.[1];
      if (!id || seen.has(id) || /\.(?:png|svg|gif)(?:\/|$)/i.test(u) || /logo|icon/i.test(u)) continue;
      seen.add(id);
      out.push(decodeURIComponent(u).replace(/(\/media\/[^/]+)\/v1\/.*$/, '$1'));
    }
  }
  return out;
}

export interface K35Pages { home: string; chalets: string; villa: string }

export function parse35KnotsContent(p: K35Pages): OfferContent {
  const home = k35Text(p.home);
  const chalets = k35Text(p.chalets);
  const villa = k35Text(p.villa);
  const f = parseK35Facts(home, villa);
  const coords = k35Coords(p.home) ?? k35Coords(p.chalets);
  const has = (re: RegExp) => re.test(home);
  const transfers = home.match(/Kitesurfing destinations\s*-\s*([^.]*?)\.\s*Ask at a reception/i)?.[1]?.replace(/\s*,\s*/g, ', ') ?? null;

  const rooms: ContentRoom[] = [
    {
      name: 'Kite Villa',
      description: `${f.villaBedrooms ?? 4}-bedroom villa with private pool, sun beds, BBQ area and beach tennis${f.villaGuests ? ` for groups of up to ${f.villaGuests} guests` : ''}.`,
      features: [
        f.villaBedrooms ? `${f.villaBedrooms} air-conditioned bedrooms` : null,
        f.villaBathrooms ? `${f.villaBathrooms} bathrooms` : null,
        /private pool/i.test(villa) ? 'Private pool' : null,
        /BBQ/i.test(villa) ? 'BBQ area' : null,
        /large living room/i.test(villa) ? 'Large living room' : null,
        /Laundry service/i.test(villa) ? 'Laundry service available' : null,
      ].filter((x): x is string => !!x),
    },
    {
      name: 'Chalet',
      description: `${f.chalets ?? 4} air-conditioned chalets / bungalows${f.chaletGuests ? ` for up to ${f.chaletGuests} guests each` : ''}.`,
      features: [
        /air-conditioned/i.test(chalets) ? 'Air conditioning' : null,
        /veranda/i.test(chalets) ? 'Veranda with hammock' : null,
      ].filter((x): x is string => !!x),
    },
  ];

  const summary = [
    `35 Knots is a kite pousada at Praia de Macapá (Luís Correia, Piauí) on Brazil's north-east coast, with a ${f.villaBedrooms ?? 4}-bedroom villa with private pool for groups of up to ${f.villaGuests ?? 11} guests and ${f.chalets ?? 4} air-conditioned chalets for up to ${f.chaletGuests ?? 4} guests each.`,
    `The pousada has a restaurant and bar, a gym, a garden with pool and beach tennis, a breakfast buffet and daily housekeeping; a quad-bike shuttle takes guests to the kite spot and there is a cleaning space for kites.`,
    `Boris and friends, certified instructors, give kite lessons and packages; the house runs a small kite shop and organises downwinders, kite trips and transfers to other kite spots${transfers ? ` (${transfers})` : ''}.`,
    `${f.windFrom && f.windTo ? `Trade winds blow from ${f.windFrom} to ${f.windTo} (average ${f.windAvg?.replace(' to ', '-')} knots) over flat-water lagoons that work at all tides` : 'Flat-water lagoons nearby work at all tides'}; rooms are booked through the site's reservation page or on request, and no prices are published.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: '35 Knots Brazil',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Piauí',
    spot: 'Praia de Macapá',
    // Wix site business location (businessLocationCoordinates, checked 2026-10-12)
    ...(coords ? { spotCoords: coords } : {}),
    itinerarySpots: [],
    durationDays: null,
    // spot text: "Whether you're a beginner or an experienced rider, this spot caters to all levels"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: has(/Kite Lessons & Packages/i),
    equipmentRental: null, // the site does not mention rental gear
    beginnerFriendly: has(/beginner/i),
    includedServices: [
      f.breakfastHours ? `Breakfast buffet (${f.breakfastHours.replace(/\s*-\s*/, '-')})` : (has(/Breakfast Buffet/i) ? 'Breakfast buffet' : null),
      has(/Daily Housekeeping/i) ? 'Daily housekeeping' : null,
      f.wifiMbps ? `Wi-Fi (${f.wifiMbps} Mbps)` : null,
      has(/Pool & BBQ/i) ? 'Pool and BBQ area' : null,
      has(/beach tennis/i) ? 'Garden with beach tennis, football and yoga space' : null,
      /cleaning space for your kites/i.test(chalets) ? 'Kite cleaning space' : null,
    ].filter((x): x is string => !!x),
    optionalServices: [
      'Kite lessons and packages (certified instructors)',
      has(/small kite shop/i) ? 'Kite shop' : null,
      has(/Quad Bike Service|quad bike shuttle/i) ? 'Quad-bike shuttle to the kite spot' : null,
      has(/Downwinders/i) ? 'Downwinders with local guides' : null,
      has(/Parnaiba River Delta/i) ? 'Parnaíba river delta trip (bird watching, kitesurfing, local lunch)' : null,
      transfers ? `Private transfers to kite spots (${transfers})` : null,
      has(/Quadbike Tours/i) ? 'Quad-bike tours' : null,
      has(/massage/i) ? 'Massage' : null,
      'Restaurant and bar',
    ].filter((x): x is string => !!x),
    accommodation: 'kite pousada with a villa and chalets',
    mealPlan: has(/Breakfast Buffet/i) ? 'breakfast' : null,
    languages: ['en', 'de'],
    rooms,
    imageUrls: k35Images([[p.home, K35_HOME_URL], [p.chalets, K35_CHALETS_URL], [p.villa, K35_VILLA_URL]]).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: K35_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home}`,
      `chalets: ${chalets}`,
      `villa: ${villa}`,
      `facts: ${JSON.stringify(f)}`,
      `business location: ${coords ? `${coords.lat},${coords.lng}` : '-'} (${p.home.match(/"businessLocationFormatted":"([^"]*)"/)?.[1] ?? ''})`,
    ].join('\n'),
  };
}

/** No published price: [] (price on request). Returns the amounts if the chalets page starts printing some. */
export function k35VisiblePrices(chaletsHtml: string): string[] {
  return findPrices(k35Text(chaletsHtml)).map(p => p.raw);
}

// --- adapter ----------------------------------------------------------------------------------
export const thirtyFiveKnotsMacapa: OfferAdapter = {
  key: '35-knots-macapa',
  name: '35 Knots Brazil Praia de Macapá',
  kind: 'accommodation',
  operator: {
    name: '35 Knots Brazil',
    websiteUrl: SITE,
    rootDomain: '35knots-brazil.com',
    contactEmail: 'info@35knots-brazil.com',
    whatsapp: PHONE,
    phone: PHONE,
  },
  url: K35_HOME_URL,
  slotMethod: 'booking_engine',
  fetchBudget: 4,
  confidence: 'low', // Wix Hotels engine not usable (signed visitor token); no prices on the pages
  async fetchContent() {
    const [home, chalets, villa] = [await page(K35_HOME_URL), await page(K35_CHALETS_URL), await page(K35_VILLA_URL)];
    return parse35KnotsContent({ home, chalets, villa });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await page(K35_CHALETS_URL);
    if (!/Spacious Chalets/i.test(html)) throw new Error('35-knots: chalets text missing on /en/chalets (layout changed?)');
    const prices = k35VisiblePrices(html);
    if (prices.length) ctx.note(`prices appeared on /en/chalets (${prices.slice(0, 5).join(', ')}): extend the adapter`);
    ctx.note('no slot source: rooms are bookable only in the Wix Hotels app (signed visitor-token handshake, not used)');
    return [];
  },
};
