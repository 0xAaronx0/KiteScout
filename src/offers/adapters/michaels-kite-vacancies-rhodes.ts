// ---------------------------------------------------------------------------
// Michael's Kite Vacancies, Fanes (Rhodes, Greece) - family-run kite hotel with half board, 20 rooms
// about 200 m from its own kite station + 4 rooms in a Beach House on the beach.
//
// Data path (checked 2026-10-09): WordPress/Elementor site, English pages (the German /de/hotel-de/ and
// /de/preise/ pages carry the same content):
//   slots    /pricing/  - static room price table: per occupancy (1/2/3 persons per room) a nightly
//            rate and a weekly total for the first, second and third week of a stay, breakfast + dinner
//            included; no season dates, no year, no inventory. Each value is its own Elementor
//            text widget, so the parser walks the <p> texts in document order (occupancy label ->
//            week label -> "93 Euros | per night" -> "650 Euros").
//   content  /hotel/, /rooms-dishes/ (rooms, surcharges, meals, shuttle), /kitestation/, /gallery/.
// No booking engine: requests go through a WPForms contact form, e-mail or WhatsApp -> 'on_request'.
// robots.txt (2026-10-09): only /wp-content/uploads/wpo/wpo-plugins-tables-list.json disallowed.
// Requests per run: content 4, slots 1.
// Parsed: 3 slots = occupancy (1-3 persons) at the standard first-week rate, EUR per room per night,
//   unit "Hotel room", no dates (the table has none). The 2nd/3rd-week rates (long-stay reductions) and
//   the Beach House surcharge (+35 EUR per room per week) go into the room features, not into slots.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kite-rhodos.com';
export const MKV_PRICING_URL = `${SITE}/pricing/`;
const HOTEL_URL = `${SITE}/hotel/`;
const ROOMS_URL = `${SITE}/rooms-dishes/`;
const STATION_URL = `${SITE}/kitestation/`;
const GALLERY_URL = `${SITE}/gallery/`;
export const MKV_UNIT = 'Hotel room';
const BEACH_UNIT = 'Beach House room';

export interface MkvRate { persons: number; week: number; nightly: number; weekly: number | null }
const WEEKS: Record<string, number> = { one: 1, first: 1, second: 2, third: 3 };
const ORD = ['', '1st', '2nd', '3rd'];

function paragraphs(html: string): string[] {
  return parse(html).querySelectorAll('p').map(p => collapse(p.text)).filter(Boolean);
}

/** Room price table: occupancy -> week of stay -> nightly rate + weekly total (in document order). */
export function parseMkvRates(html: string): MkvRate[] {
  const out: MkvRate[] = [];
  let persons: number | null = null;
  let week: number | null = null;
  for (const t of paragraphs(html)) {
    if (/residence tax|kurtaxe|aufenthalt/i.test(t) && out.length) break;
    const occ = t.match(/^(\d)\s+(?:persons?|personen)$/i);
    if (occ) { persons = Number(occ[1]); week = null; continue; }
    const wk = t.match(/^(one|first|second|third)\s+week$|^(\d)\.?\s+woche$/i);
    if (wk) { week = persons ? (wk[1] ? WEEKS[wk[1].toLowerCase()] : Number(wk[2])) : null; continue; }
    if (!persons || !week) continue;
    if (/per night|pro nacht/i.test(t)) {
      const n = parseAmount(t);
      if (n) out.push({ persons, week, nightly: n, weekly: null });
    } else if (/euros?\b/i.test(t)) {
      const last = out[out.length - 1];
      const n = parseAmount(t);
      if (last && last.persons === persons && last.week === week && n) last.weekly = n;
    }
  }
  return out;
}

/** Slots = the standard rate ("One week | 7 Nights | Standard") per occupancy. The 2nd/3rd-week rates are
 *  long-stay reductions, not separately bookable units (Slot has no field for a stay-length condition),
 *  so they go into the room features instead of becoming cheaper slots. */
export function buildMkvSlots(rates: MkvRate[]): Slot[] {
  return rates.filter(r => r.week === 1).map(r => ({
    key: `hotel-room-${r.persons}p`,
    startDate: null,
    endDate: null,
    unit: MKV_UNIT,
    price: r.nightly,
    currency: 'EUR',
    priceUnit: 'per_night',
    priceBasis: 'room',
    occupancy: r.persons,
    availability: 'on_request',
    availabilityText: null,
    spotsLeft: null,
  }));
}

/** Surcharges and rules printed under the price table. */
export function parseMkvNotes(html: string): string[] {
  const t = paragraphs(html).join('\n');
  const pick = (re: RegExp) => t.match(re)?.[0]?.trim() ?? null;
  return [
    pick(/\*?Residence tax[^\n]*/i),
    pick(/Early booking discount[^\n]*/i),
    pick(/Prices for accomodation include[^\n]*/i),
    pick(/The beach rooms cost[^\n]*?week/i),
    pick(/Children from[^\n]*/i),
  ].filter((x): x is string => !!x).map(x => x.replace(/^\*/, ''));
}

function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text).replace(/Cookie Consent Banner by Real Cookie Banner\s*$/, '').trim();
}

export interface MkvPages { hotel: string; rooms: string; station: string; gallery: string }

