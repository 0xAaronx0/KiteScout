// ---------------------------------------------------------------------------
// Kite Me Up (kite school at Lo Stagnone, Marsala) - "8 days Hostel Kite Camp": 8 days / 7 nights with a dorm bed at
// Kite Hostel Stagnone (villa by the lagoon; private room at extra cost), 6.5 hours of private 1-to-1 lessons over the
// first days plus 2 days of supervised rental, full kite gear, helmet with radio, impact vest, IKO or VDWS certificate.
// For beginners; arrival on any day in the season (March - November). Separate listing from the hostel's own stay
// (kite-hostel-stagnone-marsala).
//
// Data path (checked 2026-10-21): ONE page, https://kitemeup.com/7-days-kite-camp-beginner-lo-stagnone-sicily.html
//   The visible price ("Starting from ... Total for persons" + "€") is filled in by script; the figures sit in the
//   page's own data `<script> var packages = {...};</script>` (all school products). This adapter reads product
//   "sevenDaysHostel" (fallback: the "kite camps" product titled "8 days Hostel ..."):
//     title, subtitle, level, time, accommodation, included.more, details.{Included, Extras, Kite surf lessons, ...},
//     mainImages (ids -> https://kitemeup.com/img_webp/<id>.webp, 1024-1440 px wide) and
//     pricing {currentPrice 813, originalPrice 904, startingPrice 813}.
//   PRICE = pricing.startingPrice, READ FROM PAGE DATA (not printed as text). Currency: the price template on the page
//   carries the "€" sign (checked: the line after "Starting from Total for persons" is "€"); if that sign disappears
//   the slot still says EUR and notes the inference. Basis: per person (product "students": 1, "Total for persons"),
//   dorm bed (private room extra, no figure). "SEASON 2026 - 10% Off All Courses!" explains current vs original price.
//   The season line "Season: March - November" has no year.
// Booking: "Book This Camp Now" opens a booking wizard (date, persons, accommodation) that sends a request: "Your
//   request is not automatically confirmed - our team will review it and get back to you within a few hours" ->
//   availability 'on_request'; liveAvailability unset (no inventory read), instantBooking false (no checkout/payment).
// robots.txt kitemeup.com (2026-10-21): only /images/pic/ disallowed (photos are under /img_webp/).
// Requests per run: 1 (memoised page, ~480 KB).
// Slots: ONE undated slot (any arrival in season), key "dorm", priceUnit 'package' (packageNights 7), priceBasis
//   'person'. Doubt: "Bike rental" and "Transfers to Trapani airport" are listed as included but carry a "*" that the
//   page footnotes as "Optional extra for Bike, E-Bike and Transfer"; they go to optionalServices.
// State 2026-10-21: 1 undated slot, EUR 813 per person (startingPrice; original 904).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, parse } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://kitemeup.com';
export const KMU_URL = `${SITE}/7-days-kite-camp-beginner-lo-stagnone-sicily.html`;
const PRODUCT_ID = 'sevenDaysHostel';
const NIGHTS = 7;

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

export interface KmuProduct {
  id: string;
  category?: string;
  title?: string;
  subtitle?: string;
  level?: string;
  time?: string;
  accommodation?: string;
  accommocationIncluded?: boolean;
  students?: number;
  included?: { more?: string[] };
  details?: Record<string, string>;
  mainImages?: string[];
  pricing?: { currentPrice?: number; originalPrice?: number; startingPrice?: number };
}

/** The page's `var packages = {...};` object (all products of the school). */
export function kmuPackages(html: string): Record<string, KmuProduct> {
  const m = html.match(/var\s+packages\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!m) throw new Error('kite-me-up: `var packages` data not found (layout changed?)');
  return JSON.parse(m[1]) as Record<string, KmuProduct>;
}

export function kmuProduct(html: string): KmuProduct {
  const all = kmuPackages(html);
  const p = all[PRODUCT_ID] ?? Object.values(all).find(x => x.category === 'kite camps' && /8 days hostel/i.test(x.title ?? ''));
  if (!p) throw new Error(`kite-me-up: product "${PRODUCT_ID}" not in the page data`);
  return p;
}

/** Visible lines (structured text, collapsed). */
export function kmuLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('head, script, style, noscript, template')) el.remove();
  return root.structuredText.split('\n').map(l => collapse(l)).filter(Boolean);
}

/** "<li>..</li>" HTML of a details field -> plain items. */
const items = (h: string | undefined): string[] => (h ? h.split(/<li>/i).slice(1).map(x => clean(x.replace(/<[^>]+>/g, ' '))).filter(Boolean) : []);

export interface KmuFacts {
  price: number | null;
  original: number | null;
  euroOnPage: boolean;
  season: string | null;
  promo: string | null;
}

export function kmuFacts(html: string, p: KmuProduct): KmuFacts {
  const lines = kmuLines(html);
  const at = lines.findIndex(l => /^Starting from\b/i.test(l));
  const price = p.pricing?.startingPrice ?? p.pricing?.currentPrice ?? null;
  return {
    price: typeof price === 'number' && price > 0 ? price : null,
    original: p.pricing?.originalPrice ?? null,
    euroOnPage: at >= 0 && /€/.test(lines[at] + (lines[at + 1] ?? '')),
    season: lines.find(l => /^Season:\s*/i.test(l))?.replace(/^Season:\s*/i, '').replace(/[–—]/g, '-') ?? null,
    promo: lines.find(l => /^SEASON 20\d{2}\s*[–—-]\s*\d+% Off/i.test(l))?.replace(/[–—]/g, '-') ?? null,
  };
}

