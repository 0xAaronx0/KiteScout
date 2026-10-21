// ---------------------------------------------------------------------------
// Ruuk Village, Kalpitiya (Sri Lanka) - "Zero to Hero" kite camp: 8 days / 7 nights full board in a cabana at the
// off-grid eco lodge on the Kalpitiya lagoon, 12 hours of IKO lessons over 4 days (max 2 students per instructor),
// then 3 days with full kite gear; boat to the teaching zone daily; airport pickup and drop-off for two. One place,
// stay + course as a package -> KIND = 'camp'. The lodge itself is listed separately as a stay (adapter
// ruuk-village-kalpitiya); this is the packaged course.
//
// Data path (checked 2026-10-21), Squarespace site ruukvillage.com:
//   https://ruukvillage.com/kalpitiya-zero-to-hero (linked as "See Zero to Hero" from /kitesurfing-packages-sri-lanka)
//   slots    the page's "Build your stay" price builder. Its inline script carries the rate card ("Prices: edit
//            here when your rates change"): BASE per season (summer = June to September, quiet = Oct, Nov, March to
//            May, winter = Dec 1 to 14 + February, busy = Dec 15 to Jan 31), the cabana upgrade for the week (CAB up),
//            the single surcharge per cabana x season (SINGLE, null = on request) and LESSON_SUPPLEMENT (private
//            lessons for singles). The builder computes: two sharing = BASE + up per person; one person = BASE + up
//            + single surcharge + lesson supplement. We read those constants and compute the same numbers.
//            One undated slot per season x cabana x party (the site prints month ranges without years, and the
//            build rules say undated packages get undated slots); EUR per person, package of 7 nights.
//            "Plan Your Trip" = request form, no payment ("We reply within 24 hours", 30% deposit) -> 'on_request'.
//   content  the same page (inclusions, week plan, TouristTrip + LodgingBusiness JSON-LD with geo, photos).
// robots.txt (2026-10-21): Squarespace defaults (/config, /search, /api/, /static/, ?format=json ...); the page is
//   allowed.
// Requests per run: 1 (memoised for content + slots).
// Not modelled: early booking (-EUR 50 pp when booked 90+ days ahead with the deposit, summer and quiet months
//   only) and the single traveller's optional airport transfers (EUR 85 / 79 / 149) -> slot text and optional
//   services. The "+EUR 16 / +EUR 35 per night" upgrade labels are rounded; the script's week totals (109 / 243)
//   are what the builder charges, so those are used.
// Liveness: the builder and the TouristTrip JSON-LD are new (not on the page recorded 2026-10-12 for the stay
//   adapter); page copy names the seasons without a year.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, ldOfType, parse } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://ruukvillage.com';
export const RV_ZTH_PACKAGE_URL = `${SITE}/kalpitiya-zero-to-hero`;
const BOOKING_URL = `${SITE}/kalpitiya-kitesurfing-stay-booking`;

export interface RvRateCard {
  base: Record<string, number>;
  seasons: Record<string, string>;
  cabanas: Array<{ id: string; name: string; up: number }>;
  single: Record<string, Record<string, number | null>>;
  lessonSupplement: number;
  early: number | null;
  transfers: { pickup: number | null; dropoff: number | null; both: number | null };
}

// --- memoised page fetch ---------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

// --- pure parsers -------------------------------------------------------------------------------------
/** `{ summer: 740, quiet: 740 }` / `{ summer: 'June to September' }` -> object (keys unquoted, values number / string / null). */
function jsObject(src: string): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const m of src.matchAll(/(\w+)\s*:\s*('([^']*)'|"([^"]*)"|-?\d+(?:\.\d+)?|null)/g)) {
    out[m[1]] = m[3] ?? m[4] ?? (m[2] === 'null' ? null : Number(m[2]));
  }
  return out;
}

/** The builder's rate card from the inline script (see header). Null when the script is missing or changed. */
export function parseRvRateCard(html: string): RvRateCard | null {
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).find(s => s.includes("'rv-z2h-builder'") && /var BASE\s*=/.test(s));
  if (!script) return null;
  const base = script.match(/var BASE\s*=\s*\{([^}]*)\}/)?.[1];
  const seasons = script.match(/var SEASON\s*=\s*\{([^}]*)\}/)?.[1];
  const cab = script.match(/var CAB\s*=\s*\{([\s\S]*?)\};/)?.[1];
  const single = script.match(/var SINGLE\s*=\s*\{[^\n]*\n([\s\S]*?)\};/)?.[1];
  const lesson = script.match(/LESSON_SUPPLEMENT\s*=\s*(\d+)/)?.[1];
  if (!base || !seasons || !cab || !single || !lesson) return null;
  const num = (re: RegExp): number | null => { const m = script.match(re); return m ? Number(m[1]) : null; };
  const rc: RvRateCard = {
    base: Object.fromEntries(Object.entries(jsObject(base)).filter(([, v]) => typeof v === 'number')) as Record<string, number>,
    seasons: Object.fromEntries(Object.entries(jsObject(seasons)).map(([k, v]) => [k, String(v)])),
    cabanas: [...cab.matchAll(/(\w+)\s*:\s*\{([^}]*)\}/g)].map(m => {
      const o = jsObject(m[2]);
      return { id: m[1], name: String(o.name ?? m[1]), up: Number(o.up ?? 0) };
    }),
    single: Object.fromEntries([...single.matchAll(/(\w+)\s*:\s*\{([^}]*)\}/g)].map(m => [m[1], jsObject(m[2]) as Record<string, number | null>])),
    lessonSupplement: Number(lesson),
    early: num(/var EARLY\s*=\s*(\d+)/),
    transfers: { pickup: num(/PICKUP\s*=\s*(\d+)/), dropoff: num(/DROPOFF\s*=\s*(\d+)/), both: num(/BOTH\s*=\s*(\d+)/) },
  };
  if (!Object.keys(rc.base).length || !rc.cabanas.length) return null;
  return rc;
}

