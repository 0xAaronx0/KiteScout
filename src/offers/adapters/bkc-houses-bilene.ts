// ---------------------------------------------------------------------------
// Bilene Kite Center (BKC) Houses, Praia do Bilene (Gaza, Mozambique) - the kite school's own holiday houses right on
// its spot on the Uembje lagoon (2 en-suite bedrooms, one with sea view, shared kitchen, terrace, air conditioning,
// daily housekeeping, 4-6 guests), next to the kite centre at the Palmeiras resort. Season September to March.
//
// Liveness (checked 2026-10-12): the home page shows dated reviews "Google March 2026", "Google January 2026",
//   "Facebook December 2025"; the houses with prices are a new section of the lodging page (not in the older partner
//   list, which still gives only indicative partner-hotel prices).
// Kite link: own IKO kite & wing centre on the spot (storage, showers, rinsing and drying area, Eleveight rental,
//   lessons, guiding, downwinders); "Our own accommodations, right on the kite spot".
//
// Data path (checked 2026-10-12): www.bilenekite.com is a static Astro site in French with /en/ and /es/ copies.
//   content  /en/lodging-in-bilene-mozambique/ (BKC Houses block + photo gallery), /en/the-kite-center-in-bilene-
//            mozambique/ (centre), /en/ (season "from September to March", reviews).
//   slots    /en/lodging-in-bilene-mozambique/: <table class="house-rates"> "Option | Price / night" - "Sea view room
//            (2 pers.) 70 €", "Standard room (2 pers.) 50 €", "Whole house (4-6 pers.) 100 €". No dates, no inventory
//            ("contact us for availability and reservations") -> 'on_request'.
//   The partner hotels on the same page (Palmeiras bungalows, San Martinho, Sunset) are third-party stays with "as an
//   indication" prices: not slots of this offer.
// robots.txt (2026-10-12): Allow / (only /secret/ and /programme-ambassadeurs/ disallowed).
// Requests per run: content 3, slots 1.
// Parsed: 3 slots (two rooms per room for 2 guests, the whole house), EUR per night, no dates.
// Known limits: the season (September to March) has no year, so slots carry no dates; the room count per house and
//   the number of houses are not stated.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, parseAmount } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.bilenekite.com';
export const BKC_LODGING_URL = `${SITE}/en/lodging-in-bilene-mozambique/`;
export const BKC_CENTER_URL = `${SITE}/en/the-kite-center-in-bilene-mozambique/`;
export const BKC_HOME_URL = `${SITE}/en/`;

/** Visible text split at block tags (script/style bodies dropped). */
export function bkcLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|article|header|footer|nav|table)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

const keyPart = (s: string): string => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// --- pure parsers -----------------------------------------------------------------------------
export interface BkcRate { option: string; persons: string | null; amount: number; currency: string }

/** <table class="house-rates">: option + "70 €" per night. */
export function parseBkcRates(html: string): BkcRate[] {
  const table = html.match(/<table[^>]*class="[^"]*house-rates[^"]*"[\s\S]*?<\/table>/i)?.[0];
  if (!table) return [];
  const out: BkcRate[] = [];
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c => clean(c[1].replace(/<[^>]+>/g, ' ')));
    if (cells.length !== 2) continue;
    const amount = parseAmount(cells[1]);
    if (!amount) continue;
    out.push({
      option: cells[0].replace(/\s*\(.*?\)\s*$/, ''),
      persons: cells[0].match(/\(([\d-]+)\s*pers\.?\)/i)?.[1] ?? null,
      amount,
      currency: /€|eur/i.test(cells[1]) ? 'EUR' : /\$|usd/i.test(cells[1]) ? 'USD' : 'EUR',
    });
  }
  return out;
}

export function buildBkcSlots(rates: BkcRate[]): Slot[] {
  return rates.map(r => {
    const whole = /whole house/i.test(r.option);
    return {
      key: keyPart(r.option),
      startDate: null,
      endDate: null,
      unit: r.persons ? `${r.option} (${r.persons} guests)` : r.option,
      price: r.amount,
      currency: r.currency,
      priceUnit: 'per_night',
      priceBasis: 'room',
      occupancy: r.persons && /^\d+$/.test(r.persons) ? Number(r.persons) : null,
      availability: 'on_request',
      availabilityText: whole ? 'Whole house, 4 to 6 guests' : null,
      spotsLeft: null,
    };
  });
}

/** BKC house photos (the partner hotels' photos on the same page are left out). */
export function bkcImages(lodging: string, center: string): string[] {
  const out: string[] = [];
  const add = (path: string) => { const u = new URL(path, SITE).toString(); if (!out.includes(u)) out.push(u); };
  for (const m of lodging.matchAll(/src="(\/images\/11-Accomodation\/houses\/[^"]+\.(?:jpe?g|webp))"/gi)) add(m[1]);
  for (const m of lodging.matchAll(/src="(\/images\/11-Accomodation\/Palm_[^"]+\.(?:jpe?g|webp))"/gi)) add(m[1]);
  for (const m of center.matchAll(/src="(\/images\/2-center\/[^"]+\.(?:jpe?g|webp))"/gi)) add(m[1]);
  return out;
}

export interface BkcPages { lodging: string; center: string; home: string }

