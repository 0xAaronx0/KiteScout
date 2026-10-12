// ---------------------------------------------------------------------------
// Mazava Loha Resort, Babaomby / Emerald Sea (Mer d'Emeraude) near Diego Suarez (Antsiranana, Madagascar) - small
// resort facing the Emerald Sea's "la piscine" (the pool) kite spot, 4-5 minutes by boat, with its own IKO kite school
// and windsurf center (Naish / Fanatic / Duotone rental, free boat shuttle to the spots, jet-ski safety, free gear
// storage); sea-view suites on the dunes and six wooden bungalows in the forest, restaurant-bar, full board.
// A different property from Babaomby Island Lodge (adapter babaomby-island-lodge-diego-suarez). Found via a former
// bstoked listing - bstoked is a hint only, nothing is read from it. The domain mazavaloha.com answered 403 to the
// researcher and is not used.
//
// Data path (checked 2026-10-12): WordPress (Divi, WPML, Yoast), English pages under /en/.
//   content  /en/ (resort, contact form, phone), /en/bungalow-hotel-emerald-sea-madagascar/ (suites, bungalows,
//            restaurant), /en/kite-windsurf-emerald-sea-madagascar/ (IKO school, lesson prices, center services,
//            gear), /en/emerald-sea-madagascar/ (location, season "early April to late November").
//   slots    the room rates are NOT in the HTML: under "Rates 2025/2026." the bungalows page shows a screenshot
//            /wp-content/uploads/Capture-decran-2026-01-08-151642.png ("RATES 2026", 783x1112 px). fetchText cannot
//            read an image, so the prices below are constants read by hand on 2026-10-12 (same pattern as
//            kenyaways-diani). They are released only while the bungalows page still shows that same file; another
//            file name -> ctx.note + no slots ("price on request") until someone re-reads the sheet. The kite rate
//            sheet (Capture-decran-2026-01-08-152004.png) is not read; lesson prices come from the page text.
//            Booking: contact form / phone ("Contact us now to check availability") -> 'on_request'.
// Sheet "RATES 2026" (header: "ACCOMMODATION, FULL BOARD, MINERAL WATER WITH MEALS, BOAT TRIP"):
//   high season "May 1 - June 15, July 1 - September 15, October 1 - November 15, December 21 to January 5",
//   low season  "April 1 - April 30, June 16 - June 30, September 16 - September 30, November 16 to December 20";
//   price per number of people (suites 1-3, bungalows 1-5), children 6-14 extra, 0-6 free. January 6 to March 31
//   is not on the sheet (no slot). "December 21 to January 5" is read as 2026-12-21 .. 2027-01-05.
// ASSUMPTION per_night: the sheet prints no unit; stored as EUR per room (for n people, full board) per night,
//   which is the only reading that fits a price per number of people. Hence confidence 'medium'.
// Liveness (rule 5b, Aaron 2026-10-12): Yoast sitemap lastmod 2026-02-28 (FR kite page and FR home), 2026-02-26
//   (FR bungalows), 2026-01-08 (EN kite and bungalow pages; JSON-LD dateModified 2026-01-08T14:41:34); rate sheet
//   screenshots dated 2026-01-08, served with Last-Modified 2026-08-22; footer "(c) Mazava Loha Resort, 2026".
// robots.txt (2026-10-12): disallows only /wp-content/uploads/wpo/wpo-plugins-tables-list.json; Yoast block allows all.
// Requests per run: content 4, slots 1 (bungalows page, memoised).
// Parsed: slot = unit x people x season band with the sheet's real date limits ("sea-view-suite|2p|2026-12-21"),
//   EUR per room per night, occupancy = people; bands that ended before today are dropped.
// Known limits: spotCoords omitted (no map embed, JSON-LD geo or map link on the site); no e-mail published (form);
//   a silent re-upload under the same file name would not be noticed.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://mazavaloha-resort.com';
export const MZ_HOME_URL = `${SITE}/en/`;
export const MZ_ROOMS_URL = `${SITE}/en/bungalow-hotel-emerald-sea-madagascar/`;
export const MZ_KITE_URL = `${SITE}/en/kite-windsurf-emerald-sea-madagascar/`;
export const MZ_SPOT_URL = `${SITE}/en/emerald-sea-madagascar/`;
const CONTACT_URL = `${SITE}/en/#contact`;

