// ---------------------------------------------------------------------------
// Villa Aloha, Praia de Patos (Itarema, Ceará, Brazil) - small beach pousada with its own kite school on site:
// sea-view bungalows facing the kite spot, bar/restaurant, kite club with storage and rinsing area, buggy shuttle
// to the spots of the Patos bay and lagoons.
//
// Data path (checked 2026-10-12): www.pousadavillaaloha.com (WordPress/Elementor, French default with /en/ and /pt/
//   versions; the English pages are read):
//   content  /en/ (spot, wind, school and pousada teaser, address, e-mail, phone), /en/hotel-brazil/ (bungalows,
//            meals, activities), /en/kitesurf-school/ (IKO instructor, storage, spots, wind season).
//   slots    the "Prices" block printed on /en/hotel-brazil/ (and /en/kitesurf-school/): "Night with breakfast :
//            - Room 1 guest : 300R$ - Room 2 guests : 400R$ - Room 3 guests : 480R$" - no dates, no inventory.
//            Booking by e-mail / WhatsApp ("For any request for information or reservation, please contact
//            Olivier") -> 'on_request'.
// Liveness (rule 5b): Yoast dateModified 2026-07-12 (home), 2026-05-03 (hotel page with the prices) and
//   2026-05-03 (school page); footer "Villa Aloha 2026".
// robots.txt (2026-10-12): only /wordpress/wp-admin/ disallowed (admin-ajax allowed).
// Requests per run: content 3, slots 1 (0 extra when content ran in the same process).
// Parsed: 3 slots = occupancy 1-3 ("bungalow-2p"), BRL per bungalow per night incl. breakfast, no dates.
// Known limits: the number of bungalows is not published; the Google map on the contact page is a name query
//   (no coordinates) -> no spotCoords. The site converts with "1€ ≈ 6R$" - not used (original currency only).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.pousadavillaaloha.com';
export const VA_HOME_URL = `${SITE}/en/`;
export const VA_HOTEL_URL = `${SITE}/en/hotel-brazil/`;
export const VA_SCHOOL_URL = `${SITE}/en/kitesurf-school/`;
const CONTACT_URL = `${SITE}/en/contact-villa-aloha/`;
export const VA_UNIT = 'Sea-view bungalow';

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

/** Visible text of an Elementor page (header / footer / scripts dropped). */
function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, form, [data-elementor-type="header"], [data-elementor-type="footer"]')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}

// --- pure parsers -----------------------------------------------------------------------------
export interface VaRate { persons: number; nightly: number }

/** "Night with breakfast : – Room 1 guest : 300R$ – Room 2 guests : 400R$ – Room 3 guests : 480R$". */
export function parseVaRates(html: string): VaRate[] {
  const t = collapse(parse(html).text);
  const block = t.match(/Night with breakfast\s*:([\s\S]*?)(?:1\s*€|Kitesurf\s+Lessons|$)/i)?.[1] ?? '';
  const out: VaRate[] = [];
  for (const m of block.matchAll(/Room\s+(\d)\s+guests?\s*:\s*([\d.,]+)\s*R\$/gi)) {
    const n = parseAmount(m[2]);
    if (n && !out.some(r => r.persons === Number(m[1]))) out.push({ persons: Number(m[1]), nightly: n });
  }
  return out;
}

/** "Group lesson (3 students max) : 280R$/hour/pers" -> lesson price line (as printed, currency BRL). */
export function parseVaLesson(html: string): string | null {
  const m = collapse(parse(html).text).match(/Group lesson\s*\(([^)]*)\)\s*:\s*([\d.,]+)\s*R\$\s*\/\s*hour\s*\/\s*pers/i);
  return m ? `Group kite lesson (${m[1].trim()}): BRL ${parseAmount(m[2])} per hour per person` : null;
}

export function buildVaSlots(rates: VaRate[]): Slot[] {
  return rates.map(r => ({
    key: `bungalow-${r.persons}p`,
    startDate: null,
    endDate: null,
    unit: VA_UNIT,
    price: r.nightly,
    currency: 'BRL',
    priceUnit: 'per_night',
    priceBasis: 'room',
    occupancy: r.persons,
    availability: 'on_request',
    availabilityText: 'reservation by e-mail or WhatsApp',
    spotsLeft: null,
  }));
}

