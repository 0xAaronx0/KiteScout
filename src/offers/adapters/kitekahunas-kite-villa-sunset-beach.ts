// ---------------------------------------------------------------------------
// KITEKAHUNAS Kite Villa, Sunset Beach (Cape Town, South Africa) - the kitesurfing guesthouse of the KITEKAHUNAS kite
// school ("Live where you learn ... the school is right there"), about 70 m from the ocean at the start of Blouberg
// strand: four rooms around a salt-water pool, plus two one-bedroom apartments in the school's Beach House nearby.
//
// Liveness (checked 2026-10-12): WordPress modified dates (wp-json) - price pages 2026-02-09 and 2026-02-13 (the
//   2026-02-13 copy repeats this accommodation table), wave camp / wave course pages 2025-11-23, home 2025-10-08,
//   this guesthouse page 2025-07-25. No dated season or 2026/27 text on the page itself.
// Kite link: own kite school (beginner crash courses A-D, wave camps); "Kitesurfing storage ... is for free for all
//   kitesurfing students of our school", kite storage row in the price table.
//
// Data path (checked 2026-10-12): www.kitekahunas.com/kitesurfing_guesthouse/ (WordPress + TablePress).
//   content  the guesthouse page: villa intro, off-season offer ("15th April until 30th September ... 50% discount
//            on all rooms", whole house EUR 179 per night), room and apartment <h2> cards, contact (Tel/WhatsApp).
//   slots    two TablePress tables: "Rooms | Occupation | Price per night - low season (in EUR) | ... high season" -
//            per room one cell per occupancy line ("1 person<br>2 persons" / "95<br>105"); apartments table the same.
//            The kite-storage row (10 / 15 EUR per day, free with any room) is a service, not a slot.
// Booking: enquiry form /contact_kitesurfing/ and phone / WhatsApp -> 'on_request'.
// robots.txt (2026-10-12): only /wp-admin/ disallowed.
// Requests per run: content 1, slots 1.
// Parsed: one slot per room / apartment x occupancy x season (low / high), EUR per night, no dates (the page does not
//   date low and high season; the price page names the kite season "Mid of October" to "End of March" with high-peak
//   November to February, which we do not map onto the table); Room 4 is a shared room priced per person.
// Known limits: the low/high split has no date limits here; the off-season 50% discount and peak "please ask" rates
//   are in the text only.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, parseAmount } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kitekahunas.com';
export const KK_GUESTHOUSE_URL = `${SITE}/kitesurfing_guesthouse/`;
const CONTACT_URL = `${SITE}/contact_kitesurfing/`;

/** Visible text split at block tags (script/style bodies dropped), en/em dashes normalised to hyphens. */
export function kkLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|article|header|footer|nav)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')).replace(/\s*[–—]\s*/g, ' - '))
    .filter(Boolean);
}

const keyPart = (s: string): string => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// --- pure parsers -----------------------------------------------------------------------------
export interface KkRate { unit: string; house: 'villa' | 'apartments'; persons: string; season: 'low' | 'high'; amount: number }

const cellLines = (cell: string): string[] => cell.split(/<br\s*\/?>/i).map(x => clean(x.replace(/<[^>]+>/g, ' '))).filter(Boolean);

/** TablePress tables: per row the unit, occupancy lines and low / high season price lines (same order). */
export function parseKkRates(html: string): KkRate[] {
  const out: KkRate[] = [];
  for (const t of html.matchAll(/<table[^>]*id="tablepress-\d+"[\s\S]*?<\/table>/gi)) {
    const table = t[0];
    if (!/low season/i.test(table) || !/high season/i.test(table)) continue;
    const house = /Apartment/i.test(table.match(/<th[^>]*>([\s\S]*?)<\/th>/i)?.[1] ?? '') ? 'apartments' : 'villa';
    for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1]);
      if (cells.length !== 4) continue;
      const unit = cellLines(cells[0]).join(' ');
      if (!/^(Room|Apartment)\s+\d/i.test(unit)) continue; // header rows ("Kitesurfing Villa ...") and kite storage
      const persons = cellLines(cells[1]);
      const low = cellLines(cells[2]).map(x => parseAmount(x));
      const high = cellLines(cells[3]).map(x => parseAmount(x));
      persons.forEach((p, i) => {
        if (low[i]) out.push({ unit, house, persons: p, season: 'low', amount: low[i]! });
        if (high[i]) out.push({ unit, house, persons: p, season: 'high', amount: high[i]! });
      });
    }
  }
  return out;
}

