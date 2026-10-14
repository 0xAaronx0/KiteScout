// ---------------------------------------------------------------------------
// Ikarus Kite & Wing Center + ecological hotel, Isla Blanca (Cancún, Quintana Roo, Mexico) - kite school on
// a private beach on the flat, shallow Chacmuchuch lagoon (since 2002) with 10 solar-powered rooms and a
// camping area (tents, hammocks).
//
// Data path (checked 2026-10-12): WordPress/Elementor site kiteboardmexico.com (English).
//   slots    /accommodations/ - static price table (modified 2026-09-16 per its JSON-LD dateModified):
//            Elementor cards "X 2 PERSON – PER NIGHT" + <h5>"KING SIZE STUDIO <br> $ 2,772 MXN" + "Extra person
//            $ 250 MXN – Child $ 120 MXN Max. capacity 4 persons per room." and camping cards ("CAMPING ONE
//            PERSON" + <h5>"$ 600 MXN"). One slot per room / tent type, MXN per unit per night, no dates (the
//            table has none). Not slots: "CAMP WITH YOUR OWN GEAR" (a pitch) and the day pass.
//   content  / (kite school: since 2002, lagoon, rescue boats, languages) + /accommodations/ (10 rooms, solar,
//            no air conditioning, facilities).
// Booking: the "BOOK HERE" room pages lead to the Amenitiz engine on www.islablancamexico.com, which
//   answered HTTP 403 to our UA on 2026-10-12 (robots.txt there allows all) -> not used; availability
//   'unknown'. The menu titles of the room pages carry older prices ("DOUBLE ROOM $1,800 MX"); the
//   /accommodations/ table is the newest source.
// robots.txt (2026-10-12): kiteboardmexico.com disallows /wp-admin/ and sets "Crawl-delay: 10" -> this
//   adapter waits 10 s between its own kiteboardmexico.com requests (local helper; skipped on replay).
// Requests per run: 2 (home + /accommodations/, memoised across content and slots).
// Known limits: no availability; extra person / child rates are in the room features only.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://kiteboardmexico.com';
export const IKARUS_HOME_URL = `${SITE}/`;
export const IKARUS_ROOMS_URL = `${SITE}/accommodations/`;
const BOOKING_URL = 'https://www.islablancamexico.com/en';
const CRAWL_DELAY_MS = 10_000; // kiteboardmexico.com robots.txt "Crawl-delay: 10"

export interface IkarusRate { name: string; persons: number; price: number; currency: string; extra: string | null; camping: boolean }

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
let lastSiteFetch = 0;
let siteQueue: Promise<unknown> = Promise.resolve();
/** Memoised fetch, serialised with the robots.txt crawl delay (skipped on fixture replay). */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const run = async () => {
    if (!process.env.OFFERS_FIXTURE_DIR) {
      const wait = lastSiteFetch + CRAWL_DELAY_MS - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    try { return await fetchText(url, { accept: 'text/html' }); } finally { lastSiteFetch = Date.now(); }
  };
  const p = siteQueue.catch(() => undefined).then(run);
  siteQueue = p;
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const titleCase = (s: string): string => s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };

/** Text blocks of the page content (Elementor widgets: p / h2-h5), without chrome. */
function blocks(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, form')) el.remove();
  const out: string[] = [];
  for (const el of root.querySelectorAll('h1, h2, h3, h4, h5, p, li')) {
    const t = collapse(el.text);
    if (t && out[out.length - 1] !== t) out.push(t);
  }
  return out;
}

