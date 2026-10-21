// ---------------------------------------------------------------------------
// Kitesurfing Lanka (KSL), Kandakuliya (Kalpitiya, North Western Province, Sri Lanka) - kite and wing foil camp
// on an 8-acre former coconut estate between the Indian Ocean and the Kandakuliya lagoon: IKO kite school, wing
// school, rental, shop, kite trips; beach, lagoon-view, garden and premium bungalows, glamping tents and a
// four-bedroom villa, all full board. Found via bstoked listing 7335 ("Kitesurfing Paradise in Sri Lanka",
// Kandakuliya) - bstoked is a hint only, nothing is read from it.
//
// Data path (checked 2026-10-12): WordPress (theme "ksl", AIOSEO), English pages.
//   content  / (seasons, services, news), /stay/ (room cards with Single/Double "x EUR/pp, Full board", what is
//            included) and /how-much/ (rates, lessons, rental, kite trips).
//   slots    /how-much/ "Accommodation Rates" <table>: rows = room type ("Beach bungalow (1-4 pax)"), columns
//            Single / Double / Triple / Quadruple, cells "100 EUR / pp - Full board" or "/" (not offered).
//            No dates, no engine: "Book Now" opens the inquiry form /contact-us-inquiry-form/ -> 'on_request'.
// Liveness (rule 5b, Aaron 2026-10-12): home page news dated 8 Oct, 30 Sep, 22 Sep 2026 ("We Are Hiring: IKO Kite
//   Instructors for Winter 2026/27", mid-December 2026 to mid-March 2027); AIOSEO WebPage dateModified
//   2026-06-09; room photos uploaded 2026/03.
// robots.txt (2026-10-12): "User-agent: * Allow: /" (only Googlebot has a /nogooglebot/ rule).
// Requests per run: content 3 (/how-much/ memoised), slots 1.
// Parsed: slot per room type x occupancy column, EUR per person per night incl. full board, occupancy = column
//   (1-4); the "Double bedroom garden bungalow" row is marked "(Per room)" per bedroom (3 pax per room) and is
//   still a per-person price. The villa's "85-100 EUR/pp" range on /stay/ is not in the table (table: 85).
// Known limits: one price for the whole year (the site says rates depend on room and season, but publishes one
//   table); spotCoords omitted (no map embed or JSON-LD geo on the site; address Dutch Bay Road, Kandakuliya).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, ldOfType, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kitesurfinglanka.com';
export const KSL_HOME_URL = `${SITE}/`;
export const KSL_STAY_URL = `${SITE}/stay/`;
export const KSL_RATES_URL = `${SITE}/how-much/`;
const INQUIRY_URL = `${SITE}/contact-us-inquiry-form/`;
const OCC_WORDS: Record<string, number> = { single: 1, double: 2, triple: 3, quadruple: 4 };

export interface KslRate { room: string; occupancy: number; price: number; perRoomNote: boolean; raw: string }
export interface KslRoomCard { name: string; url: string; text: string | null; prices: string[] }

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const pageCache = new Map<string, Promise<string>>();
function page(url: string): Promise<string> {
  if (!pageCache.has(url)) {
    const p = fetchText(url, { accept: 'text/html' });
    p.catch(() => pageCache.delete(url));
    pageCache.set(url, p);
  }
  return pageCache.get(url)!;
}

function mainText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}

// --- pure parsers -------------------------------------------------------------------------------------
/** /how-much/: the first table whose header row is Room | Single | Double | Triple | Quadruple. */
export function parseKslRates(html: string): KslRate[] {
  for (const table of parse(html).querySelectorAll('table')) {
    const rows = table.querySelectorAll('tr');
    const head = rows[0]?.querySelectorAll('th, td').map(c => collapse(c.text).toLowerCase()) ?? [];
    if (head[0] !== 'room' || !head.slice(1).every(h => h in OCC_WORDS)) continue;
    const out: KslRate[] = [];
    for (const tr of rows.slice(1)) {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 2) continue;
      const room = collapse(cells[0].text);
      cells.slice(1).forEach((td, i) => {
        const raw = collapse(td.text);
        const price = /€/.test(raw) ? parseAmount(raw) : null;
        const occupancy = OCC_WORDS[head[i + 1]];
        if (room && price !== null && occupancy) out.push({ room, occupancy, price, perRoomNote: /per room/i.test(raw), raw });
      });
    }
    return out;
  }
  return [];
}

