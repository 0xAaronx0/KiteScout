// ---------------------------------------------------------------------------
// Road 2 Adventure - Kite Safari Perth to Exmouth (Western Australia): a guided kite road trip in the company's
// "hostel on wheels" bus up the coast, Perth - Lancelin - Coronation Beach - Shark Bay (Secret Spot, Spot X) -
// Gnaraloo - Exmouth (Sandy Bay, Winderabandi Point, Graveyards downwinder), camping on the beach; 9 days one way
// or 14 days return via Carnarvon and Geraldton. KIND = 'tour'.
//
// Data path (checked 2026-10-19): WordPress + WooCommerce variable product, one page:
//   https://www.road2adventure.com.au/tours/kite-safari/
//   slots    the add-to-cart form's own variation data (`data-product_variations`, shared WooCommerce helper in
//            kite-republic-aitutaki-winter-escape.ts): attribute "Route" (perth-to-exmouth / perth-exmouth-perth)
//            x "Dates" (slugs; labels from the dropdown, e.g. "10 - 18 Jan 2026 (One Way)"), display_price,
//            is_in_stock + the shop's stock words ("Bookings available"). One slot per future departure x route,
//            AUD per booking (the form's quantity is "Amount of Bookings" -> priceBasis 'person', inferred).
//            Currency AUD: the shop's analytics config (`currency = 'AUD'`, Site Kit wcdata) - the page prints "$" only.
//   content  the same page: day-by-day itinerary, prices "$2,200" one way / "$2,800" return, "$1000 Deposit".
// State 2026-10-19: the dropdown lists only Dec 2025 and Jan 2026 departures, all past -> 0 slots ("price on
//   request"); the parser reads whatever departures the shop lists, so new dates appear without a code change.
//   The summary says the next dates are not published yet.
// Flags: departures, prices and stock come from the shop's own variation data on every run (liveAvailability);
//   the shop books online (date + route, add to cart, card / PayPal checkout) -> instantBooking.
// robots.txt (2026-10-19): WooCommerce defaults; Yoast group allows everything else.
// Requests per run: 1 (memoised for content + slots).
// durationDays = 9 (the Perth to Exmouth one-way trip the listing is named after; the return trip is 14 days).
// ---------------------------------------------------------------------------
import { clean, daysInclusive, parseAmount, parseRange, todayIso } from '../parse.js';
import type { Availability, ItinerarySpot, OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';
import { memoPage, parseWooVariations, wooOptionLabels, wpImages, wpLines, type WooVariation } from './kite-republic-aitutaki-winter-escape.js';

export const R2A_SITE = 'https://www.road2adventure.com.au';
export const R2A_KITE_SAFARI_URL = `${R2A_SITE}/tours/kite-safari/`;

export const R2A_OPERATOR: OperatorRef = {
  name: 'Road 2 Adventure',
  websiteUrl: R2A_SITE,
  rootDomain: 'road2adventure.com.au',
};

export interface R2aDeparture {
  start: string;
  end: string;
  label: string;
  route: string;
  routeLabel: string;
  variation: WooVariation;
}

/** The shop currency from the page's analytics config (`currency = 'AUD'` / wcdata.currency); null if absent. */
export function r2aCurrency(html: string): string | null {
  return html.match(/\bcurrency\s*=\s*["']([A-Z]{3})["']/)?.[1] ?? html.match(/"currency":"([A-Z]{3})"/)?.[1] ?? null;
}

export function parseR2aDepartures(html: string): R2aDeparture[] {
  const dates = wooOptionLabels(html, 'pa_dates');
  const routes = wooOptionLabels(html, 'pa_route');
  const out: R2aDeparture[] = [];
  for (const v of parseWooVariations(html)) {
    const d = v.attributes['pa_dates'];
    const r = v.attributes['pa_route'];
    if (!d) continue;
    const label = dates.get(d) ?? d.replace(/-/g, ' ');
    const range = parseRange(label.replace(/\(.*?\)/g, ''));
    if (!range) continue;
    out.push({ ...range, label, route: r ?? '', routeLabel: routes.get(r ?? '') ?? r ?? '', variation: v });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.route.localeCompare(b.route));
}

const routeUnit = (d: R2aDeparture): string =>
  /perth.*exmouth.*perth|return/i.test(d.route + ' ' + d.label) ? 'Perth - Exmouth - Perth (return, 14 days)' : 'Perth to Exmouth (one way, 9 days)';

export function buildR2aSlots(deps: R2aDeparture[], currency: string | null, today: string): Slot[] {
  return deps.filter(d => d.start >= today && d.variation.price !== null).map(d => {
    const v = d.variation;
    const availability: Availability = !v.inStock || !v.purchasable ? 'sold_out' : 'available';
    return {
      key: `${d.start}|${/return/i.test(routeUnit(d)) ? 'return' : 'one-way'}`,
      startDate: d.start,
      endDate: d.end,
      unit: routeUnit(d),
      price: v.price,
      currency,
      priceUnit: 'package',
      priceBasis: 'person',
      occupancy: null,
      availability,
      availabilityText: v.stockText ?? (v.inStock ? 'In stock in the online shop' : 'Out of stock'),
      spotsLeft: null,
    } satisfies Slot;
  });
}

const ROUTE = ['Perth', 'Lancelin', 'Coronation Beach', 'Shark Bay', 'Gnaraloo', 'Exmouth'];

export function r2aItinerary(): ItinerarySpot[] {
  return ROUTE.map((name, i) => ({ name, country: 'Australia', region: 'Western Australia', order: i + 1 }));
}

export function parseR2aContent(html: string, today = todayIso()): OfferContent {
  const lines = wpLines(html);
  const text = lines.join('\n');
  const deps = parseR2aDepartures(html);
  const oneWay = text.match(/Perth\s*\u2192\s*Exmouth \(one way\)\s*[\u2013\u2014-]\s*\$\s?([\d,]+)/i)?.[1] ?? null;
  const ret = text.match(/Perth\s*\u2192\s*Exmouth \(return\)\s*[\u2013\u2014-]\s*\$\s?([\d,]+)/i)?.[1] ?? null;
  const deposit = text.match(/\$\s?([\d,]+)\s*Deposit/i)?.[1] ?? null;
  if (!oneWay && !deps.length) throw new Error('road2adventure: neither the "Perth -> Exmouth (one way)" price nor departures found (layout changed?)');
  const future = deps.filter(d => d.start >= today);
  const months = (list: R2aDeparture[]): string => [...new Set(list.map(d => new Date(`${d.start}T00:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })))].join(' and ');
  const cur = r2aCurrency(html) ?? 'AUD';
  const amt = (s: string | null): string => (s ? (parseAmount(s) ?? 0).toLocaleString('en-US') : '?');
  const oneWayDays = deps.find(d => !/return/i.test(routeUnit(d)));

  const summary = [
    "Road 2 Adventure's Kite Safari is a guided kitesurf road trip up the Western Australian coast in the company's converted bus, camping close to the spots: Lancelin, Coronation Beach, two 4WD days at Shark Bay's Secret Spot and Spot X, the Gnaraloo wave, and Exmouth's Sandy Bay, Winderabandi Point and a Graveyards downwinder.",
    'It runs in the summer sea-breeze season (typically 15-20 knots) for freestyle, wave and freeride kiters, with the daily plan adjusted to the forecast.',
    future.length
      ? `Next departures: ${months(future)}.`
      : `Runs every summer; the next dates are not published yet (last: ${deps.length ? months(deps) : 'not listed'}).`,
    `Prices are ${cur} ${amt(oneWay)} for the 9-day trip Perth to Exmouth (one way) and ${cur} ${amt(ret)} for the 14-day return trip, with a ${cur} ${amt(deposit)} deposit.`,
  ].join(' ');

  return {
    kind: 'tour',
    title: 'Road 2 Adventure Kite Safari Perth to Exmouth',
    summary,
    continent: 'Oceania',
    country: 'Australia',
    region: 'Western Australia',
    spot: 'Perth',
    itinerarySpots: r2aItinerary(),
    durationDays: oneWayDays ? daysInclusive(oneWayDays.start, oneWayDays.end) : 9,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: false,
    equipmentRental: null,
    beginnerFriendly: false,
    includedServices: [
      'Transport in the "hostel on wheels" bus from Perth (Langley Park pick-up)',
      'Camping / sleeping on the bus along the route',
      'Guiding to the kite spots, 4WD days to Shark Bay Secret Spot, Spot X and Winderabandi Point',
    ],
    optionalServices: ['14-day return trip back to Perth via Carnarvon and Geraldton', 'KiteWest rental gear at Coronation Beach'],
    accommodation: 'camping with the bus ("hostel on wheels")',
    mealPlan: null,
    languages: ['en'],
    rooms: [],
    imageUrls: wpImages(html, R2A_KITE_SAFARI_URL, /unnamed|payment|visa|mastercard|paypal/i).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: R2A_KITE_SAFARI_URL,
    bookingUrl: R2A_KITE_SAFARI_URL,
    sourceText: [
      text,
      `parsed: departures ${deps.map(d => `${d.start}..${d.end} ${d.route}=${d.variation.price}${d.variation.inStock ? '' : ' (out of stock)'}`).join(', ')}; currency ${r2aCurrency(html)}; dropdown ${clean([...wooOptionLabels(html, 'pa_dates').values()].join(' | '))}`,
    ].join('\n'),
  };
}

export async function fetchR2aSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const html = await memoPage(R2A_KITE_SAFARI_URL);
  const deps = parseR2aDepartures(html);
  if (!parseWooVariations(html).length) throw new Error('road2adventure: no variation data on the page (layout changed?)');
  const currency = r2aCurrency(html);
  if (!currency) ctx?.note('no shop currency found on the page');
  const slots = buildR2aSlots(deps, currency, today);
  const past = deps.filter(d => d.start < today);
  if (past.length) ctx?.note(`${past.length} past departure(s) dropped (${[...new Set(past.map(d => d.start))].join(', ')})`);
  return slots;
}

export const road2adventureKiteSafariPerthExmouth: OfferAdapter = {
  key: 'road2adventure-kite-safari-perth-exmouth',
  name: 'Road 2 Adventure Kite Safari Perth to Exmouth',
  kind: 'tour',
  operator: R2A_OPERATOR,
  url: R2A_KITE_SAFARI_URL,
  slotMethod: 'booking_engine',
  liveAvailability: true,          // per-departure WooCommerce stock of the shop's own product, read every run
  instantBooking: true,            // departure + route, add to cart, card / PayPal checkout
  fetchBudget: 2,
  async fetchContent() {
    return parseR2aContent(await memoPage(R2A_KITE_SAFARI_URL));
  },
  fetchSlots: ctx => fetchR2aSlots(todayIso(), ctx),
};
