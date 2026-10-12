// ---------------------------------------------------------------------------
// Sakalava Lodge, Sakalava Bay near Diego Suarez (Antsiranana, Madagascar) - all-inclusive kite & wingfoil
// lodge with 10 bungalows (max 15 guests) on the lagoon and its own IKO school (since 2005). Wind season
// April to November.
//
// Data path (checked 2026-10-12), English pages of sakalava.com (WordPress/Elementor; the French pages
// at / carry the same content):
//   content  /en/ (spot, wind season, map link with the lodge's coordinates), /en/le-lodge/ (lodge facts),
//            /en/tarifs-sakalava/ (rates for the summary and the add-ons),
//            /en/culture-sakalava/bungalows/ (bungalow types), /en/kitesurf/ (IKO school),
//            /en/nos-offres-all-included/ (what the all-inclusive formula covers).
//   slots    /en/tarifs-sakalava/ ("2027 all-inclusive rates"): two price lists, "All-inclusive stays:
//            3 days/3 nights" and "All-inclusive 1-week stays", each with "1 PERSON KITESURFING" /
//            "2 PEOPLE KITESURFING" / "2 PEOPLE, 1 KITESURFING AND 1 WITHOUT KITESURFING" (price for the
//            bungalow) plus add-ons (additional adult with / without kite, child under 12). The season
//            limits come from the page's own budget simulator script (seasonMin / seasonMax =
//            2027-04-01 / 2027-11-30; it also enforces a minimum stay of 3 nights).
// No booking engine: "Book" opens WhatsApp / e-mail / a contact form -> availability 'on_request'.
// robots.txt (2026-10-12): "User-agent: * / Crawl-delay: 10", nothing disallowed. http.ts does not read
//   Crawl-delay, so this adapter waits 10 s between its own live requests (local helper `sakalavaGet`).
// Requests per run: content 6 (incl. the rates page), slots 1.
// Parsed: slot = composition x package length for the 2027 season ("bungalow-2p-kite|7n|2027"), EUR per
//   bungalow (priceBasis room) for the whole 3- or 7-night package (priceUnit 'package', packageNights).
//   The add-ons (extra adult, child) go into the room features, not into slots.
// Known limits: no 2026 rate table on the site any more (only the "+1 free day in November 2026" offer),
//   so the rest of the 2026 season has no slot; the simulator's per-night formula is not stored.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, meta, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://sakalava.com';
export const SK_HOME_URL = `${SITE}/en/`;
export const SK_LODGE_URL = `${SITE}/en/le-lodge/`;
export const SK_BUNGALOWS_URL = `${SITE}/en/culture-sakalava/bungalows/`;
export const SK_KITE_URL = `${SITE}/en/kitesurf/`;
export const SK_OFFERS_URL = `${SITE}/en/nos-offres-all-included/`;
export const SK_RATES_URL = `${SITE}/en/tarifs-sakalava/`;
const BOOKING_URL = `${SITE}/en/contact-booking/`;
const CRAWL_DELAY_MS = 10_000;

/** robots.txt asks for Crawl-delay: 10 - waits between live requests (no wait when replaying fixtures). */
let lastLive = 0;
async function sakalavaGet(url: string): Promise<string> {
  if (!process.env.OFFERS_FIXTURE_DIR) {
    const wait = lastLive + CRAWL_DELAY_MS - Date.now();
    if (lastLive > 0 && wait > 0) await new Promise(r => setTimeout(r, wait));
    lastLive = Date.now();
  }
  return fetchText(url, { accept: 'text/html' });
}

export interface SkRate { nights: number; label: string; amount: number; currency: string }
export interface SkSeason { start: string; end: string; minNights: number | null }

/** Visible text split at block tags (one entry per heading / paragraph / price). */
export function skLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|select|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|span|a|button)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
/** Rate lists on /en/tarifs-sakalava/: section heading -> nights, then "LABEL" / "680 €" pairs. */
export function parseSkRates(html: string): SkRate[] {
  const out: SkRate[] = [];
  let nights: number | null = null;
  const ls = skLines(html);
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    const short = l.match(/^All-inclusive stays:\s*(\d+)\s*days?\s*\/\s*(\d+)\s*nights?/i);
    const week = /^All-inclusive 1-week stays/i.test(l);
    if (short) { nights = Number(short[2]); continue; }
    if (week) { nights = 7; continue; }
    if (/^(INDEPENDENT RIDER|OUR OFFERS)/i.test(l)) nights = null;
    if (!nights) continue;
    const price = ls[i + 1]?.match(/^(\d[\d\s.,]*)\s*€$|^€\s*(\d[\d\s.,]*)$/);
    if (/^(\d+ (PERSON|PEOPLE)|ADDITIONAL ADULT|CHILDREN)/i.test(l) && price) {
      const amount = parseAmount(price[1] ?? price[2]);
      if (amount) out.push({ nights, label: l, amount, currency: 'EUR' });
      i++;
    }
  }
  return out;
}

