// ---------------------------------------------------------------------------
// Uncharted Kite Sessions - "Choose Your Strapless Week" (Kite Beach, Cabarete, Dominican Republic): a private
// strapless (surfboard or foil) kite coaching week with Uncharted founder Andreas Lagopoulos, any week of the year,
// 1 to 4 guests: 6 nights in a two or three bedroom oceanfront condo at Uncharted Villas (own room), 5 days of
// unlimited coaching with bbTalkin headsets, video coaching by a private camera crew, all food and drinks (Caba Eats
// catering), local transport, guided downwinders, Slingshot demo gear. KIND = 'camp'.
// Helpers come from uncharted-kite-sessions-fred-hope-foil-master-cabarete.ts (same site, same page layout).
//
// Data path (checked 2026-10-21): Joomla + K2 item /destinations/choose-your-strapless-week:
//   dd.dates "All Year Long", dd.number-of-guests "1 to 4", dd.price "Starting @ $3195 USD p/p", dd.pro "Uncharted
//   Founder Andreas Lagopoulos"; div.package-includes bullets; div.not-included. Images: the item's K2 image + three
//   banners (photos with "Choose Your Week, Choose Your Ride" printed on them) + /uncharted-villas photos.
// Slots: one undated slot, "starting" USD 3,195 per person ("p/p" printed), package of 6 nights, 'on_request'
//   ("Book Now" = /contact-us form). The price for 1 vs 4 guests is not broken down ("Starting @").
// robots.txt (2026-10-21): Joomla default, /destinations/ and /images/ allowed.
// Requests per run: content 2 (item + villas), slots 1 (memoised: 2 for a full run).
// Flags: liveAvailability no (static page), instantBooking false (contact form).
// ---------------------------------------------------------------------------
import type { OfferAdapter, OfferContent, Slot } from '../types.js';
import { UKS_CONTACT_URL, UKS_OPERATOR, UKS_SITE, parseUksCamp, uksImages, uksPage, uksSlot, uksVillas, type UksCamp } from './uncharted-kite-sessions-fred-hope-foil-master-cabarete.js';

export const UKS_STRAPLESS_URL = `${UKS_SITE}/destinations/choose-your-strapless-week`;

export function buildUksStraplessSlots(c: UksCamp): Slot[] {
  const words = [c.dates, c.guests ? `${c.guests} guests` : null].filter(Boolean).join(', ');
  return [uksSlot(c, 'strapless-week', `${c.title} (private coaching week)`, null, null, words || null)];
}

export function parseUksStraplessContent(campHtml: string, villasHtml: string | null): OfferContent {
  const c = parseUksCamp(campHtml);
  if (!c.price) throw new Error('uncharted strapless week: price (dd.price) not found');
  const nights = c.nights ?? 6;
  const coach = c.pro?.replace(/^Uncharted Founder\s+/i, '') ?? 'Andreas Lagopoulos';
  const summary = [
    `Uncharted Kite Sessions offers a private strapless kitesurf coaching week at Kite Beach in Cabarete, on the north coast of the Dominican Republic, with founder and head coach ${coach}, on a strapless surfboard or a foil.`,
    `The package covers ${nights} nights with an own room in a two or three bedroom oceanfront condo at Uncharted Villas, 5 days of unlimited coaching with bluetooth headsets and video analysis, sessions at Kite Beach, Encuentro and La Boca, guided downwinders, all food and drinks from a private caterer and local transport; riders bring their own gear (Slingshot demo kites available).`,
    `It runs ${/all year/i.test(c.dates ?? '') ? 'any week of the year' : (c.dates ?? 'on demand')} for ${c.guests ?? 'small groups of'} guests, starts at USD ${c.price.toLocaleString('en-US')} per person and is booked by contact form.`,
  ].join(' ');
  return {
    kind: 'camp',
    title: `${c.title} (Uncharted Kite Sessions, Cabarete)`,
    summary,
    continent: 'North America',
    country: 'Dominican Republic',
    region: 'Puerto Plata',            // as cabarete-boutique-kite-hotel.ts / kite-beach-inn-cabarete.ts
    spot: 'Kite Beach, Cabarete',
    spotCoords: { lat: 19.76256, lng: -70.42241 }, // same beach pin as kite-beach-inn-cabarete (the geocoder finds no 'Kite Beach, Cabarete'), set by the lead 2026-10-21
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['intermediate', 'advanced'], // strapless surfboard / foil riding
    kiteLessons: true,
    equipmentRental: false,            // "Do You Need Your Own Gear? Yes." (Slingshot demo gear in limited quantities)
    beginnerFriendly: false,
    includedServices: c.includes,
    optionalServices: [
      'Personalized video of the week (for purchase after the camp)',
      'Airport transfer by the school\'s driver (flat taxi rates from POP, STI, AZS, SDQ)',
    ],
    accommodation: 'Own room in a two or three bedroom oceanfront condo at Uncharted Villas on Kite Beach (pool)',
    mealPlan: 'full_board',            // "All food and drinks included"
    languages: ['en'],
    rooms: [],
    imageUrls: uksImages(campHtml, villasHtml),
    heroVideoUrl: null,
    sourceUrl: UKS_STRAPLESS_URL,
    bookingUrl: UKS_CONTACT_URL,
    sourceText: [`facts: ${JSON.stringify({ ...c, intro: undefined })}`, `intro: ${c.intro}`].join('\n'),
  };
}

export const unchartedKiteSessionsStraplessWeekCabarete: OfferAdapter = {
  key: 'uncharted-kite-sessions-strapless-week-cabarete',
  name: 'Uncharted Kite Sessions - Choose Your Strapless Week, Cabarete',
  kind: 'camp',
  operator: UKS_OPERATOR,
  url: UKS_STRAPLESS_URL,
  slotMethod: 'price_table',
  instantBooking: false,
  fetchBudget: 3,
  async fetchContent(ctx) {
    const camp = await uksPage(UKS_STRAPLESS_URL);
    return parseUksStraplessContent(camp, await uksVillas(ctx));
  },
  async fetchSlots() {
    const c = parseUksCamp(await uksPage(UKS_STRAPLESS_URL));
    if (!c.price) throw new Error('uncharted strapless week: price (dd.price) not found');
    return buildUksStraplessSlots(c);
  },
};