// --- rate sheet (constants, read by hand 2026-10-12) ---------------------------------------------------
export const MZ_RATE_SHEET = 'Capture-decran-2026-01-08-151642.png';
export type MzUnit = 'sea-view-suite' | 'forest-bungalow';
export const MZ_UNITS: Array<{ id: MzUnit; name: string }> = [
  { id: 'sea-view-suite', name: 'Sea-view Suite' },
  { id: 'forest-bungalow', name: 'Wooden Bungalow in the forest' },
];
/** EUR for 1..n people (index 0 = 1 person), full board. */
export const MZ_RATES: Record<'high' | 'low', Record<MzUnit, number[]>> = {
  high: { 'sea-view-suite': [210, 280, 420], 'forest-bungalow': [130, 190, 285, 380, 425] },
  low: { 'sea-view-suite': [190, 250, 375], 'forest-bungalow': [110, 170, 255, 340, 375] },
};
export const MZ_CHILD: Record<'high' | 'low', Record<MzUnit, number>> = {
  high: { 'sea-view-suite': 70, 'forest-bungalow': 50 },
  low: { 'sea-view-suite': 60, 'forest-bungalow': 40 },
};
export const MZ_BANDS: Array<{ start: string; end: string; season: 'high' | 'low' }> = [
  { start: '2026-04-01', end: '2026-04-30', season: 'low' },
  { start: '2026-05-01', end: '2026-06-15', season: 'high' },
  { start: '2026-06-16', end: '2026-06-30', season: 'low' },
  { start: '2026-07-01', end: '2026-09-15', season: 'high' },
  { start: '2026-09-16', end: '2026-09-30', season: 'low' },
  { start: '2026-10-01', end: '2026-11-15', season: 'high' },
  { start: '2026-11-16', end: '2026-12-20', season: 'low' },
  { start: '2026-12-21', end: '2027-01-05', season: 'high' },
];
export const MZ_EXTRAS = [
  'Breakfast EUR 5, lunch or dinner EUR 15 (rate sheet 2026)',
  'Round-trip transfer from Diego Suarez centre or airport: EUR 50 per person (children 0-14: EUR 25)',
  'Round-trip boat transfer from Ramena: EUR 25 per person',
  'Transfer from Nosy Be: EUR 350 for 1 to 4 people',
  'Massages: EUR 14 per hour',
];

// --- memoised page fetch (content and slots share the bungalows page) ----------------------------------
const pageCache = new Map<string, Promise<string>>();
function page(url: string): Promise<string> {
  if (!pageCache.has(url)) {
    const p = fetchText(url, { accept: 'text/html' });
    p.catch(() => pageCache.delete(url));
    pageCache.set(url, p);
  }
  return pageCache.get(url)!;
}

/** Visible text split at block tags (one entry per heading / paragraph / list item). */
export function mzLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|select|svg|header|footer|nav)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|button)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}
const mzText = (html: string): string => mzLines(html).join(' ');

