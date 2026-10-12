// ---------------------------------------------------------------------------
// The Rider Experience - Los Roques kite trip 2027 (Venezuela)
//
// Land-based small-group trip (Aaron 2026-10-12: "als Tour-Package aufnehmen"): eight nights at
// Posada Las Tinajas on Gran Roque, daily boat trips to the kite spots. Not a cruise (the provider's
// Egypt kite cruise lives in cruise_offers).
// Data path (checked 2026-10-12, Squarespace; robots.txt only names AI/ads bots, our UA is allowed):
//   page   /los-roques-trip: "Los Roques Trip 2-10th April 2027 Limited spaces available Bookings until
//          30 October 2026" + link to the info PDF /s/Los-Roques-2-10-April-Info.pdf
//   prices from that PDF (read by hand 2026-10-12, not machine-readable for us): shared room USD 3,240
//          p.p. (room shared with 1-2 guests), private room USD 4,090 p.p. (only 2 available).
//          The constants are released only while the page still links the same PDF (liveness).
// Requests per run: 1 (content and slots each fetch the page once).
// Known limits: one image on the page; the trip runs only with 12 riders (deadline 30 Oct 2026).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, htmlToText, imageCandidates, iso, monthOf } from '../parse.js';
import type { Availability, OfferAdapter, OfferContent, Slot } from '../types.js';

export const TRE_LOS_ROQUES_URL = 'https://www.theriderexperience.com/los-roques-trip';
const PDF_PATH = '/s/Los-Roques-2-10-April-Info.pdf';

/** Rooms per the info PDF of 2026-10-12. */
const ROOMS: Array<{ key: string; unit: string; price: number; occupancy: number; text: string | null }> = [
  { key: 'shared', unit: 'Shared room', price: 3240, occupancy: 2, text: 'room shared with 1-2 other guests' },
  { key: 'private', unit: 'Private room', price: 4090, occupancy: 1, text: 'single occupancy, only 2 available' },
];
const CURRENCY = 'USD';

const human = (isoDate: string): string =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export interface TreTrip { start: string; end: string; deadline: string | null; limited: boolean; pdf: boolean }

// --- pure parsers -----------------------------------------------------------------------------
/** "Los Roques Trip 2-10th April 2027 Limited spaces available Bookings until 30 October 2026" */
export function parseTreTrip(html: string): TreTrip | null {
  const text = htmlToText(html);
  const m = text.match(/Los Roques Trip\s+(\d{1,2})(?:st|nd|rd|th)?\s*[-–]\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/i);
  if (!m || !monthOf(m[3])) return null;
  const month = monthOf(m[3])!;
  const d = text.match(/Bookings until\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/i);
  return {
    start: iso(+m[4], month, +m[1]),
    end: iso(+m[4], month, +m[2]),
    deadline: d && monthOf(d[2]) ? iso(+d[3], monthOf(d[2])!, +d[1]) : null,
    limited: /limited spaces/i.test(text),
    pdf: html.includes(PDF_PATH),
  };
}

/** The two rooms on the trip dates; bookable until the deadline, closed after it. */
export function parseTreSlots(html: string, today = new Date().toISOString().slice(0, 10)): Slot[] {
  const trip = parseTreTrip(html);
  if (!trip || !trip.pdf) return [];
  const closed = trip.deadline !== null && today > trip.deadline;
  const availability: Availability = closed ? 'closed' : trip.limited ? 'limited' : 'available';
  return ROOMS.map(r => ({
    key: `${trip.start}|${r.key}`,
    startDate: trip.start,
    endDate: trip.end,
    unit: r.unit,
    price: r.price,
    currency: CURRENCY,
    priceUnit: 'package',
    priceBasis: 'person',
    occupancy: r.occupancy,
    availability,
    availabilityText: closed
      ? `bookings closed on ${trip.deadline}`
      : [trip.limited ? 'limited spaces' : null, trip.deadline ? `bookings until ${trip.deadline}` : null, r.text].filter(Boolean).join('; '),
    spotsLeft: null,
  }));
}