/** "Beach bungalow (1-4 pax)" -> "Beach bungalow"; "Double bedroom garden bungalow 1-6 pax (3 pax per room)" -> "Double bedroom garden bungalow". */
export function kslRoomName(room: string): string {
  return collapse(room.replace(/\(?\s*\d+\s*-\s*\d+\s*pax\s*\)?/i, '').replace(/\(\s*\d+\s*pax per room\s*\)/i, ''));
}

/** Rate-table unit -> /stay/ card name (the content room), where the two name the same room differently.
 *  "Family and Group Options" is a card without its own table row; units named like their card match without this. */
export const KSL_ROOM_BY_UNIT: Record<string, string> = {
  'premium bungalow': 'Premium Bungalows',
  'lagoon view bungalow': 'Lagoon View Bungalows',
  'garden view bungalow': 'Garden View Bungalows',
  'glamping tent': 'Glamping',
  'ksl villa': 'Four Bedroom Villa',
};

export function buildKslSlots(rates: KslRate[]): Slot[] {
  const out: Slot[] = [];
  for (const r of rates) {
    const unit = kslRoomName(r.room);
    const key = `${keyPart(unit)}|${r.occupancy}p`;
    if (out.some(s => s.key === key)) continue;
    const room = KSL_ROOM_BY_UNIT[unit.toLowerCase()];
    out.push({
      key,
      startDate: null,
      endDate: null,
      unit,
      ...(room ? { room } : {}),
      price: r.price,
      currency: 'EUR',
      priceUnit: 'per_night',
      priceBasis: 'person',
      occupancy: r.occupancy,
      availability: 'on_request',
      availabilityText: 'inquiry form, full board included',
      spotsLeft: null,
    });
  }
  return out;
}

/** /stay/ room cards: a.card with the name, blurb and "Single 145 EUR/pp Full board" columns. */
export function parseKslRoomCards(html: string): KslRoomCard[] {
  const out: KslRoomCard[] = [];
  for (const card of parse(html).querySelectorAll('.card.card__3')) {
    const name = collapse(card.querySelector('.card-title')?.text ?? '');
    const url = card.closest('a')?.getAttribute('href') ?? card.querySelector('a')?.getAttribute('href') ?? '';
    if (!name || out.some(c => c.name === name)) continue;
    const prices = card.querySelectorAll('.row .col').map(col => collapse(col.text)).filter(t => /€/.test(t));
    out.push({ name, url, text: collapse(card.querySelector('.x-small')?.text ?? '') || null, prices });
  }
  return out;
}

export interface KslPages { home: string; stay: string; rates: string }

