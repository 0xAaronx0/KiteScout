// ---------------------------------------------------------------------------
// NoHotel - Lampes Piraten Koje, Dranske (Wittow, northern Rügen, Germany) - hostel with dorms, double / triple rooms
// and holiday apartments between the Bodden and the Baltic Sea, run by Doreen Lamprecht since 2020 ("ganzjährig für
// dich geöffnet"); "Location close to the Rügen Piraten watersports school" (kite and windsurf courses, kite and surf
// equipment rental: "the most beautiful surf and kitespot on Rügen").
//
// Data path (checked 2026-10-14), Jimdo site (German + English pages):
//   content  / (welcome text, room categories, contact), /nohotel-english-1/accomodation/ (facilities, location, booking
//            form), /nohotel-english-1/your-holiday/watersports/ (Rügen Piraten: windsurfing, kiting, rental).
//   slots    /nohotel-english-1/prices/: the price list is an IMAGE (Jimdo image version 1688647957 = 2023-07-06; the
//            German page's image 1688646759, same day); the text only gives the rules (apartments minimum 3 nights,
//            service fee, towels, tourist tax). Aaron's call (2026-10-14): list as "price on request", no slots unless
//            the site prints prices as text -> fetchSlots returns [] and notes when text prices appear.
// No booking engine: requests by phone, mail or the site's form.
// robots.txt (2026-10-14): "User-agent: *" disallows /app/ and /j/, "Crawl-Delay: 5" -> this adapter waits 5 s between
//   its own nohotel.de requests (local helper; the shared throttle in http.ts is 1.5 s). The contact page's Google Maps
//   embed is a place search ("q=Nohotel+Dranske"), no coordinates -> no spotCoords.
// Requests per run: content 3, slots 1 -> 4 (about 15 s with the crawl delay).
// Liveness: the own site shows no 2026/27 date (newest dated item: the 2023 price image; "ganzjährig geöffnet"); the
//   2026 signal is third-party only (VDWS course May 2026), listed on Aaron's approval -> confidence 'low'.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, parseAmount } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.nohotel.de';
export const NH_HOME_URL = `${SITE}/`;
export const NH_ROOMS_URL = `${SITE}/nohotel-english-1/accomodation/`;
export const NH_SPORT_URL = `${SITE}/nohotel-english-1/your-holiday/watersports/`;
export const NH_PRICES_URL = `${SITE}/nohotel-english-1/prices/`;
const CRAWL_DELAY_MS = 5_000; // nohotel.de robots.txt "Crawl-Delay: 5"

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
let lastFetch = 0;
let queue: Promise<unknown> = Promise.resolve();
/** Memoised fetch, serialised with the robots.txt crawl delay (skipped on fixture replay). */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const run = async () => {
    if (!process.env.OFFERS_FIXTURE_DIR) {
      const wait = lastFetch + CRAWL_DELAY_MS - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    try { return await fetchText(url, { accept: 'text/html' }); } finally { lastFetch = Date.now(); }
  };
  const p = queue.catch(() => undefined).then(run);
  queue = p;
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines of the Jimdo content area (navigation and footer dropped). */
export function nhLines(html: string): string[] {
  const lines = html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|table|nav|header|footer)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
  const last = lines.reduce((a, l, i) => (/^(Get in touch|Kontakt)$/.test(l) ? i : a), -1);
  const end = lines.findIndex((l, i) => i > last && /^NOHOTEL - LAMPES PIRATEN KOJE$/.test(l));
  return lines.slice(last + 1, end > last ? end : undefined);
}