export function buildRvZthSlots(rc: RvRateCard): Slot[] {
  const out: Slot[] = [];
  for (const [season, base] of Object.entries(rc.base)) {
    const period = rc.seasons[season] ?? season;
    const earlyOk = season === 'summer' || season === 'quiet';
    const earlyNote = earlyOk && rc.early ? `; book 90+ days ahead with the deposit and save EUR ${rc.early} per person` : '';
    for (const c of rc.cabanas) {
      out.push({
        key: `${season}|${c.id}|2p`,
        startDate: null,
        endDate: null,
        unit: `${c.name}, two sharing (${period})`,
        room: c.name,
        price: base + c.up,
        currency: 'EUR',
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: 2,
        availability: 'on_request',
        availabilityText: `Request via Plan Your Trip, reply within 24 h, 30% deposit confirms; airport pickup and drop-off included for two${earlyNote}`,
        spotsLeft: null,
        packageNights: 7,
      });
      const single = rc.single[c.id]?.[season];
      out.push({
        key: `${season}|${c.id}|1p`,
        startDate: null,
        endDate: null,
        unit: `${c.name}, one person (${period})`,
        room: c.name,
        price: single === null || single === undefined ? null : base + c.up + single + rc.lessonSupplement,
        currency: single === null || single === undefined ? null : 'EUR',
        priceUnit: single === null || single === undefined ? null : 'package',
        priceBasis: 'person',
        occupancy: 1,
        availability: 'on_request',
        availabilityText: single === null || single === undefined
          ? 'On request ("Write to us and we will find a fair price together")'
          : `Own cabana and 10 hours of private lessons (single surcharge EUR ${single} + EUR ${rc.lessonSupplement}); airport transfers extra${earlyNote}`,
        spotsLeft: null,
        packageNights: 7,
      });
    }
  }
  return out;
}

function pageLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script,style,noscript,svg,header,footer')) el.remove();
  return (root.querySelector('main') ?? root.querySelector('body') ?? root).structuredText
    .split('\n').map(s => collapse(s)).filter(Boolean);
}

