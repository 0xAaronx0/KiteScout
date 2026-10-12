// ---------------------------------------------------------------------------
// The Breakers Diving & Surfing Lodge, Soma Bay (Red Sea, Egypt) - 173-room watersport lifestyle hotel on
// the Soma Bay peninsula with a house reef and dive center; kiters ride at the partner 7Bft KiteHouse
// (VDWS school, rental, storage room), 8 minutes away by the hotel's free shuttle.
//
// Data path (checked 2026-10-12): WordPress/Enfold site www.thebreakers-somabay.com (English pages).
//   slots    /rooms/ - two Enfold data tables (<table class="avia-table ...">), caption "Room Rates Summer
//            2026 - per person, per night" / "Room Rates Winter 2026/2027 - per person, per night"; header
//            row "Time Frame | Single Room Sea View | Double Room Sea View", one row per period
//            ("01.11.2026-02.12.2026 | 139.00 € | 114.00 €"), half board ("All mentioned rates are on half
//            board basis, per person per night").
//   content  /hotel/ (concept, dining, facilities), /rooms/ (room types, room features, policies),
//            /sports/kitesurfing/ (7Bft KiteHouse), /gallery/ (photos), /reservation/ (request form,
//            airport transfer price).
// Booking: /reservation/ is a request form ("We will reply to you with the best available rate within 24
//   hours") -> 'on_request'. No booking engine.
// robots.txt (2026-10-12): only /wp-admin/ disallowed (admin-ajax allowed).
// Requests per run: content 5, slots 1.
// Parsed: slot = rate column (single / double room sea view) x period with the printed date limits
//   ("double-room-sea-view|2026-11-01"), EUR per person per night, occupancy 1 / 2; periods that ended
//   before today are dropped.
// Known limits: the table has one rate per period for all sea-view rooms; LifeStyle (L / XL) rooms are a
//   special request on the form without a published surcharge, so they are rooms without a price. The
//   compulsory Christmas / New Year's Eve dinner fees go into the room features.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, parse, parseAmount, parseDate, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.thebreakers-somabay.com';
export const TB_ROOMS_URL = `${SITE}/rooms/`;
const HOTEL_URL = `${SITE}/hotel/`;
const KITE_URL = `${SITE}/sports/kitesurfing/`;
const GALLERY_URL = `${SITE}/gallery/`;
const RESERVATION_URL = `${SITE}/reservation/`;

export interface TbRate { table: string; unit: string; start: string; end: string; price: number }

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Visible text split at block tags (Enfold text blocks: one entry per paragraph / list item / cell). */
export function tbLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg|select)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|caption|table)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
/** The "Room Rates ... per person, per night" tables: one rate per column x period row. */
export function parseTbRates(html: string): TbRate[] {
  const out: TbRate[] = [];
  for (const table of parse(html).querySelectorAll('table')) {
    const caption = clean(table.querySelector('caption')?.text);
    if (!/room rates/i.test(caption) || !/per person/i.test(caption)) continue;
    const rows = table.querySelectorAll('tr').map(tr => tr.querySelectorAll('th, td').map(c => clean(c.text)));
    const head = rows.find(r => /time frame/i.test(r[0] ?? ''));
    if (!head) continue;
    for (const r of rows) {
      const m = (r[0] ?? '').match(/^(\d{1,2}\.\d{1,2}\.\d{4})\s*-\s*(\d{1,2}\.\d{1,2}\.\d{4})$/);
      if (!m) continue;
      const start = parseDate(m[1]); const end = parseDate(m[2]);
      if (!start || !end) continue;
      r.slice(1).forEach((cell, i) => {
        const price = /€|eur/i.test(cell) ? parseAmount(cell) : null;
        const unit = head[i + 1];
        if (price && unit) out.push({ table: caption, unit, start, end, price });
      });
    }
  }
  return out;
}

/** Slots = rate column x period, EUR per person per night; periods that ended before `today` are dropped. */
export function buildTbSlots(rates: TbRate[], today: string): Slot[] {
  return rates.filter(r => r.end >= today).map(r => ({
    key: `${keyPart(r.unit)}|${r.start}`,
    startDate: r.start,
    endDate: r.end,
    unit: r.unit,
    price: r.price,
    currency: 'EUR',
    priceUnit: 'per_night',
    priceBasis: 'person',
    occupancy: /single/i.test(r.unit) ? 1 : /double/i.test(r.unit) ? 2 : null,
    availability: 'on_request',
    availabilityText: 'reservation request; the hotel replies with the best available rate within 24 hours',
    spotsLeft: null,
  }));
}