/** Cloudflare-obfuscated mail addresses (data-cfemail) of the page. */
export function nhEmails(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/g)) {
    const h = m[1]; const k = parseInt(h.slice(0, 2), 16);
    let s = '';
    for (let i = 2; i < h.length; i += 2) s += String.fromCharCode(parseInt(h.slice(i, i + 2), 16) ^ k);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** Text prices on the prices page ("35 € / Nacht", "EUR 60 per night") - none while the list is an image. */
export function nhTextPrices(html: string): string[] {
  return nhLines(html).filter(l => /(\d+[.,]?\d*\s*(€|EUR|Euro)|(€|EUR)\s*\d+)/i.test(l) && /night|nacht|person|zimmer|room|bett|bed/i.test(l)
    && !/service fee|servicepauschale|towels|handtücher/i.test(l));
}

/** Jimdo photos at original size (transf/none), one per image id; icons (shown at 240 px or less) and small originals dropped. */
export function nhImages(htmls: string[]): string[] {
  const width = new Map<string, number>();
  const shownMax = new Map<string, number>();
  const urls = new Map<string, string>();
  for (const html of htmls) {
    for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
      const id = m[0].match(/\/image\/(i[0-9a-f]{16})\//)?.[1];
      if (!id) continue;
      const w = Number(m[0].match(/data-src-width="(\d+)"/)?.[1] ?? NaN);
      if (Number.isFinite(w)) width.set(id, Math.max(width.get(id) ?? 0, w));
      // display size from the src transform ("transf/dimension=57x10000:format=png"; "transf/none" = original)
      const src = m[0].match(/\ssrc="([^"]*)"/)?.[1] ?? '';
      const shown = /\/transf\/none\//.test(src) ? Infinity : Number(src.match(/\/transf\/dimension=(\d+)x/)?.[1] ?? NaN);
      if (Number.isFinite(shown) || shown === Infinity) shownMax.set(id, Math.max(shownMax.get(id) ?? 0, shown));
    }
    for (const m of html.matchAll(/https:\/\/image\.jimcdn\.com\/app\/cms\/image\/transf\/[^/]+\/path\/(s[0-9a-f]+)\/image\/(i[0-9a-f]{16})\/version\/(\d+)\/([^"'\s<>]+?\.(?:jpe?g|png))/gi)) {
      const id = m[2];
      if (!urls.has(id)) urls.set(id, `https://image.jimcdn.com/app/cms/image/transf/none/path/${m[1]}/image/${id}/version/${m[3]}/${m[4]}`);
    }
  }
  const small = (id: string) => (shownMax.get(id) ?? Infinity) <= 240 || (width.get(id) ?? Infinity) < 600;
  return [...urls.entries()].filter(([id, u]) => !small(id) && (width.has(id) || /\.jpe?g$/i.test(u))).map(([, u]) => u);
}

export interface NhPages { home: string; rooms: string; sport: string }

export function parseNohotelContent(p: NhPages): OfferContent {
  const home = nhLines(p.home);
  const rooms = nhLines(p.rooms);
  const sport = nhLines(p.sport);
  const homeText = home.join('\n');
  const roomsText = rooms.join('\n');
  const yearRound = /ganzjährig für dich geöffnet/i.test(homeText);
  const serviceFee = parseAmount(roomsText.match(/service fee \(([\d.,]+)\s*Euro?\/day\)/i)?.[1] ?? '');
  const kite = sport.find(l => /kiting|kite equipment|kitespot/i.test(l)) ?? null;

  const contentRooms: ContentRoom[] = [
    { name: 'Dorm room', description: 'Dorm rooms for backpackers, families and groups with shower and WC on the corridor.', features: ['Shared kitchen use', 'Bed linen included'] },
    { name: 'Double room', description: 'Double room with en-suite shower and WC.', features: ['Shared kitchen use', 'Bed linen included'] },
    { name: 'Triple room', description: 'Triple room with en-suite shower and WC.', features: ['Shared kitchen use', 'Bed linen included'] },
    { name: 'Holiday apartment', description: 'Apartment with shower / WC, kitchen and TV; minimum stay 3 nights.', features: ['Kitchen', 'TV', 'Bed linen included'] },
  ];

  const summary = [
    `NoHotel - Lampes Piraten Koje is a hostel in Dranske on the Wittow peninsula in the north of Rügen, between the Bodden and the Baltic Sea (5 minutes on foot to either), run by Doreen Lamprecht since 2020${yearRound ? ' and open all year' : ''}.`,
    'It has dorm rooms with shared bathrooms, double and triple rooms with en-suite shower and WC and holiday apartments (minimum 3 nights), plus a common room, garden with barbecue, free Wi-Fi and parking; breakfast and dinner can be booked.',
    'The hostel is close to the Rügen Piraten water sports school in Dranske, which teaches kitesurfing and windsurfing and rents kite and surf equipment; the price list is published only as an image, so stays are on request.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'NoHotel - Lampes Piraten Koje',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Dranske, Rügen',
    spot: 'Dranske, Wittow',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: null, // lessons by the partner school Rügen Piraten, not the hostel
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: ['Bed linen', 'Free Wi-Fi', 'Free parking', 'Common room with TV, projector and screen', 'Garden, terrace and barbecue', 'Table tennis, table football, sports field'],
    optionalServices: [
      'Breakfast and dinner on request',
      serviceFee ? `Service fee EUR ${serviceFee} per day (water dispenser, coffee, tea)` : 'Service fee per day (water dispenser, coffee, tea)',
      'Towels EUR 10 per set',
      'Shared kitchen (fee, up to 6 guests)',
      'Kite and windsurf courses, kite and surf rental at the Rügen Piraten school (partner)',
      'Bike rental, fishing, photo workshops, group programmes',
    ],
    accommodation: 'hostel rooms and holiday apartments',
    mealPlan: 'breakfast optional',
    languages: ['de', 'en'],
    rooms: contentRooms,
    imageUrls: nhImages([p.rooms, p.sport, p.home]).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: NH_ROOMS_URL,
    bookingUrl: `${SITE}/nohotel-deutsch/kontakt/`,
    sourceText: [
      `home: ${home.filter(l => /ganzjährig|Hostel|Kiten|Mehrbettzimmer|Doppelzimmer|Dreibettzimmer|Ferienwohnung|Dranske/i.test(l)).join(' | ')}`,
      `accommodation: ${rooms.filter(l => l.length > 12 && !/^(Name|E-Mail|Cell|Message)$/.test(l)).join(' | ')}`,
      `watersports: ${kite ?? ''}`,
    ].join('\n'),
  };
}

export async function fetchNohotelContent(): Promise<OfferContent> {
  const home = await page(NH_HOME_URL);
  const rooms = await page(NH_ROOMS_URL);
  const sport = await page(NH_SPORT_URL);
  if (!/Rügen Piraten/i.test(rooms) || !/kit(e|ing)/i.test(sport)) throw new Error('nohotel: the Rügen Piraten / kiting text is missing on the accommodation or watersports page');
  return parseNohotelContent({ home, rooms, sport });
}

export async function fetchNohotelSlots(ctx: FetchContext): Promise<Slot[]> {
  const prices = await page(NH_PRICES_URL);
  const text = nhTextPrices(prices);
  if (text.length) ctx.note(`nohotel: the prices page now prints prices as text (${text.slice(0, 3).join(' | ')}) - build slots from them`);
  return [];
}

export const nohotelLampesPiratenKojeDranske: OfferAdapter = {
  key: 'nohotel-lampes-piraten-koje-dranske',
  name: 'NoHotel - Lampes Piraten Koje, Dranske',
  kind: 'accommodation',
  operator: {
    name: 'NoHotel - Lampes Piraten Koje',
    websiteUrl: SITE,
    rootDomain: 'nohotel.de',
    contactEmail: 'info@nohotel.de',
    phone: '+493839189924',
  },
  url: NH_ROOMS_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'low',
  fetchContent: () => fetchNohotelContent(),
  fetchSlots: ctx => fetchNohotelSlots(ctx),
};