// --- pure parsers -------------------------------------------------------------------------------------
/** The rate image shown under the "Rates ..." heading of the bungalows page (file name), or null. */
export function mzRateImage(html: string): { file: string; heading: string | null } | null {
  const at = html.search(/<h2>\s*Rates[^<]*<\/h2>/i);
  if (at < 0) return null;
  const heading = clean(html.slice(at).match(/<h2>([^<]*)<\/h2>/i)?.[1] ?? '') || null;
  const img = html.slice(at).match(/<img[^>]+src="[^"]*\/wp-content\/uploads\/([^"/]+\.(?:png|jpe?g|webp))"/i);
  return img ? { file: img[1], heading } : null;
}

export function buildMzSlots(today: string): Slot[] {
  const out: Slot[] = [];
  for (const b of MZ_BANDS) {
    if (b.end < today) continue;
    for (const u of MZ_UNITS) {
      MZ_RATES[b.season][u.id].forEach((price, i) => {
        const people = i + 1;
        out.push({
          key: `${u.id}|${people}p|${b.start}`,
          startDate: b.start,
          endDate: b.end,
          unit: `${u.name}, ${people} ${people === 1 ? 'person' : 'people'}, full board (${b.season} season)`,
          price,
          currency: 'EUR',
          priceUnit: 'per_night', // assumption, see header: the sheet prints no unit
          priceBasis: 'room',
          occupancy: people,
          availability: 'on_request',
          availabilityText: 'Contact us now to check availability',
          spotsLeft: null,
        });
      });
    }
  }
  return out;
}

export interface MzPages { home: string; rooms: string; kite: string; spot: string }

export function parseMazavaContent(p: MzPages): OfferContent {
  const home = mzText(p.home);
  const rooms = mzText(p.rooms);
  const kite = mzText(p.kite);
  const spot = mzText(p.spot);
  const discovery = kite.match(/Discovery Course 2 hours private lesson:\s*€(\d+)/i)?.[1] ?? null;
  const tenHours = kite.match(/10-hour Course private lessons:\s*€(\d+)/i)?.[1] ?? null;
  const group = kite.match(/group lessons \(max 3 pers\):\s*1 hour \/ €(\d+)/i)?.[1] ?? null;
  const season = spot.match(/optimal from (early [A-Z][a-z]+ to late [A-Z][a-z]+)/)?.[1] ?? null;
  const nBungalows = rooms.match(/Our (\w+) wooden bungalows/i)?.[1] ?? null;
  const suiteDesc = rooms.match(/Description : (60 m² suite[^.]*\.[^.]*\.)/)?.[1] ?? null;
  const bungDesc = rooms.match(/(Double bungalows of 24 m²[^.]*\. Family bungalows of 40 m²[^.]*\.)/)?.[1] ?? null;

  const contentRooms: ContentRoom[] = [
    {
      name: 'Sea-view Suite',
      description: suiteDesc ? `Small independent villa on the dunes. ${suiteDesc}` : 'Small independent villa on the dunes with a view of the Emerald Sea.',
      features: [
        'Terrace of 100 m² with sea view', 'Queen size bed (210/200)', 'Indoor lounge, desk', 'Private bathroom and toilet',
        'Hot water, fan, refrigerator with cold drinks', 'Up to 3 people (rate sheet)',
        `Children 6-14: EUR ${MZ_CHILD.high['sea-view-suite']} high / EUR ${MZ_CHILD.low['sea-view-suite']} low season; under 6 free`,
      ],
    },
    {
      name: 'Wooden Bungalow in the forest',
      description: bungDesc ? `Wooden bungalow in a forest clearing. ${bungDesc}` : 'Wooden bungalow in a forest clearing.',
      features: [
        'Terrace', 'Private bathroom and toilet', 'Hot water', 'Cold drinks in the bungalow', 'Up to 5 people (rate sheet)',
        `Children 6-14: EUR ${MZ_CHILD.high['forest-bungalow']} high / EUR ${MZ_CHILD.low['forest-bungalow']} low season; under 6 free`,
      ],
    },
  ];

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of [
    ...imageCandidates(p.home, MZ_HOME_URL, null, 40),
    ...imageCandidates(p.rooms, MZ_ROOMS_URL, null, 60),
    ...imageCandidates(p.kite, MZ_KITE_URL, null, 40),
  ]) {
    if (/logo|Capture-d|-[bv]60(?:-\d+)?\.png$|-h\d+\.png$|Kitesurfeur\.png|\.svg/i.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u); imageUrls.push(u);
  }

  const summary = [
    `Mazava Loha Resort sits in Babaomby on the Emerald Sea (Mer d'Emeraude) near Diego Suarez in northern Madagascar, facing the flat, clear lagoon spot "la piscine", 4-5 minutes away by boat; wave spots are at Nosy Toreky and the Suarez islet.`,
    `Its own kite school (an IKO instructor and two assistants) gives private lessons with jet-ski safety${discovery ? ` (2-hour discovery course EUR ${discovery})` : ''}, and the windsurf center rents Naish kites and Fanatic / Duotone windsurf gear, runs a free boat shuttle to the spots and stores gear for free.`,
    `Guests stay in sea-view suites on the dunes or ${nBungalows ?? 'six'} wooden bungalows in the forest; the 2026 rates include full board, mineral water with meals and a boat trip.`,
    season ? `The kite season is ${season}.` : '',
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Mazava Loha Resort',
    summary,
    continent: 'Africa',
    country: 'Madagascar',
    region: 'Diana (Diego Suarez)',
    spot: "Emerald Sea (Mer d'Emeraude), Babaomby",
    spotCoords: null,
    itinerarySpots: [],
    durationDays: null,
    // "suitable for practitioners of all levels"; initiation / progression lessons; free-ride, freestyle, big air, waves
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /IKO instructor/i.test(kite),
    equipmentRental: /Rental of windsurfing and kitesurfing equipment/i.test(kite),
    beginnerFriendly: /suitable for practitioners of all levels/i.test(kite),
    includedServices: [
      'Full board, mineral water with meals and a boat trip (2026 rate sheet)',
      'Free boat shuttle to the Emerald Sea spots',
      'Free gear storage',
      'Free launch / landing assistance',
      'Jet-ski safety (first intervention free)',
      'Shower and gear rinsing',
    ],
    optionalServices: [
      ...(discovery ? [`Kite discovery course: 2 hours private lesson EUR ${discovery}`] : []),
      ...(tenHours ? [`Kite course: 10 hours private lessons EUR ${tenHours}`] : []),
      ...(group ? [`"Progression" group lessons (max 3 people): EUR ${group} per person per hour with own equipment`] : []),
      'Kite and windsurf rental (Naish kites, Fanatic boards, Naish / Duotone sails)',
      ...MZ_EXTRAS,
      'Sea excursions, hikes and land excursions around Diego Suarez',
    ],
    accommodation: 'sea-view suites on the dunes and wooden bungalows in the forest',
    mealPlan: 'full_board',
    languages: [],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 40),
    heroVideoUrl: null,
    sourceUrl: MZ_ROOMS_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `home: ${home}`,
      `rooms: ${rooms}`,
      `rate sheet (hand-read 2026-10-12 from ${MZ_RATE_SHEET}): ${MZ_BANDS.map(b => `${b.start}..${b.end} ${b.season}`).join(', ')}; `
        + MZ_UNITS.map(u => `${u.name}: high ${MZ_RATES.high[u.id].join('/')} low ${MZ_RATES.low[u.id].join('/')} EUR for 1..n people`).join('; '),
      `kite: ${kite}`,
      `spot: ${spot}`,
    ].join('\n'),
  };
}