export function buildKmuSlots(f: KmuFacts): Slot[] {
  return [{
    key: 'dorm',
    startDate: null,
    endDate: null,
    unit: 'Dorm bed at Kite Hostel Stagnone, 7 nights, 6.5 h private lessons + 2 days supervised rental',
    price: f.price,
    currency: f.price !== null ? 'EUR' : null,
    priceUnit: f.price !== null ? 'package' : null,
    priceBasis: f.price !== null ? 'person' : null,
    occupancy: 1,
    availability: 'on_request',
    availabilityText: [
      `starting price read from the page data (startingPrice${f.euroOnPage ? '' : '; currency EUR inferred, the page sign is missing'})`,
      f.original && f.price && f.original > f.price ? `${f.promo ? `season offer "${f.promo}"` : 'season discount'}, regular EUR ${f.original}` : null,
      'private room at extra cost on request',
      `any arrival date in season${f.season ? ` (${f.season})` : ''}`,
      'booking wizard request, confirmed by the team',
    ].filter(Boolean).join('; '),
    spotsLeft: null,
    packageNights: NIGHTS,
  }];
}

export async function fetchKmuSlots(ctx: FetchContext): Promise<Slot[]> {
  const html = await page(KMU_URL);
  const f = kmuFacts(html, kmuProduct(html));
  if (f.price === null) ctx.note('kite-me-up: no startingPrice in the page data; price on request');
  if (!f.euroOnPage) ctx.note('kite-me-up: "€" sign next to the price template not found; EUR inferred');
  return buildKmuSlots(f);
}

// --- content ----------------------------------------------------------------------------------------------------------
export function parseKmuContent(html: string): OfferContent {
  const p = kmuProduct(html);
  const f = kmuFacts(html, p);
  const d = p.details ?? {};
  const more = p.included?.more ?? [];
  const starred = more.filter(x => /\*\s*$/.test(x)).map(x => x.replace(/\s*\*\s*$/, ''));
  const included = [
    ...more.filter(x => !/\*\s*$/.test(x)),
    ...(d['Kite surf lessons'] ? [`Kite lessons: ${clean(d['Kite surf lessons'])}`] : []),
    ...(d.equipment ? [`Equipment: ${clean(d.equipment)}`] : []),
  ];
  const summary = [
    `Kite Me Up, a kite school at the Lo Stagnone lagoon near Marsala in western Sicily, sells an 8-day / 7-night beginner kite camp with private lessons in the lagoon's flat, shallow water.`,
    `Guests sleep in a dorm at Kite Hostel Stagnone, a villa by the lagoon (private rooms at extra cost, group dinners and yoga three times a week as paid extras), and get 6.5 hours of 1-to-1 lessons followed by 2 days of supervised rental, full gear with radio helmet and an IKO or VDWS certificate.`,
    `${f.price !== null ? `The camp starts at EUR ${f.price.toLocaleString('en-US')} per person${f.original && f.original > f.price ? ` (season discount; regular EUR ${f.original.toLocaleString('en-US')})` : ''}, ` : ''}with arrival on any day in the season${f.season ? ` (${f.season})` : ''}; bookings are requests confirmed by the school.`,
  ].join(' ');
  return {
    kind: 'camp',
    title: 'Kite Me Up 8 days Hostel Kite Camp, Lo Stagnone',
    summary,
    continent: 'Europe',
    country: 'Italy',
    region: 'Lo Stagnone, Sicily',
    spot: 'Lo Stagnone',
    // no spotCoords: the page prints none
    itinerarySpots: [],
    durationDays: NIGHTS + 1,
    skillLevels: ['beginner'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: included,
    optionalServices: [
      ...starred.map(x => `${x} (footnoted "Optional extra for Bike, E-Bike and Transfer")`),
      ...items(d.Extras),
      'Private room instead of a dorm bed (extra cost, on request)',
      'Extra lesson hours',
    ],
    accommodation: 'Kite Hostel Stagnone, villa by the lagoon: dorm bed (private room at extra cost)',
    mealPlan: null, // dinners (3x a week) are a paid extra
    languages: ['en', 'fr', 'it', 'de'],
    rooms: [],
    imageUrls: (p.mainImages ?? []).filter(x => /^[\w/-]+$/.test(x)).map(x => `${SITE}/img_webp/${x}.webp`),
    heroVideoUrl: null,
    sourceUrl: KMU_URL,
    bookingUrl: KMU_URL,
    sourceText: [
      `product ${p.id}: ${p.title} / ${p.subtitle} / level ${p.level} / ${p.time}`,
      `included: ${more.join(' | ')}`,
      `details: ${Object.entries(d).map(([k, v]) => `${k}: ${clean(v.replace(/<[^>]+>/g, ' '))}`).join(' | ')}`,
      `pricing (page data): ${JSON.stringify(p.pricing)}; season: ${f.season}; promo: ${f.promo}; euro sign on page: ${f.euroOnPage}`,
    ].join('\n'),
  };
}

export const kiteMeUpHostelKiteCampLoStagnone: OfferAdapter = {
  key: 'kite-me-up-hostel-kite-camp-lo-stagnone',
  name: 'Kite Me Up 8 days Hostel Kite Camp, Lo Stagnone',
  kind: 'camp',
  operator: {
    name: 'Kite Me Up',
    websiteUrl: SITE,
    rootDomain: 'kitemeup.com',
    contactEmail: 'contact@kitemeup.com',
    whatsapp: '+393519504204',
    phone: '+393519504204',
  },
  url: KMU_URL,
  slotMethod: 'price_table',
  instantBooking: false,
  confidence: 'medium',
  fetchBudget: 2,
  async fetchContent() {
    return parseKmuContent(await page(KMU_URL));
  },
  fetchSlots: ctx => fetchKmuSlots(ctx),
};
