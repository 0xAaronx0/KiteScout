// ---------------------------------------------------------------------------
// Regenbogen Ferienanlage Born, Born a. Darß (Fischland-Darß-Zingst, Mecklenburg-Vorpommern, Germany) - holiday park of
// Regenbogen AG on the Bodden in the Vorpommersche Boddenlandschaft national park; its surf spot (standing depth, no
// waves, "einer der einsteigerfreundlichsten Wassersport-Hotspots an der Ostsee") is almost on the site and the VDWS
// school on the park teaches kitesurfing and windsurfing (kiten-lernen.de). Listed: the Holli® rental units only, never
// the pitches.
//
// Data path (checked 2026-10-14), same Neos site and layout as Regenbogen Ummanz (shared helpers in regenbogen-ummanz.ts):
//   content  /ferienanlagen/born.html: intro, "Öffnungszeiten: 20. März 2026 bis 01. November 2026", tab panes
//            ("Surfangebote": Wind-Wind-Situation / Surferwiese / Surfschule; "Ferienunterkunft Holli®", "... Komfort",
//            "... Exklusiv"), offer cards ("SPAR-ANGEBOT-MIETOBJEKT ... AB € 332,-"), Google Maps link
//            maps.google.de/?q=54.383965,12.504492 -> spotCoords.
//   slots    the linked price list "Born_Preisliste-2026-1.pdf" (Stand November 2025), rental rows read by hand
//            2026-10-14 (constants below), released only while the page links that very PDF path; seasons as Ummanz.
// Booking engine: SIHOT (buchen.regenbogen.ag, HN=40) - not usable without the engine's session cookie (see
//   regenbogen-ummanz.ts), so no live price or availability.
// robots.txt www.regenbogen.ag (2026-10-14): only /neos/ disallowed.
// Requests per run: content 1, slots 1 (memoised) -> 1.
// Parsed: slot = Holli category x season band clipped to the opening (nights 20.03.-31.10.2026), EUR per unit per night
//   ("ab" price; unit INFERRED, the PDF prints none - see regenbogen-ummanz.ts), availability 'unknown'; past bands dropped.
//   After 01.11.2026 -> [] (price on request) until the 2027 list.
// Known limits: "Holli® Komfort" is on the page but not in the price list (no slot). The offer card's 7-night example
//   (17.10.-24.10.26 "ab € 332" = 5 x 66 + 2 x 1) implies EUR 66 per night that week, above the sheet's "ab 55" - the
//   sheet gives the season minimum, SIHOT the day price.
// ---------------------------------------------------------------------------
import { todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent } from '../types.js';
import {
  RGB_EXTRAS_2026, RGB_OPERATOR, RGB_SEASONS_2026, RGB_SITE, type RgbPriceSheet, type RgbSeason,
  isRentalPane, rgbImages, rgbLines, rgbOfferLine, rgbOpening, rgbPage, rgbPanes, rgbPin, rgbPriceFeatures,
  rgbRentalOffers, rgbRooms, rgbSlotsFromPage,
} from './regenbogen-ummanz.js';

export const RBO_URL = `${RGB_SITE}/ferienanlagen/born.html`;
const RBO_BOOKING_URL = 'https://buchen.regenbogen.ag/SIHOTWebRegenbogenAG/client/?HN=40';

const ab = (a: number, c: number, d: number): Record<RgbSeason, number> => ({ 'A+B': a, C: c, D: d });
/** Tab pane names of the park page (= content room names, with ® on this page; checked against the 2026-10-14 fixture). */
export const RBO_ROOM_HOLLI = 'Ferienunterkunft Holli®';
export const RBO_ROOM_EXKLUSIV = 'Ferienunterkunft Holli® Exklusiv';
/** Born_Preisliste-2026-1.pdf, page 1 "Camping & Mietobjekte", rental rows (read by hand 2026-10-14). */
export const RBO_SHEET: RgbPriceSheet = {
  href: '/resources/persistent/e268412daa5c3c52dea96a920914c188d4b55993/Born_Preisliste-2026-1.pdf',
  year: 2026,
  seasons: RGB_SEASONS_2026,
  opening: { start: '2026-03-20', end: '2026-11-01' },
  units: [
    // pet-friendly rows price the same pane's unit; "Holli® Komfort" has no row -> stays unpriced
    { name: 'Ferienhaus Holli®', persons: null, pets: false, prices: ab(55, 107, 151), room: RBO_ROOM_HOLLI },
    { name: 'Ferienhaus Holli® mit Haustiererlaubnis', persons: null, pets: true, prices: ab(55, 107, 151), room: RBO_ROOM_HOLLI },
    { name: 'Ferienhaus Holli® Exklusiv', persons: 6, pets: false, prices: ab(76, 129, 173), room: RBO_ROOM_EXKLUSIV },
    { name: 'Ferienhaus Holli® Exklusiv mit Haustiererlaubnis', persons: 6, pets: true, prices: ab(76, 129, 173), room: RBO_ROOM_EXKLUSIV },
  ],
  extras: ['Final cleaning: Holli EUR 89, Holli Exklusiv EUR 109', ...RGB_EXTRAS_2026],
};

