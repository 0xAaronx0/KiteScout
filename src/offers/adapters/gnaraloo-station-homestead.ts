// ---------------------------------------------------------------------------
// Gnaraloo Station - The Homestead (Gnaraloo, Western Australia): self-contained, self-catering stone cabins and
// group lodges at the station homestead on the escarpment above the Indian Ocean, 7 km from Gnaraloo Bay (flat-water
// kite spot) and the same distance from 3 Mile Camp / the Tombstones wave. Gnaraloo's own /kitesurfing/ page
// describes both kite spots -> KIND = 'accommodation'.
//
// Data path (checked 2026-10-19): WordPress.com site, static pages, bookings by enquiry form (no engine). Shared
//   Gnaraloo helpers in gnaraloo-station-3-mile-camp.ts.
//   slots    /homestead-tariffs/ "Homestead Tariffs 2026" (AUD incl. GST): Off Peak / Standard / Peak tables, rows =
//            unit, PAX, Base Price, Add Adult, Add Child (One Bedroom Cabin, Two Bedroom Cabin, Fishing Lodge 1 + 2,
//            Shearers Quarters, Shearing Shed). One UNDATED slot per unit x period: base price for PAX guests, AUD,
//            priceUnit 'per_night' (inferred, as for 3 Mile Camp: the page prints "per night" only for dogs),
//            priceBasis 'room' (per cabin / lodge), occupancy = PAX; period definition, extra-guest rates in
//            availabilityText; availability 'on_request'. The periods (standard 15 Dec - 15 Jan, peak 1-31 May + WA
//            school holidays) are kept as text, not as dated bands (school holiday dates are not on the page).
//            "1-2 Night Surcharge $50.00 once off per cabin" is an additional service (sourceText / summary).
//   content  /the-homestead/ (facilities, the six accommodation blocks with descriptions, photos) + /kitesurfing/.
// robots.txt (2026-10-19): only /wp-admin/ disallowed.
// Requests per run: content 3 (homestead page, tariffs, kitesurfing page), slots 1 (tariffs, memoised in the same run).
// spotCoords: none on the site.
// ---------------------------------------------------------------------------
import { todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';
import { memoPage, wpLines } from './kite-republic-aitutaki-winter-escape.js';
import {
  GNARALOO_ENQUIRY_URL, GNARALOO_KITE_URL, GNARALOO_OPERATOR, GNARALOO_SITE, buildGnSlots, gnImages, gnKiteText,
  parseGnRooms, parseGnTariffs,
} from './gnaraloo-station-3-mile-camp.js';

export const GHS_URL = `${GNARALOO_SITE}/the-homestead/`;
export const GHS_TARIFFS_URL = `${GNARALOO_SITE}/homestead-tariffs/`;

/** Tariff name -> room block name of the homestead page ("One Bedroom Cabin" -> "1 Bedroom Cabins"). */
export function ghsRoomOf(unit: string, roomNames: string[]): string | null {
  const norm = (s: string): string => s.toLowerCase().replace(/\bone\b/, '1').replace(/\btwo\b/, '2').replace(/s\b/g, '').replace(/[^a-z0-9]+/g, '');
  return roomNames.find(n => norm(n) === norm(unit)) ?? null;
}

export interface GhsPages { homestead: string; tariffs: string; kite: string | null }

export function parseGhsContent(p: GhsPages): OfferContent {
  const lines = wpLines(p.homestead);
  const t = parseGnTariffs(p.tariffs);
  const rooms = parseGnRooms(p.homestead);
  if (!t.rates.length) throw new Error('gnaraloo-homestead: no tariff rows (layout changed?)');
  if (!rooms.length) throw new Error('gnaraloo-homestead: no accommodation blocks on the homestead page (layout changed?)');
  const cabins = t.rates.filter(r => /cabin/i.test(r.unit));
  const lo = Math.min(...cabins.map(r => r.base));
  const hi = Math.max(...cabins.map(r => r.base));
  const kite = gnKiteText(p.kite);

  const summary = [
    "Gnaraloo Homestead is the hub of Gnaraloo Station on the remote Ningaloo coast of Western Australia: self-contained, self-catering stone cabins with ensuite, kitchen, ocean-view patio and gas BBQ, plus group lodges (the Fishing Lodge, Shearers Quarters and Shearing Shed) for up to 26 guests.",
    'Power runs from 7 am to 11 pm; Gnaraloo Bay, a flat-water kite spot with a boat ramp, is 7 km north, and the Tombstones wave at 3 Mile Camp, for experienced kiters, about the same distance south.',
    cabins.length
      ? `${t.year ? `${t.year} rates` : 'Rates'} for the one- and two-bedroom cabins run from AUD ${lo} to ${hi} per night depending on season and size (peak in May and the West Australian school holidays), with a surcharge for stays of 1-2 nights; bookings are made by enquiry.`
      : 'Rates are published per season on the tariffs page; bookings are made by enquiry.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Gnaraloo Station Homestead',
    summary,
    continent: 'Oceania',
    country: 'Australia',
    region: 'Gnaraloo, Western Australia',
    spot: 'Gnaraloo Homestead',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: null,
    equipmentRental: null,
    beginnerFriendly: false,
    includedServices: ['Self-contained cabin or lodge with kitchen', 'Power 7 am to 11 pm, drinking water, freshwater showers', 'Boat parking'],
    optionalServices: ['Dogs permitted (fees and conditions apply)'],
    accommodation: 'self-catering stone cabins (1 and 2 bedrooms) and group lodges',
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms,
    imageUrls: gnImages(p.homestead, GHS_URL).slice(0, 20),
    heroVideoUrl: null,
    sourceUrl: GHS_URL,
    bookingUrl: GNARALOO_ENQUIRY_URL,
    sourceText: [
      lines.join('\n'),
      `tariffs ${t.year}: ${t.rates.map(r => `${r.unit}/${r.period}: ${r.pax} pax $${r.base} +${r.addAdult}/+${r.addChild}`).join('; ')}`,
      `periods: ${Object.entries(t.periods).map(([k, v]) => `${k} = ${v}`).join(' | ')}`,
      `extras: ${t.extras.join(' | ')}`,
      kite ? `kitesurfing page: ${kite}` : '',
    ].filter(Boolean).join('\n'),
  };
}

export async function fetchGhsSlots(ctx?: { note(t: string): void }): Promise<Slot[]> {
  const t = parseGnTariffs(await memoPage(GHS_TARIFFS_URL));
  if (!t.rates.length) throw new Error('gnaraloo-homestead: no tariff rows (layout changed?)');
  if (t.year && t.year < Number(todayIso().slice(0, 4))) ctx?.note(`tariffs are for ${t.year} (not updated yet)`);
  // the room block names of /the-homestead/ (2026-10-19), so slots link to content rooms without an extra request;
  // a renamed block just leaves `room` null
  const roomNames = ['1 Bedroom Cabins', '2 Bedroom Cabins', 'Fishing Lodge 1', 'Fishing Lodge 2', 'Shearing Shed', 'Shearers Quarters'];
  return buildGnSlots(t, u => ghsRoomOf(u, roomNames));
}

export const gnaralooStationHomestead: OfferAdapter = {
  key: 'gnaraloo-station-homestead',
  name: 'Gnaraloo Station Homestead',
  kind: 'accommodation',
  operator: GNARALOO_OPERATOR,
  url: GHS_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  async fetchContent() {
    const homestead = await memoPage(GHS_URL);
    const tariffs = await memoPage(GHS_TARIFFS_URL);
    const kite = await memoPage(GNARALOO_KITE_URL).catch(() => null);
    return parseGhsContent({ homestead, tariffs, kite });
  },
  fetchSlots: ctx => fetchGhsSlots(ctx),
};