export const mazavaLohaResortDiegoSuarez: OfferAdapter = {
  key: 'mazava-loha-resort-diego-suarez',
  name: 'Mazava Loha Resort (Emerald Sea, Diego Suarez)',
  kind: 'accommodation',
  operator: {
    name: 'Mazava Loha Resort',
    websiteUrl: SITE,
    rootDomain: 'mazavaloha-resort.com',
    phone: '+261347690009', // home page contact block "00261 34 76 900 09", 2026-10-12
  },
  url: MZ_ROOMS_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'medium', // hand-read rate sheet image + assumed per-night unit
  async fetchContent() {
    const home = await page(MZ_HOME_URL);
    const rooms = await page(MZ_ROOMS_URL);
    const kite = await page(MZ_KITE_URL);
    const spot = await page(MZ_SPOT_URL);
    return parseMazavaContent({ home, rooms, kite, spot });
  },
  async fetchSlots(ctx) {
    const sheet = mzRateImage(await page(MZ_ROOMS_URL));
    if (!sheet) {
      ctx.note('mazava: no "Rates" heading with a rate image on the bungalows page - layout changed, no slots');
      return [];
    }
    if (sheet.file !== MZ_RATE_SHEET) {
      ctx.note(`mazava: rate sheet changed (${sheet.file}, heading "${sheet.heading ?? ''}") - re-read it by hand; no slots until then`);
      return [];
    }
    ctx.note(`prices are constants read by hand from ${MZ_RATE_SHEET} on 2026-10-12`);
    return buildMzSlots(todayIso());
  },
};