export function parseRegenbogenBornContent(html: string): OfferContent {
  const lines = rgbLines(html);
  const all = lines.join('\n');
  const panes = rgbPanes(html);
  const surf = panes.find(p => /surfangebote|kite/i.test(p.name));
  const opening = rgbOpening(html);
  const pin = rgbPin(html);
  const offers = rgbRentalOffers(html);
  const rooms = rgbRooms(html).map(r => ({
    ...r,
    features: [...r.features, ...rgbPriceFeatures(RBO_SHEET, r.name.replace(/^Ferienunterkunft/, 'Ferienhaus'))],
  }));
  const min = Math.min(...RBO_SHEET.units.map(u => u.prices['A+B']));
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  const summary = [
    `Regenbogen Born is a holiday park of Regenbogen AG at Born a. Darß on the Fischland-Darß-Zingst peninsula, inside the Vorpommersche Boddenlandschaft national park; its surf spot on the Bodden is sheltered from waves, of standing depth and almost on the site${opening ? `, and the park is open from ${fmt(opening.start)} to ${fmt(opening.end)}` : ''}.`,
    'The VDWS school on the park teaches kitesurfing and windsurfing to children, beginners and advanced riders and rents the equipment for the whole season.',
    `Besides pitches the park rents Holli® holiday units (24 m² for up to 4 persons, Exklusiv 40 m² for up to 6), self-catering, from EUR ${min} per unit and night in the ${RBO_SHEET.year} low season; the Weststrand on the Baltic Sea is within cycling distance.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Regenbogen Ferienanlage Born',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Born, Fischland-Darß',
    spot: 'Born a. Darß',
    ...(pin ? { spotCoords: pin } : {}),
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: surf ? /Kite- und Windsurfen/i.test(surf.text) : null,
    equipmentRental: surf ? /Equipment einfach auszuleihen/i.test(surf.text) : null,
    beginnerFriendly: /einsteigerfreundlich|Anfänger/i.test(all),
    includedServices: ['Sanitary buildings with showers', 'Playground'],
    optionalServices: [
      'Kite and windsurf lessons and rental at the VDWS school on the park',
      'Day parking at the Surferwiese next to the spot',
      'Bike rental at the surf school',
      ...offers.map(rgbOfferLine),
      ...RBO_SHEET.extras,
    ],
    accommodation: 'Holli® holiday units on a holiday park',
    mealPlan: 'self_catering',
    languages: ['de'],
    rooms,
    imageUrls: rgbImages(html).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: RBO_URL,
    bookingUrl: RBO_BOOKING_URL,
    sourceText: [
      `intro: ${lines.find(l => /einsteigerfreundlichsten/i.test(l)) ?? ''}`,
      `opening: ${opening ? `${opening.start}..${opening.end}` : '-'}`,
      `surf offers: ${surf?.text ?? '-'}`,
      ...panes.filter(p => isRentalPane(p.name)).map(p => `${p.name}: ${p.text}`),
      `offers: ${offers.map(o => `${o.name} ${o.example ?? ''} ${o.price ?? ''}`).join(' | ')}`,
      `price list ${RBO_SHEET.href} (read by hand 2026-10-14): ${RBO_SHEET.units.map(u => `${u.name} ${u.prices['A+B']}/${u.prices.C}/${u.prices.D}`).join('; ')}`,
    ].join('\n'),
  };
}

export const regenbogenBorn: OfferAdapter = {
  key: 'regenbogen-born',
  name: 'Regenbogen Ferienanlage Born',
  kind: 'accommodation',
  operator: RGB_OPERATOR,
  url: RBO_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 2,
  confidence: 'medium', // prices are hand-read constants from the linked PDF price list
  async fetchContent() {
    const html = await rgbPage(RBO_URL);
    if (!/Kite/i.test(html)) throw new Error('regenbogen-born: kite school text missing on the park page');
    return parseRegenbogenBornContent(html);
  },
  async fetchSlots(ctx) {
    return rgbSlotsFromPage(await rgbPage(RBO_URL), RBO_SHEET, todayIso(), ctx);
  },
};