export function parseRvZthContent(html: string): OfferContent {
  const rc = parseRvRateCard(html);
  if (!rc) throw new Error('ruuk-village-zero-to-hero: price builder script not found (layout changed?)');
  const lines = pageLines(html);
  const text = lines.join('\n');
  const trip = ldOfType(html, 'TouristTrip')[0] as Record<string, unknown> | undefined;
  const lodging = (ldOfType(html, 'LodgingBusiness')[0] ?? ldOfType(html, 'LocalBusiness')[0]) as Record<string, unknown> | undefined;
  const geo = (lodging?.geo ?? null) as { latitude?: number; longitude?: number } | null;
  const days = Number(String(trip?.name ?? '').match(/(\d+)\s*days/i)?.[1] ?? NaN) || 8;
  const nights = days - 1;
  const cheapest = Math.min(...Object.values(rc.base));
  const winterBase = rc.base.winter ?? rc.base.busy ?? null;

  const iFrom = lines.findIndex(l => /^Included for everyone$/i.test(l));
  const iTo = lines.findIndex((l, i) => i > iFrom && /^Not included:/i.test(l));
  const included = iFrom >= 0 && iTo > iFrom
    ? lines.slice(iFrom + 1, iTo).filter(l => !/^Travelling as two\?/i.test(l)).map(l => (/^Airport pickup/i.test(l) ? `${l} (when travelling as two)` : l))
    : [];
  const notIncluded = lines.find(l => /^Not included:/i.test(l))?.replace(/^Not included:\s*/i, '') ?? null;

  const imgs: string[] = [];
  const seen = new Set<string>();
  for (const u of imageCandidates(html, RV_ZTH_PACKAGE_URL, null, 60)) {
    if (!/squarespace-cdn\.com\/content/.test(u) || /logo|icon|favicon|\.svg|\.png|VW-bully/i.test(u)) continue;
    const k = u.replace(/\?.*$/, '');
    if (seen.has(k)) continue;
    seen.add(k); imgs.push(k);
  }
  // kite photos first, then the cabanas and the lodge
  const kitePhoto = (u: string): number => Number(!/kite|on-power|jump|hangman|launch|board|coaching/i.test(u));
  imgs.sort((a, b) => kitePhoto(a) - kitePhoto(b));

  const up = rc.cabanas.filter(c => c.up > 0).map(c => `${c.name} +EUR ${c.up}`).join(', ');
  const summary = [
    `Ruuk Village's "Zero to Hero" is ${/^8|^11|^18/.test(String(days)) ? 'an' : 'a'} ${days}-day, ${nights}-night beginner kite camp at its small off-grid eco lodge on the flat, waist-deep Kalpitiya lagoon in north-western Sri Lanka.`,
    `It includes 12 hours of IKO lessons over four days with at most two students per instructor, then three days with full kite gear, full board, the daily boat to the teaching zone and, for two guests, airport pickup and drop-off.`,
    `Prices start at EUR ${cheapest} per person for two sharing the Wadiya fisherman's cabana from March to November${winterBase && winterBase !== cheapest ? ` (EUR ${winterBase} from December to February)` : ''}${up ? `, with cabana upgrades for the week (${up})` : ''}; singles get their own cabana and private lessons at a surcharge.`,
    'Booking is by request with a 30% deposit.',
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Ruuk Village Zero to Hero Kite Camp',
    summary,
    continent: 'Asia',
    country: 'Sri Lanka',
    region: 'North Western Province',
    spot: 'Kalpitiya',
    spotCoords: geo && typeof geo.latitude === 'number' && typeof geo.longitude === 'number' ? { lat: geo.latitude, lng: geo.longitude } : null, // site JSON-LD geo
    itinerarySpots: [],
    durationDays: days,
    skillLevels: ['beginner'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: included.length ? included : [
      `${nights} nights in the Wadiya Cabana`, 'Full board', '12 hours of IKO lessons, max 2 students per instructor', '3 days of full kite gear after the course', 'Daily boat to the teaching zone',
    ],
    optionalServices: [
      ...rc.cabanas.filter(c => c.up > 0).map(c => `${c.name} upgrade: +EUR ${c.up} per person for the week`),
      `Single traveller: own cabana and 10 hours of private lessons (surcharge by season)`,
      ...(rc.transfers.pickup && rc.transfers.dropoff ? [`Airport transfers for singles: pickup EUR ${rc.transfers.pickup}, drop-off EUR ${rc.transfers.dropoff}${rc.transfers.both ? `, both EUR ${rc.transfers.both}` : ''}`] : []),
      ...(rc.early ? [`Early booking (90+ days ahead, June to November and March to May): -EUR ${rc.early} per person`] : []),
      ...(notIncluded ? [`Not included: ${notIncluded}`] : []),
      'Non-kiting partner (companion price on request)',
    ],
    accommodation: 'eco cabanas at an off-grid lodge: Wadiya fisherman\'s cabana (included), Garden Cabana or Wooden Chalet as upgrades',
    mealPlan: 'full_board',
    languages: ['en', 'de'],
    rooms: rc.cabanas.map(c => ({ name: c.name, description: null, features: [c.up ? `+EUR ${c.up} per person for the week` : 'included in the package price'] })),
    imageUrls: imgs.slice(0, 12),
    heroVideoUrl: null,
    sourceUrl: RV_ZTH_PACKAGE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      text,
      `json-ld trip: ${JSON.stringify(trip ?? null)}`,
      `rate card: ${JSON.stringify(rc)}`,
    ].join('\n'),
  };
}

export const ruukVillageZeroToHeroKalpitiya: OfferAdapter = {
  key: 'ruuk-village-zero-to-hero-kalpitiya',
  name: 'Ruuk Village Zero to Hero Kite Camp (Kalpitiya)',
  kind: 'camp',
  operator: {
    name: 'Ruuk Village',
    websiteUrl: SITE,
    rootDomain: 'ruukvillage.com',
    contactEmail: 'contact@kalpitiya.info',
    whatsapp: '+94710425874',
    phone: '+94710425874',
  },
  url: RV_ZTH_PACKAGE_URL,
  slotMethod: 'price_table',
  instantBooking: false, // request form, "No payment now", 30% deposit after the reply
  fetchBudget: 2,
  async fetchContent() {
    return parseRvZthContent(await page(RV_ZTH_PACKAGE_URL));
  },
  async fetchSlots() {
    const rc = parseRvRateCard(await page(RV_ZTH_PACKAGE_URL));
    if (!rc) throw new Error('ruuk-village-zero-to-hero: price builder script not found (layout changed?)');
    return buildRvZthSlots(rc);
  },
};