/** Season limits + minimum stay from the budget simulator script on the rates page. */
export function parseSkSeason(html: string): SkSeason | null {
  const m = html.match(/seasonMin\s*=\s*new Date\('(\d{4}-\d{2}-\d{2})'\)\s*,\s*seasonMax\s*=\s*new Date\('(\d{4}-\d{2}-\d{2})'\)/);
  if (!m) return null;
  const min = html.match(/if\s*\(\s*nights\s*<\s*(\d+)\s*\)/);
  return { start: m[1], end: m[2], minNights: min ? Number(min[1]) : null };
}

const COMPOSITIONS: Array<{ re: RegExp; slug: string; unit: string; occupancy: number }> = [
  { re: /^1 PERSON KITESURFING$/i, slug: 'bungalow-1p-kite', unit: 'Beachfront bungalow, 1 person with kite package', occupancy: 1 },
  { re: /^2 PEOPLE KITESURFING$/i, slug: 'bungalow-2p-kite', unit: 'Beachfront bungalow, 2 people with kite package', occupancy: 2 },
  { re: /^2 PEOPLE, 1 KITESURFING AND 1 WITHOUT KITESURFING$/i, slug: 'bungalow-2p-1kite', unit: 'Beachfront bungalow, 2 people (1 with, 1 without kite package)', occupancy: 2 },
];

export function buildSkSlots(rates: SkRate[], season: SkSeason): Slot[] {
  const year = season.start.slice(0, 4);
  const out: Slot[] = [];
  for (const r of rates) {
    const c = COMPOSITIONS.find(x => x.re.test(r.label));
    if (!c) continue; // add-ons (extra adult, child) are not bookable on their own
    out.push({
      key: `${c.slug}|${r.nights}n|${year}`,
      startDate: season.start,
      endDate: season.end,
      unit: c.unit,
      price: r.amount,
      currency: r.currency,
      priceUnit: 'package',
      priceBasis: 'room',
      occupancy: c.occupancy,
      availability: 'on_request',
      availabilityText: null,
      spotsLeft: null,
      packageNights: r.nights,
      minNights: season.minNights,
    });
  }
  return out;
}

/** Bungalow cards between "Choose your bungalow" and "Picture gallery". */
export function parseSkBungalows(html: string): ContentRoom[] {
  const ls = skLines(html);
  const from = ls.findIndex(l => /^Choose your bungalow$/i.test(l));
  const to = ls.findIndex((l, i) => i > from && /^Picture gallery$/i.test(l));
  if (from < 0) return [];
  const block = ls.slice(from + 2, to > from ? to : from + 40);
  const out: ContentRoom[] = [];
  for (const l of block) {
    if (/^(Triple Bungalow|Family Bungalow|Family XL|Bridal suite|[A-Z][a-z]+ (Bungalow|suite))$/.test(l)) { out.push({ name: l, description: null, features: [] }); continue; }
    const cur = out[out.length - 1];
    if (!cur || l === 'Family') continue;
    if (l.length > 45 && !cur.description) cur.description = l;
    else cur.features.push(l);
  }
  return out;
}

function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}

export interface SkPages { home: string; lodge: string; bungalows: string; kite: string; offers: string; rates: string }