export function parseBkcContent(p: BkcPages): OfferContent {
  const lodging = bkcLines(p.lodging);
  const center = bkcLines(p.center).join(' ');
  const home = bkcLines(p.home).join(' ');
  const houseText = lodging.find(l => /^Our own accommodations/i.test(l)) ?? '';
  const rates = parseBkcRates(p.lodging);
  const season = home.match(/from (September) to (March)/i);
  const fmt = (r: BkcRate) => `${r.option.toLowerCase()} ${r.amount} ${r.currency}`;

  const rooms: ContentRoom[] = [
    {
      name: 'Sea view room',
      description: 'En-suite bedroom with sea view in a BKC house (2 guests).',
      features: ['En-suite bathroom', 'Sea view', 'Air conditioning', 'Shared kitchen and lagoon terrace', ...rates.filter(r => /sea view/i.test(r.option)).map(r => `${r.amount} ${r.currency} per night`)],
    },
    {
      name: 'Standard room',
      description: 'En-suite bedroom in a BKC house (2 guests).',
      features: ['En-suite bathroom', 'Air conditioning', 'Shared kitchen and lagoon terrace', ...rates.filter(r => /standard/i.test(r.option)).map(r => `${r.amount} ${r.currency} per night`)],
    },
    {
      name: 'Whole house',
      description: 'Both bedrooms of a BKC house for 4 to 6 guests.',
      features: ['2 en-suite bedrooms', 'Fully equipped kitchen', 'Terrace facing the lagoon', 'Barbecue and parking', ...rates.filter(r => /whole/i.test(r.option)).map(r => `${r.amount} ${r.currency} per night`)],
    },
  ];

  const summary = [
    'The BKC Houses are the Bilene Kite Center\'s own holiday houses directly on its kite spot on the shallow Uembje lagoon at Praia do Bilene, southern Mozambique, next to the kite centre at the Palmeiras resort with its beach bar and restaurant.',
    'Each house has two en-suite bedrooms (one with sea view), a shared fully equipped kitchen, a terrace facing the lagoon, barbecue, parking, air conditioning and daily housekeeping, for 4 to 6 guests' + (rates.length ? `; rooms and whole houses are rented per night (${rates.map(fmt).join(', ')}).` : '.'),
    `The centre has storage, showers and a rinsing and drying area, rents Eleveight kites and boards, teaches kite and wing with an IKO instructor and runs guiding, downwinders and trips${season ? ` in the season from ${season[1]} to ${season[2]}` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Bilene Kite Center Houses',
    summary,
    continent: 'Africa',
    country: 'Mozambique',
    region: 'Gaza',
    spot: 'Praia do Bilene',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /lessons|IKO/i.test(`${center} ${home}`),
    equipmentRental: /rental|Eleveight/i.test(`${center} ${home}`),
    beginnerFriendly: /shallow/i.test(center) ? true : null,
    includedServices: ['Towels', 'Daily housekeeping', 'Air conditioning', 'Shared kitchen', 'Parking']
      .filter(s => new RegExp(s.split(' ').pop()!, 'i').test(houseText)),
    optionalServices: [
      'Kite and wing lessons (IKO instructor) and freestyle / big air / strapless / wave coaching',
      'Eleveight kite, bar and board rental; SUP lessons and rental',
      'Guiding on the lagoon, speed spots, boat drop-offs, downwinders and kite trips along the south coast',
      'Airport transfers',
    ],
    accommodation: 'holiday houses on the kite spot (2 en-suite bedrooms each)',
    mealPlan: 'self_catering',
    languages: ['en', 'fr', 'es'],
    rooms,
    imageUrls: bkcImages(p.lodging, p.center).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: BKC_LODGING_URL,
    bookingUrl: BKC_LODGING_URL,
    sourceText: [
      `houses: ${houseText}`,
      `rates: ${rates.map(r => `${r.option} (${r.persons ?? '?'} pers.) ${r.amount} ${r.currency}`).join('; ')}`,
      `centre: ${bkcLines(p.center).filter(l => l.length > 40).join(' | ')}`,
      // season + dated review headers only (no reviewer names or quotes)
      `home: ${bkcLines(p.home).filter(l => /from September to March|^(Google|Facebook|Tripadvisor) [A-Za-z]+ 20\d\d$|reviews across/i.test(l)).join(' | ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const bkcHousesBilene: OfferAdapter = {
  key: 'bkc-houses-bilene',
  name: 'Bilene Kite Center Houses',
  kind: 'accommodation',
  operator: {
    name: 'Bilene Kite Center',
    websiteUrl: SITE,
    rootDomain: 'bilenekite.com',
    contactEmail: 'contact@bilenekite.com',
  },
  url: BKC_LODGING_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'medium', // undated nightly prices, inquiry only
  async fetchContent() {
    const lodging = await fetchText(BKC_LODGING_URL, { accept: 'text/html' });
    const center = await fetchText(BKC_CENTER_URL, { accept: 'text/html' });
    const home = await fetchText(BKC_HOME_URL, { accept: 'text/html' });
    return parseBkcContent({ lodging, center, home });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    const rates = parseBkcRates(await fetchText(BKC_LODGING_URL, { accept: 'text/html' }));
    if (rates.length === 0) throw new Error('bkc-houses-bilene: table.house-rates not found on the lodging page (layout changed?)');
    if (rates.length < 3) ctx.note(`only ${rates.length} house rates (3 expected)`);
    return buildBkcSlots(rates);
  },
};