/** Policy sentences under the tables (half board basis, prepayment, Christmas / New Year fees). */
export function tbPolicies(roomsHtml: string): { basis: string | null; fees: string | null; prepayment: string | null } {
  const t = tbLines(roomsHtml).join(' ');
  return {
    basis: t.match(/All mentioned rates are on [^.]+\./)?.[0] ?? null,
    fees: t.match(/Compulsory fee for Christmas[^:]*:\s*[\d.,]+ € per person\.\s*Compulsory fee for New Year[^:]*:\s*[\d.,]+ € per person\./)?.[0] ?? null,
    prepayment: t.match(/To guarantee your reservation, we will need a prepayment of [^.]+?per room\./)?.[0] ?? null,
  };
}

/** Text block of a room card on /rooms/ (heading line -> following paragraph). */
function after(lines: string[], heading: RegExp): string | null {
  const i = lines.findIndex(l => heading.test(l));
  return i >= 0 && lines[i + 1] ? lines[i + 1] : null;
}

const PHOTO_JUNK = /logo|button|icon|award|zertifikat|holiday-?check|trip-?advisor|booknow|sep\.png|cam\.png|\/\d_[a-z0-9_-]+\.png|\/\d+\.png$|\/Rooms\.png$|gimmick|avatar|sprite|preview|rates_slider|watterbottles|Stefan-Reichl|Klitschko|Nasemann|Demtroder|Kajiya|Pulido|Winkowska|Ludwig|Whaley|news/i;

export function tbImages(pages: Array<[string, string]>, max = 30): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [html, base] of pages) {
    for (const u of imageCandidates(html, base, null, 80)) {
      if (!/\/wp-content\/uploads\//.test(u) || PHOTO_JUNK.test(u)) continue;
      const k = u.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '').replace(/-e\d{10,}(?=\.[a-z]+$)/i, '');
      if (seen.has(k)) continue;
      seen.add(k); out.push(u);
    }
  }
  return out.slice(0, max);
}

export interface TbPages { hotel: string; rooms: string; kite: string; gallery: string; reservation: string }

