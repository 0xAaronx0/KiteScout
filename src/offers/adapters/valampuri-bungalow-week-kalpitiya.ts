// ---------------------------------------------------------------------------
// Valampuri Resort, Kalpitiya Lagoon (Sri Lanka) - bungalow kite package: 5 nights in an air-conditioned bungalow,
// a 6-hour private IKO lesson course, half board, boat transfers to the teaching area, walkie-talkie coaching,
// rescue boat cover and the IKO certificate. One place, stay + course as a package -> KIND = 'camp'. The resort
// itself is listed separately as a stay (adapter valampuri-resort-kalpitiya); this is the packaged course.
//
// Product name: the research (2026-10-21, from search snippets) called it "Full Week Bungalow Package, from
//   EUR 590". The live page (checked 2026-10-21) no longer uses that name: the same EUR 590 bungalow package is
//   now "Independent Rider Bungalow Week" (5 nights, "Best for: Beginners wanting a longer stay"). The parser
//   accepts both names. The title says "Bungalow Week" as the site does, although it is 5 nights, not 7.
//
// Data path (checked 2026-10-21): static Astro site, English.
//   slots    /rates-offers/ "All six packages compared" <table> (Package | Nights | Accommodation | Lessons / Kite
//            | Price): the row "Independent Rider Bungalow Week | 5 | Air-conditioned bungalow | 6-hour private
//            lesson course | EUR 590 pp". One undated slot, EUR per person, package of 5 nights. "Book This Offer"
//            opens WhatsApp with a prefilled text; "confirmation within 24 hours", no deposit -> 'on_request'.
//   content  the same page (the package's offer card, shared inclusions, Resort JSON-LD with geo) + /gallery/
//            (photos of the resort, lagoon and kite school).
// Liveness: Resort JSON-LD dateModified 2026-07-17, "Last updated: 17 July 2026".
// robots.txt (2026-10-21): "User-agent: * Allow: /".
// Requests per run: content 2 (/rates-offers/ memoised), slots 1.
// Inferred: occupancy is not printed for this package ("EUR 590 pp") -> null. Extra nights at the standard room
//   rate (page FAQ) are not modelled. The page does not name which room type the "air-conditioned bungalow" is.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, ldOfType, parse, parseAmount } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.valampuriresort.com';
export const VAL_BW_RATES_URL = `${SITE}/rates-offers/`;
const VAL_BW_GALLERY_URL = `${SITE}/gallery/`;
/** current name first; the research name as a fallback */
const PACKAGE_RE = /bungalow week|full week bungalow/i;

export interface ValBwRow { name: string; nights: number | null; accommodation: string; kite: string; price: number | null; currency: string | null; raw: string }
export interface ValBwCard { name: string; facts: Record<string, string>; price: string | null }

// --- memoised page fetch ------------------------------------------------------------------------------
const pageCache = new Map<string, Promise<string>>();
function page(url: string): Promise<string> {
  if (!pageCache.has(url)) {
    const p = fetchText(url, { accept: 'text/html' });
    p.catch(() => pageCache.delete(url));
    pageCache.set(url, p);
  }
  return pageCache.get(url)!;
}

// --- pure parsers -------------------------------------------------------------------------------------
/** The package comparison table row for the bungalow week. */
export function parseValBwRow(html: string): ValBwRow | null {
  for (const tr of parse(html).querySelectorAll('table tr')) {
    const cells = tr.querySelectorAll('td').map(td => collapse(td.text));
    if (cells.length < 5 || !PACKAGE_RE.test(cells[0])) continue;
    const raw = cells[4];
    return {
      name: cells[0],
      nights: /^\d+$/.test(cells[1]) ? Number(cells[1]) : null,
      accommodation: cells[2],
      kite: cells[3],
      price: /€|eur/i.test(raw) ? parseAmount(raw) : null,
      currency: /€|eur/i.test(raw) ? 'EUR' : null,
      raw,
    };
  }
  return null;
}

/** The package's offer card: <article class="offer-card"> with h3, "Label: value" lines and the price. */
export function parseValBwCard(html: string): ValBwCard | null {
  for (const card of parse(html).querySelectorAll('article.offer-card')) {
    const name = collapse(card.querySelector('h3')?.text ?? '');
    if (!PACKAGE_RE.test(name)) continue;
    const facts: Record<string, string> = {};
    for (const el of card.querySelectorAll('li, p')) {
      const m = collapse(el.text).match(/^([A-Za-z ]{3,20}):\s*(.+)$/);
      if (m) facts[m[1].trim()] = m[2].trim();
    }
    return { name, facts, price: collapse(card.querySelector('.offer-card-top strong')?.text ?? '') || null };
  }
  return null;
}

export function buildValBwSlots(row: ValBwRow): Slot[] {
  if (row.price === null) return [];
  return [{
    key: 'bungalow-week',
    startDate: null,
    endDate: null,
    unit: `${row.name} (${row.accommodation}, ${row.kite})`,
    price: row.price,
    currency: row.currency,
    priceUnit: 'package',
    priceBasis: /\bpp\b|p\/p|per person/i.test(row.raw) ? 'person' : null,
    occupancy: null,
    availability: 'on_request',
    availabilityText: 'Book by WhatsApp or e-mail, confirmation within 24 hours, no deposit; extra nights at the standard room rate',
    spotsLeft: null,
    packageNights: row.nights,
  }];
}

function mainText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}

export interface ValBwPages { rates: string; gallery: string }

