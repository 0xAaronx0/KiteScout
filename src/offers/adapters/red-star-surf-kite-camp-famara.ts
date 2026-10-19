// ---------------------------------------------------------------------------
// Red Star Surf Kite Camp, Caleta de Famara (Lanzarote, Canary Islands, Spain) - the school's kite camp packages:
// a private room in its surf & kite houses in the village + a group kite course (3 hours a day, IKO instructors,
// all gear, helmet and lesson insurance, transfer shop -> kite zone). Three packages: Try-Out Week (7 nights + 3 kite
// days, beginners), Level-Up Week (7 nights + 5 kite days), Short Trip (from 3 nights, lessons every day except
// arrival and departure). Kind 'camp'.
//
// Data path (checked 2026-10-19): WordPress, server-rendered.
//   slots    /kite-camp/ "Kite Camp Packages": per package a name line ("Try-Out Week"), inclusion lines and
//            "from €665 / 7 nights" + "Price depends on dates and room". One undated slot per package, EUR from-price
//            (priceUnit 'package', packageNights as printed), availability 'unknown'.
//   content  /kite-camp/ (packages, inclusions, FAQ, no-wind rule) + /accommodation/ (house photos).
// Booking engine: bookings.redstarsurf.com = Bookinglayer (its product pages are a JS shell); the data API
//   api.bookinglayer.io answers robots.txt "Disallow: /" -> not called: no dates, no live availability, printed
//   from-prices only (the same situation as Drivethru / Panama Kite House / Algarve).
// robots.txt www.redstarsurf.com (2026-10-19): Yoast default (search and /wp-json/ disallowed); pages allowed.
// Requests per run: content 2, slots 1 (camp page memoised).
// Price basis: 'person' is inferred - the search box defaults to "1 person" and every guest gets a private room; the
//   page does not print "per person".
// Flags: instantBooking left unset (Bookinglayer may take paid bookings, but the checkout path is robots-disallowed
//   and we could not confirm immediate confirmation); liveAvailability false (engine not read).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { imageCandidates, parseAmount } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';
import { blockLines } from './jaguaribe-lodge-fortim.js';

const SITE = 'https://www.redstarsurf.com';
export const RSS_CAMP_URL = `${SITE}/kite-camp/`;
export const RSS_ACCOMMODATION_URL = `${SITE}/accommodation/`;
const BOOKING_URL = 'https://bookings.redstarsurf.com/en/category/kite-camp-packages';

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export interface RssPackage { name: string; details: string[]; price: number; nights: number }

/** "Kite Camp Packages": name line, detail lines, "from €665 / 7 nights". */
export function parseRssPackages(html: string): RssPackage[] {
  const lines = blockLines(html);
  const start = lines.findIndex(l => /^Kite Camp Packages$/i.test(l));
  const end = lines.findIndex((l, i) => i > start && /^What is included$/i.test(l));
  if (start < 0) return [];
  const out: RssPackage[] = [];
  let cur: { name: string; details: string[] } | null = null;
  for (const l of lines.slice(start + 1, end > start ? end : undefined)) {
    const m = l.match(/^from\s*€\s*([\d.,]+)\s*\/\s*(\d+)\s*nights?/i);
    if (m && cur) {
      const price = parseAmount(m[1]);
      if (price) out.push({ name: cur.name, details: cur.details, price, nights: Number(m[2]) });
      cur = null;
      continue;
    }
    if (/^(Book |Price depends)/i.test(l)) continue;
    if (!cur) cur = { name: l, details: [] };
    else cur.details.push(l);
  }
  return out;
}

export function buildRssSlots(pkgs: RssPackage[]): Slot[] {
  return pkgs.map(p => ({
    key: slug(p.name),
    startDate: null,
    endDate: null,
    unit: `${p.name}: ${p.details.slice(0, 2).join(', ')}`,
    price: p.price,
    currency: 'EUR',
    priceUnit: 'package',
    priceBasis: 'person', // inferred (see header)
    occupancy: 1,
    availability: 'unknown',
    availabilityText: `from EUR ${p.price} / ${p.nights} nights; price depends on dates and room (online booking engine, not read)`,
    spotsLeft: null,
    packageNights: p.nights,
  }));
}

export interface RssPages { camp: string; accommodation: string }

