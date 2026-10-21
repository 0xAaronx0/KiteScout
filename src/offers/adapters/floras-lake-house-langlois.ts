// ---------------------------------------------------------------------------
// Floras Lake House By The Sea, Langlois (Oregon Coast, USA) - 4-room bed & breakfast on Floras Lake,
// run since 1991 by the Brady family, who opened the windsurfing school on the lake in 1990 (today
// Floras Lake Windsports: kiteboarding, wing, foil and windsurf lessons, linked as "Kite & Windsurf"
// from the B&B site). The house looks over the lake to the ocean; guests watch the kiteboarders from
// the decks.
//
// Data path (checked 2026-10-14): Squarespace site floraslake.com, English only.
//   content  / (intro, kite link), /rooms-rates (4 room cards: <h3> name + <p> text with "Max N
//            people" and the season prices), /bb-policies (minimum stay, taxes, singles / extra person),
//            www.floraslakewindsports.com/ (the family's kite & windsurf school next door: season,
//            lessons for all levels). Map pin = the site's own Squarespace location setting
//            ("location":{"mapLat":42.9029331,"mapLng":-124.5008057}) printed in every page.
//   slots    /rooms-rates: "<year> Rooms & Rates" + per room three season bands ("April 15-May 22:
//            $ 285", "May 23-Sept 14: $ 335", "Sept 15-30 $ 310") -> one slot per room x band with the
//            real date limits, USD per room per night, availability 'unknown' (the page says nothing
//            about availability). Bands that already ended are dropped: on 2026-10-14 the whole 2026
//            table is past ("Our season ends October 1st"), so fetchSlots returns [] ("price on
//            request") until the 2027 table is published.
// Currency: the page prints only "$"; USD is the site's own Squarespace store setting
//   ("selectedCurrency":"USD") and the business is in the US -> USD (inferred from that setting).
// Booking engine: ThinkReservations (secure.thinkreservations.com/floraslake/reservations) - its
//   robots.txt is "User-agent: * / Disallow: /" (checked 2026-10-14) -> not used, no live availability.
// robots.txt floraslake.com / floraslakewindsports.com (Squarespace defaults, 2026-10-14): the pages
//   we read are allowed (/api/, /static/, ?format=json are disallowed and never touched).
// Requests per run: content 4 (+1 shared with slots, memoised), slots 1.
// Known limits: "2 night minimum stay ... most summer weekends" is not tied to a band -> room
//   features, not minNights; 12.75% lodging tax, singles -$10, extra person +$10 and the 5+ night
//   discount (-$25/night) go into the room features. The "Full upper home rental" has no price.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, iso, monthOf, parse, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://floraslake.com';
export const FL_HOME_URL = `${SITE}/`;
export const FL_ROOMS_URL = `${SITE}/rooms-rates`;
export const FL_POLICIES_URL = `${SITE}/bb-policies`;
export const FL_SCHOOL_URL = 'https://www.floraslakewindsports.com/';
const BOOKING_URL = 'https://secure.thinkreservations.com/floraslake/reservations';

// --- local helpers (shared with the other Squarespace adapters of this batch) ------------------
/** Heading / paragraph / list blocks in document order, script/style/template bodies dropped. */
export function sqsBlocks(html: string): Array<{ tag: string; text: string }> {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, template, svg')) el.remove();
  const out: Array<{ tag: string; text: string }> = [];
  for (const el of root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li')) {
    if (el.tagName === 'LI' && el.querySelector('p')) continue; // its <p> children come separately
    const text = collapse(el.text);
    if (text) out.push({ tag: el.tagName.toLowerCase(), text });
  }
  return out;
}

/** Squarespace content photos (data-src / data-image / src originals), logos, badges, maps and screenshots dropped. */
export function sqsImages(html: string, max = 40): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/(?:data-src|data-image|src)="(https:\/\/images\.squarespace-cdn\.com\/content\/v1\/[^"?]+)/g)) {
    const u = m[1].replace(/&amp;/g, '&');
    if (/logo|favicon|icon|screenshot|doodle|map\b|\+map|centerid|\.svg|\.gif|\.ico/i.test(u) || out.includes(u)) continue;
    out.push(u);
  }
  return out.slice(0, max);
}

