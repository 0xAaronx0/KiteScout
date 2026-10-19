// ---------------------------------------------------------------------------
// Kite Republic - Brazil Kite Safari 2027 (10th Anniversary Edition): a 14-day guided kite safari by 4x4 along
// Brazil's north-east coast, moving every 2-3 days: Ilha do Guajiru - Tatajuba - Arpoador - Macapa - Prea, with
// downwinders (10-30 km), lagoon sessions, skills clinics, breakfast + beach lunches. KIND = 'tour'.
//
// Data path (checked 2026-10-19): WordPress + WooCommerce variable product, one page (shared parser in
// kite-republic-aitutaki-winter-escape.ts): https://www.kiterepublic.com.au/product/kr-brazil-kite-adventure/
//   slots    the add-to-cart form's own variation data (`data-product_variations`): attribute "Options" =
//            "Twin share (per person)" / "Private room (per person)" / "Deposit Only"; no date attribute, the one
//            departure comes from the description ("TOUR DATES: 22nd August to 4th September 2027").
//            One slot per room option (deposit skipped), AUD from the Product JSON-LD `priceCurrency`.
//   content  the description (route line, inclusions, requirements) + gallery.
// The conflicting figures (2026-10-19) and how they resolve:
//   - price range "$1,000.00 - $6,150.00" / JSON-LD AggregateOffer 1000-6150 = deposit .. private room (sale)
//   - "COST: Cost $5600" in the description = the twin-share REGULAR price; the shop sells twin share at the
//     early-bird sale price 4,950 (display_regular_price 5,600) and the private room at 6,150 (regular 6,800)
//   -> slots: twin share AUD 4,950 pp, private room AUD 6,150 pp (early bird; the regular price is in
//      availabilityText). No early-bird deadline is printed -> priceValidUntil null.
// Route: the page's "Brazil 2027 Route:" line (read live, so next year's order follows the page). Fortaleza is
//   prepended as the arrival point: INFERRED, the page says only "Airport Pickup and drop-off" without naming the
//   airport (Fortaleza is the international gateway for Ilha do Guajiru, the first stop).
//   Arpoador = the lagoons near Tutoia / the Parnaiba delta (Maranhao), as in the KiteActive / Ventus adapters;
//   "Macapa" = Praia de Macapa, Luis Correia (Piaui), as in the 35 Knots adapter.
// Duration: 22 Aug - 4 Sep = 14 days (the page also says "14 nights accommodation", which those dates do not
//   allow; durationDays follows the dates).
// Availability: `is_in_stock` per room option (live shop stock), the page's "SOLD 40%" bar in availabilityText.
// robots.txt (2026-10-19): WooCommerce defaults + /wp-json/ disallowed; product pages allowed.
// Requests per run: 1 (memoised for content + slots).
// ---------------------------------------------------------------------------
import { daysInclusive, todayIso } from '../parse.js';
import type { ItinerarySpot, OfferAdapter, OfferContent, Slot } from '../types.js';
import {
  KR_OPERATOR, KR_SITE, buildKrSlots, memoPage, parseKrTour, unEmoji, wooOptionLabels, wpImages, type KrTour,
} from './kite-republic-aitutaki-winter-escape.js';

export const KR_BRAZIL_URL = `${KR_SITE}/product/kr-brazil-kite-adventure/`;

/** Option slug -> room unit; null for payment-only options. Labels come from the dropdown ("Twin share (per person)"). */
function brazilUnitOf(labels: Map<string, string>): (option: string) => string | null {
  return option => {
    if (!option || /deposit/i.test(option)) return null;
    const label = (labels.get(option) ?? option.replace(/-/g, ' ')).replace(/\(per person\)|per person/i, '').trim();
    return label ? label.charAt(0).toUpperCase() + label.slice(1).toLowerCase() : null;
  };
}

export function parseKrBrazilSlots(html: string, today = todayIso()): Slot[] {
  return buildKrSlots(parseKrTour(html), today, brazilUnitOf(wooOptionLabels(html, 'pa_options')));
}

const REGION: Array<[RegExp, string]> = [
  [/arpoador|tut[oó]ia|atins/i, 'Maranhão'],
  [/macap[aá]|parna[ií]ba|luis correia|luís correia/i, 'Piauí'],
];
const STOP_NAME: Record<string, string> = { 'macapá': 'Praia de Macapá', macapa: 'Praia de Macapá' };

/** "Brazil 2027 Route: Ilha do Guajiru - Tatajuba - Arpoador - Macapá - Preá" -> stops in order. */
export function parseKrBrazilRoute(t: KrTour): string[] {
  const line = t.lines.find(l => /Route:/i.test(l));
  if (!line) return [];
  return unEmoji(line.replace(/^.*?Route:\s*/i, '')).split(/\s+-\s+|\s*[\u2013\u2014]\s*/).map(s => s.trim()).filter(Boolean);
}

export function krBrazilItinerary(route: string[]): ItinerarySpot[] {
  const stops = ['Fortaleza', ...route.filter(r => !/fortaleza/i.test(r))];
  return stops.map((name, i) => {
    const n = STOP_NAME[name.toLowerCase()] ?? name;
    return { name: n, country: 'Brazil', region: REGION.find(([re]) => re.test(n))?.[1] ?? 'Ceará', order: i + 1 };
  });
}