export function parseMichaelsContent(p: MkvPages): OfferContent {
  const hotel = pageText(p.hotel);
  const rooms = pageText(p.rooms);
  const station = pageText(p.station);
  const rates = parseMkvRates(p.rooms);
  const notes = parseMkvNotes(p.rooms);
  const roomsText = rooms.match(/(Our \d+ rooms[\s\S]*?bed linen\.)/)?.[1] ?? '';
  const nRooms = hotel.match(/hotel has (\d+) rooms/)?.[1] ?? roomsText.match(/Our (\d+) rooms/)?.[1] ?? null;
  const nBeach = hotel.match(/(\d+) more rooms in the Beach House/)?.[1] ?? null;
  const shuttle = rooms.match(/we will charge you (EUR [\d.,]+) per room for the return journey/)?.[1] ?? null;
  const beachSurcharge = notes.find(n => /beach rooms/i.test(n)) ?? null;
  const min = rates.length ? Math.min(...rates.map(r => r.nightly)) : null;
  const max = rates.length ? Math.max(...rates.map(r => r.nightly)) : null;

  const features = [
    'Air conditioning', 'Refrigerator', 'Balcony', 'Private shower and toilet', 'Hair dryer', 'Wi-Fi',
    'Daily cleaning, towels every second day, bed linen every third day',
  ];
  const contentRooms: ContentRoom[] = [
    {
      name: MKV_UNIT,
      description: `${nRooms ?? '20'} rooms with 2, 3 or 4 beds in the hotel between vineyards and olive groves, about 200 m from the kite station and the beach.`,
      features: [...features, ...rates.map(r => `${r.persons} person${r.persons > 1 ? 's' : ''}, ${ORD[r.week]} week of stay: EUR ${r.nightly} per night${r.weekly ? ` / EUR ${r.weekly} per week` : ''} (half board)`)],
    },
    {
      name: BEACH_UNIT,
      description: `${nBeach ?? '4'} rooms in the Beach House directly on the beach, equipped like the hotel rooms.`,
      features: [...features, ...(beachSurcharge ? [beachSurcharge] : [])],
    },
  ];

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of [...imageCandidates(p.hotel, HOTEL_URL, null, 40), ...imageCandidates(p.gallery, GALLERY_URL, null, 80), ...imageCandidates(p.rooms, ROOMS_URL, null, 40)]) {
    if (/\.svg|logo|icon|Group-\d+|\/leafs?\d*\.png/i.test(u)) continue;
    const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }

  const summary = [
    `Michael's Kite Vacancies is a family-run hotel in the village of Fanes on the west coast of Rhodes, Greece, run by Michael and Lisa: ${nRooms ?? '20'} rooms about 200 m from its own kite station and the beach, plus ${nBeach ?? '4'} rooms in a Beach House directly on the beach.`,
    `Stays are half board (breakfast buffet and dinner with home-cooked Greek food)${min !== null ? `; room rates run from EUR ${min} to ${max} per night depending on persons per room and week of stay, with lower rates from the second week` : ''}.`,
    `The kite station has a beach bar, a VDWS-certified school with Cabrinha equipment, rental and storage; the airport is about 25 km away.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: "Michael's Kite Vacancies",
    summary,
    continent: 'Europe',
    country: 'Greece',
    region: 'Dodecanese',
    spot: 'Fanes, Rhodes',
    itinerarySpots: [],
    durationDays: null,
    // home page: "Whether you're a beginner or seasoned pro" (2026-10-09)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kite lessons/i.test(station),
    equipmentRental: /rent kites|equipment rental/i.test(station),
    beginnerFriendly: true,
    includedServices: ['Breakfast', 'Dinner', 'Wi-Fi in hotel and kite center', 'Daily room cleaning'],
    optionalServices: [
      'Kite and wing lessons (group or private; English, French, Italian, Spanish)',
      'Surf lessons',
      'Equipment rental (kite, wing, surf)',
      'Equipment storage',
      shuttle ? `Airport shuttle (${shuttle} per room, return)` : 'Airport shuttle',
    ],
    accommodation: 'family-run hotel rooms and beach house rooms',
    mealPlan: 'half_board',
    languages: ['en', 'de'],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: HOTEL_URL,
    bookingUrl: `${SITE}/contact/`,
    sourceText: [
      `hotel: ${hotel}`,
      `rooms & dishes: ${rooms}`,
      `kite station: ${station}`,
      `rates: ${rates.map(r => `${r.persons}p week${r.week} ${r.nightly}/night ${r.weekly ?? '-'}/week`).join('; ')}`,
      `notes: ${notes.join(' | ')}`,
    ].join('\n'),
  };
}

export const michaelsKiteVacanciesRhodes: OfferAdapter = {
  key: 'michaels-kite-vacancies-rhodes',
  name: "Michael's Kite Vacancies Rhodes",
  kind: 'accommodation',
  operator: {
    name: "Michael's Kite Vacancies",
    websiteUrl: SITE,
    rootDomain: 'kite-rhodos.com',
    contactEmail: 'info@kite-rhodos.com',
  },
  url: HOTEL_URL,
  slotMethod: 'price_table',
  fetchBudget: 5,
  async fetchContent() {
    const [hotel, rooms, station, gallery] = [
      await fetchText(HOTEL_URL, { accept: 'text/html' }),
      await fetchText(ROOMS_URL, { accept: 'text/html' }),
      await fetchText(STATION_URL, { accept: 'text/html' }),
      await fetchText(GALLERY_URL, { accept: 'text/html' }),
    ];
    return parseMichaelsContent({ hotel, rooms, station, gallery });
  },
  async fetchSlots() {
    const rates = parseMkvRates(await fetchText(MKV_PRICING_URL, { accept: 'text/html' }));
    if (rates.length < 3) throw new Error(`michaels-kite-vacancies: price table not found or changed (${rates.length} rates parsed)`);
    return buildMkvSlots(rates);
  },
};