export function parseBreakersContent(p: TbPages): OfferContent {
  const hotel = tbLines(p.hotel);
  const rooms = tbLines(p.rooms);
  const kite = tbLines(p.kite);
  const reservation = tbLines(p.reservation);
  const rates = parseTbRates(p.rooms);
  const pol = tbPolicies(p.rooms);
  const roomsText = rooms.join(' ');
  const kiteText = kite.join(' ');
  const nRooms = roomsText.match(/Our (\d+) comfortable rooms/)?.[1] ?? '173';
  const size = roomsText.match(/approx\. (\d+) m²|ca\. (\d+)m²/);
  const transfer = reservation.join(' ').match(/Transfer service from \/ to Hurghada airport: Euro ([\d.,]+) per way for one or two persons/)?.[1] ?? null;
  const shuttle = kiteText.match(/(\d+)-minute complimentary shuttle/)?.[1] ?? '8';
  const fleet = kiteText.match(/rental equipment with (\d+) kites and (\d+) boards/);
  const roomFeatures = (() => {
    const i = rooms.findIndex(l => /^Our \d+ modern and comfortable guest rooms/.test(l));
    const out: string[] = [];
    for (let j = i + 1; i >= 0 && j < rooms.length && out.length < 12; j++) {
      if (/^RATES$/i.test(rooms[j])) break;
      out.push(rooms[j]);
    }
    return out;
  })();
  const priceFeatures = (unit: string) => rates.filter(r => r.unit === unit && /winter/i.test(r.table))
    .map(r => `${r.start} to ${r.end}: EUR ${r.price} per person per night (half board)`);
  const extra = [pol.basis, pol.fees, pol.prepayment].filter((x): x is string => !!x);

  const contentRooms: ContentRoom[] = [
    {
      name: 'Double Room Sea View',
      description: [`Sea-view room for two (about ${size?.[1] ?? size?.[2] ?? '28'} m²), renovated in boho style in 2023.`, after(rooms, /^Standard Rooms$/)].filter(Boolean).join(' '),
      features: [...roomFeatures, ...priceFeatures('Double Room Sea View'), ...extra],
    },
    {
      name: 'Single Room Sea View',
      description: 'Sea-view room for one guest with the same features as the double room.',
      features: [...roomFeatures, ...priceFeatures('Single Room Sea View'), ...extra],
    },
    {
      name: 'LifeStyle Room',
      description: after(rooms, /^Lifestyle Rooms$/),
      features: ['Direct sea view', 'Espresso machine', 'Bathrobe', 'Hammock', 'Requested on the reservation form ("LifeStyle room L"); no surcharge published'],
    },
    {
      name: 'XL LifeStyle Room',
      description: after(rooms, /^XL Lifestyle Rooms$/),
      features: ['Freestanding bathtub with sunrise or sunset view', 'Breakfast to the room once per week', 'Bottle of wine', 'Six rooms', 'Requested on the reservation form ("LifeStyle room XL"); no surcharge published'],
    },
  ];

  const winter = rates.filter(r => /winter/i.test(r.table));
  const minWinter = winter.length ? Math.min(...winter.map(r => r.price)) : null;
  const summary = [
    `The Breakers Diving & Surfing Lodge is a ${nRooms}-room watersport hotel in Soma Bay on the Egyptian Red Sea, with a 420 m jetty to its house reef, a dive club, pool, rooftop bar and sauna; every room has a balcony and most face the sea.`,
    `Kitesurfers ride at the 7Bft KiteHouse, ${shuttle} minutes away by the hotel's free shuttle: a flat-water lagoon spot with VDWS-certified instructors, rental (Core, Carved, goodboards), rescue boat, storage room and an island spot for downwinders.`,
    `Rates are per person per night with half board${minWinter !== null ? ` (winter 2026/27 from EUR ${minWinter} in a double room)` : ''}; bookings are made by request.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'The Breakers Diving & Surfing Lodge',
    summary,
    continent: 'Africa',
    country: 'Egypt',
    region: 'Red Sea',
    spot: 'Soma Bay',
    itinerarySpots: [],
    durationDays: null,
    // kite page: "perfect for beginners and advanced riders alike"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /Kiteschool|instruction/i.test(kiteText),
    equipmentRental: /rental/i.test(kiteText),
    beginnerFriendly: /perfect for beginners/i.test(kiteText),
    includedServices: [
      'Half board (breakfast and dinner)',
      'Unlimited drinking water',
      'Free shuttle to the 7Bft KiteHouse',
      'Sunbeds, parasols and beach towels at the pool and beach',
      'Wi-Fi',
    ],
    optionalServices: [
      'Kitesurf and wingfoil lessons at the 7Bft KiteHouse (VDWS)',
      fleet ? `Kite equipment rental (${fleet[1]} kites, ${fleet[2]} boards)` : 'Kite equipment rental',
      'Kite storage room, shop and repair service at the KiteHouse',
      'Downwinders, SUP, wakeboarding and wakesurfing',
      'Diving at the house reef (Orca Dive Club)',
      transfer ? `Hurghada airport transfer (EUR ${transfer} per way for one or two persons)` : 'Hurghada airport transfer',
      'Massage, beauty salon, sauna, gym, yoga',
    ],
    accommodation: 'hotel rooms with balcony, mostly sea view',
    mealPlan: 'half_board',
    // kite page: "German-speaking staff on-site"; the site itself is English and German
    languages: /German-speaking staff/i.test(kiteText) ? ['en', 'de'] : ['en'],
    rooms: contentRooms,
    imageUrls: tbImages([[p.rooms, TB_ROOMS_URL], [p.kite, KITE_URL], [p.gallery, GALLERY_URL], [p.hotel, HOTEL_URL]]),
    heroVideoUrl: null,
    sourceUrl: TB_ROOMS_URL,
    bookingUrl: RESERVATION_URL,
    sourceText: [
      `hotel: ${hotel.join(' ')}`,
      `rooms: ${rooms.join(' ')}`,
      `kitesurfing: ${kiteText}`,
      `reservation: ${reservation.join(' ')}`,
      `rates: ${rates.map(r => `${r.unit} ${r.start}..${r.end} EUR ${r.price}`).join('; ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const theBreakersSomaBay: OfferAdapter = {
  key: 'the-breakers-soma-bay',
  name: 'The Breakers Diving & Surfing Lodge Soma Bay',
  kind: 'accommodation',
  operator: {
    name: 'The Breakers Diving & Surfing Lodge',
    websiteUrl: SITE,
    rootDomain: 'thebreakers-somabay.com',
    contactEmail: 'info@thebreakers-somabay.com',
    phone: '+201277554460',
  },
  url: TB_ROOMS_URL,
  slotMethod: 'price_table',
  fetchBudget: 6,
  async fetchContent() {
    const [hotel, rooms, kite, gallery, reservation] = [
      await fetchText(HOTEL_URL, { accept: 'text/html' }),
      await fetchText(TB_ROOMS_URL, { accept: 'text/html' }),
      await fetchText(KITE_URL, { accept: 'text/html' }),
      await fetchText(GALLERY_URL, { accept: 'text/html' }),
      await fetchText(RESERVATION_URL, { accept: 'text/html' }),
    ];
    return parseBreakersContent({ hotel, rooms, kite, gallery, reservation });
  },
  async fetchSlots() {
    const rates = parseTbRates(await fetchText(TB_ROOMS_URL, { accept: 'text/html' }));
    if (rates.length < 4) throw new Error(`the-breakers: rate tables not found or changed (${rates.length} rates parsed)`);
    return buildTbSlots(rates, todayIso());
  },
};