export function parseKrBrazilContent(html: string): OfferContent {
  const t = parseKrTour(html);
  const d = t.dates[0];
  if (!d) throw new Error('kite-republic-brazil: no "TOUR DATES:" line (layout changed?)');
  const year = d.start.slice(0, 4);
  const days = daysInclusive(d.start, d.end);
  const route = parseKrBrazilRoute(t);
  if (!route.length) throw new Error('kite-republic-brazil: no "Route:" line (layout changed?)');
  const slots = buildKrSlots(t, '0000-00-00', brazilUnitOf(wooOptionLabels(html, 'pa_options')));
  const cur = t.currency ?? 'AUD';
  const fmt = (n: number | null | undefined): string => (n == null ? '?' : n.toLocaleString('en-US'));
  const twin = slots.find(s => /twin/i.test(s.unit ?? ''));
  const priv = slots.find(s => /private/i.test(s.unit ?? ''));
  const text = t.lines.join('\n');
  const groupMax = text.match(/max\s*(\d+)\s*pp/i)?.[1] ?? null;
  const cost = text.match(/Cost \$\s?([\d,]+)/i)?.[1]?.replace(/,/g, '') ?? null;
  const flights = text.match(/Flights \(not included\):\s*([^\n]+)/i)?.[1] ?? null;
  const includeBlock = (() => {
    const i = t.lines.findIndex(l => /^WHAT IS INCLUDED/i.test(l));
    const j = t.lines.findIndex((l, k) => k > i && /^NEW FOR|^Optional Add-on/i.test(l));
    return i >= 0 ? t.lines.slice(i + 1, j > i ? j : i + 16) : [];
  })();
  const keep = includeBlock.map(unEmoji)
    .filter(l => /accommodation|breakfast|dinner|bottled water|airport|4x4|kiting adventures|downwinders|support|clinics|jericoacoara/i.test(l)
      && !/let us surprise|we will visit/i.test(l));

  const summary = [
    `Kite Republic's Brazil Kite Safari is a ${days}-day guided kite trip by 4x4 along Brazil's north-east coast (${route.join(', ')}), changing accommodation every two to three days${groupMax ? ` in a group of at most ${groupMax}` : ''}.`,
    'Days are planned around wind and tide: flat-water lagoons, river mouths, small waves and 10-30 km downwinders with vehicle support, skills clinics, breakfast and beach lunches, two special dinners and a visit to Jericoacoara.',
    `The ${year} departure runs ${d.start} to ${d.end}; riders should ride upwind with solid kite control.`,
    `Early-bird prices are ${cur} ${fmt(twin?.price)} per person in a twin share${cost ? ` (regular ${cur} ${Number(cost).toLocaleString('en-US')})` : ''} and ${cur} ${fmt(priv?.price)} in a private room; flights are extra.`,
  ].join(' ');

  return {
    kind: 'tour',
    title: `Kite Republic Brazil Kite Safari ${year}`,
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Ceará',
    spot: 'Fortaleza',
    itinerarySpots: krBrazilItinerary(route),
    durationDays: days,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: true,             // skills clinics during the tour
    equipmentRental: null,
    beginnerFriendly: false,
    includedServices: keep.length ? keep : ['Twin-share accommodation', 'Breakfast and beach lunches', '4x4 transport', 'Guided downwinders'],
    optionalServices: [
      "Phil's Downwinder Special: 5-day pre-tour downwinder challenge (50-80 km runs)",
      'Parnaíba Delta downwinder with boat ride (extra cost)',
      'Private room',
    ],
    accommodation: 'pousadas in 5 locations along the route, twin share (private room on request)',
    mealPlan: 'breakfast and lunch on beach days',
    languages: ['en'],
    rooms: [],
    imageUrls: wpImages(html, KR_BRAZIL_URL, /Aitutaki|Mauritius/i).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KR_BRAZIL_URL,
    bookingUrl: KR_BRAZIL_URL,
    sourceText: [
      text,
      `parsed: ${d.start}..${d.end}; route ${route.join(' > ')}; variations ${t.variations.map(v => `${Object.values(v.attributes).join('/')}=${v.price} (regular ${v.regularPrice})${v.inStock ? '' : ' out of stock'}`).join(', ')}; currency ${t.currency}; flights ${flights ?? '?'}`,
    ].join('\n'),
  };
}

export async function fetchKrBrazilSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const html = await memoPage(KR_BRAZIL_URL);
  const t = parseKrTour(html);
  if (!t.variations.length) throw new Error('kite-republic-brazil: no variation data on the product page (layout changed?)');
  if (!t.dates.length) throw new Error('kite-republic-brazil: no "TOUR DATES:" line (layout changed?)');
  if (!t.currency) ctx?.note('no priceCurrency in the Product JSON-LD');
  const slots = buildKrSlots(t, today, brazilUnitOf(wooOptionLabels(html, 'pa_options')));
  if (!slots.length) ctx?.note(`the departure ${t.dates[0].start} is past; no new date on the page yet`);
  return slots;
}

export const kiteRepublicBrazilKiteSafari: OfferAdapter = {
  key: 'kite-republic-brazil-kite-safari',
  name: 'Kite Republic Brazil Kite Safari',
  kind: 'tour',
  operator: KR_OPERATOR,
  url: KR_BRAZIL_URL,
  slotMethod: 'booking_engine',
  liveAvailability: true,          // WooCommerce stock per room option of the shop's own product, read every run
  instantBooking: true,            // add to cart + checkout on the shop
  fetchBudget: 2,
  async fetchContent() {
    return parseKrBrazilContent(await memoPage(KR_BRAZIL_URL));
  },
  fetchSlots: ctx => fetchKrBrazilSlots(todayIso(), ctx),
};
