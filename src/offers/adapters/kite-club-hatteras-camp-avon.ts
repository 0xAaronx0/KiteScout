// ---------------------------------------------------------------------------
// Kite Club Hatteras kite camp, Avon (Hatteras Island, North Carolina, USA) - the school's dated camp weeks: 7 nights in
// a private room of the Kite Club guest house + the 3-day express course (three 3-hour private lessons with boat /
// jet ski support from the property's own canal docks) + lesson gear.
//
// Data path (checked 2026-10-14): WordPress + WooCommerce (helpers in kite-club-hatteras-avon.ts).
//   slots    /kitesurfing-camps/ prints "<year> Kite Camp Dates:" with the weeks ("April 4 - 11th", "April 25 - May 2nd",
//            "September 12 - 19th", "September 26 - October 3rd" for 2026) and the price range of the camp product
//            ("$1,500.00 - $1,600.00"; USD is the shop's currency in the Store API), "+$395" for a second person
//            sharing the private room. One slot per week that has not started yet, USD per person (package),
//            the lower end of the range (the page does not say which week costs which); availability 'unknown'.
//            The WooCommerce product's own variations ("April 15 - 22nd", "May 6 - 13th", "Sep 16 - 23rd", no year)
//            are older than the page's dated list and are not used.
//   content  /kitesurfing-camps/ + the Store API product list (camp and room photos; memoised with the stay adapter).
// robots.txt (2026-10-14): WooCommerce cart / wp-admin rules only; pages and /wp-json allowed.
// Requests per run: content 2, slots 1 (camps page memoised).
// State 2026-10-14: all four 2026 weeks are past and no 2027 dates are printed -> 0 slots ("price on request") until
//   the page lists new weeks.
// ---------------------------------------------------------------------------
import { iso, monthOf, parseAmount, todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';
import { KCH_OPERATOR, KCH_PRODUCTS_URL, KCH_SITE, kchFetch, kchText, parseKchProducts } from './kite-club-hatteras-avon.js';

export const KCC_CAMPS_URL = `${KCH_SITE}/kitesurfing-camps/`;
const NIGHTS = 7;

export interface KccWeek { start: string; end: string; label: string }
export interface KccCamp { year: number | null; weeks: KccWeek[]; priceMin: number | null; priceMax: number | null; secondPerson: number | null }

/** "<year> Kite Camp Dates: April 4 - 11th April 25 - May 2nd ..." + the price range of the camps page. */
export function parseKccCamp(html: string): KccCamp {
  const t = kchText(html).replace(/[–—]/g, '-');
  const head = t.match(/(20\d{2}) Kite Camp Dates:\s*([\s\S]*?)(?=This is the|Package Includes|$)/i);
  const year = head ? Number(head[1]) : null;
  const weeks: KccWeek[] = [];
  if (head && year) {
    const re = /([A-Z][a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?\s*-\s*(?:([A-Z][a-z]+)\.? )?(\d{1,2})(?:st|nd|rd|th)?/g;
    for (const m of head[2].matchAll(re)) {
      const m1 = monthOf(m[1]);
      const m2 = m[3] ? monthOf(m[3]) : m1;
      if (!m1 || !m2) continue;
      const start = iso(year, m1, +m[2]);
      const end = iso(m2 < m1 ? year + 1 : year, m2, +m[4]);
      weeks.push({ start, end, label: m[0].trim() });
    }
  }
  const range = t.match(/\$\s?([\d,]+(?:\.\d{2})?)\s*-\s*\$\s?([\d,]+(?:\.\d{2})?)/);
  const second = t.match(/additional \$\s?([\d,]+)/i);
  return {
    year,
    weeks,
    priceMin: range ? parseAmount(range[1]) : null,
    priceMax: range ? parseAmount(range[2]) : null,
    secondPerson: second ? parseAmount(second[1]) : null,
  };
}

export function buildKccSlots(c: KccCamp, today: string): Slot[] {
  return c.weeks.filter(w => w.start >= today).map(w => ({
    key: w.start,
    startDate: w.start,
    endDate: w.end,
    unit: 'Private room + 3-day express course',
    price: c.priceMin,
    currency: c.priceMin !== null ? 'USD' : null,
    priceUnit: c.priceMin !== null ? 'package' : null,
    priceBasis: c.priceMin !== null ? 'person' : null,
    occupancy: 1,
    availability: 'unknown',
    availabilityText: c.priceMin !== null
      ? `USD ${c.priceMin}${c.priceMax && c.priceMax !== c.priceMin ? `-${c.priceMax}` : ''} per camp week (${w.label})${c.secondPerson ? `; a second person sharing the room +USD ${c.secondPerson}` : ''}`
      : null,
    spotsLeft: null,
  }));
}

export interface KccPages { camps: string; products: string }

export function parseKiteClubCampContent(p: KccPages): OfferContent {
  const t = kchText(p.camps);
  const c = parseKccCamp(p.camps);
  const products = parseKchProducts(p.products);
  const camp = products.find(x => x.slug === 'kite-camp');
  const room = products.find(x => /private-room/.test(x.slug));
  const imageUrls: string[] = [];
  for (const u of [...(camp?.images ?? []), ...(room?.images ?? [])]) if (!imageUrls.includes(u)) imageUrls.push(u);

  const summary = [
    `Kite Club Hatteras runs kite camp weeks in Avon on Hatteras Island, North Carolina: 7 nights in a private room of the school's canal-front guest house with shared kitchen and Wi-Fi, plus the 3-day express course (three 3-hour private lessons: kite control, getting moving, learning to ride).`,
    `Lessons leave by boat or jet ski from the house's own canal to shallow, flat water on Pamlico Sound; kite, bar, harness, board, life vest, helmet and wetsuit are provided.`,
    `${c.year && c.weeks.length ? `Camp dates ${c.year}: ${c.weeks.map(w => w.label.replace(/(\d)(?:st|nd|rd|th)\b/g, '$1').replace(/\s*-\s*/, ' - ')).join(', ')}` : 'Camp weeks are dated on the camps page'}${c.priceMin ? `, at USD ${c.priceMin.toLocaleString('en-US')}${c.priceMax && c.priceMax !== c.priceMin ? ` to ${c.priceMax.toLocaleString('en-US')}` : ''} per person` : ''}${c.secondPerson ? `; a second person sharing the room pays USD ${c.secondPerson}` : ''}.`,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Kite Club Hatteras Kite Camp',
    summary,
    continent: 'North America',
    country: 'United States',
    region: 'Hatteras Island, North Carolina',
    spot: 'Avon',
    itinerarySpots: [],
    durationDays: NIGHTS + 1,
    skillLevels: ['beginner'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      `${NIGHTS} nights in a private room at the Kite Club guest house (shared kitchen and living room, Wi-Fi)`,
      '3-day express course: three 3-hour private lessons with boat / jet ski support',
      'Lesson gear: Cabrinha kite, bar, harness, board, life vest, helmet, wetsuit',
    ],
    optionalServices: c.secondPerson ? [`Second person sharing the private room (+USD ${c.secondPerson})`] : [],
    accommodation: 'private room in the kite school guest house',
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms: [],
    imageUrls: imageUrls.slice(0, 20),
    heroVideoUrl: null,
    sourceUrl: KCC_CAMPS_URL,
    bookingUrl: camp?.url || KCC_CAMPS_URL,
    sourceText: [
      `camps: ${t}`,
      `parsed: year ${c.year}; weeks ${c.weeks.map(w => `${w.start}..${w.end}`).join(', ')}; USD ${c.priceMin}-${c.priceMax}; second person +${c.secondPerson}`,
      camp ? `product ${camp.name}: ${camp.description}` : '',
    ].join('\n'),
  };
}

export async function fetchKccSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const c = parseKccCamp(await kchFetch(KCC_CAMPS_URL));
  if (!c.year || c.weeks.length === 0) throw new Error('kite-club-hatteras-camp: "<year> Kite Camp Dates" list not found (layout changed?)');
  const slots = buildKccSlots(c, today);
  if (slots.length === 0) ctx?.note(`all ${c.year} camp weeks are past (${c.weeks.map(w => w.start).join(', ')}); no new dates printed yet`);
  return slots;
}

export const kiteClubHatterasCampAvon: OfferAdapter = {
  key: 'kite-club-hatteras-camp-avon',
  name: 'Kite Club Hatteras Kite Camp, Avon',
  kind: 'camp',
  operator: KCH_OPERATOR,
  url: KCC_CAMPS_URL,
  slotMethod: 'html_dates',
  fetchBudget: 3,
  async fetchContent() {
    const camps = await kchFetch(KCC_CAMPS_URL);
    const products = await kchFetch(KCH_PRODUCTS_URL);
    return parseKiteClubCampContent({ camps, products });
  },
  fetchSlots: ctx => fetchKccSlots(todayIso(), ctx),
};
