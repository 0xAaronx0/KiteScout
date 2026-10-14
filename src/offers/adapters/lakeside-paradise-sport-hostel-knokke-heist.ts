// ---------------------------------------------------------------------------
// Lakeside Paradise Sport Hostel, Knokke-Heist (West Flanders, Belgium) - the 10-room hostel (bunk-bed rooms for 4,
// 8 and 12 people) of the Lakeside Paradise water sports club and wakeboard cable park on Lake Duinenwater,
// Duinenwater 41, 1 km from the beach. Kite link (Aaron's call 2026-10-12: list it, described honestly): the hostel
// itself has no kite school; the same club ("Surfers en Lakeside Paradise vzw", same company number OND 0431 001 781
// in both sites' footers) runs the Surfers Paradise water sports center with a "Kitesurfcenter" (lessons, rental,
// camps) on the beach of Knokke-Heist, which the hostel's facility list puts at "Distance: 5 km"; a Lakeside
// membership includes Surfers Paradise.
//
// Data path (checked 2026-10-12): WordPress (WPML; the English pages are used).
//   content  /en/sports-hostel/overview/, /en/sports-hostel/accommodation/ (facility table: 10 rooms, 64 beds,
//            rooms per size, distances), /en/info/lakesideparadise/ (club, opening season, membership incl. Surfers
//            Paradise), www.surfersparadise.be/home/ (the kite center: "Kitesurfcenter", "gelegen op het strand
//            van Knokke-Heist").
//   slots    /en/sports-hostel/rates/: "Room with 12 beds | 25 € / bed / night", "Room with 8 beds | 29 € / bed /
//            nacht", "Room with 4 beds | 39€ / bed / nacht" - no dates, no year -> one undated slot per room size,
//            EUR per bed (person) per night, availability 'unknown'.
// Booking engine: Cubilis (reservations.cubilis.eu/lakeside-paradise-hostel-knokke-heist) answers 403 to non-browser
//   clients (research 2026-10-12) -> not called.
// robots.txt (2026-10-12): lakesideparadise.be and surfersparadise.be are Yoast defaults (allow everything).
// Requests per run: content 5 (4 Lakeside pages + 1 Surfers Paradise), slots 1 (rates page, memoised).
// Known limits: the map pin is missing (the location page embeds Google Maps by address, no coordinates); the rate
//   table has no season, so prices hold "as printed" until the page changes.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, parseAmount } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.lakesideparadise.be';
export const LP_OVERVIEW_URL = `${SITE}/en/sports-hostel/overview/`;
export const LP_RATES_URL = `${SITE}/en/sports-hostel/rates/`;
export const LP_FACILITIES_URL = `${SITE}/en/sports-hostel/accommodation/`;
export const LP_ABOUT_URL = `${SITE}/en/info/lakesideparadise/`;
export const LP_SURFERS_URL = 'https://www.surfersparadise.be/home/';
const LP_BOOKING_URL = 'https://reservations.cubilis.eu/lakeside-paradise-hostel-knokke-heist';

const memo = new Map<string, { at: number; p: Promise<string> }>();
function get(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines of the page body (scripts, styles, SVGs, header and menus dropped), split at block tags. */
export function lpLines(html: string): string[] {
  const body = html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ');
  const out: string[] = [];
  for (const raw of body.split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|a|button|figure|span)\b[^>]*>/i)) {
    const t = clean(raw.replace(/<[^>]+>/g, ' '));
    if (t && out[out.length - 1] !== t) out.push(t);
  }
  return out;
}

export function lpUnit(beds: number): string { return `${beds}-bed room (bunk beds)`; }

/** Rate table: "Room with 12 beds" followed by "25 € / bed / night". */
export function parseLpRates(html: string): Array<{ beds: number; price: number; raw: string }> {
  const lines = lpLines(html);
  const out: Array<{ beds: number; price: number; raw: string }> = [];
  lines.forEach((l, i) => {
    const beds = l.match(/^Room with (\d+) beds$/i)?.[1];
    if (!beds) return;
    const priceLine = lines.slice(i + 1, i + 3).find(x => /€/.test(x) && /bed/i.test(x));
    const price = priceLine ? parseAmount(priceLine) : null;
    if (price && !out.some(r => r.beds === Number(beds))) out.push({ beds: Number(beds), price, raw: priceLine! });
  });
  return out;
}

export function buildLpSlots(rates: Array<{ beds: number; price: number }>): Slot[] {
  return rates.map(r => ({
    key: `dorm-${r.beds}-beds`,
    startDate: null,
    endDate: null,
    unit: lpUnit(r.beds),
    price: r.price,
    currency: 'EUR',
    priceUnit: 'per_night',
    priceBasis: 'person',
    occupancy: 1,
    availability: 'unknown',
    availabilityText: null,
    spotsLeft: null,
  }));
}

