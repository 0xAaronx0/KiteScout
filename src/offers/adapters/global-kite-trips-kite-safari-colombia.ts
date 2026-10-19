// ---------------------------------------------------------------------------
// Global Kite Trips - Kite Safari Colombia (La Guajira): a 10-day guided kite trip from Riohacha through Mayapo,
// Cabo de la Vela and Punta Gallinas (northernmost point of South America, 20 km downwinder through mangroves) to
// Palomino. Accommodation, breakfasts, daily coaching with video review, yoga, photos, airport transfers and desert
// transport included. Kind 'tour' (moves between places; route pins in itinerarySpots).
//
// Data path (checked 2026-10-19), same WordPress site as the Cumbuco camp (shared helpers imported from there):
//   dates    the page prints only "March 2027" ("What's Included March 2027", menu "Kite Safari Colombia March 2027"),
//            no days -> one month-precision slot (2027-03-01..2027-03-31). If the page ever prints a dated range
//            ("March 7th - 16th 2027") the shared session parser picks it up and the slot becomes day-precise.
//   price    "From 2500 USD" (per person assumed: the camp is sold per guest, the Cumbuco sibling prices "1 person";
//            the page does not say "per person") -> USD, package, person, availability on_request.
//   booking  "BOOK YOUR SPOT" links to the request form /booking/ (30% deposit). The "What's Included" section also
//            embeds a Stripe pricing table (prctbl_..., rendered by js.stripe.com from Stripe's API; we do not call
//            it), i.e. probably an online deposit checkout - whether that confirms a place immediately is not visible
//            without Stripe -> instantBooking left unset (unsure). The fixture's Stripe publishable key is redacted.
// robots.txt (2026-10-19): everything allowed.
// Requests per run: 1 (memoised).
// ---------------------------------------------------------------------------
import { collapse, daysInclusive, iso, monthOf, parseAmount, todayIso, imageCandidates } from '../parse.js';
import type { ItinerarySpot, OfferAdapter, OfferContent, Slot } from '../types.js';
import { GKT_BOOKING_URL, GKT_OPERATOR, GKT_SITE, gktPage, gktText, parseGktSessions, type GktSession } from './global-kite-trips-progression-camp-cumbuco.js';

export const GKT_COLOMBIA_URL = `${GKT_SITE}/kite-safari-colombia-2027/`;
const ROUTE: Array<{ name: string; re: RegExp }> = [
  { name: 'Riohacha', re: /Riohacha/i },
  { name: 'Mayapo', re: /Mayapo/i },
  { name: 'Cabo de la Vela', re: /Cabo de la vela/i },
  { name: 'Punta Gallinas', re: /Punta Gallinas/i },
  { name: 'Palomino', re: /Palomino/i },
];

export interface GktSafari {
  sessions: GktSession[];            // dated ranges, if printed
  month: { year: number; month: number } | null;
  days: number | null;
  priceFrom: number | null;
  currency: string | null;
  route: string[];
}

