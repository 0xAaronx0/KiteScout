// ---------------------------------------------------------------------------
// The Wild House, Tarifa (Cadiz, Andalusia, Spain) - a guest house for kitesurfers in the natural park between the kite
// spots of Los Lances and Valdevaqueros, less than 10 minutes by car from Tarifa: up to 26 guests, shared kitchen and
// living room, free private parking, Wi-Fi/TV, a large garden with barbecue and a washing and storage area for kite
// gear; can also be booked exclusively (events, team building). It has no website of its own: it is offered by the kite
// schools Matos Tarifa (accommodation page, booked with a course) and Kite and Roll Tarifa ("our mythical The Wild
// House", with a Kite Camp option).
//
// Data path (checked 2026-10-12):
//   content  https://matos-tarifa.com/en/tarifa-guide/accommodation/ - the "The Wild House - Guest House" section
//            (text, highlights, 8 photos; parser shared with matos-apartments-tarifa.ts) + the sentence about the
//            house on https://kiteandrolltarifa.com/en/kitesurfing-tarifa/.
//   slots    none: neither school prints a price ("We will confirm availability and rates by email or phone").
//            fetchSlots returns [] ("price on request") without a request.
// Operator: Matos Tarifa - the page the description, photos and booking path come from. Kite and Roll calls the house
//   "our", so it may be theirs; neither page names an owner (open question).
// Liveness (rule 5b): Matos page dateModified 2026-03-06 (JSON-LD WebPage), the section offers a "Booking Request".
//   (The Kite and Roll page itself was last edited 2023-06-06 per its sitemap; its home page 2026-03-13.)
// robots.txt (2026-10-12): matos-tarifa.com disallows /wp-admin/ and /wp-content/ except uploads; kiteandrolltarifa.com
//   disallows /wp-*, /*? and some paths - both pages read here are allowed.
// Requests per run: content 2 (the Matos page is memoised with the apartments adapter), slots 0.
// Known limits: no address or map on either page (third-party portals give one; not used), so no spotCoords; the
//   region is the nearer named spot "Los Lances, Tarifa"; the room count is not stated (only "up to 26 guests").
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { MATOS_ACCOM_URL, MATOS_BOOKING_URL, MATOS_OPERATOR, matosDateModified, matosHighlights, matosImages, matosLines, matosPage, matosSection } from './matos-apartments-tarifa.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

export const KAR_URL = 'https://kiteandrolltarifa.com/en/kitesurfing-tarifa/';

/** The Kite and Roll sentence that mentions the house. */
export function parseKarWildHouse(html: string): string | null {
  return matosLines(html).find(l => /The Wild House/i.test(l)) ?? null;
}

export interface WhPages { matos: string; kar: string | null }

export function parseWildHouseContent(p: WhPages): OfferContent {
  const sec = matosSection(p.matos, /Wild House/i);
  if (!sec) throw new Error('wild-house: "The Wild House" section not found on the Matos accommodation page');
  const lines = matosLines(sec.html);
  const text = lines.filter(l => /Wild House|shared kitchen|booked exclusively/i.test(l) && l.length > 60);
  const highlights = matosHighlights(sec.html);
  const guests = highlights.join(' ').match(/up to (\d+) guests/i)?.[1] ?? null;
  const kar = p.kar ? parseKarWildHouse(p.kar) : null;
  const all = text.join(' ');
  const has = (re: RegExp) => re.test(all) || highlights.some(h => re.test(h));

  const summary = [
    `The Wild House is a guest house for kitesurfers in the natural park between the kite spots of Los Lances and Valdevaqueros, less than 10 minutes by car from the centre of Tarifa, Spain${guests ? `, for up to ${guests} guests` : ''}.`,
    `It has ${[has(/shared kitchen/i) ? 'a shared kitchen and living room' : null, has(/parking/i) ? 'free private parking' : null, has(/Wi-?Fi/i) ? 'Wi-Fi and TV' : null, has(/garden|barbecue/i) ? 'a large garden with a barbecue' : null, has(/storage area for kite/i) ? 'a washing and storage area for kite gear' : null].filter(Boolean).join(', ')}, and can be booked exclusively for groups and events.`,
    `It has no website of its own: the kite schools Matos Tarifa and Kite and Roll Tarifa offer it with their courses${kar ? ' (Kite and Roll also as a Kite Camp option)' : ''}; prices on request.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'The Wild House',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Los Lances, Tarifa',
    spot: 'Los Lances, Tarifa',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'], // both schools teach beginner to advanced
    kiteLessons: true,
    equipmentRental: null,
    beginnerFriendly: true,
    includedServices: highlights.filter(h => !/up to \d+ guests/i.test(h)).concat(has(/parking/i) ? ['Free private parking'] : []),
    optionalServices: ['Kite courses with Matos Tarifa or Kite and Roll Tarifa', 'Exclusive use of the whole house (private events, team building)'],
    accommodation: 'kitesurf guest house',
    mealPlan: 'self_catering',
    languages: [],
    rooms: [],
    imageUrls: matosImages(sec.html).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: `${MATOS_ACCOM_URL}`,
    bookingUrl: MATOS_BOOKING_URL,
    sourceText: [
      `matos: ${lines.join(' ')}`,
      `kite and roll: ${kar ?? '-'}`,
      `matos dateModified: ${matosDateModified(p.matos) ?? '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------------
export const wildHouseTarifa: OfferAdapter = {
  key: 'wild-house-tarifa',
  name: 'The Wild House Tarifa',
  kind: 'accommodation',
  operator: MATOS_OPERATOR,
  url: MATOS_ACCOM_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  confidence: 'low', // no own website, no price
  async fetchContent(ctx) {
    const matos = await matosPage(MATOS_ACCOM_URL);
    let kar: string | null = null;
    try {
      kar = await fetchText(KAR_URL, { accept: 'text/html' });
    } catch (e) {
      ctx.note(`Kite and Roll page not readable (${(e as Error).message})`);
    }
    return parseWildHouseContent({ matos, kar });
  },
  async fetchSlots(): Promise<Slot[]> {
    return []; // no price on either school's page: "price on request"
  },
};
