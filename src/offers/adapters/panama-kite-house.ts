// ---------------------------------------------------------------------------
// Panama Kite House & Villa, Punta Chame (Panama) - all-inclusive kitesurf guesthouse on the main kite
// beach + the Kitesurfers Villa 150 m away; run by The Rider Experience Ltd (UK). Open December-April,
// minimum stay 5 nights.
//
// Data path (checked 2026-10-09):
//   content  www.theriderexperience.com/panama-kite-house (Squarespace: overview, season, trailer)
//            + www.panamakitehouse.com/kitehouse and /the-kitesurfers-villa (room cards, facilities).
//   slots    static price tables on www.panamakitehouse.com: per room an <h3> name followed by
//            <table class="prices"> - header columns = persons (one 👤 per guest), row "5 Days" =
//            package price in USD per room ("from $875" on the kite house page = lowest seasonal
//            price; villa prices are fixed, plus an "Extra Day" row). The season bands come from the
//            season calendar script on /book-now-overview (ranges [{start,end,season:"shoulder"|"high"}]).
// Booking engine: bookings.panamakitehouse.com = Bookinglayer (business 2766); its data API
//   api.bookinglayer.io has robots.txt "Disallow: /" -> we do not call it, so there is no live
//   availability (slots stay 'unknown').
// robots.txt (2026-10-09): theriderexperience.com (Squarespace) disallows /api/, /static/, ?format=json
//   etc., not the pages we read; panamakitehouse.com the same Squarespace defaults.
// Requests per run: content 3, slots 3.
// Parsed: slot = room x persons for the 2026/27 season band ("premium-seaview-cabin-2p|2026-27"), USD
//   per room (per bed for the dorm) for a 5-day stay (priceUnit 'package'), availability 'unknown'.
// Known limits: kite house prices are "from" prices (seasonal pricing, the exact price only in the
//   booking system); villa meal upgrades (+$16 / +$32 pp per night) are in the room features only.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, detectCurrency, imageCandidates, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot, SlotPriceBasis } from '../types.js';

export const PKH_PAGE_URL = 'https://www.theriderexperience.com/panama-kite-house';
const PKH = 'https://www.panamakitehouse.com';
export const PKH_KITEHOUSE_URL = `${PKH}/kitehouse`;
export const PKH_VILLA_URL = `${PKH}/the-kitesurfers-villa`;
export const PKH_SEASON_URL = `${PKH}/book-now-overview`;
const BOOKING_URL = 'https://bookings.panamakitehouse.com/en/';
const PACKAGE_DAYS = 5;

export interface PkhPrice { persons: number; amount: number; currency: string; from: boolean }
export interface PkhRoom { name: string; features: string[]; prices: PkhPrice[]; extraDay: Array<{ persons: number; amount: number }> }
export interface PkhSeason { start: string; end: string; bands: Array<{ start: string; end: string; season: string }> }

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const PERSON = /\u{1F464}|&#128100;/gu;
const HAS_PERSON = /\u{1F464}|&#128100;/u;

// --- pure parsers -----------------------------------------------------------------------------
/** Room cards: every <table class="prices"> belongs to the last <h3> before it (Squarespace blocks). */
export function parsePkhRooms(html: string, prefix = ''): PkhRoom[] {
  const marks: Array<{ at: number; h3?: { name: string; features: string[] }; table?: string }> = [];
  for (const m of html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>\s*(<p[^>]*>([\s\S]*?)<\/p>)?/g)) {
    const name = collapse(parse(m[1]).text);
    const features = (m[3] ?? '').split(/<br\s*\/?>/i).map(x => collapse(parse(x).text)).filter(Boolean);
    if (name) marks.push({ at: m.index!, h3: { name, features } });
  }
  for (const m of html.matchAll(/<table class="prices"[\s\S]*?<\/table>/g)) marks.push({ at: m.index!, table: m[0] });
  marks.sort((a, b) => a.at - b.at);
  const out: PkhRoom[] = [];
  let card: { name: string; features: string[] } | null = null;
  for (const mk of marks) {
    if (mk.h3) { card = mk.h3; continue; }
    if (!card || !mk.table) continue;
    // rows split by regex: the tables contain unclosed <tr>s ("<td> from $550 </td> <tr> </tr>"),
    // which a DOM parser nests into the wrong row
    const rows = [...mk.table.matchAll(/<tr[^>]*>([\s\S]*?)(?=<tr[\s>]|<\/tbody>|<\/thead>|<\/table>)/g)]
      .map(r => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(td => td[1]));
    const theadEnd = mk.table.indexOf('</thead>');
    const headRow = rows.find(r => r.some(c => HAS_PERSON.test(c))) ?? [];
    const head = headRow.slice(1).map(c => (c.match(PERSON) ?? []).length);
    const room: PkhRoom = { name: `${prefix}${card.name}`, features: card.features, prices: [], extraDay: [] };
    const bodyRows = theadEnd >= 0
      ? [...mk.table.slice(theadEnd).matchAll(/<tr[^>]*>([\s\S]*?)(?=<tr[\s>]|<\/tbody>|<\/table>)/g)].map(r => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(td => td[1]))
      : rows.slice(1);
    for (const raw of bodyRows) {
      const cells = raw.map(c => collapse(parse(c).text));
      if (cells.length < 2) continue;
      const label = cells[0].toLowerCase();
      cells.slice(1).forEach((c, i) => {
        const amount = parseAmount(c);
        const persons = head[i] || i + 1;
        if (!amount) return;
        if (/extra day/.test(label)) room.extraDay.push({ persons, amount });
        else if (new RegExp(`^${PACKAGE_DAYS}\\s+days?$`).test(label)) {
          room.prices.push({ persons, amount, currency: detectCurrency(c) ?? 'USD', from: /\bfrom\b/i.test(c) });
        }
      });
    }
    if (room.prices.length) out.push(room);
    card = null;
  }
  return out;
}