export function parseValBwContent(p: ValBwPages): OfferContent {
  const row = parseValBwRow(p.rates);
  if (!row || row.price === null) throw new Error('valampuri-bungalow-week: package row not found in the comparison table (renamed or removed?)');
  const card = parseValBwCard(p.rates);
  const resort = ldOfType(p.rates, 'Resort')[0] as Record<string, unknown> | undefined;
  const geo = (resort?.geo ?? null) as { latitude?: number; longitude?: number } | null;
  const modified = (ldOfType(p.rates, 'WebPage')[0]?.dateModified as string | undefined) ?? null;
  const text = mainText(p.rates);
  const nights = row.nights ?? 5;
  const lessonsFrom = text.match(/Private kitesurfing lessons without a package cost from (€\d+ per hour)/)?.[1] ?? null;
  const fullBoard = text.match(/Full board \(adding lunch\) is an extra (€\d+) per person per day/)?.[1] ?? null;

  // photos: kite school, lagoon and resort first (rates page hero, then the gallery); no logos / brand marks
  const seen = new Set<string>();
  const all: string[] = [];
  for (const u of [...imageCandidates(p.rates, VAL_BW_RATES_URL, null, 20), ...imageCandidates(p.gallery, VAL_BW_GALLERY_URL, null, 80)]) {
    if (/\/brand\/|logo|badge|icon|\.svg|facebook\.com\/tr|wind-rider-dorm/i.test(u)) continue; // the dorm is not this package's room
    const k = u.replace(/-(?:thumb-)?\d+w(?=\.webp$)|-thumb(?=\.webp$)|-q\d+(?=\.webp$)|-opt(?=\.webp$)/, '');
    if (seen.has(k)) continue;
    seen.add(k); all.push(u);
  }
  const rank = (u: string): number => (/kite|kitesurf/i.test(u) ? 0 : /lagoon|jetty|boat|pool|chalet|cabana|aerial/i.test(u) ? 1 : 2);
  const imageUrls = all.map((u, i) => ({ u, i })).sort((a, b) => rank(a.u) - rank(b.u) || a.i - b.i).map(x => x.u).filter(u => rank(u) < 2).slice(0, 12);

  const summary = [
    `Valampuri Resort's "${row.name}" is a ${nights}-night kite course package at the family-run eco resort on Kalpitiya Lagoon in north-western Sri Lanka, which runs its own IKO-certified kite school with Duotone equipment.`,
    `It includes an ${row.accommodation.toLowerCase()}, a ${row.kite.toLowerCase()}, breakfast and dinner, boat transfers to the teaching area, walkie-talkie coaching, rescue boat cover and the IKO certificate.`,
    `The price is EUR ${row.price} per person; booking is by WhatsApp or e-mail with confirmation within 24 hours and no deposit.`,
  ].join(' ');

  return {
    kind: 'camp',
    title: `Valampuri ${row.name}`,
    summary,
    continent: 'Asia',
    country: 'Sri Lanka',
    region: 'North Western Province',
    spot: 'Kalpitiya Lagoon',
    spotCoords: geo && typeof geo.latitude === 'number' && typeof geo.longitude === 'number' ? { lat: geo.latitude, lng: geo.longitude } : null, // site JSON-LD geo
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      `${nights} nights in an ${row.accommodation.toLowerCase()}`,
      row.kite,
      'Half board (breakfast and dinner)',
      card?.facts.Transfers ?? 'Boat transfers to the teaching area',
      card?.facts.Coaching ?? 'Walkie-talkie coaching',
      card?.facts.Safety ?? 'Rescue boat',
      card?.facts.Certification ?? 'IKO certificate',
    ],
    optionalServices: [
      'Extra nights at the standard room rate',
      ...(fullBoard ? [`Full board (lunch): ${fullBoard.replace('€', 'EUR ')} per person per day`] : []),
      ...(lessonsFrom ? [`Extra private lessons from ${lessonsFrom.replace('€', 'EUR ')}`] : []),
      'Duotone kite rental, kite storage',
      'Kite trips: Vella Island, Dream Spot, island-hopping downwinder, one-night downwinder stay',
      'Dolphin watching, Wilpattu safari, lagoon boat tours, kayaking',
    ],
    accommodation: `${row.accommodation.toLowerCase()} at a lagoon-side eco resort with pool`,
    mealPlan: 'half_board',
    languages: ['en'],
    rooms: [],
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: VAL_BW_RATES_URL,
    bookingUrl: `${SITE}/contact/`,
    sourceText: [
      `rates (dateModified ${modified ?? '?'}): ${text}`,
      `package row: ${row.name} | ${row.nights} | ${row.accommodation} | ${row.kite} | ${row.raw}`,
      `offer card: ${JSON.stringify(card)}`,
    ].join('\n'),
  };
}

export const valampuriBungalowWeekKalpitiya: OfferAdapter = {
  key: 'valampuri-bungalow-week-kalpitiya',
  name: 'Valampuri Bungalow Week kite package (Kalpitiya)',
  kind: 'camp',
  operator: {
    name: 'Valampuri Resort',
    websiteUrl: SITE,
    rootDomain: 'valampuriresort.com',
    contactEmail: 'valampuriresort@gmail.com', // site footer + JSON-LD
    whatsapp: '+94776314144',
    phone: '+94776314144',
  },
  url: VAL_BW_RATES_URL,
  slotMethod: 'price_table',
  instantBooking: false, // WhatsApp / e-mail request
  fetchBudget: 3,
  async fetchContent() {
    return parseValBwContent({ rates: await page(VAL_BW_RATES_URL), gallery: await page(VAL_BW_GALLERY_URL) });
  },
  async fetchSlots() {
    const row = parseValBwRow(await page(VAL_BW_RATES_URL));
    if (!row) throw new Error('valampuri-bungalow-week: package row not found in the comparison table (renamed or removed?)');
    return buildValBwSlots(row);
  },
};