/** Facility table: rooms per size ("4 pers. | 2 rooms", "8 pers. | 6 kamers"), bed total, distances. */
export function parseLpFacilities(html: string): { roomsBySize: Record<number, number>; rooms: number | null; beds: number | null; distances: Record<string, string>; themes: string[] } {
  const lines = lpLines(html);
  const roomsBySize: Record<number, number> = {};
  lines.forEach((l, i) => {
    const size = l.match(/^(\d+) pers\.$/)?.[1];
    const n = lines[i + 1]?.match(/^(\d+)\s+(?:rooms?|kamers?)$/i)?.[1];
    if (size && n) roomsBySize[Number(size)] = Number(n);
  });
  const total = lines.join('\n').match(/(\d+)\s+ROOMS\s*-\s*(\d+)\s+SLEEPING/i);
  const distances: Record<string, string> = {};
  lines.forEach((l, i) => {
    const d = lines[i + 1]?.match(/^Distance:\s*(.+)$/i)?.[1];
    if (d) distances[l] = d;
  });
  const themes = lines.join(' ').match(/So you have the rooms ([^.]+)\./)?.[1]?.split(/,\s*|\s+and\s+/).map(s => s.trim()).filter(Boolean) ?? [];
  return { roomsBySize, rooms: total ? Number(total[1]) : null, beds: total ? Number(total[2]) : null, distances, themes };
}

export interface LpPages { overview: string; rates: string; facilities: string; about: string; surfers: string }

export function parseLakesideContent(p: LpPages): OfferContent {
  const rates = parseLpRates(p.rates);
  const fac = parseLpFacilities(p.facilities);
  const overviewText = lpLines(p.overview).join('\n');
  const ratesText = lpLines(p.rates).join('\n');
  const facText = lpLines(p.facilities).join('\n');
  const aboutText = lpLines(p.about).join('\n');
  const surfersLines = lpLines(p.surfers);
  const surfersText = surfersLines.join('\n');
  const kiteCenter = /Kitesurfcenter/i.test(surfersText);
  const sameClub = /Surfers en Lakeside Paradise vzw/i.test(surfersText);
  const toSurfers = fac.distances['Surfers Paradise'] ?? null;
  const toBeach = fac.distances['Beach & North Sea'] ?? null;
  const memberBoth = /also a member of\s+Surfers Paradise/i.test(aboutText);
  const season = aboutText.match(/open daily from ([^.]+)\. In between, ([^.]+)\./i);
  const groupBreakfast = ratesText.match(/Breakfast buffet for Sport Hostel groups \(from (\d+) pers\.\)\s*€\s*(\d+)/i);
  const privatised = /privatised for your group as soon as half of its capacity is booked/i.test(ratesText);
  const min = rates.length ? Math.min(...rates.map(r => r.price)) : null;
  const max = rates.length ? Math.max(...rates.map(r => r.price)) : null;

  const has = (re: RegExp) => re.test(facText);
  const shared = [
    has(/Bed sheets available\s+yes/i) ? 'Bunk beds, bed linen included (bring towels and toiletries)' : 'Bunk beds',
    ...(has(/Shared bathroom in the corridor/i) ? ['Shared bathrooms and toilets in the corridor (separate for men and women)'] : []),
    ...(has(/Private lockers\s+yes\s+Warranty 20/i) ? ['Lockers (EUR 20 deposit)'] : []),
    ...(privatised ? ['A room is private for your group once half of its beds are booked; the extra beds are free'] : []),
  ];
  const rooms: ContentRoom[] = rates.map(r => ({
    name: lpUnit(r.beds),
    description: `${fac.roomsBySize[r.beds] ? `${fac.roomsBySize[r.beds]} room${fac.roomsBySize[r.beds] > 1 ? 's' : ''}` : 'Rooms'} with ${r.beds} beds, each themed after a surf spot.`,
    features: [`EUR ${r.price} per bed and night`, ...shared],
  }));

  const imageUrls: string[] = [];
  for (const [html, base] of [[p.overview, LP_OVERVIEW_URL], [p.facilities, LP_FACILITIES_URL], [p.rates, LP_RATES_URL], [p.about, LP_ABOUT_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 40)) {
      if (/\.svg|logo|favicon|icon|flag|wpml|sponsor|partner|travelmyth|no-pets|huisreglement|_plan|plan[A-Z]/i.test(u)) continue;
      const k = u.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
      if (!imageUrls.some(x => x.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '') === k)) imageUrls.push(u);
    }
  }

  const summary = [
    `Lakeside Paradise Sport Hostel is the hostel of the Lakeside Paradise water sports club and wakeboard cable park on Lake Duinenwater in Knokke-Heist on the Belgian coast${toBeach ? `, ${toBeach} from the beach` : ''}: ${fac.rooms ?? 10} rooms with bunk beds for 4, 8 or 12 people${fac.beds ? ` (${fac.beds} beds)` : ''}, shared bathrooms, a bar and restaurant on site.`,
    `The hostel has no kite school of its own: the same club runs the Surfers Paradise water sports center${kiteCenter ? ' with a kitesurf center' : ''} on the beach of Knokke-Heist${toSurfers ? `, about ${toSurfers} away` : ''}${memberBoth ? ', and a Lakeside membership includes Surfers Paradise' : ''}.`,
    `${min !== null ? `Beds cost EUR ${min} to ${max} per night depending on room size, bed linen included; ` : ''}breakfast is extra and groups can add half or full board.`,
    season ? `The club is open daily from ${season[1]} and on ${season[2].replace(/^all /i, '')} in between.` : '',
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Lakeside Paradise Sport Hostel',
    summary,
    continent: 'Europe',
    country: 'Belgium',
    region: 'Knokke-Heist, West Flanders',
    spot: 'Knokke-Heist',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    // lessons at Surfers Paradise (same club, beach, ~5 km), not at the hostel
    kiteLessons: kiteCenter ? true : null,
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: [
      ...(has(/Bed sheets available\s+yes/i) ? ['Bed linen'] : []),
      ...(has(/Free WiFi\s+yes/i) ? ['Wi-Fi'] : []),
      ...(has(/Lounge area\s+yes/i) ? ['Lounge in the clubhouse'] : []),
      ...(has(/Outdoor fitness equipment\s+yes/i) ? ['Outdoor fitness equipment around the lake'] : []),
    ],
    optionalServices: [
      ...(kiteCenter ? [`Kitesurfing at Surfers Paradise, the club's water sports center on the beach${toSurfers ? ` (about ${toSurfers})` : ''}: lessons, rental, camps`] : []),
      'Wakeboard and waterski cable park on the lake',
      'Tiki breakfast (à la carte)',
      ...(groupBreakfast ? [`Breakfast buffet for groups from ${groupBreakfast[1]} persons (EUR ${groupBreakfast[2]})`] : []),
      'Half or full board for groups (on request)',
      ...(has(/Rental bikes\s+yes/i) ? ['Bike rental (book in advance)'] : []),
      ...(has(/24h - 3€/) ? ['Parking tickets (EUR 3 per 24 h)'] : []),
    ],
    accommodation: 'sport hostel with bunk-bed rooms for 4, 8 and 12 people',
    mealPlan: 'room only (breakfast, half or full board optional)',
    languages: ['nl', 'fr', 'en', 'de'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: LP_OVERVIEW_URL,
    bookingUrl: LP_BOOKING_URL,
    sourceText: [
      `overview: ${overviewText.slice(overviewText.indexOf('Lakeside Paradise Sport Hostel offers'), overviewText.indexOf('Testimonials'))}`,
      `rates: ${rates.map(r => `${r.beds} beds ${r.raw}`).join('; ')}${groupBreakfast ? `; ${groupBreakfast[0]}` : ''}`,
      `facilities: ${fac.rooms} rooms, ${fac.beds} beds, ${JSON.stringify(fac.roomsBySize)}, distances ${JSON.stringify(fac.distances)}, themes ${fac.themes.join(', ')}`,
      `about: ${aboutText.match(/Lakeside Paradise started in[\s\S]*?CU @ the Lake!/)?.[0] ?? ''}`,
      `surfers paradise: kitesurf center ${kiteCenter}, same club ${sameClub}; ${surfersLines.find(l => /gelegen op het strand/i.test(l)) ?? ''}`,
      `facility table: ${facText.slice(Math.max(0, facText.indexOf('10 ROOMS')), facText.indexOf('Book now') > 0 ? facText.indexOf('Book now') : 4000)}`,
    ].join('\n'),
  };
}