export function parseRssContent(p: RssPages): OfferContent {
  const lines = blockLines(p.camp);
  const pkgs = parseRssPackages(p.camp);
  const week = pkgs.filter(x => x.nights === 7);
  const short = pkgs.find(x => x.nights < 7);
  const imageUrls: string[] = [];
  for (const u of [...imageCandidates(p.camp, RSS_CAMP_URL), ...imageCandidates(p.accommodation, RSS_ACCOMMODATION_URL)]) {
    if (/logo|bungalow/i.test(u) || imageUrls.includes(u)) continue; // bungalows = separate rentals, not the camp houses
    imageUrls.push(u);
  }
  const noWind = lines.some(l => /missed kite days are replaced by the same number of surf lessons/i.test(l));
  const summary = [
    'Red Star Surf, a surf and kite school in Caleta de Famara on Lanzarote since 2010, sells kite camps that combine a private room in its surf & kite houses in the village with a group kite course: 3 hours a day with IKO-certified instructors, all gear, helmet, lesson insurance and the drive from the shop to the kite zone at the far end of Famara beach.',
    week.length ? `The ${week.map(w => `${w.name} (7 nights, from EUR ${w.price})`).join(' and ')} suit complete beginners and riders who want to progress${short ? `; a ${short.name} starts at ${short.nights} nights (from EUR ${short.price})` : ''}.` : '',
    noWind ? 'Kite days lost to no wind are replaced by surf lessons and the price difference is refunded.' : '',
    'Prices depend on dates and room; there is no airport transfer.',
  ].filter(Boolean).join(' ');

  return {
    kind: 'camp',
    title: 'Red Star Surf Kite Camp Famara',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Canary Islands',
    spot: 'Famara, Lanzarote',
    itinerarySpots: [],
    durationDays: 8,
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      'Private room in the school\'s surf & kite house in Caleta de Famara (shared kitchen, Wi-Fi, linen and towels, daily cleaning)',
      'Group kite course, 3 hours on the water a day (3 days Try-Out Week, 5 days Level-Up Week)',
      'Kite, board, harness, wetsuit and helmet',
      'IKO-certified instructors (qualified lifeguards)',
      'Transfer from the shop to the kite zone and back',
      'Medical insurance during the lessons',
      'Kite certificate (weeks)',
    ],
    optionalServices: pkgs.filter(x => x.nights < 7).map(x => `${x.name}: from EUR ${x.price} for ${x.nights} nights with daily lessons`),
    accommodation: 'private room in the school\'s surf & kite houses',
    mealPlan: 'self_catering',
    languages: ['en', 'es', 'fr', 'de', 'it'],
    rooms: [],
    imageUrls: imageUrls.slice(0, 20),
    heroVideoUrl: null,
    sourceUrl: RSS_CAMP_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      lines.join('\n'),
      `parsed: ${pkgs.map(x => `${x.name} EUR ${x.price}/${x.nights}n`).join('; ')}`,
    ].join('\n'),
  };
}

export async function fetchRssSlots(): Promise<Slot[]> {
  const pkgs = parseRssPackages(await page(RSS_CAMP_URL));
  if (pkgs.length === 0) throw new Error('red-star-surf: "Kite Camp Packages" block not found (layout changed?)');
  return buildRssSlots(pkgs);
}

export const redStarSurfKiteCampFamara: OfferAdapter = {
  key: 'red-star-surf-kite-camp-famara',
  name: 'Red Star Surf Kite Camp, Famara',
  kind: 'camp',
  operator: {
    name: 'Red Star Surf',
    websiteUrl: SITE,
    rootDomain: 'redstarsurf.com',
    contactEmail: 'info@redstarsurf.com',
    phone: '+34 928 528 808',
    whatsapp: '+34 648 745 447',
  },
  url: RSS_CAMP_URL,
  slotMethod: 'price_table',
  liveAvailability: false,
  fetchBudget: 3,
  confidence: 'medium', // from-prices only, per-person basis inferred
  async fetchContent() {
    const camp = await page(RSS_CAMP_URL);
    const accommodation = await page(RSS_ACCOMMODATION_URL);
    return parseRssContent({ camp, accommodation });
  },
  fetchSlots: () => fetchRssSlots(),
};