// --- pure parsers -----------------------------------------------------------------------------
/** /accommodations/ price cards in document order (rooms "X N PERSON – PER NIGHT", tents "CAMPING ONE PERSON"). */
export function parseIkarusRates(html: string): IkarusRate[] {
  const out: IkarusRate[] = [];
  let persons: number | null = null;
  let camping = false;
  for (const b of blocks(html)) {
    if (/^(DAYPASS|AMENITIES)\b/i.test(b) && out.length) break;
    const occ = b.match(/^X\s*(\d+)\s*PERSONS?\s*[–-]\s*PER NIGHT$/i);
    if (occ) { persons = Number(occ[1]); camping = false; continue; }
    const camp = b.match(/^CAMPING\s+(ONE|TWO|\d)\s+PERSONS?$/i);
    if (camp) { persons = WORDS[camp[1].toLowerCase()] ?? Number(camp[1]); camping = true; continue; }
    const price = b.match(/^(.*?)\s*\$\s*([\d.,]+)\s*MXN$/i);
    if (price && persons) {
      const label = collapse(price[1]);
      if (/own gear/i.test(label)) { persons = null; continue; } // a pitch, not a rental unit
      const amount = parseAmount(price[2]);
      if (!amount) continue;
      out.push({ name: camping ? 'Camping tent' : titleCase(label), persons, price: amount, currency: 'MXN', extra: null, camping });
      persons = null;
      continue;
    }
    const last = out[out.length - 1];
    if (last && !last.extra && /^Extra person/i.test(b)) last.extra = b.replace(/\s*[–-]\s*Child/i, ', child').replace(/\s*Max\./i, '; max.').replace(/\s+/g, ' ');
    else if (last && last.camping && !last.extra && /mattress/i.test(b)) last.extra = b;
  }
  return out;
}

export function buildIkarusSlots(rates: IkarusRate[]): Slot[] {
  return rates.map(r => ({
    key: `${keyPart(r.name)}-${r.persons}p`,
    startDate: null,
    endDate: null,
    unit: r.camping ? `Camping tent (${r.persons} ${r.persons > 1 ? 'persons' : 'person'})` : r.name,
    price: r.price,
    currency: r.currency,
    priceUnit: 'per_night',
    priceBasis: 'room',
    occupancy: r.persons,
    availability: 'unknown',
    availabilityText: null,
    spotsLeft: null,
  }));
}

export interface IkarusPages { home: string; rooms: string }

