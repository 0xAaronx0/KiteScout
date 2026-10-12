// ---------------------------------------------------------------------------
// Kite HI - guided kitesurf downwinder, Maui North Shore (Hawaii)
//
// BLOCKER (2026-10-09): the product, its prices and its calendar live ONLY on FareHarbor
//   (https://fareharbor.com/embeds/book/kitehi/items/49060/). fareharbor.com/robots.txt disallows
//   /embeds/book/, /embeds/api/ and /api/v1/ for all agents, so we never fetch it (no browser capture
//   either); FareHarbor's official API needs partner approval. kitehi.com has no downwinder page
//   (/lessons/, /downwinder/ 404; the "Lessons" menu links straight to FareHarbor).
// Data path:
//   content  kitehi.com /about/ (school + FareHarbor link) and /locations/ (North Shore beach guide, photos)
//   slots    the two products as constants (below), released only while kitehi.com still links its
//            FareHarbor "kitehi" booking flow (liveness check, 1 request). No dates, no inventory.
// robots.txt (2026-10-09): kitehi.com disallows only WooCommerce/admin paths; /about/ and /locations/ allowed.
// Requests per run: slots 1 (/about/), content 2 (/about/, /locations/).
// Known limits: prices/durations are NOT re-verified by us (source: research brief 2026-10-09 reading the
//   FareHarbor item page: "$350 Half Day / $650 Full Day"); availability is always 'on_request'; the
//   downwind route is not published, so itinerarySpots stays empty.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

export const KITEHI_ABOUT_URL = 'https://kitehi.com/about/';
export const KITEHI_LOCATIONS_URL = 'https://kitehi.com/locations/';
/** Human booking link (not fetched: robots.txt disallows /embeds/book/ for crawlers). */
export const KITEHI_BOOKING_URL = 'https://fareharbor.com/embeds/book/kitehi/items/49060/';

/**
 * Downwinder products per FareHarbor item 49060, as reported by the research brief of 2026-10-09
 * ("$350 Half Day / $650 Full Day", no online availability, "please call"). Not machine-readable for us.
 * Price basis assumed per person (inferred, the brief does not say) - confirm with Kite HI.
 */
const PRODUCTS: Array<{ key: string; unit: string; price: number }> = [
  { key: 'half-day', unit: 'Half day', price: 350 },
  { key: 'full-day', unit: 'Full day', price: 650 },
];
const CURRENCY = 'USD';

function textLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script,style,noscript,svg,header,footer,nav')) el.remove();
  return (root.querySelector('main') ?? root.querySelector('body') ?? root).structuredText
    .split('\n').map(s => collapse(s)).filter(Boolean);
}