export function parseKslContent(p: KslPages): OfferContent {
  const home = mainText(p.home);
  const stay = mainText(p.stay);
  const rates = mainText(p.rates);
  const cards = parseKslRoomCards(p.stay);
  const table = parseKslRates(p.rates);
  const summer = home.match(/Summer Season \(([^)]+)\)/)?.[1] ?? null;
  const winter = home.match(/Winter Season \(([^)]+)\)/)?.[1] ?? null;
  const acres = home.match(/Our (\d+)-acre beachfront property/)?.[1] ?? null;
  const lesson = rates.match(/Standard rate \(per hour\) (\d+) € (\d+) €/);
  const rental = rates.match(/Kitesurfing gear \(full set-up\) (\d+) € (\d+) €/);
  const modified = (ldOfType(p.home, 'WebPage')[0]?.dateModified as string | undefined) ?? null;
  const minPrice = table.length ? Math.min(...table.map(r => r.price)) : null;

  const rooms: ContentRoom[] = cards.map(c => ({
    name: c.name,
    description: c.text,
    features: [
      ...c.prices.map(x => x.replace(/\s*Full board$/i, ' (full board)')),
      ...table.filter(r => kslRoomName(r.room).toLowerCase() === c.name.toLowerCase().replace(/s$/, '')).map(r => `${r.occupancy} person${r.occupancy > 1 ? 's' : ''}: EUR ${r.price} per person per night, full board`),
    ],
  }));

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of [...imageCandidates(p.home, KSL_HOME_URL, null, 40), ...imageCandidates(p.stay, KSL_STAY_URL, null, 40)]) {
    if (/logo|icon|flag|trustindex|tripadvisor|google|\.svg|avatar|gravatar|\/themes\/ksl\/assets\//i.test(u)) continue;
    const k = u.replace(/-\d+x\d+(?=\.[a-z]+$)|-scaled(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }

  const summary = [
    `Kitesurfing Lanka (KSL) is a kite and wing foil camp in Kandakuliya on the Kalpitiya peninsula in north-western Sri Lanka, on ${acres ? `an ${acres}-acre` : 'a'} former coconut estate between the ocean and the lagoon, with its own IKO kite school, wing school, gear rental and kite trips.`,
    `Guests stay in beach, lagoon-view, garden and premium bungalows, glamping tents or a four-bedroom villa; all stays are full board and include gear storage, the spot in front of the camp and seasonal transport to the Kalpitiya lagoon${minPrice !== null ? `, from EUR ${minPrice} per person per night` : ''}.`,
    summer && winter ? `The wind seasons are ${summer.replace(/[–—]/g, 'to')} and ${winter.replace(/[–—]/g, 'to')}.` : '',
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Kitesurfing Lanka',
    summary,
    continent: 'Asia',
    country: 'Sri Lanka',
    region: 'North Western Province',
    spot: 'Kandakuliya, Kalpitiya',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /IKO/.test(home + rates),
    equipmentRental: /Gear Rental/i.test(home + rates),
    beginnerFriendly: true,
    includedServices: ['Full board (breakfast, lunch, dinner)', 'Gear storage', 'Access to the kite spot in front of the camp', 'Transport to Kalpitiya Big Lagoon (seasonal)', 'Access to all on-site facilities'],
    optionalServices: [
      lesson ? `Kite lessons (IKO): private EUR ${lesson[1]} / group EUR ${lesson[2]} per hour, gear and transfers included` : 'Kite lessons (IKO)',
      rental ? `Kite gear rental (full set-up): EUR ${rental[1]} half day / EUR ${rental[2]} day` : 'Kite gear rental',
      'Wing foil lessons and rental',
      'Kite trips (half day, full day, overnight)',
      'Kite shop and repairs',
      'Yoga, diving, dolphin and whale watching, excursions',
      'Airport transfer (price on request)',
    ],
    accommodation: 'bungalows, glamping tents and a villa on a beachfront camp',
    mealPlan: 'full_board',
    languages: [],
    rooms,
    imageUrls: imageUrls.slice(0, 40),
    heroVideoUrl: null,
    sourceUrl: KSL_STAY_URL,
    bookingUrl: INQUIRY_URL,
    sourceText: [
      `home (dateModified ${modified ?? '?'}): ${home}`,
      `stay: ${stay}`,
      `rates table: ${table.map(r => `${r.room} ${r.occupancy}p ${r.raw}`).join('; ')}`,
      `how much: ${rates}`,
    ].join('\n'),
  };
}

export const kitesurfingLankaKalpitiya: OfferAdapter = {
  key: 'kitesurfing-lanka-kalpitiya',
  name: 'Kitesurfing Lanka (Kalpitiya)',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Kitesurfing Lanka',
    websiteUrl: SITE,
    rootDomain: 'kitesurfinglanka.com',
    contactEmail: 'info@kitesurfinglanka.com', // footer, 2026-10-12
    phone: '+94766839462',                    // KSL hotline, footer + JSON-LD
  },
  url: KSL_STAY_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  async fetchContent() {
    const home = await page(KSL_HOME_URL);
    const stay = await page(KSL_STAY_URL);
    const rates = await page(KSL_RATES_URL);
    return parseKslContent({ home, stay, rates });
  },
  async fetchSlots() {
    const rates = parseKslRates(await page(KSL_RATES_URL));
    if (rates.length < 10) throw new Error(`kitesurfing-lanka: rate table not found or changed (${rates.length} cells)`);
    return buildKslSlots(rates);
  },
};