export function parseIkarusContent(p: IkarusPages): OfferContent {
  const home = blocks(p.home);
  const rooms = blocks(p.rooms);
  const rates = parseIkarusRates(p.rooms);
  const school = home.find(b => /First kiteboarding school in the Riviera Maya/i.test(b)) ?? '';
  const bullets = home.find(b => /rescue boats/i.test(b)) ?? '';
  const welcome = home.find(b => /best place to learn kitesurfing/i.test(b)) ?? '';
  const roomMix = rooms.find(b => /stay in one of our \d+ rooms/i.test(b)) ?? '';
  const roomFacts = rooms.find(b => /All rooms have a private bathroom/i.test(b)) ?? '';
  const solar = rooms.find(b => /solar system/i.test(b)) ?? '';
  const nRooms = roomMix.match(/one of our (\d+) rooms/i)?.[1] ?? null;
  const since = school.match(/Since (\d{4})/)?.[1] ?? null;
  const langs = school.match(/Lessons available in ([^.]+)\./)?.[1] ?? '';
  const LANG: Record<string, string> = { english: 'en', spanish: 'es', german: 'de', italian: 'it', french: 'fr' };
  const languages = langs.split(/,\s*(?:and\s+)?|\s+and\s+/).map(l => LANG[l.trim().toLowerCase()]).filter((x): x is string => !!x);
  const roomRates = rates.filter(r => !r.camping);
  const fmt = (n: number) => n.toLocaleString('en-US');

  const contentRooms: ContentRoom[] = rates.map(r => ({
    name: r.camping ? `Camping tent (${r.persons} ${r.persons > 1 ? 'persons' : 'person'})` : r.name,
    description: r.camping
      ? 'Tent in the camping area with mattress, sheets, pillow and towel; shared hot shower and toilet.'
      : 'Hotel room with private bathroom, hot shower, Wi-Fi and fan (no air conditioning), solar-powered.',
    features: [`MXN ${fmt(r.price)} per night for ${r.persons} ${r.persons > 1 ? 'persons' : 'person'}`, ...(r.extra && !r.camping ? [r.extra] : [])],
  }));

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const [html, base] of [[p.rooms, IKARUS_ROOMS_URL], [p.home, IKARUS_HOME_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 80)) {
      if (!/kiteboardmexico\.com\/wp-content\/uploads\//.test(u) || /logo|icon|cropped-|trustindex|partner|\.svg|\.png$/i.test(u)) continue;
      const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '').toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); imageUrls.push(u);
    }
  }

  const cheapestRoom = roomRates.length ? roomRates.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const summary = [
    `Ikarus is a kite and wing center with an ecological boutique hotel and camping site on a private beach at Isla Blanca, 20 minutes north of Cancún, Mexico, on the flat and shallow water of the Chacmuchuch lagoon nature reserve${since ? `; its kite school has run since ${since}` : ''}.`,
    `The hotel has ${nRooms ?? '10'} solar-powered rooms (king-size studio with kitchen, double and triple rooms) with private bathroom, hot shower and fan but no air conditioning${cheapestRoom ? `, from MXN ${fmt(cheapestRoom.price)} per night for two` : ''}, plus tents and hammocks; there is a pool, bar, restaurant and kite shop.`,
    'Lessons are supported by rescue boats and jet ski for beginners to advanced riders, with rental for kite, kitefoil and wing.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Ikarus School & Hotel Boutique',
    summary,
    continent: 'North America',
    country: 'Mexico',
    region: 'Quintana Roo',
    spot: 'Isla Blanca',
    itinerarySpots: [],
    durationDays: null,
    // home: "We can train you from beginner level to very advanced tricks." (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kite lesson/i.test(home.join(' ')),
    equipmentRental: /RENTALS?/.test(home.join(' ')) ? true : null,
    beginnerFriendly: /best place to learn kitesurfing/i.test(welcome) ? true : null,
    includedServices: ['Private beach', 'Wi-Fi', 'Swimming pool', 'SUP and kayaks'],
    optionalServices: [
      'Kite lessons (group and private, 1-9 hours, with rescue boat / jet ski support)',
      'Wing foil course',
      'Supervision and equipment rental',
      'Restaurant and bar',
      'Fishing and manatee tours',
      'Day pass (100 pesos or 200 pesos minimum consumption in the restaurant)',
    ],
    accommodation: 'eco hotel rooms and camping (tents, hammocks)',
    mealPlan: null,
    languages: languages.length ? languages : ['en', 'es'],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: IKARUS_ROOMS_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${[welcome, school, bullets].filter(Boolean).join(' | ')}`,
      `rooms: ${[roomMix, roomFacts, solar].filter(Boolean).join(' | ')}`,
      `rates: ${rates.map(r => `${r.name} ${r.persons}p MXN ${r.price}/night${r.extra ? ` (${r.extra})` : ''}`).join('; ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const ikarusKiteboardMexicoIslaBlanca: OfferAdapter = {
  key: 'ikarus-kiteboard-mexico-isla-blanca',
  name: 'Ikarus Kiteboard Mexico Isla Blanca',
  kind: 'accommodation',
  operator: {
    name: 'Ikarus Cancun Kite Center',
    websiteUrl: SITE,
    rootDomain: 'kiteboardmexico.com',
    contactEmail: 'info@kiteboardmexico.com',
    whatsapp: '+529988744245',
  },
  url: IKARUS_ROOMS_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 3,
  async fetchContent() {
    const home = await page(IKARUS_HOME_URL);
    const rooms = await page(IKARUS_ROOMS_URL);
    return parseIkarusContent({ home, rooms });
  },
  async fetchSlots() {
    const rates = parseIkarusRates(await page(IKARUS_ROOMS_URL));
    if (rates.filter(r => !r.camping).length < 2) throw new Error(`ikarus: room price table not found on /accommodations/ (${rates.length} rates parsed)`);
    return buildIkarusSlots(rates);
  },
};