export const lakesideParadiseSportHostelKnokkeHeist: OfferAdapter = {
  key: 'lakeside-paradise-sport-hostel-knokke-heist',
  name: 'Lakeside Paradise Sport Hostel Knokke-Heist',
  kind: 'accommodation',
  operator: {
    name: 'Lakeside Paradise',
    websiteUrl: SITE,
    rootDomain: 'lakesideparadise.be',
    contactEmail: 'info@lakesideparadise.be',
    phone: '+32 50 60 60 35',
  },
  url: LP_OVERVIEW_URL,
  slotMethod: 'price_table',
  fetchBudget: 6,
  async fetchContent() {
    const overview = await get(LP_OVERVIEW_URL);
    const rates = await get(LP_RATES_URL);
    const facilities = await get(LP_FACILITIES_URL);
    const about = await get(LP_ABOUT_URL);
    const surfers = await get(LP_SURFERS_URL);
    return parseLakesideContent({ overview, rates, facilities, about, surfers });
  },
  async fetchSlots(ctx: FetchContext) {
    const rates = parseLpRates(await get(LP_RATES_URL));
    if (rates.length < 2) throw new Error(`lakeside-paradise: rate table not found or changed (${rates.length} rows)`);
    if (rates.length !== 3) ctx.note(`rate table has ${rates.length} room sizes (expected 3)`);
    return buildLpSlots(rates);
  },
};
