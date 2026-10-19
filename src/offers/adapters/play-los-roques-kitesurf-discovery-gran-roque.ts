// ---------------------------------------------------------------------------
// Play Los Roques - Kitesurfing Discovery, Gran Roque (Los Roques Archipelago, Venezuela): a 3-day / 2-night learn-to-
// kite package at Posada Casa Play with meals, daily transfer to the Saki-Saki kite spot and a 6-hour kite lesson
// package (9 h optional). Kind 'camp' (one base, stay + lessons). Shared helpers from the ADVANCED camp adapter.
//
// Data path (checked 2026-10-19), Wix page /travel-with-us ("Packages" cards):
//   slots    "kitesurfing DISCOVERY | 3 days - 2 nights + 6h kite lesson | ... | $999 on weekdays | $1149 on weekENDs |
//            *Packages are per person double occupancy and do not include airfare* | Additional references: |
//            REF 1168–1248 – Single occupancy | REF 398–458 – Non-kiter companion". Undated (any dates on request):
//            double weekday / double weekend slots, plus a single-occupancy slot at the lower REF figure (the range
//            is read as weekday-weekend, INFERRED; the page does not say). Currency "$" / "REF" = the site's own Wix
//            currency setting "USD". Per person (package), availability on_request ("chat with us"),
//            instantBooking false. Airfare is not included (unlike the ADVANCED camps).
//   content  /travel-with-us (package card) + the ADVANCED camp page's kite photos (same school, same posada).
// robots.txt (2026-10-19): "User-agent: * Allow: /". Requests per run: 2 (both pages memoised).
// ---------------------------------------------------------------------------
import { imageCandidates, parseAmount } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';
import { PLR_ADVANCED_URL, PLR_OPERATOR, PLR_REGION, PLR_SITE, plrCoords, plrCurrency, plrPage, plrText } from './play-los-roques-advanced-kite-camp-gran-roque.js';

export const PLR_TRAVEL_URL = `${PLR_SITE}/travel-with-us`;

export interface PlrDiscovery {
  days: number | null; nights: number | null; hours: number | null;
  weekday: number | null; weekend: number | null;
  single: [number, number] | null; nonKiter: [number, number] | null;
}

export function parsePlrDiscovery(html: string): PlrDiscovery | null {
  const t = plrText(html);
  const start = t.search(/kitesurfing DISCOVERY/i);
  if (start < 0) return null;
  const rest = t.slice(start);
  const end = rest.slice(20).search(/chat with us/i);
  const card = end >= 0 ? rest.slice(0, end + 20) : rest.slice(0, 1500);
  const dur = card.match(/(\d+)\s*days?\s*-\s*(\d+)\s*nights?\s*\+\s*(\d+)\s*h/i);
  const amt = (re: RegExp) => { const m = card.match(re); return m ? parseAmount(m[1]) : null; };
  const range = (re: RegExp): [number, number] | null => {
    const m = card.match(re);
    return m && parseAmount(m[1]) && parseAmount(m[2]) ? [parseAmount(m[1])!, parseAmount(m[2])!] : null;
  };
  return {
    days: dur ? +dur[1] : null, nights: dur ? +dur[2] : null, hours: dur ? +dur[3] : null,
    weekday: amt(/\$\s?([\d.,]+)\s*on weekdays/i),
    weekend: amt(/\$\s?([\d.,]+)\s*on weekends/i),
    single: range(/REF\s*([\d.,]+)\s*-\s*([\d.,]+)\s*-\s*Single/i),
    nonKiter: range(/REF\s*([\d.,]+)\s*-\s*([\d.,]+)\s*-\s*Non-kiter/i),
  };
}

export function buildPlrDiscoverySlots(d: PlrDiscovery, currency: string): Slot[] {
  const base = {
    startDate: null, endDate: null, currency, priceUnit: 'package' as const, priceBasis: 'person' as const,
    availability: 'on_request' as const, spotsLeft: null, packageNights: d.nights,
  };
  const out: Slot[] = [];
  if (d.weekday) out.push({ ...base, key: 'double-weekday', unit: 'Double occupancy, weekdays', price: d.weekday, occupancy: 2, availabilityText: `$${d.weekday} on weekdays, per person double occupancy, airfare not included` });
  if (d.weekend) out.push({ ...base, key: 'double-weekend', unit: 'Double occupancy, weekends', price: d.weekend, occupancy: 2, availabilityText: `$${d.weekend} on weekends, per person double occupancy, airfare not included` });
  if (d.single) out.push({ ...base, key: 'single', unit: 'Single occupancy', price: d.single[0], occupancy: 1, availabilityText: `REF ${d.single[0]}-${d.single[1]} single occupancy` });
  return out;
}