export function parseSakalavaContent(p: SkPages): OfferContent {
  const home = skLines(p.home);
  const lodge = skLines(p.lodge);
  const kite = skLines(p.kite);
  const rates = parseSkRates(p.rates);
  const season = parseSkSeason(p.rates);
  const coords = p.home.match(/google\.com\/maps\/search\/\?api=1&(?:amp;)?query=(-?\d+\.\d+),(-?\d+\.\d+)/);
  const find = (ls: string[], re: RegExp) => ls.find(l => re.test(l)) ?? null;
  const addOns = rates.filter(r => /ADDITIONAL|CHILDREN/i.test(r.label)).map(r => `${r.nights} nights: ${r.label.toLowerCase()} +EUR ${r.amount}`);
  const rooms = parseSkBungalows(p.bungalows).map(r => ({ ...r, features: [...r.features, ...addOns] }));
  const cheapest = rates.filter(r => /^1 PERSON/i.test(r.label)).sort((a, b) => a.nights - b.nights);
  const naish = find(skLines(p.rates), /^NAISH EXPERT RANGE/i);
  const instructors = kite[kite.findIndex(l => /^IKO certified instructors$/i.test(l)) - 1] ?? null;
  const nBungalows = lodge.join(' ').match(/(\d+) bungalows of \d+ m²/)?.[1] ?? null;
  const maxGuests = home.join(' ').match(/Maximum (\d+) clients/i)?.[1] ?? null;

  const imgs: string[] = [];
  const og = meta(p.home, 'og:image');
  if (og) imgs.push(og);
  for (const html of [p.bungalows, p.lodge, p.home, p.kite]) {
    for (const m of html.matchAll(/https:\/\/sakalava\.com\/wp-content\/uploads\/[^"'\s)]+?\.(?:jpe?g|webp)/gi)) {
      const u = m[0].replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
      if (/logo|icon|favicon|cropped-|Sakalava_YPKL/i.test(u) || imgs.includes(u)) continue;
      imgs.push(u);
    }
  }

  const summary = [
    `Sakalava Lodge is a kitesurf and wingfoil lodge on Sakalava Bay near Diego Suarez in northern Madagascar, with ${nBungalows ?? 'ten'} bungalows facing the lagoon${maxGuests ? ` (at most ${maxGuests} guests)` : ''} on a 5-hectare private estate.`,
    `Stays are all-inclusive: bungalow, full board, open bar, gym and, with the kite package, unlimited equipment, IKO lessons and coaching${cheapest.length ? `; 2027 rates start at EUR ${cheapest[0].amount} for ${cheapest[0].nights} nights for one person` : ''}${season ? ` (season ${season.start} to ${season.end}, minimum ${season.minNights ?? 3} nights)` : ''}.`,
    `The lodge's IKO school has taught since 2005${instructors ? ` with ${instructors} IKO instructors` : ''}, private lessons and radio headsets; the bay has a flat, shallow lagoon for learning and a wave spot behind it, with southeast trade winds from April to November.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Sakalava Lodge',
    summary,
    continent: 'Africa',
    country: 'Madagascar',
    region: 'Diana (Diego Suarez)',
    spot: 'Sakalava Bay',
    spotCoords: coords ? { lat: Number(coords[1]), lng: Number(coords[2]) } : null, // map link on the home page
    itinerarySpots: [],
    durationDays: null,
    // kite page: "from complete beginners to experienced riders"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: kite.some(l => /IKO/.test(l)),
    equipmentRental: kite.some(l => /rental|equipment included/i.test(l)),
    beginnerFriendly: home.some(l => /beginner area|calm water for beginners/i.test(l)),
    includedServices: [
      'Beachfront bungalow', 'Full board', 'Open bar', 'Gym',
      'With the kite package: unlimited kitesurf and wingfoil equipment, IKO lessons and coaching',
      'Equipment storage', 'Starlink Wi-Fi',
    ],
    optionalServices: [
      ...(naish ? [`Naish expert rental range for independent riders (${naish.replace(/^NAISH EXPERT RANGE \[Q\] \d{4}:\s*/i, '')})`] : []),
      'Kite trip to the Emerald Sea', 'Family kiteboarding lessons',
      'Airport transfers (Diego Suarez, Nosy Be via Ankify)', 'Excursions (Red Tsingy, Amber Mountain, quad raid)',
    ],
    accommodation: '10 beachfront bungalows (incl. 3 family bungalows and a suite)',
    mealPlan: 'full_board',
    languages: ['fr', 'en', 'mg'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: SK_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home.join(' | ')}`,
      `lodge: ${lodge.join(' | ')}`,
      `kite school: ${kite.join(' | ')}${instructors ? ` (instructors: ${instructors})` : ''}`,
      `offers: ${pageText(p.offers)}`,
      `rates: ${rates.map(r => `${r.nights}n ${r.label} ${r.amount} ${r.currency}`).join('; ')}`,
      `season: ${season ? `${season.start}..${season.end} min ${season.minNights}` : '-'}`,
      `coords (home map link): ${coords ? `${coords[1]},${coords[2]}` : '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const sakalavaLodgeDiegoSuarez: OfferAdapter = {
  key: 'sakalava-lodge-diego-suarez',
  name: 'Sakalava Lodge',
  kind: 'accommodation',
  operator: {
    name: 'Sakalava Lodge',
    websiteUrl: SITE,
    rootDomain: 'sakalava.com',
    contactEmail: 'sakalava1@gmail.com',
    whatsapp: '+261324238436',
    phone: '+261324238436',
  },
  url: SK_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 6,
  async fetchContent() {
    const home = await sakalavaGet(SK_HOME_URL);
    const lodge = await sakalavaGet(SK_LODGE_URL);
    const bungalows = await sakalavaGet(SK_BUNGALOWS_URL);
    const kite = await sakalavaGet(SK_KITE_URL);
    const offers = await sakalavaGet(SK_OFFERS_URL);
    const rates = await sakalavaGet(SK_RATES_URL);
    return parseSakalavaContent({ home, lodge, bungalows, kite, offers, rates });
  },
  async fetchSlots(ctx) {
    const html = await sakalavaGet(SK_RATES_URL);
    const rates = parseSkRates(html);
    const season = parseSkSeason(html);
    if (rates.length < 6) throw new Error(`sakalava: rate lists not found or changed (${rates.length} rates parsed)`);
    if (!season) throw new Error('sakalava: season limits (seasonMin / seasonMax in the budget simulator) not found');
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
    if (!title.includes(season.start.slice(0, 4))) ctx.note(`rates page title "${clean(title)}" does not name the simulator season ${season.start.slice(0, 4)}`);
    return buildSkSlots(rates, season);
  },
};