const occupancyOf = (persons: string): number | null => {
  const m = persons.match(/(\d+)\s*(?:-\s*(\d+))?\s*persons?/i);
  return m ? Number(m[2] ?? m[1]) : null;
};

export function buildKkSlots(rates: KkRate[]): Slot[] {
  return rates.map(r => {
    const occ = occupancyOf(r.persons);
    const shared = /^Room 4\b/i.test(r.unit); // "Shared Bedroom with Shared Bathroom", one bed per person
    return {
      key: `${keyPart(r.unit)}-${occ ?? 'x'}p|${r.season}`,
      startDate: null,
      endDate: null,
      unit: r.house === 'villa' ? `Kite Villa ${r.unit}` : `Beach House ${r.unit}`,
      price: r.amount,
      currency: 'EUR',
      priceUnit: 'per_night',
      priceBasis: shared ? 'person' : 'room',
      occupancy: occ,
      availability: 'on_request',
      availabilityText: `${r.season} season`,
      spotsLeft: null,
    };
  });
}

/** Room / apartment cards: "<h2>Room 1 - Master Bedroom with large Ensuite Bathroom</h2>" + the first paragraph. */
export function parseKkCards(html: string): ContentRoom[] {
  const out: ContentRoom[] = [];
  for (const m of html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h[12][\s>])/gi)) {
    const head = clean(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s*[–—]\s*/g, ' - ');
    const card = head.match(/^((?:Room|Apartment) \d)\s*-\s*(.+)$/i);
    if (!card) continue;
    const paras = [...m[2].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(p => clean(p[1].replace(/<[^>]+>/g, ' ')).replace(/\s*[–—]\s*/g, ' - ')).filter(p => p.length > 30);
    const beds = paras.find(p => /bed \(|single beds|queen size|King Size/i.test(p)) ?? null;
    out.push({
      name: `${/^Room/i.test(card[1]) ? 'Kite Villa' : 'Beach House'} ${card[1]}`,
      description: card[2],
      features: beds ? [beds.replace(/\s*Prices? (?:are|shown) below\.?$/i, '')] : [],
    });
  }
  return out;
}

export function parseKkContent(html: string): OfferContent {
  const lines = kkLines(html);
  const text = lines.join(' ');
  const rates = parseKkRates(html);
  const cards = parseKkCards(html);
  const villaLow = rates.filter(r => r.house === 'villa' && r.season === 'low' && !/^Room 4\b/i.test(r.unit)).map(r => r.amount).sort((a, b) => a - b);
  const sharedLow = rates.find(r => /^Room 4\b/i.test(r.unit) && r.season === 'low')?.amount ?? null;
  const offSeason = text.match(/(15th April until 30th September)[^:]*:\s*(50% discount on all rooms)/i);
  const wholeHouse = text.match(/entire house, with (\d) bedrooms for EUR (\d+) per night/i);
  const storage = text.match(/Kite-Storage:\s*FREE when booking any of our rooms or apartments/i);

  const summary = [
    'The Kite Villa is the guesthouse of the KITEKAHUNAS kite school in Sunset Beach, Cape Town, about 70 m from the ocean at the start of Blouberg strand, so guests live where they learn and walk to lessons.',
    `It has four rooms (two master bedrooms with en-suite bathrooms, a private room and a shared room with shared bathrooms) around a salt-water pool, terrace, large kitchen, TV lounge and braai, plus two one-bedroom apartments in the school's Beach House 50 m from the beach${villaLow.length ? `; private rooms cost ${villaLow[0]} to ${villaLow[villaLow.length - 1]} EUR per night in low season${sharedLow ? ` (a bed in the shared room ${sharedLow} EUR)` : ''}, a little more in high season` : ''}.`,
    `Kite storage is free with any room${offSeason ? `, and outside the kite season (${offSeason[1].replace('15th April until 30th September', '15 April to 30 September')}) all rooms are half price${wholeHouse ? ` or the whole ${wholeHouse[1]}-bedroom house is ${wholeHouse[2]} EUR per night` : ''}` : ''}; bookings go through the school's enquiry form or WhatsApp.`,
  ].join(' ');

  const imgs: string[] = [];
  for (const u of imageCandidates(html, KK_GUESTHOUSE_URL, null, 80)) {
    if (!/kitekahunas\.com\/wp-content\/uploads\//.test(u) || /_kite\.jpe?g$|logo|icon|cropped-|\.png$|\.svg$/i.test(u)) continue;
    if (!imgs.includes(u)) imgs.push(u);
  }

  return {
    kind: 'accommodation',
    title: 'KITEKAHUNAS Kite Villa',
    summary,
    continent: 'Africa',
    country: 'South Africa',
    region: 'Western Cape',
    spot: 'Sunset Beach, Cape Town',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kitesurfing school|beginner crash course/i.test(text),
    equipmentRental: null,
    beginnerFriendly: /new to kitesurfing|zero experience/i.test(text),
    includedServices: [
      storage ? 'Kite storage (free with any room or apartment)' : null,
      /salt water swimming pool/i.test(text) ? 'Salt-water swimming pool' : null,
      /large designer kitchen/i.test(text) ? 'Shared designer kitchen, TV lounge and braai' : null,
      /free and fast WiFi/i.test(text) ? 'Free fast Wi-Fi' : null,
    ].filter((x): x is string => !!x),
    optionalServices: [
      'KITEKAHUNAS kitesurfing beginner crash course (modules A to D) and wave kitesurfing courses and camps',
      'Kite storage for non-guests: 10 EUR per day (low season), 15 EUR per day (high season)',
    ],
    accommodation: 'kitesurf guesthouse rooms and beach apartments',
    mealPlan: 'self_catering',
    languages: ['en', 'de'],
    rooms: cards,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KK_GUESTHOUSE_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `page: ${lines.filter(l => l.length > 40).join(' | ')}`,
      `rates: ${rates.map(r => `${r.unit} ${r.persons} ${r.season} EUR ${r.amount}`).join('; ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const kitekahunasKiteVillaSunsetBeach: OfferAdapter = {
  key: 'kitekahunas-kite-villa-sunset-beach',
  name: 'KITEKAHUNAS Kite Villa',
  kind: 'accommodation',
  operator: {
    name: 'KITEKAHUNAS',
    websiteUrl: SITE,
    rootDomain: 'kitekahunas.com',
    whatsapp: '+27727120498',
    phone: '+27727120498',
  },
  url: KK_GUESTHOUSE_URL,
  slotMethod: 'price_table',
  fetchBudget: 2,
  confidence: 'low', // undated low/high season prices on a page last edited 2025-07-25 (same table re-saved 2026-02-13)
  async fetchContent() {
    return parseKkContent(await fetchText(KK_GUESTHOUSE_URL, { accept: 'text/html' }));
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    const rates = parseKkRates(await fetchText(KK_GUESTHOUSE_URL, { accept: 'text/html' }));
    if (rates.length === 0) throw new Error('kitekahunas-kite-villa-sunset-beach: no TablePress low/high season tables (layout changed?)');
    if (!rates.some(r => r.house === 'apartments')) ctx.note('apartment price table not found');
    return buildKkSlots(rates);
  },
};