export function parseGktSafari(html: string): GktSafari {
  const t = gktText(html);
  // the site menu lists every trip; the page body starts after the menu's last item ("... contact")
  const cut = t.indexOf(' contact ');
  const body = cut >= 0 ? t.slice(cut) : t;
  const sessions = parseGktSessions(body).filter(s => daysInclusive(s.start, s.end) >= 5);
  const mm = body.match(/What'?s Included\s+([A-Z][a-z]+)\s+(20\d{2})/) ?? t.match(/Kite Safari Colombia\s+([A-Z][a-z]+)\s+(20\d{2})/);
  const month = mm && monthOf(mm[1]) ? { year: Number(mm[2]), month: monthOf(mm[1])! } : null;
  const days = body.match(/(\d{1,2})-DAY (?:CAMP|SAFARI|TRIP)/i);
  const price = body.match(/From\s+(?:\$\s?)?([\d.,]+)\s*(USD|\$)/i) ?? body.match(/From\s+\$\s?([\d.,]+)/i);
  const it = body.slice(body.search(/Itinerary/i) >= 0 ? body.search(/Itinerary/i) : 0);
  const route = ROUTE.filter((r, i) => (i === 0 ? r.re.test(body) : r.re.test(it))).map(r => r.name);
  return {
    sessions,
    month,
    days: days ? Number(days[1]) : null,
    priceFrom: price ? parseAmount(price[1]) : null,
    currency: price ? 'USD' : null,
    route,
  };
}

const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function buildGktSafariSlots(s: GktSafari, today: string): Slot[] {
  const base = {
    unit: `${s.days ?? 10}-day kite safari`,
    price: s.priceFrom,
    currency: s.priceFrom !== null ? s.currency : null,
    priceUnit: s.priceFrom !== null ? 'package' as const : null,
    priceBasis: s.priceFrom !== null ? 'person' as const : null,
    occupancy: 1,
    availability: 'on_request' as const,
    spotsLeft: null,
  };
  const text = s.priceFrom !== null ? `From ${s.priceFrom} USD` : null;
  if (s.sessions.length) {
    return s.sessions.filter(x => x.start >= today).map(x => ({
      ...base, key: x.start, startDate: x.start, endDate: x.end, availabilityText: [x.label, text].filter(Boolean).join(' · '),
    }));
  }
  if (!s.month) return [];
  const start = iso(s.month.year, s.month.month, 1);
  const end = iso(s.month.year, s.month.month, lastDay(s.month.year, s.month.month));
  if (end < today) return [];
  return [{
    ...base,
    key: start.slice(0, 7),
    startDate: start,
    endDate: end,
    datePrecision: 'month',
    availabilityText: [`${new Date(`${start}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })} (exact days not printed)`, text].filter(Boolean).join(' · '),
  }];
}

export function parseGktColombiaContent(html: string, today = todayIso()): OfferContent {
  const t = gktText(html);
  const s = parseGktSafari(html);
  const when = s.sessions.find(x => x.start >= today)
    ? `Next dates: ${s.sessions.filter(x => x.start >= today).map(x => x.label).join(', ')}`
    : s.month && iso(s.month.year, s.month.month, 28) >= today
      ? `Next trip: ${new Date(Date.UTC(s.month.year, s.month.month - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })} (exact days on request)`
      : 'Runs yearly; the next dates are not published yet';
  const days = s.days ?? 10;
  const itinerarySpots: ItinerarySpot[] = s.route.map((name, i) => ({ name, country: 'Colombia', region: 'La Guajira', order: i + 1 }));
  const lessons = t.match(/Beginner lessons from\s+([\d.,]+)\s*USD\s*\/\s*(\d+)\s*hours/i);
  const imgs = imageCandidates(html, GKT_COLOMBIA_URL, null, 40)
    .filter(u => !/dummy\.png|whats-included|logo/i.test(u));

  return {
    kind: 'tour',
    title: 'Global Kite Trips Kite Safari Colombia',
    summary: [
      `A ${days}-day guided kite safari in La Guajira, Colombia: from Riohacha airport to Mayapo, five days of flat water at Cabo de la Vela, two days at Punta Gallinas with a 20 km downwinder through the mangroves, and a final stop in the beach village of Palomino.`,
      'Includes accommodation, breakfasts, daily coaching with filmed sessions and video review, yoga, photos, airport transfers and desert transport; lunches and dinners are paid locally.',
      `${when}${s.priceFrom ? `, from USD ${s.priceFrom.toLocaleString('en-US')} per person` : ''}. For beginners to advanced riders.`,
    ].join(' '),
    continent: 'South America',
    country: 'Colombia',
    region: 'La Guajira',
    spot: s.route[0] ?? 'Riohacha',
    itinerarySpots,
    durationDays: days,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: /gear rentals?/i.test(t) ? true : null,
    beginnerFriendly: true,
    includedServices: [
      'Accommodation along the route',
      'Breakfasts',
      'Daily kite coaching with video review',
      'Assisted downwinder (Punta Gallinas)',
      'Daily yoga, pro photos and group video',
      'Riohacha airport transfers and transport between the spots',
    ],
    optionalServices: [
      lessons ? `Beginner lessons from USD ${parseAmount(lessons[1])} / ${lessons[2]} hours, equipment included` : 'Beginner lessons',
      'Full kite gear rental (on request)',
    ],
    accommodation: 'guesthouses and lodges along the route',
    mealPlan: 'breakfast',
    languages: ['en'],
    rooms: [],
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: GKT_COLOMBIA_URL,
    bookingUrl: GKT_BOOKING_URL,
    sourceText: [
      `safari: ${collapse(t)}`,
      `parsed: month ${s.month ? `${s.month.year}-${s.month.month}` : null}; sessions ${s.sessions.map(x => x.start).join(', ')}; days ${s.days}; from USD ${s.priceFrom}; route ${s.route.join(' > ')}`,
    ].join('\n'),
  };
}

export async function fetchGktColombiaSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const s = parseGktSafari(await gktPage(GKT_COLOMBIA_URL));
  if (!s.month && s.sessions.length === 0) throw new Error('global-kite-trips colombia: no trip month or dates found (layout changed?)');
  const slots = buildGktSafariSlots(s, today);
  if (slots.length === 0) ctx?.note('the printed safari dates are past; next dates not published yet');
  return slots;
}

export const globalKiteTripsKiteSafariColombia: OfferAdapter = {
  key: 'global-kite-trips-kite-safari-colombia',
  name: 'Global Kite Trips Kite Safari Colombia',
  kind: 'tour',
  operator: GKT_OPERATOR,
  url: GKT_COLOMBIA_URL,
  slotMethod: 'html_dates',
  liveAvailability: false,
  fetchBudget: 2,
  async fetchContent() { return parseGktColombiaContent(await gktPage(GKT_COLOMBIA_URL)); },
  fetchSlots: ctx => fetchGktColombiaSlots(todayIso(), ctx),
};
