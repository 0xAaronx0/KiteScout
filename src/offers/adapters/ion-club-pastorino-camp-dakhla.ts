// ---------------------------------------------------------------------------
// ION CLUB "Kitesurf and Wingfoil Camp in Dakhla with Mathieu Pastorino" (Morocco) - a one-off coached week for
// independent kitesurfers and wing foilers at ION CLUB's Oasis212 centre on the Dakhla lagoon, 4-10 April 2027,
// 6 to 12 participants: coaching by Mathieu Pastorino (centre manager of ION CLUB Golf de Roses), 3 days of
// sessions at the Oasis212 spots + 3 wind excursions (meals included; Dune Blanche, Speed Spot, Secret Spot and
// lagoon pictures on the page), daily yoga, gear workshops, bungalow at Oasis212 (2 sharing), full board, airport
// transfers, and either 6 days of equipment rental (EUR 1,180 pp) or 6 days of storage for own gear (EUR 950 pp).
//
// Kind 'camp' (one base; the excursions are day trips). Data path: ion-club.net (shared ION parser in
//   ion-club-oasis212-lessons-package-dakhla.ts): the header "4-10 APRIL 2027 • OASIS212 • 6 TO 12 PARTICIPANTS",
//   the .camp-pricing-card cards ("With equipment rental 1180€ / person", "With equipment storage 950€ / person"),
//   "Based on 2 people sharing a bungalow", supplements (single +EUR 460, multisport rental +EUR 135, COVER+ +EUR 70).
//   "BOOK NOW" = on-page request form -> 'on_request', instantBooking false, liveAvailability false.
// Duration: the page lists "7 nights at Oasis212" but its own programme runs Sunday 04/04 (arrival) to Saturday
//   10/04 (departure) = 6 nights; slots use the printed dates (2027-04-04..2027-04-10), durationDays 7 from them.
// Slots: one per price card for the dated camp, EUR per person, occupancy 2; [] once the start date has passed
//   (the summary then says the next edition is not published).
// Requests per run: content 1, slots 1 (memoised).
// ---------------------------------------------------------------------------
import { daysInclusive, iso, monthOf, todayIso } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import { ION_OPERATOR, ION_SITE, ionFetch, ionImages, ionText, parseIonPrices, type IonPrice } from './ion-club-oasis212-lessons-package-dakhla.js';

export const ION_CAMP_URL = `${ION_SITE}/dakhla-kitesurf-wingfoil-camp/`;

export interface IonCampPage {
  start: string | null;
  end: string | null;
  label: string | null;
  participants: string | null;
  prices: IonPrice[];
  singleSupplement: number | null;
  sharing: number | null;
  text: string;
}

export function parseIonCampPage(html: string): IonCampPage {
  const text = ionText(html).replace(/[–—]/g, '-');
  // "4-10 APRIL 2027" / "28 MARCH - 3 APRIL 2027"
  const d = text.match(/(\d{1,2})(?:\s+([A-Za-z]+))?\s*-\s*(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})/);
  let start: string | null = null;
  let end: string | null = null;
  if (d) {
    const m2 = monthOf(d[4]);
    const m1 = d[2] ? monthOf(d[2]) : m2;
    const y = Number(d[5]);
    if (m1 && m2) { start = iso(m1 > m2 ? y - 1 : y, m1, Number(d[1])); end = iso(y, m2, Number(d[3])); }
  }
  const part = text.match(/(\d+)\s*TO\s*(\d+)\s*PARTICIPANTS/i);
  const single = text.match(/Single supplement:\s*\+?\s*€?\s*(\d[\d.,]*)/i);
  const sharing = text.match(/Based on (\d+) people sharing/i);
  return {
    start, end,
    label: d ? d[0] : null,
    participants: part ? `${part[1]}-${part[2]}` : null,
    prices: parseIonPrices(html).filter(p => p.price !== null),
    singleSupplement: single ? Number(single[1].replace(/[.,]/g, '')) : null,
    sharing: sharing ? Number(sharing[1]) : null,
    text,
  };
}

const unitOf = (p: IonPrice): { id: string; label: string } =>
  /storage/i.test(p.title) ? { id: 'storage', label: 'With equipment storage (own gear, 6 days storage)' }
    : /rental/i.test(p.title) ? { id: 'rental', label: 'With equipment rental (6 days of rental)' }
      : { id: p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: p.title };

export function buildIonCampSlots(c: IonCampPage, today: string): Slot[] {
  if (!c.start || !c.end || c.start < today) return [];
  return c.prices.map(p => {
    const u = unitOf(p);
    return {
      key: `${u.id}|${c.start}`,
      startDate: c.start,
      endDate: c.end,
      unit: u.label,
      price: p.price,
      currency: p.currency ?? 'EUR',
      priceUnit: 'package',
      priceBasis: 'person',
      occupancy: c.sharing ?? 2,
      availability: 'on_request',
      availabilityText: `${p.currency ?? 'EUR'} ${p.price} per person, ${c.sharing ?? 2} sharing a bungalow${c.singleSupplement ? ` (single supplement +EUR ${c.singleSupplement})` : ''}; ${c.participants ?? '6-12'} participants; booking request form`,
      spotsLeft: null,
    } satisfies Slot;
  });
}

