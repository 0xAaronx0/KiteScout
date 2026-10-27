// ---------------------------------------------------------------------------
// Above The Water (Swiss kite + yoga camp operator, head coach Fabio Ingrosso) - Kitesurf + yoga camp South Africa,
// Langebaan, December 2026, based at the Windtown Hotel (250 m from Main Beach, 10 min from Shark Bay): 7 nights in a
// double room, daily video coaching + a daily 1 h group on-water session (max 3 riders per group), one 1 h photo +
// video session, personal video analysis, morning yoga and off-water training. A different product, by a different
// operator, from the catalog's Windtown Lagoon Hotel stay (windtown-lagoon-hotel-langebaan.ts). One base -> 'camp'.
//
// Shared helpers (fetch, Wix lines, date ranges, price variants, /next-camps season grid, slots, photos) come from
// above-the-water-kite-camp-cape-town.ts.
//
// Data path (checked 2026-10-27): Wix site, server-rendered HTML, https://www.abovethewater.online/langebaan-december-2026
//   slots    week = the form's date checkbox "13-20 December 2026" (hero line as fallback). Variants as printed:
//            "GROUP COACHING 1880 EUR", "PRIVATE COACHING 2330 EUR", "GROUP + EQUIPMENT 2580 EUR" (all with the
//            "Always Included" 7 nights in a double room) and the form option "No hotel ( €1280 )" (its own slot,
//            no accommodation). One slot per future week x variant, EUR, priceUnit 'package' (packageNights 7 on the
//            hotel variants). "Single room (+€50/night)" is a form supplement -> optionalServices, not a slot.
//            Availability: the /next-camps card linking to this page ("4 SPOTS LEFT" on 2026-10-27 -> 'limited',
//            spotsLeft 4; the count is per camp, so every variant slot carries it). Further Langebaan editions listed
//            in the grid (e.g. a "langebaan-december-2027" page) are read too (at most 3 camp pages per run).
//   content  the same page + the card's "Ideal for" line ("Beginners, Intermediate, Pro").
// Price basis: not printed next to the prices; inferred per person from the deposit "per participant, per camp week".
// Breakfast: the hotel text says "Begin your day with a delicious breakfast at the hotel's restaurant" and the daily
//   flow lists "08:30 - Breakfast", but breakfast is NOT in the "Always Included" list -> mealPlan null (the summary
//   says so). Level: only the season grid states one; the page sells video/group coaching and no beginner course, so
//   beginnerFriendly stays null. The page also describes Bloubergstrand, but the camp itself is at Windtown, Langebaan.
// robots.txt www.abovethewater.online (2026-10-27): Wix default, `Allow: /`.
// Requests per run: 2 (camp page + /next-camps, memoised).
// Flags: liveAvailability no (season grid badge text), instantBooking no (registration form + EUR 880 deposit).
// Contact: booking@abovethewater.online (footer); the page also prints Above_the_water@outlook.com in a contact block.
// ---------------------------------------------------------------------------
import { todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent } from '../types.js';
import {
  ATW_OPERATOR, ATW_SITE, atwFormOptions, atwImages, atwLevels, atwLines, atwSupplements, fetchAtwSlots, readAtwCamps,
  type AtwParsed, type AtwSpec, type AtwVariant,
} from './above-the-water-kite-camp-cape-town.js';

export const ATW_LB_URL = `${ATW_SITE}/langebaan-december-2026`;

/** Checked by eye 2026-10-27: Langebaan lagoon (aerial), Windtown Hotel pool / room / garden, riding and coaching in
 *  the lagoon. Cape Town (Table Mountain) photos on this page are left out: the camp is in Langebaan. */
export const ATW_LB_PHOTOS = [
  '941edc_9377ec9edf17425cbcf1f149b1bc208e~mv2.jpg', // Langebaan lagoon from the air
  '941edc_d9deef15a0c349ff856604cc0f09f25b~mv2.jpg', // riding in the lagoon
  '941edc_e84bccb0a65e48269325af59e6701758~mv2.jpg', // Windtown Lagoon Hotel pool
  '941edc_b73cba63aa114ea7ad0f7089c2575bfd~mv2.jpg', // Windtown room
  '941edc_b61a097cff924466873eb73a2c1df092~mv2.jpg', // coaching in the shallow lagoon
  '941edc_ea83ebc85dc540acb1c339a92828a7ee~mv2.jpg', // rider with kite at the lagoon
  '941edc_187874cf179f45338eb6d1c9cdd5539e~mv2.jpg', // beach coaching at the lagoon
  '941edc_4925b626a382430a899da91c6b752ec9~mv2.jpg', // riding in the lagoon
  '941edc_46f130a8089442eca900dacf3cf4a09c~mv2.jpg', // water start in the shallows
  '941edc_0eb2d4df38024acb9ba0b4c45141a53b~mv2.jpg', // Windtown garden lounger
  '941edc_4d55148e1648409a89341824c3e327d7~mv2.jpg', // rider on the lagoon beach
];

export const ATW_LB_SPEC: AtwSpec = {
  url: ATW_LB_URL,
  card: h => /langebaan/i.test(h),
  unit: (v: AtwVariant) => (v.nights ? `${v.label ?? 'Camp'}, double room` : v.label ?? 'No hotel'),
  room: 'Double room',
};

const day = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
/** provider copy may carry em/en dashes; our generated text does not */
const dashless = (s: string): string => s.replace(/\s*[\u2013\u2014]\s*/g, ' - ');
const eur = (v: AtwVariant): string => `${v.currency} ${v.amount.toLocaleString('en-US')}`;