export function parseTreContent(html: string): OfferContent {
  const trip = parseTreTrip(html);
  const text = collapse(htmlToText(html));
  return {
    kind: 'tour',
    title: 'Los Roques Kite Trip 2027, Venezuela',
    summary: [
      `A small-group kite trip to the Los Roques archipelago off Venezuela with The Rider Experience${trip ? ` from ${human(trip.start)} to ${human(trip.end)}` : ''}: eight nights at Posada Las Tinajas on Gran Roque with all meals, and a boat out to the flat-water sandbanks and outer islands every day, with local kite support and a few downwinders.`,
      'The package runs from Caracas airport and includes the return flights to Los Roques, the park fees and a private video-coaching session; riders must kite upwind on their own, there are no beginner lessons.',
      `Prices are per person: ${ROOMS.map(r => `${CURRENCY} ${r.price.toLocaleString('en-US')} in a ${r.unit.toLowerCase()}`).join(', ')}; the trip goes ahead with at least 12 riders${trip?.deadline ? `, bookings close on ${human(trip.deadline)}` : ''}.`,
    ].join(' '),
    continent: 'South America',
    country: 'Venezuela',
    region: 'Los Roques Archipelago',
    spot: 'Gran Roque',
    itinerarySpots: [{ name: 'Gran Roque', country: 'Venezuela', region: 'Los Roques Archipelago', order: 1 }],
    durationDays: 9, // 8 nights
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: false,
    equipmentRental: true,
    beginnerFriendly: false,
    includedServices: [
      'Return flights Caracas - Los Roques, airport assistance and transfers',
      'Los Roques entrance and departure fees',
      '8 nights at Posada Las Tinajas, all meals',
      'Daily boat trips to the kite spots with local kite support, downwinders',
      '1 h private video coaching and analysis',
    ],
    optionalServices: ['Board bag on the Caracas - Los Roques flight (USD 160)', 'Equipment rental for 7 days (USD 840)'],
    accommodation: 'Posada Las Tinajas, Gran Roque (guesthouse)',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: ROOMS.map(r => ({ name: r.unit, description: r.text, features: [] })),
    imageUrls: imageCandidates(html, TRE_LOS_ROQUES_URL, null, 20),
    heroVideoUrl: null,
    sourceUrl: TRE_LOS_ROQUES_URL,
    bookingUrl: TRE_LOS_ROQUES_URL,
    sourceText: [
      `rooms (constant, info PDF ${PDF_PATH} read 2026-10-12): ${ROOMS.map(r => `${r.unit} ${CURRENCY} ${r.price} p.p. (${r.text})`).join('; ')}`,
      text,
    ].join('\n'),
  };
}

export const theriderexperienceLosRoques: OfferAdapter = {
  key: 'theriderexperience-los-roques',
  name: 'The Rider Experience Los Roques kite trip 2027',
  kind: 'tour',
  operator: {
    name: 'The Rider Experience',
    websiteUrl: 'https://www.theriderexperience.com',
    rootDomain: 'theriderexperience.com',
    contactEmail: 'info@theriderexperience.com',
    whatsapp: '+447342472870',
    phone: '+447399147617',
  },
  url: TRE_LOS_ROQUES_URL,
  slotMethod: 'html_dates',
  fetchBudget: 2,
  // prices come from a PDF we read by hand, dates and state from the page
  confidence: 'medium',
  async fetchContent() {
    return parseTreContent(await fetchText(TRE_LOS_ROQUES_URL));
  },
  async fetchSlots(ctx) {
    const html = await fetchText(TRE_LOS_ROQUES_URL);
    const trip = parseTreTrip(html);
    if (!trip) throw new Error('theriderexperience: trip dates no longer on /los-roques-trip - re-check by hand');
    if (!trip.pdf) throw new Error(`theriderexperience: the page no longer links ${PDF_PATH} - the constant prices may be stale, re-check by hand`);
    ctx.note(`prices are constants from the info PDF ${PDF_PATH} (read 2026-10-12)`);
    return parseTreSlots(html);
  },
};