// --- pure parsers ----------------------------------------------------------------------------
/** The FareHarbor booking flow linked from kitehi.com ("Get Lessons"), or null if the site dropped it. */
export function kitehiBookingLink(html: string): string | null {
  const m = html.match(/https:\/\/fareharbor\.com\/embeds\/book\/kitehi\/[^"'\s<>]*/);
  return m ? m[0].replace(/&#0?38;|&amp;/g, '&') : null;
}

/** The constant products, released only when the site still books through FareHarbor "kitehi". */
export function parseKitehiSlots(aboutHtml: string): Slot[] {
  if (!kitehiBookingLink(aboutHtml)) return [];
  return PRODUCTS.map(p => ({
    key: p.key,
    startDate: null,
    endDate: null,
    unit: p.unit,
    price: p.price,
    currency: CURRENCY,
    priceUnit: 'package',
    priceBasis: 'person',
    occupancy: null,
    availability: 'on_request',
    availabilityText: null,
    spotsLeft: null,
  }));
}

export function parseKitehiContent(aboutHtml: string, locationsHtml: string): OfferContent {
  const about = textLines(aboutHtml);
  const locations = textLines(locationsHtml);
  const aboutText = about.join('\n');
  const locText = locations.join('\n');
  const tagline = about.find(l => /Premiere Kiteboarding School/i.test(l)) ?? null;
  const ozone = /Official USA Distributor for Ozone/i.test(aboutText);
  const beaches = ['Kanaha', 'Kite Beach', 'Lanes', "Ho'okipa|Hookipa", 'Baldwin']
    .filter(b => new RegExp(b, 'i').test(locText)).map(b => b.split('|')[1] ?? b);

  const summary = [
    `A guided kitesurf downwinder on the North Shore of Maui with Kite HI, a Maui kiteboarding school and shop${ozone ? ' (official US distributor for Ozone kites)' : ''}, offered as a half day (USD 350) or a full day (USD 650).`,
    `Kite HI's beach guide${beaches.length ? ` covers ${beaches.length > 1 ? `${beaches.slice(0, -1).join(', ')} and ${beaches[beaches.length - 1]}` : beaches[0]}` : ''} and warns of reefs, waves and strong currents on this coast; it recommends hiring a Kite HI guide to learn the safe spots and etiquette.`,
    'Riders should already kite independently; booking and availability go through Kite HI by phone or its FareHarbor page.',
  ].join(' ');

  const images = [...imageCandidates(locationsHtml, KITEHI_LOCATIONS_URL, null, 60), ...imageCandidates(aboutHtml, KITEHI_ABOUT_URL, null, 20)]
    .filter(u => !/\.png$|logo|Screen-Shot|image-asset|mapnorthshore/i.test(u));

  return {
    kind: 'tour',
    title: 'Guided Kitesurf Downwinder, Maui North Shore',
    summary,
    continent: 'North America',
    country: 'United States',
    region: 'Hawaii',
    spot: 'North Shore, Maui',
    // Kanaha Beach Park; "North Shore, Maui" geocodes inland near Makawao
    spotCoords: { lat: 20.9005, lng: -156.4388 },
    itinerarySpots: [],           // route not published (FareHarbor only)
    durationDays: 1,
    skillLevels: ['intermediate', 'advanced'], // inferred: a downwinder needs independent riders
    kiteLessons: /lessons/i.test(aboutText),
    equipmentRental: null,
    beginnerFriendly: false,
    includedServices: ['Kite HI guide on the water'],
    optionalServices: [],
    accommodation: null,
    mealPlan: null,
    languages: ['en'],
    rooms: [],
    imageUrls: [...new Set(images)].slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KITEHI_ABOUT_URL,
    bookingUrl: KITEHI_BOOKING_URL,
    sourceText: [
      `products (constant, FareHarbor item 49060 per brief 2026-10-09): ${PRODUCTS.map(p => `${p.unit} ${CURRENCY} ${p.price}`).join('; ')}`,
      tagline ?? '',
      ...about,
      '--- locations ---',
      ...locations,
    ].join('\n'),
  };
}

export const kitehiMauiDownwinder: OfferAdapter = {
  key: 'kitehi-maui-downwinder',
  name: 'Kite HI guided kitesurf downwinder (Maui)',
  kind: 'tour',
  operator: {
    name: 'Kite HI',
    websiteUrl: 'https://kitehi.com',
    rootDomain: 'kitehi.com',
    phone: '+18082038684',
  },
  url: KITEHI_ABOUT_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  // prices are not readable live (FareHarbor is robots-blocked): mark the row as low confidence
  confidence: 'low',
  async fetchContent() {
    const about = await fetchText(KITEHI_ABOUT_URL);
    const locations = await fetchText(KITEHI_LOCATIONS_URL);
    return parseKitehiContent(about, locations);
  },
  async fetchSlots(ctx) {
    const about = await fetchText(KITEHI_ABOUT_URL);
    if (!kitehiBookingLink(about)) {
      throw new Error('kitehi: kitehi.com no longer links fareharbor.com/embeds/book/kitehi - the constant products may be stale, re-check by hand');
    }
    ctx.note('prices are constants from FareHarbor item 49060 (robots.txt blocks fareharbor.com/embeds/book/); no dates or inventory');
    return parseKitehiSlots(about);
  },
};