export function parseAtwLbContent(p: AtwParsed, today: string): OfferContent {
  const lines = atwLines(p.html);
  const text = lines.join('\n');
  const hotel = p.variants.filter(v => v.nights);
  const noHotel = p.variants.find(v => !v.nights);
  const cheapest = [...hotel].sort((a, b) => a.amount - b.amount)[0];
  const nights = cheapest?.nights ?? 7;
  const future = p.weeks.filter(w => w.start >= today);
  const alwaysAt = lines.findIndex(l => /^Always included$/i.test(l));
  const alwaysEnd = lines.findIndex((l, i) => i > alwaysAt && /^WHAT'?S DIFFERENT|^\d[\d.,]*\s*EUR$|RIDER REGISTRATION FORM/i.test(l));
  const always = alwaysAt >= 0 ? lines.slice(alwaysAt + 1, alwaysEnd > alwaysAt ? alwaysEnd : alwaysAt + 9) : [];
  const supplements = atwSupplements(atwFormOptions(p.html));
  const levels = atwLevels(p.card?.idealFor ?? null);
  const equipment = hotel.find(v => /equipment/i.test(v.label ?? ''));
  const summary = [
    'Above The Water, a Swiss kite and yoga camp run by six-time world champion Fabio Ingrosso, holds a one-week kitesurf and yoga camp on the Langebaan lagoon north of Cape Town, staying at the Windtown Hotel, 250 m from Main Beach and 10 minutes from the flat-water Shark Bay.',
    `The package covers ${nights} nights in a double room, daily video coaching plus a daily 1-hour group session on the water (max 3 riders per group), a photo and video session, personal video analysis and morning yoga; the page describes breakfast at the hotel restaurant but does not list it as included.`,
    `${hotel.length ? `Prices: ${hotel.map(v => `${(v.label ?? 'camp').toLowerCase()} ${eur(v)}`).join(', ')}` : 'Prices are on the camp page'}${noHotel ? `, or ${eur(noHotel)} without the hotel` : ''}; flights are extra, and booking is by registration form with a non-refundable EUR 880 deposit.`,
    future.length
      ? `Camp week: ${future.map(w => `${day(w.start)} to ${day(w.end)}`).join(' and ')}.`
      : p.weeks.length ? 'The published camp week is over; the next dates are not published yet.' : 'Dates are on the camp page.',
  ].join(' ');
  return {
    kind: 'camp',
    title: 'Above The Water Kite and Yoga Camp Langebaan (Windtown Hotel)',
    summary,
    continent: 'Africa',
    country: 'South Africa',
    region: 'Western Cape',
    spot: 'Langebaan',
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: levels.length ? levels : ['intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: equipment ? true : null,
    beginnerFriendly: null,
    includedServices: always.length ? always : [`${nights} nights accommodation in a double room`, 'Daily video coaching', 'Daily 1h group on-water coaching', 'Morning yoga'],
    optionalServices: [
      ...hotel.filter(v => v !== cheapest).map(v => `${v.label} (${eur(v)}): ${v.details.map(dashless).join(' ')}`),
      ...(noHotel ? [`${noHotel.label ?? 'No hotel'} (${eur(noHotel)}): the camp without the hotel`] : []),
      ...supplements,
    ],
    accommodation: 'Windtown Hotel, Langebaan: double rooms, pool and restaurant, next to the West Coast National Park, 250 m from Main Beach and 10 minutes from Shark Bay',
    mealPlan: null,
    languages: ['en'],
    rooms: [
      { name: 'Double room', description: 'Shared double room at the Windtown Hotel', features: ['Pool', 'Restaurant'] },
      ...(supplements.some(s => /^single room/i.test(s)) ? [{ name: 'Single room', description: supplements.find(s => /^single room/i.test(s))!, features: [] }] : []),
    ],
    imageUrls: atwImages(p.html, ATW_LB_PHOTOS),
    heroVideoUrl: null,
    sourceUrl: p.url,
    bookingUrl: p.url,
    sourceText: [
      text,
      `parsed: weeks (${p.weekSource}) ${p.weeks.map(w => `${w.start}..${w.end}`).join(', ')}; variants ${p.variants.map(v => `${v.label ?? 'stay'} ${eur(v)} nights=${v.nights ?? '-'}`).join('; ')}; season grid ${p.card ? `"${p.card.badge ?? ''}" ideal for "${p.card.idealFor ?? ''}"` : 'card not found'}`,
    ].join('\n'),
  };
}

export const aboveTheWaterKiteYogaCampLangebaan: OfferAdapter = {
  key: 'above-the-water-kite-yoga-camp-langebaan',
  name: 'Above The Water - Kite and Yoga Camp Langebaan (Windtown Hotel)',
  kind: 'camp',
  disciplines: ['kitesurf'],
  operator: ATW_OPERATOR,
  url: ATW_LB_URL,
  slotMethod: 'html_dates',
  instantBooking: false, // registration form + EUR 880 deposit, confirmed by the operator
  fetchBudget: 4,
  async fetchContent(ctx) {
    const [p] = await readAtwCamps(ATW_LB_SPEC, todayIso(), ctx);
    return parseAtwLbContent(p, todayIso());
  },
  fetchSlots: ctx => fetchAtwSlots(ATW_LB_SPEC, todayIso(), ctx),
};