export function parsePlrDiscoveryContent(travelHtml: string, advancedHtml: string | null): OfferContent {
  const d = parsePlrDiscovery(travelHtml);
  const cur = plrCurrency(travelHtml);
  const nights = d?.nights ?? 2;
  const hours = d?.hours ?? 6;
  const imgs: string[] = [];
  for (const u of [...imageCandidates(travelHtml, PLR_TRAVEL_URL, null, 20), ...(advancedHtml ? imageCandidates(advancedHtml, PLR_ADVANCED_URL, null, 30) : [])]) {
    if (!/logo|icon/i.test(u) && !imgs.includes(u)) imgs.push(u);
  }
  const prices = d ? [d.weekday, d.weekend].filter((x): x is number => !!x) : [];
  return {
    kind: 'camp',
    title: 'Play Los Roques Kitesurfing Discovery',
    summary: [
      `A learn-to-kite short break on Gran Roque in the Los Roques Archipelago, Venezuela: ${nights + 1} days / ${nights} nights at Posada Casa Play (air-conditioned room, private bathroom) with meals, daily boat transfer to the Saki-Saki kite spot and a ${hours}-hour kitesurfing lesson package (9 hours optional).`,
      prices.length ? `${[d?.weekday ? `${cur} ${d.weekday} on weekdays` : null, d?.weekend ? `${cur} ${d.weekend} on weekends` : null].filter(Boolean).join(', ')} per person in a double room${d?.single ? `; single occupancy ${cur} ${d.single[0]}-${d.single[1]}` : ''}; any dates on request, flights to Los Roques not included.` : 'Any dates on request; flights to Los Roques not included.',
    ].join(' '),
    continent: 'South America',
    country: 'Venezuela',
    region: PLR_REGION,
    spot: 'Gran Roque',
    spotCoords: plrCoords(travelHtml),
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner'],
    kiteLessons: true,
    equipmentRental: null,
    beginnerFriendly: true,
    includedServices: [
      'Welcome and farewell at the Gran Roque airstrip',
      `${nights} nights at Posada Casa Play (air conditioning, private bathroom)`,
      'Meals (except breakfast on the arrival day), cooler lunch on the departure day',
      'Daily boat transfer to Saki-Saki',
      `${hours} hours of kitesurfing lessons`,
    ],
    optionalServices: [
      '9-hour lesson package instead of 6',
      d?.nonKiter ? `Non-kiter companion (${cur} ${d.nonKiter[0]}-${d.nonKiter[1]})` : 'Non-kiter companion',
      'Flights Caracas - Los Roques (arranged by Play Los Roques)',
    ],
    accommodation: 'posada (Posada Casa Play, Gran Roque)',
    mealPlan: 'full_board',
    languages: ['es', 'en'],
    rooms: [],
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: PLR_TRAVEL_URL,
    bookingUrl: PLR_TRAVEL_URL,
    sourceText: [
      `travel-with-us: ${plrText(travelHtml)}`,
      `parsed: ${JSON.stringify(d)}; currency ${cur}`,
    ].join('\n'),
  };
}

export async function fetchPlrDiscoverySlots(): Promise<Slot[]> {
  const html = await plrPage(PLR_TRAVEL_URL);
  const d = parsePlrDiscovery(html);
  if (!d || (!d.weekday && !d.weekend)) throw new Error('play-los-roques discovery: "kitesurfing DISCOVERY" card or its "$… on weekdays" price not found (layout changed?)');
  return buildPlrDiscoverySlots(d, plrCurrency(html));
}

export const playLosRoquesKitesurfDiscoveryGranRoque: OfferAdapter = {
  key: 'play-los-roques-kitesurf-discovery-gran-roque',
  name: 'Play Los Roques Kitesurfing Discovery, Gran Roque',
  kind: 'camp',
  operator: PLR_OPERATOR,
  url: PLR_TRAVEL_URL,
  slotMethod: 'price_table',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 3,
  async fetchContent() {
    const travel = await plrPage(PLR_TRAVEL_URL);
    let advanced: string | null = null;
    try { advanced = await plrPage(PLR_ADVANCED_URL); } catch { /* photos only */ }
    return parsePlrDiscoveryContent(travel, advanced);
  },
  fetchSlots: () => fetchPlrDiscoverySlots(),
};