export async function fetchIonCampSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const c = parseIonCampPage(await ionFetch(ION_CAMP_URL));
  if (!c.start) throw new Error('ion-club pastorino camp: camp dates ("4-10 APRIL 2027") not found (layout changed?)');
  if (c.prices.length === 0) throw new Error('ion-club pastorino camp: price cards not found (layout changed?)');
  const slots = buildIonCampSlots(c, today);
  if (slots.length === 0) ctx?.note(`camp ${c.start}..${c.end} has started or passed; no new edition printed yet`);
  return slots;
}

export function parseIonCampContent(html: string, today = todayIso()): OfferContent {
  const c = parseIonCampPage(html);
  if (!c.start || !c.end) throw new Error('ion-club pastorino camp: camp dates not found (layout changed?)');
  const rental = c.prices.find(p => /rental/i.test(p.title));
  const storage = c.prices.find(p => /storage/i.test(p.title));
  const past = c.start < today;
  const when = `${c.start.slice(8)}.${c.start.slice(5, 7)}.-${c.end.slice(8)}.${c.end.slice(5, 7)}.${c.end.slice(0, 4)}`;
  const summary = [
    `A coached kitesurf and wing foil week at ION CLUB's Oasis212 centre on the Dakhla lagoon with Mathieu Pastorino, for ${c.participants ?? '6-12'} independent riders: 3 days of sessions on the Oasis212 spots and 3 wind excursions to other lagoon spots, daily yoga and gear workshops (kite and bar trim, bladder repair, foil choice).`,
    `Bungalow at Oasis212 shared by two, full board and airport transfers are included; with 6 days of equipment rental EUR ${rental?.price ?? '?'} per person, with storage for your own gear EUR ${storage?.price ?? '?'}${c.singleSupplement ? ` (single supplement EUR ${c.singleSupplement})` : ''}.`,
    past
      ? `The ${c.start.slice(0, 4)} edition (${when}) has passed; the next dates are not published yet.`
      : `Dates: ${when}; booking on request.`,
  ].join(' ');
  return {
    kind: 'camp',
    title: 'ION CLUB Dakhla Kitesurf & Wingfoil Camp with Mathieu Pastorino',
    summary,
    continent: 'Africa',
    country: 'Morocco',
    region: 'Dakhla-Oued Ed-Dahab',
    spot: 'Dakhla Lagoon',
    itinerarySpots: [],
    durationDays: daysInclusive(c.start, c.end),
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: false,
    includedServices: [
      'Coaching with Mathieu Pastorino (kitesurf and wing foil)',
      'Bungalow at Oasis212, 2 sharing (partial sea view)',
      'Full board',
      'Round-trip airport transfers',
      '3 wind excursions (meals included)',
      'One yoga session per day',
      'Workshops: choosing kite and wing gear, bar trim, bladder replacement, approaching a new spot, foil choice',
      '6 days of equipment rental or 6 days of storage for your own gear',
    ],
    optionalServices: [
      ...(c.singleSupplement ? [`Single supplement (+EUR ${c.singleSupplement})`] : []),
      'Multisport rental supplement (+EUR 135)',
      'COVER+ for equipment rental (+EUR 70)',
      'Discount for 3-4 people sharing a bungalow (on request)',
    ],
    accommodation: 'bungalow at the Oasis212 hotel (2 single beds or 1 double, partial sea view)',
    mealPlan: 'full_board',
    languages: ['en', 'fr'],
    rooms: [],
    imageUrls: ionImages(html, ION_CAMP_URL),
    heroVideoUrl: null,
    sourceUrl: ION_CAMP_URL,
    bookingUrl: ION_CAMP_URL,
    sourceText: [
      `dates: ${c.label} -> ${c.start}..${c.end}; participants ${c.participants}; sharing ${c.sharing}; single +${c.singleSupplement}`,
      ...c.prices.map(p => `${p.title}: ${p.price} ${p.currency} ${p.basis}; ${p.items.join(' | ')}`),
      c.text.slice(Math.max(0, c.text.search(/KITESURF AND WINGFOIL CAMP/i)), 5000),
    ].join('\n'),
  };
}

export const ionClubPastorinoCampDakhla: OfferAdapter = {
  key: 'ion-club-pastorino-camp-dakhla',
  name: 'ION CLUB Kitesurf & Wingfoil Camp with Mathieu Pastorino, Dakhla',
  kind: 'camp',
  operator: ION_OPERATOR,
  url: ION_CAMP_URL,
  slotMethod: 'html_dates',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 2,
  fetchContent: async () => parseIonCampContent(await ionFetch(ION_CAMP_URL)),
  fetchSlots: ctx => fetchIonCampSlots(todayIso(), ctx),
};