/** Own photos (wp-content/uploads originals; logos, icons, PNG badges and -WxH thumbnails dropped). */
export function vaImages(pages: string[], max = 30): string[] {
  const out: string[] = [];
  for (const html of pages) {
    for (const m of html.replace(/\\\//g, '/').matchAll(/https:\/\/www\.pousadavillaaloha\.com\/wp-content\/uploads\/[^"' )?,]+\.jpe?g/gi)) {
      const u = m[0].replace(/-\d+x\d+(\.[a-z]+)$/i, '$1');
      if (/logo|favicon|icon|loader/i.test(u) || out.includes(u)) continue;
      out.push(u);
    }
  }
  return out.slice(0, max);
}

export interface VaPages { home: string; hotel: string; school: string }

export function parseVillaAlohaContent(p: VaPages): OfferContent {
  const home = pageText(p.home);
  const hotel = pageText(p.hotel);
  const school = pageText(p.school);
  const rates = parseVaRates(p.hotel);
  const lesson = parseVaLesson(p.hotel) ?? parseVaLesson(p.school);
  const size = hotel.match(/bungalows of (\d+) m²/)?.[1] ?? null;
  const distance = home.match(/(\d+) km north-west of Fortaleza/)?.[1] ?? null;
  const wind = home.match(/wind of (\d+ to \d+) knots constant from (\w+) to (\w+)/);
  const iko = /IKO instructor/i.test(school);
  const min = rates.length ? Math.min(...rates.map(r => r.nightly)) : null;
  const max = rates.length ? Math.max(...rates.map(r => r.nightly)) : null;

  const rooms: ContentRoom[] = [{
    name: VA_UNIT,
    description: `Bungalow${size ? ` of ${size} m2` : ''} for 2 or 3 guests facing the sea and the kite spot, with a queen-size bed and a single bed, private bathroom, its own shaded terrace with hammock and deck chair and a private garden.`,
    features: [
      'Sea view', 'Terrace with hammock and deck chair', 'Private garden', 'Private bathroom', 'Queen-size bed + single bed', 'Wi-Fi',
      ...rates.map(r => `${r.persons} guest${r.persons > 1 ? 's' : ''}: BRL ${r.nightly} per night with breakfast`),
    ],
  }];

  const summary = [
    `Villa Aloha is a small beach pousada with its own kite school in the village of Patos (Itarema, Ceará, Brazil)${distance ? `, about ${distance} km north-west of Fortaleza towards Jericoacoara` : ''}, facing a 10 km open bay with flat-water lagoons upwind in the river estuary.`,
    `Guests stay in sea-view bungalows${size ? ` of ${size} m2` : ''} for 2 or 3 people with terrace, hammock and private garden; breakfast is a buffet, and the pousada has a bar, snack bar and restaurant${min !== null ? `; a night with breakfast costs BRL ${min} to ${max} per bungalow for 1 to 3 guests` : ''}.`,
    `The on-site kite school${iko ? ' (IKO instructor)' : ''} teaches beginners to advanced riders, offers supervised sessions, downwinders and rental for advanced riders, and has storage, a rinsing area and a buggy that shuttles riders to the farther spots${wind ? `; the wind blows ${wind[1]} knots from ${wind[2]} to ${wind[3]}` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Villa Aloha',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Praia de Patos, Ceará',
    spot: 'Praia de Patos',
    spotCoords: null, // the contact page's Google map is a name query, no coordinates on the site
    itinerarySpots: [],
    durationDays: null,
    // home: "Whether you are on a beginner lesson, starting to stand up, doing your first jumps, freestylers ..." (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /Lessons are taught|kitesurf school/i.test(school),
    equipmentRental: /rental equipment/i.test(home),
    beginnerFriendly: /learning kitesurfing becomes easy|adapted structure to beginners/i.test(`${home} ${school}`) ? true : null,
    includedServices: ['Breakfast buffet', 'Wi-Fi', 'Kite storage, outdoor shower and rinsing area at the on-site school'],
    optionalServices: [
      lesson ?? 'Kite lessons (IKO instructor)',
      'Supervised riding sessions for advanced kiters',
      'Kite equipment rental for advanced riders',
      'Buggy shuttle to the farther kite spots',
      'Downwinders and kite trips',
      'Horse riding, hiking, lobster fishing trips',
      'Lunch at the snack bar, dinner at the restaurant',
    ],
    accommodation: 'sea-view beach bungalows',
    mealPlan: 'breakfast',
    languages: ['fr', 'en', 'pt'], // site languages (hreflang fr / en / pt)
    rooms,
    imageUrls: vaImages([p.hotel, p.school, p.home]),
    heroVideoUrl: null,
    sourceUrl: VA_HOTEL_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `home: ${home}`,
      `hotel: ${hotel}`,
      `kitesurf school: ${school}`,
      `rates: ${rates.map(r => `${r.persons} guest(s) BRL ${r.nightly}/night with breakfast`).join('; ')}`,
      `lesson: ${lesson ?? '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const villaAlohaPraiaDePatos: OfferAdapter = {
  key: 'villa-aloha-praia-de-patos',
  name: 'Villa Aloha Praia de Patos',
  kind: 'accommodation',
  operator: {
    name: 'Villa Aloha',
    websiteUrl: SITE,
    rootDomain: 'pousadavillaaloha.com',
    contactEmail: 'contact@pousadavillaaloha.com',
    phone: '+5588981126155',
    whatsapp: '+5588981126155',
  },
  url: VA_HOTEL_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'medium', // dateless price list, booking by e-mail / WhatsApp
  async fetchContent() {
    const [home, hotel, school] = [await page(VA_HOME_URL), await page(VA_HOTEL_URL), await page(VA_SCHOOL_URL)];
    return parseVillaAlohaContent({ home, hotel, school });
  },
  async fetchSlots() {
    const rates = parseVaRates(await page(VA_HOTEL_URL));
    if (rates.length === 0) throw new Error('villa-aloha: "Night with breakfast" price list not found on /en/hotel-brazil/ (layout changed?)');
    return buildVaSlots(rates);
  },
};