/** The site's own map pin from the Squarespace website context ("location":{"mapLat":..,"mapLng":..}). */
export function sqsSitePin(html: string): { lat: number; lng: number } | null {
  const m = html.match(/"location":\{"mapLat":(-?\d+\.\d+),"mapLng":(-?\d+\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat, lng } : null;
}

/** Store currency of a Squarespace site ("selectedCurrency":"USD"). */
export function sqsCurrency(html: string): string | null {
  return html.match(/"selectedCurrency":"([A-Z]{3})"/)?.[1] ?? null;
}

const memo = new Map<string, Promise<string>>();
function page(url: string): Promise<string> {
  let p = memo.get(url);
  if (!p) { p = fetchText(url, { accept: 'text/html' }); memo.set(url, p); p.catch(() => memo.delete(url)); }
  return p;
}
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// --- pure parsers -----------------------------------------------------------------------------
export interface FlBand { start: string; end: string; price: number; label: string }
export interface FlRoom { name: string; description: string; maxPersons: number | null; extraPerson: number | null; bands: FlBand[] }

/** Year of the rate table ("2026 Rooms & Rates"). */
export function parseFlYear(html: string): number | null {
  const b = sqsBlocks(html).find(x => /^(20\d{2})\s+Rooms\s*&\s*Rates/i.test(x.text));
  return b ? Number(b.text.slice(0, 4)) : null;
}

/** "April 15-May 22: $ 285", "Sept 15-30 $ 310" -> bands with real dates in `year`. */
export function parseFlBands(text: string, year: number): FlBand[] {
  const out: FlBand[] = [];
  const re = /([A-Z][a-z]+)\.?\s+(\d{1,2})\s*[-–]\s*(?:([A-Z][a-z]+)\.?\s+)?(\d{1,2})\s*:?\s*\$\s*([\d,]+)/g;
  for (const m of text.matchAll(re)) {
    const m1 = monthOf(m[1]);
    const m2 = m[3] ? monthOf(m[3]) : m1;
    if (!m1 || !m2) continue;
    out.push({
      start: iso(year, m1, Number(m[2])),
      end: iso(year, m2, Number(m[4])),
      price: Number(m[5].replace(/,/g, '')),
      label: collapse(m[0].replace(/\s*:?\s*\$\s*[\d,]+$/, '')),
    });
  }
  return out;
}

/** Room cards: an <h3>/<h1> "... Room" followed by its <p> blocks (name, max persons, season prices). */
export function parseFlRooms(html: string): FlRoom[] {
  const year = parseFlYear(html);
  if (!year) return [];
  const blocks = sqsBlocks(html);
  const rooms: FlRoom[] = [];
  let cur: { name: string; text: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const text = cur.text.join(' ');
    const bands = parseFlBands(text, year);
    if (bands.length) {
      const desc = text.split(/\bMax\s+\d/i)[0].trim();
      rooms.push({
        name: cur.name,
        description: desc,
        maxPersons: Number(text.match(/Max\s+(\d+)\s+people/i)?.[1] ?? NaN) || null,
        extraPerson: Number(text.match(/\$\s*(\d+)\s+for additional person/i)?.[1] ?? NaN) || null,
        bands,
      });
    }
    cur = null;
  };
  for (const b of blocks) {
    if (/^h[1-6]$/.test(b.tag)) {
      if (cur && cur.name === b.text) continue;              // "South Room" printed as <h1> and <h3>
      flush();
      if (/\bRoom$/i.test(b.text)) cur = { name: b.text, text: [] };
      continue;
    }
    if (cur && b.tag === 'p') cur.text.push(b.text);
  }
  flush();
  return rooms;
}

/** Policy lines that change the price (taxes, singles, extra person, minimum stay, long-stay discount). */
export function parseFlPolicies(html: string): string[] {
  return sqsBlocks(html).map(b => b.text)
    .filter(t => /tax|minimum stay|Singles deduct|additional person|deduct \$|Children 12\+|check-in|CANCELLATIONS/i.test(t))
    .filter((t, i, a) => a.indexOf(t) === i);
}

export function buildFlSlots(rooms: FlRoom[], currency: string, today = todayIso()): Slot[] {
  const out: Slot[] = [];
  for (const r of rooms) {
    for (const b of r.bands) {
      if (b.end < today) continue;
      out.push({
        key: `${slug(r.name)}|${b.start}`,
        startDate: b.start,
        endDate: b.end,
        unit: r.name,
        price: b.price,
        currency,
        priceUnit: 'per_night',
        priceBasis: 'room',
        // rates are per room for two; the North Room takes a 3rd guest at +$10 (room features)
        occupancy: 2,
        availability: 'unknown',
        availabilityText: null,
        spotsLeft: null,
      });
    }
  }
  return out;
}

export interface FlPages { home: string; rooms: string; policies: string; school: string }

export function parseFlContent(p: FlPages): OfferContent {
  const rooms = parseFlRooms(p.rooms);
  const year = parseFlYear(p.rooms);
  const policies = parseFlPolicies(p.policies);
  const home = sqsBlocks(p.home).map(b => b.text);
  const roomsText = sqsBlocks(p.rooms).map(b => b.text);
  const school = sqsBlocks(p.school).map(b => b.text);
  const intro = home.find(t => /family-run business/i.test(t)) ?? '';
  const schoolIntro = school.find(t => /Kiteboarding, wing, foil and windsurfing lessons/i.test(t)) ?? '';
  const schoolSeason = school.find(t => /our season is/i.test(t)) ?? null;
  const seasonEnd = roomsText.find(t => /season ends/i.test(t)) ?? null;
  const pin = sqsSitePin(p.home) ?? sqsSitePin(p.rooms);
  const currency = sqsCurrency(p.rooms) ?? 'USD';
  const usd = (n: number) => `${currency} ${n}`;
  const taxLine = policies.find(t => /tax/i.test(t)) ?? null;
  const priceLines = policies.filter(t => /Singles deduct|minimum stay/i.test(t));

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: r.description || null,
    features: [
      ...(r.maxPersons ? [`max ${r.maxPersons} people`] : []),
      ...(r.extraPerson ? [`additional person ${usd(r.extraPerson)} per night`] : []),
      ...r.bands.map(b => `${year ?? ''} ${b.label}: ${usd(b.price)} per room per night`.trim()),
      'hot breakfast included',
      ...(taxLine ? [taxLine] : []),
      ...priceLines,
    ],
  }));
  const cheapest = rooms.flatMap(r => r.bands).sort((a, b) => a.price - b.price)[0];

  const summary = [
    'Floras Lake House By The Sea is a family-run bed & breakfast with four rooms on Floras Lake near Langlois, 17 miles south of Bandon on the southern Oregon coast; only a sand dune separates the fresh-water lake from the ocean.',
    'The Brady family opened the windsurfing school on the lake in 1990 and the inn in 1991; their Floras Lake Windsports next door teaches kiteboarding, wing, foil and windsurfing at all levels from April through September, and guests watch the kiteboarders from the decks.',
    `Every room has a private bath, lake and ocean views and a deck entrance; a hot breakfast is served daily${cheapest ? ` (${year} rates ${usd(cheapest.price)} to ${usd(Math.max(...rooms.flatMap(r => r.bands).map(b => b.price)))} per room per night, plus lodging tax)` : ''}.`,
  ].join(' ');

  const imageUrls = [...new Set([...sqsImages(p.rooms, 40), ...sqsImages(p.home, 10)])];

  return {
    kind: 'accommodation',
    title: 'Floras Lake House By The Sea',
    summary,
    continent: 'North America',
    country: 'United States',
    region: 'Oregon Coast, Oregon',
    spot: 'Floras Lake, Langlois',
    spotCoords: pin,
    itinerarySpots: [],
    durationDays: null,
    // windsports site: "lessons are available at all ability levels" (2026-10-14)
    skillLevels: /all ability levels/i.test(schoolIntro) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: /Kiteboarding/i.test(schoolIntro) ? true : null,
    equipmentRental: null, // the school page names SUP and kayak rental, not kite gear
    beginnerFriendly: /all ability levels/i.test(schoolIntro) ? true : null,
    includedServices: ['Hot breakfast daily', 'Free Wi-Fi', 'Private bath per room', 'Deck entrance per room'],
    optionalServices: ['Kiteboarding, wing, foil and windsurf lessons at Floras Lake Windsports (next door)', 'SUP and kayak rental (Floras Lake Windsports)'],
    accommodation: 'bed & breakfast, 4 rooms with lake and ocean views',
    mealPlan: 'breakfast',
    languages: ['en'],
    rooms: contentRooms,
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: FL_ROOMS_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${intro}`,
      `rooms: ${roomsText.filter(t => /Room|Rates|season|\$|views|breakfast/i.test(t)).join(' | ')}`,
      `policies: ${policies.join(' | ')}`,
      `school: ${[schoolIntro, schoolSeason].filter(Boolean).join(' | ')}`,
      seasonEnd ? `season: ${seasonEnd}` : '',
    ].filter(Boolean).join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const florasLakeHouseLanglois: OfferAdapter = {
  key: 'floras-lake-house-langlois',
  name: 'Floras Lake House By The Sea',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Floras Lake House By The Sea',
    websiteUrl: FL_HOME_URL,
    rootDomain: 'floraslake.com',
    contactEmail: 'reservations@floraslake.com', // footer, 2026-10-14
    phone: '+15413482573',                       // footer "Text or call 541-348-2573"
  },
  url: FL_ROOMS_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 6,
  confidence: 'medium',
  async fetchContent() {
    const [home, rooms, policies, school] = [await page(FL_HOME_URL), await page(FL_ROOMS_URL), await page(FL_POLICIES_URL), await page(FL_SCHOOL_URL)];
    return parseFlContent({ home, rooms, policies, school });
  },
  async fetchSlots(ctx: FetchContext) {
    const html = await page(FL_ROOMS_URL);
    const rooms = parseFlRooms(html);
    if (rooms.length === 0) throw new Error('floras-lake: no room price bands on /rooms-rates (layout or "<year> Rooms & Rates" heading changed?)');
    const slots = buildFlSlots(rooms, sqsCurrency(html) ?? 'USD');
    if (slots.length === 0) ctx.note(`all ${parseFlYear(html)} season bands are past; price on request until the next table is published`);
    return slots;
  },
};
