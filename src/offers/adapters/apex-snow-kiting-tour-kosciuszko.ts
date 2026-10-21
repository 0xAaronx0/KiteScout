// ---------------------------------------------------------------------------
// Apex Kitesurfing (Yamba / Coffs Harbour kite school) - 5 Day Snow Kiting Tour, Kosciuszko National Park (New South
// Wales): a guided backcountry snowkite trip in the Snowy Mountains: pick-up at Canberra Airport, twin-share
// accommodation in Jindabyne, daily alpine / over-snow transport to Thredbo (North Rams Head) and Charlotte Pass
// (snowcat day to the "Splenda" zone), lift passes and backcountry permits, avalanche safety gear, KA-certified
// instruction, dinners out in Jindabyne. Moves between resorts from a Jindabyne base -> KIND = 'tour' with the
// route Canberra - Jindabyne - Thredbo - Charlotte Pass as itinerarySpots.
//
// Data path (checked 2026-10-19): Wix site, two pages:
//   /snow-kiting-tours        tour description, the day-by-day itinerary (Day 1 - Day 6) and "2027 dates releasing
//                             soon". The slot parser reads any short dated line of this page (a range with a year,
//                             e.g. "12 - 17 July 2027"), so new dates appear without a code change; past dates are
//                             dropped. Today: no dates -> [] (price on request), the summary says 2027 dates are not
//                             published yet.
//   /service-page/5-day-snow-kiting-tour-charlotte-pass   the Wix Bookings service: "A$9,850" ("9,850 Australian
//                             dollars"), inclusions, "This service is currently booked out" (the 2026 tour). The price
//                             does not say per person or per group -> slots carry priceBasis null; the summary
//                             quotes it as printed. The Wix Bookings availability API needs the site's signed
//                             instance token -> not used (engine rules); availability of dated slots = 'unknown'.
// Known conflict (2026-10-19): the service is named "5 Day", the tour page's itinerary runs Day 1 - Day 6 (arrival
//   and departure days included) and calls it "a 6-day ... expedition" -> durationDays 6.
// robots.txt (2026-10-19): disallows only "?lightbox=", /under-construction, /payment-request-page.
// Requests per run: content 2 (tours page + service page), slots 1 (tours page, memoised in the same run).
// Flags: liveAvailability / instantBooking unset (no inventory read; whether the Wix service takes paid bookings
//   for a dated session cannot be seen while it is booked out).
// spotCoords: none for the tour (the site's LocalBusiness geo is the Coffs Harbour school address, not used).
// ---------------------------------------------------------------------------
import { parse, parseAmount, parseRange, todayIso } from '../parse.js';
import type { ItinerarySpot, OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';
import { memoPage, wpLines } from './kite-republic-aitutaki-winter-escape.js';

export const APEX_SITE = 'https://www.apexkitesurfing.com.au';
export const APEX_TOURS_URL = `${APEX_SITE}/snow-kiting-tours`;
export const APEX_SERVICE_URL = `${APEX_SITE}/service-page/5-day-snow-kiting-tour-charlotte-pass`;

export const APEX_OPERATOR: OperatorRef = {
  name: 'Apex Kitesurfing',
  websiteUrl: APEX_SITE,
  rootDomain: 'apexkitesurfing.com.au',
  contactEmail: 'apexkitesurfing@gmail.com', // the address the site prints
};

export const APEX_ROUTE: ItinerarySpot[] = [
  { name: 'Canberra', country: 'Australia', region: 'Australian Capital Territory', order: 1 },
  { name: 'Jindabyne', country: 'Australia', region: 'Snowy Mountains, New South Wales', order: 2 },
  { name: 'Thredbo', country: 'Australia', region: 'Snowy Mountains, New South Wales', order: 3 },
  { name: 'Charlotte Pass', country: 'Australia', region: 'Snowy Mountains, New South Wales', order: 4 },
];

export interface ApexDate { start: string; end: string; label: string }
export interface ApexTour { dates: ApexDate[]; datesNote: string | null; days: string[]; lines: string[] }
export interface ApexService { price: number | null; currency: string | null; bookedOut: boolean; description: string }

/** Tours page: dated lines (any short range with a year), the "<year> dates releasing soon" note, the Day 1..n lines. */
export function parseApexTour(html: string): ApexTour {
  const lines = wpLines(html);
  const dates: ApexDate[] = [];
  for (const raw of lines) {
    const l = raw.replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1');
    if (l.length > 50 || !/\b20\d{2}\b/.test(l) || !/\d{1,2}\s*[-–]/.test(l) || /releas|soon|TBA|TBC/i.test(l)) continue;
    const r = parseRange(l);
    if (r && !dates.some(d => d.start === r.start)) dates.push({ ...r, label: raw });
  }
  return {
    dates: dates.sort((a, b) => a.start.localeCompare(b.start)),
    datesNote: lines.find(l => /^20\d{2} dates/i.test(l)) ?? null,
    days: lines.filter(l => /^Day \d+:/i.test(l)),
    lines,
  };
}

/** Service page: "A$9,850", the booked-out notice, the description paragraph. */
export function parseApexService(html: string): ApexService {
  const lines = wpLines(html);
  const priceLine = lines.find(l => /^A\$\s?[\d,]+/.test(l)) ?? null;
  const d = lines.findIndex(l => /^Description$/i.test(l));
  return {
    price: priceLine ? parseAmount(priceLine) : null,
    currency: priceLine || lines.some(l => /Australian dollars/i.test(l)) ? 'AUD' : null,
    bookedOut: lines.some(l => /currently booked out/i.test(l)),
    description: d >= 0 ? lines.slice(d + 1).filter(l => !/^bottom of page$/i.test(l)).join(' ') : '',
  };
}

export function buildApexSlots(t: ApexTour, s: ApexService | null, today: string): Slot[] {
  return t.dates.filter(d => d.start >= today).map(d => ({
    key: d.start,
    startDate: d.start,
    endDate: d.end,
    unit: 'Twin-share accommodation in Jindabyne',
    price: s?.price ?? null,
    currency: s?.price ? s.currency ?? 'AUD' : null,
    priceUnit: s?.price ? 'package' : null,
    priceBasis: null, // "A$9,850" without per person / per group
    occupancy: null,
    availability: 'unknown',
    availabilityText: s?.price ? `A$${s.price.toLocaleString('en-US')} as printed on the booking page (per person or per group not stated)` : null,
    spotsLeft: null,
  }));
}

export interface ApexPages { tours: string; service: string | null }

export function parseApexContent(p: ApexPages, today = todayIso()): OfferContent {
  const t = parseApexTour(p.tours);
  if (t.days.length < 3) throw new Error('apex-snowkite: day-by-day itinerary not found (layout changed?)');
  const s = p.service ? parseApexService(p.service) : null;
  const future = t.dates.filter(d => d.start >= today);
  const nDays = t.days.length;
  const gearIdx = t.lines.findIndex(l => /^Want to Try the Latest/i.test(l));
  const year = t.datesNote?.match(/20\d{2}/)?.[0] ?? null;
  const datesText = future.length
    ? `Tour dates: ${future.map(d => `${d.start} to ${d.end}`).join(', ')}`
    : `Runs in the Australian winter; ${year ? `the ${year} dates are` : 'the next dates are'} not published yet${s?.bookedOut ? ' (the booking page shows the service as booked out)' : ''}`;

  const summary = [
    `Apex Kitesurfing runs a ${nDays}-day backcountry snowkite tour in Kosciuszko National Park in the Snowy Mountains of New South Wales, sold as the "5 Day Snow Kiting Tour": pick-up at Canberra Airport, twin-share accommodation in Jindabyne and daily alpine and over-snow transport to the Thredbo and Charlotte Pass backcountry.`,
    'The route covers North Rams Head and the Main Range above Thredbo and a dawn snowcat trip into the Charlotte Pass backcountry; lift passes, backcountry permits, avalanche safety gear (beacon, shovel), KA-certified instruction and an Apex outer shell jacket are included, with dinners out in Jindabyne.',
    'Riders need ski or snowboard experience; the tour is not for people with recent shoulder, back or severe knee injuries.',
    `${datesText}.${s?.price ? ` The booking page prints A$${s.price.toLocaleString('en-US')} for the tour.` : ''}`,
  ].join(' ');

  return {
    kind: 'tour',
    title: 'Apex Snow Kiting Tour Kosciuszko',
    summary,
    continent: 'Oceania',
    country: 'Australia',
    region: 'Snowy Mountains, New South Wales',
    spot: 'Canberra',
    spotCoords: null,
    itinerarySpots: APEX_ROUTE,
    durationDays: nDays,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      'Return transfers from Canberra Airport',
      'Twin-share accommodation in Jindabyne',
      'Daily alpine and over-snow transport to Thredbo / Charlotte Pass, snowcat day',
      'Lift passes and backcountry permits',
      'Avalanche beacon, shovel and backcountry survival gear',
      'KA-certified instruction and guiding',
      'Apex outer shell jacket',
    ],
    optionalServices: ['Try-before-you-buy package with the latest snowkites (A$650, credited towards a purchase)', 'Hire packages'],
    accommodation: 'twin-share accommodation in Jindabyne',
    mealPlan: null,
    languages: ['en'],
    rooms: [],
    imageUrls: apexImages(p.service, p.tours).slice(0, 20),
    heroVideoUrl: null,
    sourceUrl: APEX_TOURS_URL,
    bookingUrl: APEX_SERVICE_URL,
    sourceText: [
      (gearIdx > 0 ? t.lines.slice(0, gearIdx) : t.lines).join('\n'),
      s ? `service page: A$${s.price}; booked out: ${s.bookedOut}; ${s.description}` : '',
      `parsed: dates ${t.dates.map(d => `${d.start}..${d.end}`).join(', ') || 'none'} (${t.datesNote ?? 'no note'})`,
    ].filter(Boolean).join('\n'),
  };
}