/** Season bands from the calendar script; fallback "Season Calendar 2026 / 2027" + "December to April". */
export function parsePkhSeason(html: string): PkhSeason | null {
  const bands = [...html.matchAll(/\{\s*start\s*:\s*"(\d{4}-\d{2}-\d{2})"\s*,\s*end\s*:\s*"(\d{4}-\d{2}-\d{2})"\s*,\s*season\s*:\s*"(\w+)"\s*\}/g)]
    .map(m => ({ start: m[1], end: m[2], season: m[3] }));
  if (bands.length) {
    return { start: bands.map(b => b.start).sort()[0], end: bands.map(b => b.end).sort().reverse()[0], bands };
  }
  const y = html.match(/Season Calendar\s+(20\d{2})\s*\/\s*(20\d{2})/);
  if (y && /December (?:to|until|-) April/i.test(collapse(parse(html).text))) return { start: `${y[1]}-12-01`, end: `${y[2]}-04-30`, bands: [] };
  return null;
}

export function buildPkhSlots(rooms: PkhRoom[], season: PkhSeason): Slot[] {
  const label = `${season.start.slice(0, 4)}-${season.end.slice(2, 4)}`;
  const out: Slot[] = [];
  for (const r of rooms) {
    // the 6-bed dorm is sold per bed; every other card prices the whole room for 1..n guests
    const basis: SlotPriceBasis = /^dorm\b/i.test(r.name) ? 'person' : 'room';
    for (const p of r.prices) {
      out.push({
        key: `${keyPart(r.name)}-${p.persons}p|${label}`,
        startDate: season.start,
        endDate: season.end,
        unit: r.name,
        price: p.amount,
        currency: p.currency,
        priceUnit: 'package',
        priceBasis: basis,
        occupancy: p.persons,
        availability: 'unknown',
        availabilityText: null,
        spotsLeft: null,
        // tables say "5 Days" (+ "Extra Day"), the page "minimum stay of 5 Nights": read as a 5-night package (inferred)
        packageNights: 5,
      });
    }
  }
  return out;
}

function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('#page') ?? root.querySelector('body') ?? root).text);
}

export interface PkhPages { rider: string; kitehouse: string; villa: string }

