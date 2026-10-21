// ---------------------------------------------------------------------------
// Kite Buen Hombre - "10-Day Special" kite stay package (Playa Buen Hombre, Monte Cristi, Dominican Republic):
// 9 nights in the school's beach bungalows (loft upgrade possible), three meals a day, bottled water, kite
// equipment, the 11-hour beginner course, a graduation boat trip with downwinder and the second-level course
// (5 h classes + 5 h supervised practice). Sold per person, year-round, no dates. KIND = 'camp'.
// The same provider's lodge is already in the catalog as an accommodation (kite-buen-hombre-eco-lodge.ts, NOT
// edited, its wixLines helper is imported); this is a separate listing for the package. The 7-Day Special is a
// second listing (kite-buen-hombre-7-day-special.ts) that imports the shared helpers of this file.
//
// Data path (checked 2026-10-21): Wix site, ONE page /kite-stay-packages-dominican-republic.
//   price    JSON-LD Service "Kite Stay Packages in Buen Hombre" -> hasOfferCatalog.itemListElement[]: Offer
//            {itemOffered.name "10-Day Special", itemOffered.description "9 nights accommodation ...",
//            priceSpecification {price 2222, priceCurrency USD, unitText "per person"}} (the old Product/offers
//            block of 2026-10-12 is still read as a fallback). Visible: "Normal value: $2,390 per person -> 10-Day
//            Special: $2,222 per person (save $168)", FAQ "all package prices shown on this page are per person".
//   content  the same page: the package's "· "-separated inclusion block, "Add only what you want" (extras), FAQ
//            (bungalow, loft upgrade, airport transfer not included), "Regular Kite Stay Packages are available
//            year-round". The JSON-LD FAQ still describes an older 50% offer (May-Jun 15 / Oct-Nov 15); the visible
//            page now prints the "Season Special" (1 Nov - 15 Dec 2026) instead -> visible text wins.
//   map pin  spotCoords = the LodgingBusiness.geo of the school's own hotel page (19.87004, -71.40395, read
//            2026-10-12 for kite-buen-hombre-eco-lodge.ts); the packages page itself has no geo. Kept as a constant
//            so this listing needs one request.
// Booking: there is no shop product for the 10-Day Special (the Wix Stores category sells the courses and the
//   Season Special only, checked 2026-10-21 on /category/kite-and-stay-packages); the page links "See the full
//   10-Day Course" and "Book Now" (/book, contact / WhatsApp). -> availability 'on_request', instantBooking false.
// robots.txt (2026-10-21): Wix default ("*?lightbox=" disallowed for all), the page is allowed.
// Requests per run: 1 (memoised for 10 min; the 7-Day listing shares the same page).
// Slots: one undated slot "10-Day Special" = USD 2,222 per person, package of 9 nights.
// Currency: JSON-LD priceCurrency "USD" (stated by the site; the visible page prints "$").
// Flags: liveAvailability no (static page), instantBooking false (request / WhatsApp).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, ldOfType, parse, parseAmount, parseDate } from '../parse.js';
import type { OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';
import { wixLines } from './kite-buen-hombre-eco-lodge.js';

export const KBH_SITE = 'https://www.kitebuenhombre.com';
export const KBH_PACKAGES_PAGE = `${KBH_SITE}/kite-stay-packages-dominican-republic`;
export const KBH_BOOK_URL = `${KBH_SITE}/book`;
/** LodgingBusiness.geo of /buen-hombre-hotel (own site, read 2026-10-12) */
export const KBH_COORDS = { lat: 19.87004, lng: -71.40395 };
export const KBH_OPERATOR: OperatorRef = {
  name: 'Kite Buen Hombre',
  websiteUrl: KBH_SITE,
  rootDomain: 'kitebuenhombre.com',
  contactEmail: 'kitebuen@gmail.com',
  whatsapp: '+18295212367',
  phone: '+18295212367',
};

// --- local helpers ----------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
export function kbhPage(url = KBH_PACKAGES_PAGE): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const num = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
export const usd = (n: number): string => `USD ${n.toLocaleString('en-US')}`;
/** Visible page text in one line (Wix lines joined, dashes made plain). */
export function kbhText(html: string): string {
  return wixLines(html).join(' ').replace(/\s*[—–]\s*/g, ' - ').replace(/\s+/g, ' ');
}

export interface KbhOffer { name: string; nights: number | null; price: number; currency: string; description: string }

// --- pure parsers -----------------------------------------------------------------------------
/** Package offers from the JSON-LD OfferCatalog (2026-10-21) or the older Product.offers block (2026-10-12). */
export function parseKbhOffers(html: string): KbhOffer[] {
  const out: KbhOffer[] = [];
  const push = (name: unknown, description: unknown, price: unknown, currency: unknown) => {
    const p = num(price);
    const n = typeof name === 'string' ? collapse(name) : '';
    if (!p || !n || typeof currency !== 'string') return;
    const d = collapse(String(description ?? ''));
    const nights = d.match(/^(\d+)\s+nights?/i)?.[1];
    out.push({ name: n, nights: nights ? Number(nights) : null, price: p, currency, description: d });
  };
  for (const s of ldOfType(html, 'Service')) {
    const items = ((s.hasOfferCatalog as Record<string, unknown> | undefined)?.itemListElement ?? []) as Array<Record<string, unknown>>;
    for (const o of items) {
      const item = (o.itemOffered ?? {}) as Record<string, unknown>;
      const spec = (o.priceSpecification ?? {}) as Record<string, unknown>;
      push(item.name ?? o.name, item.description ?? o.description, spec.price ?? o.price, spec.priceCurrency ?? o.priceCurrency);
    }
  }
  if (out.length === 0) {
    for (const p of ldOfType(html, 'Product')) {
      const offers = (Array.isArray(p.offers) ? p.offers : [p.offers]) as Array<Record<string, unknown> | undefined>;
      for (const o of offers) if (o) push(o.name, o.description, o.price, o.priceCurrency);
    }
  }
  return out;
}

export function kbhOffer(offers: KbhOffer[], re: RegExp): KbhOffer | null {
  return offers.find(o => re.test(o.name)) ?? null;
}

/** "Normal value: $2,390 per person -> 10-Day Special: $2,222 per person" -> 2390 (the visible strike price). */
export function kbhNormalValue(text: string, label: RegExp): number | null {
  const re = new RegExp(`Normal value:\\s*\\$\\s?([\\d,]+)\\s*per person\\s*(?:→|->)?\\s*${label.source}`, 'i');
  const m = text.match(re);
  return m ? parseAmount(m[1]) : null;
}

/** The "· "-separated inclusion block of a package: from "<n> nights accommodation" to the line ending in ".". */
export function kbhInclusions(html: string, nights: number): string[] {
  const ls = wixLines(html);
  const a = ls.findIndex(l => new RegExp(`^${nights}\\s+nights? accommodation`, 'i').test(l));
  if (a < 0) return [];
  const block: string[] = [];
  for (let i = a; i < ls.length && i < a + 15; i++) {
    block.push(ls[i]);
    if (/\.\s*$/.test(ls[i])) break;
  }
  return block.join(' ').replace(/\s*[—–]\s*/g, ' - ')
    .split(/\s*·\s*/)
    .map(s => collapse(s).replace(/\.$/, '').trim())
    .filter(Boolean)
    .map(s => s[0].toUpperCase() + s.slice(1));
}

/** Extras the page sells on top ("Add only what you want."). */
export function kbhExtras(text: string): string[] {
  const out: string[] = [];
  if (/Airport pickup and transfers/i.test(text)) out.push('Airport pickup and transfers (not included in the package)');
  if (/Photography,?\s*Video coaching/i.test(text)) out.push('Photography and video coaching');
  if (/Boat trips, downwinders/i.test(text)) out.push('Boat trips, downwinders and other experiences (Cayo Arena, 7 Islands, Punta Rucia)');
  if (/upgrade to a loft room/i.test(text)) out.push('Upgrade from the bungalow to a loft room');
  return out;
}

/** Real photos of the page: og:image + content images, Wix originals; logos, the transport photo and alt-less assets dropped. */
export function kbhImages(html: string, base = KBH_PACKAGES_PAGE): string[] {
  const alts = new Map<string, string>();
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const id = m[0].match(/static\.wixstatic\.com\/media\/([^/~."]+)/)?.[1];
    const alt = m[0].match(/\balt="([^"]*)"/)?.[1] ?? '';
    if (id && !alts.has(id)) alts.set(id, alt);
  }
  const og = parse(html).querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '';
  const ogId = og.match(/static\.wixstatic\.com\/media\/([^/~."]+)/)?.[1] ?? null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of imageCandidates(html, base, null, 60)) {
    const id = u.match(/static\.wixstatic\.com\/media\/([^/~."]+)/)?.[1];
    if (!id || seen.has(id)) continue;
    const alt = alts.get(id);
    if (id !== ogId && (!alt || /logo|icon|transport|instagram|facebook|tiktok|youtube|tripadvisor/i.test(alt))) continue;
    if (/logo|icon|\.svg/i.test(u)) continue;
    seen.add(id);
    out.push(u.replace(/(\/media\/[^/]+)\/v1\/.*$/, '$1'));
  }
  return out;
}

export interface KbhSeasonSpecial {
  start: string; end: string; total: number; days: number | null; coursePrice: number | null;
  mealsPerDay: number | null; deposit: number | null; depositBy: string | null; placesPerWeek: number | null;
}
/** "Season special ... Stay any week from 1 November to 15 December 2026: book the 10-hour kite course ($850) ...
 *  the 7-day stay is $1,235 in total ... Reserve with a $425 deposit by 15 November. Only 10 places a week." */
export function parseKbhSeasonSpecial(text: string): KbhSeasonSpecial | null {
  const i = text.search(/Stay any week from/i);
  if (i < 0) return null;
  const t = text.slice(i, i + 700);
  const win = t.match(/from (\d{1,2} [A-Za-z]+)(?: (\d{4}))? to (\d{1,2} [A-Za-z]+) (\d{4})/i);
  const total = t.match(/(\d+)-day(?: \/ \d+-night)? stay (?:is|comes to) \$\s?([\d,]+) in total/i);
  if (!win || !total) return null;
  const year = win[4];
  const start = parseDate(`${win[1]} ${win[2] ?? year}`);
  const end = parseDate(`${win[3]} ${year}`);
  if (!start || !end) return null;
  const dep = t.match(/\$\s?([\d,]+) deposit by (\d{1,2} [A-Za-z]+)(?: (\d{4}))?/i);
  return {
    start, end,
    total: parseAmount(total[2])!,
    days: Number(total[1]),
    coursePrice: (() => { const m = t.match(/course \(\$\s?([\d,]+)\)/i); return m ? parseAmount(m[1]) : null; })(),
    mealsPerDay: (() => { const m = t.match(/\$\s?(\d+) a day/i); return m ? Number(m[1]) : null; })(),
    deposit: dep ? parseAmount(dep[1]) : null,
    depositBy: dep ? parseDate(`${dep[2]} ${dep[3] ?? year}`) : null,
    placesPerWeek: (() => { const m = t.match(/Only (\d+) places a week/i); return m ? Number(m[1]) : null; })(),
  };
}

// --- 10-Day Special ----------------------------------------------------------------------------
export function buildKbh10DaySlots(offer: KbhOffer, text: string): Slot[] {
  const yearRound = /available (?:year-round|12 months a year)/i.test(text);
  return [{
    key: '10-day-special',
    startDate: null,
    endDate: null,
    unit: offer.name,
    price: offer.price,
    currency: offer.currency,
    priceUnit: 'package',
    priceBasis: 'person', // FAQ: "all package prices shown on this page are per person"
    occupancy: 1,
    availability: 'on_request',
    availabilityText: yearRound ? 'Regular Kite Stay Packages are available year-round' : null,
    spotsLeft: null,
    packageNights: offer.nights,
  }];
}

export function parseKbh10DayContent(html: string): OfferContent {
  const text = kbhText(html);
  const offer = kbhOffer(parseKbhOffers(html), /^10-Day/i);
  if (!offer) throw new Error('kite-buen-hombre-10-day: "10-Day Special" offer not found (JSON-LD changed?)');
  const nights = offer.nights ?? 9;
  const normal = kbhNormalValue(text, /10-Day\s*Special/);
  const included = kbhInclusions(html, nights);
  const hours = text.match(/= (\d+) hours\b/)?.[1];
  const summary = [
    `The 10-Day Special is Kite Buen Hombre's longest regular kite camp package at Playa Buen Hombre (Monte Cristi, north-west Dominican Republic), on the shallow flat-water lagoon beside the school's own beach lodge.`,
    `It covers ${nights} nights in a beach bungalow (loft upgrade available), three meals a day, bottled water and kite equipment, the 11-hour beginner course, a graduation boat trip with a downwinder and the second-level course (5 hours of classes plus 5 hours of supervised practice)${hours ? `, ${hours} hours of instruction in total` : ''}.`,
    `It costs ${usd(offer.price)} per person${normal ? ` (normal value ${usd(normal)})` : ''}, is sold year-round without fixed dates and is booked on request; airport transfers are extra.`,
  ].join(' ');
  return {
    kind: 'camp',
    title: 'Kite Buen Hombre 10-Day Special Kite Camp',
    summary,
    continent: 'North America',
    country: 'Dominican Republic',
    region: 'Monte Cristi',          // as kite-buen-hombre-eco-lodge.ts
    spot: 'Playa Buen Hombre',
    spotCoords: KBH_COORDS,
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner', 'intermediate'], // beginner course + second-level course (FAQ: "also suits riders progressing beyond the basics")
    kiteLessons: true,
    equipmentRental: /kite equipment/i.test(offer.description) || null,
    beginnerFriendly: true,
    includedServices: included,
    optionalServices: kbhExtras(text),
    accommodation: /upgrade to a loft room/i.test(text) ? 'Beach bungalow at the school, loft room upgrade available' : 'Beach bungalow at the school',
    mealPlan: /3 meals daily|three meals a day/i.test(`${offer.description} ${text}`) ? 'full_board' : null,
    languages: ['en', 'es'],
    rooms: [],
    imageUrls: kbhImages(html),
    heroVideoUrl: null,
    sourceUrl: KBH_PACKAGES_PAGE,
    bookingUrl: KBH_BOOK_URL,
    sourceText: [`offer: ${JSON.stringify(offer)}`, `normal value: ${normal}`, `page: ${text}`].join('\n'),
  };
}

export const kiteBuenHombre10DaySpecial: OfferAdapter = {
  key: 'kite-buen-hombre-10-day-special',
  name: 'Kite Buen Hombre - 10-Day Special kite camp, Buen Hombre',
  kind: 'camp',
  operator: KBH_OPERATOR,
  url: KBH_PACKAGES_PAGE,
  slotMethod: 'jsonld',
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() {
    return parseKbh10DayContent(await kbhPage());
  },
  async fetchSlots() {
    const html = await kbhPage();
    const offer = kbhOffer(parseKbhOffers(html), /^10-Day/i);
    if (!offer) throw new Error('kite-buen-hombre-10-day: "10-Day Special" offer not found (JSON-LD changed?)');
    return buildKbh10DaySlots(offer, kbhText(html));
  },
};