/** The site's own Wix photos (d444dc_* media ids), originals; stock icons (11062b_*) and the logo dropped. */
export function apexImages(...pages: Array<string | null>): string[] {
  const out: string[] = [];
  for (const html of pages) {
    if (!html) continue;
    const root = parse(html);
    for (const el of root.querySelectorAll('header,footer,script,style')) el.remove();
    for (const img of root.querySelectorAll('img')) {
      const src = img.getAttribute('src') ?? '';
      const alt = img.getAttribute('alt') ?? '';
      if (/logo|instagram|facebook|icon|Apex kitesurfing lessons/i.test(alt)) continue;
      const id = decodeURIComponent(src).match(/static\.wixstatic\.com\/media\/([0-9a-f]{6}_[0-9a-f]{32}~mv2\.(?:jpe?g|png|webp))/i)?.[1];
      if (!id || id.startsWith('11062b_')) continue;
      const u = `https://static.wixstatic.com/media/${id}`;
      if (!out.includes(u)) out.push(u);
    }
  }
  return out;
}

export async function fetchApexSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const t = parseApexTour(await memoPage(APEX_TOURS_URL));
  if (t.days.length < 3) throw new Error('apex-snowkite: day-by-day itinerary not found (layout changed?)');
  if (!t.dates.length) {
    ctx?.note(`no tour dates on the page (${t.datesNote ?? 'no dated lines'}): price on request`);
    return [];
  }
  const past = t.dates.filter(d => d.start < today);
  if (past.length) ctx?.note(`${past.length} past tour date(s) dropped (${past.map(d => d.start).join(', ')})`);
  // dates found: the price comes from the service page (one more request only in this case)
  const service = await memoPage(APEX_SERVICE_URL).then(parseApexService).catch(() => null);
  if (!service?.price) ctx?.note('service page price not read: dated slots without price');
  return buildApexSlots(t, service, today);
}

export const apexSnowKitingTourKosciuszko: OfferAdapter = {
  key: 'apex-snow-kiting-tour-kosciuszko',
  name: 'Apex Kitesurfing 5 Day Snow Kiting Tour, Kosciuszko',
  kind: 'tour',
  disciplines: ['snowkite'],
  operator: APEX_OPERATOR,
  url: APEX_TOURS_URL,
  slotMethod: 'html_dates',
  fetchBudget: 3,
  async fetchContent() {
    const tours = await memoPage(APEX_TOURS_URL);
    const service = await memoPage(APEX_SERVICE_URL).catch(() => null);
    return parseApexContent({ tours, service });
  },
  fetchSlots: ctx => fetchApexSlots(todayIso(), ctx),
};