export function parsePanamaContent(p: PkhPages): OfferContent {
  const rider = pageText(p.rider);
  const kh = pageText(p.kitehouse);
  const villa = pageText(p.villa);
  const houseRooms = parsePkhRooms(p.kitehouse);
  const villaRooms = parsePkhRooms(p.villa, 'Villa ');
  const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

  const rooms: ContentRoom[] = [...houseRooms, ...villaRooms].map(r => ({
    name: r.name,
    description: r.name.startsWith('Villa ') ? 'Room in the Kitesurfers Villa, 150 m from the kite house (bed & breakfast; half or full board on request).' : 'Room at the Panama Kite House, all meals included.',
    features: [
      ...r.features,
      ...r.prices.map(x => `${x.persons} guest${x.persons > 1 ? 's' : ''}: ${PACKAGE_DAYS} days ${x.from ? 'from ' : ''}${usd(x.amount)}`),
      ...r.extraDay.map(x => `${x.persons} guest${x.persons > 1 ? 's' : ''}: extra day +${usd(x.amount)}`),
    ],
  }));

  const imgs: string[] = [];
  const seen = new Set<string>();
  for (const [html, base] of [[p.kitehouse, PKH_KITEHOUSE_URL], [p.rider, PKH_PAGE_URL], [p.villa, PKH_VILLA_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 80)) {
      if (!/squarespace/.test(u) || /logo|screenshot|untitled|icon|\.svg/i.test(u)) continue;
      const k = u.replace(/\?.*$/, '').replace(/^https?:\/\/[^/]+/, '');
      if (seen.has(k)) continue;
      seen.add(k); imgs.push(u.replace(/^http:/, 'https:'));
    }
  }
  const trailer = p.rider.match(/href="(https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]+)"[^>]*>[^<]*(?:<[^>]+>[^<]*)*?Trailer/i)?.[1]
    ?? p.rider.match(/https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]+/)?.[0] ?? null;
  const cheapest = houseRooms.flatMap(r => r.prices.map(x => ({ r, x }))).filter(({ r }) => !/^dorm/i.test(r.name)).sort((a, b) => a.x.amount - b.x.amount)[0];

  const summary = [
    'Panama Kite House is an all-inclusive kitesurf guesthouse directly on the main kite beach of Punta Chame, Panama, next to the local fishing village, open from December to April with a minimum stay of 5 nights.',
    `Rooms range from private seaview cabins to a single room, glamping tents and dorms around a pool and beach bar, and all meals are included${cheapest ? ` (5 days from ${usd(cheapest.x.amount)} for one guest in the ${cheapest.r.name.toLowerCase()})` : ''}; the Kitesurfers Villa 150 m away adds ${villaRooms.length || 4} rooms with pool, hot tub and tennis court on bed & breakfast, half or full board.`,
    'The team teaches beginners to advanced riders with radio headsets, rents Duotone and Core kites and runs downwinders and boat trips to the sandbars; bikes, SUPs and kayaks are free for guests.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Panama Kite House & Villa',
    summary,
    continent: 'North America',
    country: 'Panama',
    region: 'Panamá Oeste',
    spot: 'Punta Chame',
    itinerarySpots: [],
    durationDays: null,
    // rider page: "Kite Level Beginner - Advanced" (2026-10-09)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kitesurf(?:ing)? lessons/i.test(rider),
    equipmentRental: /kitesurf rental/i.test(rider),
    beginnerFriendly: /beginner/i.test(rider),
    includedServices: ['All meals (kite house)', 'Use of bikes, SUPs and kayaks', 'Pool and beach bar access', 'Kite equipment storage and air compressor', 'Weekly no-wind day trips (canyon, cocktail night, rivermouth downwinder)', 'Wi-Fi'],
    optionalServices: ['Kitesurf lessons', 'Kitesurf and foil rental', 'Kite trips: downwinders and boat trips to the sandbars', 'Surf trips', 'Airport pick-up from Panama City (PTY)', 'Massage', 'Villa meal plans: half board +$16 pp/night, full board +$32 pp/night'],
    accommodation: 'beachfront guesthouse cabins, rooms, glamping tents and dorms + a 4-room villa',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: trailer,
    sourceUrl: PKH_PAGE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [`rider experience: ${rider}`, `kite house: ${kh}`, `villa: ${villa}`].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const panamaKiteHouse: OfferAdapter = {
  key: 'panama-kite-house',
  name: 'Panama Kite House & Villa',
  kind: 'accommodation',
  operator: {
    name: 'The Rider Experience',
    websiteUrl: 'https://www.theriderexperience.com',
    rootDomain: 'theriderexperience.com',
    contactEmail: 'info@theriderexperience.com',
  },
  url: PKH_PAGE_URL,
  slotMethod: 'price_table',
  fetchBudget: 6,
  async fetchContent() {
    const [rider, kitehouse, villa] = [
      await fetchText(PKH_PAGE_URL, { accept: 'text/html' }),
      await fetchText(PKH_KITEHOUSE_URL, { accept: 'text/html' }),
      await fetchText(PKH_VILLA_URL, { accept: 'text/html' }),
    ];
    return parsePanamaContent({ rider, kitehouse, villa });
  },
  async fetchSlots(ctx) {
    const house = parsePkhRooms(await fetchText(PKH_KITEHOUSE_URL, { accept: 'text/html' }));
    const villa = parsePkhRooms(await fetchText(PKH_VILLA_URL, { accept: 'text/html' }), 'Villa ');
    const season = parsePkhSeason(await fetchText(PKH_SEASON_URL, { accept: 'text/html' }));
    if (!season) throw new Error('panama-kite-house: season calendar (ranges / "Season Calendar YYYY / YYYY") not found on book-now-overview');
    if (house.length === 0) throw new Error('panama-kite-house: no price tables on the kite house page (layout changed?)');
    if (villa.length === 0) ctx.note('no villa price tables found');
    return buildPkhSlots([...house, ...villa], season);
  },
};
