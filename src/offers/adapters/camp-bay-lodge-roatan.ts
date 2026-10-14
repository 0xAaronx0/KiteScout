// ---------------------------------------------------------------------------
// Camp Bay Lodge, Camp Bay (East End, Roatán, Bay Islands, Honduras) - rustic eco beach lodge with about a
// dozen rooms, cabanas and studios on Camp Bay beach, an on-site kite launch/landing area and kite lessons
// (Roatán Kite School next to the Kitesurf Room), breakfast included.
//
// Data path (checked 2026-10-12): Squarespace site www.campbaylodgeroatan.com.
//   content  /home-1 (the full home page text: kite launch + lessons, rooms overview; the root "/" is a
//            5.3 MB page above our 5 MB fetch cap), /rooms (rooms intro: breakfast included, 19% tax not
//            included, links to the 12 room pages), /rooms/<slug> (description + "Accommodates: 2",
//            "Features: ...", "Price: $200/night", "Includes: ...", "Extra cost: ..." text blocks + photos).
//   slots    the "Price:" line of every room page (USD per room per night) -> one slot per room, no dates
//            (the site prints no seasons), availability 'unknown'.
//   coordinates  the Google Maps link on every page (query=16.42897224,-86.29253387).
// Booking: Cloudbeds (hotels.cloudbeds.com/reservation/0Bj1Nx, linked as "Book Now"); its /booking/* data
//   endpoints answer 403 to non-browser clients (Keros Blue, 2026-10-09) -> no live availability or the
//   engine's seasonal rate plans (e.g. "15% off Feb & March 2027" seen there by the research on 2026-10-12).
// robots.txt (2026-10-12): Squarespace defaults (disallows /api/, /static/, ?format=json etc., not pages).
// Requests per run: 14 (rooms index + 12 room pages + /home-1), memoised across content and slots.
// Known limits: no availability; the 19% government tax is in the room features, not in the price.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, parseAmount } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.campbaylodgeroatan.com';
export const CBL_HOME_URL = `${SITE}/home-1`;
export const CBL_ROOMS_URL = `${SITE}/rooms`;
const BOOKING_URL = 'https://hotels.cloudbeds.com/reservation/0Bj1Nx';

export interface CblRoom {
  slug: string;
  name: string;
  tagline: string | null;
  description: string;
  accommodates: number | null;
  features: string[];
  price: number | null;
  currency: string | null;
  priceText: string | null;
  includes: string | null;
  extraCost: string | null;
}

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const stripSemi = (s: string): string => s.replace(/[;.\s]+$/, '').trim();

/** Text blocks (h1-h4, p, li) in document order with their tag, without scripts/styles/chrome. */
function tagged(html: string): Array<{ tag: string; text: string }> {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  const out: Array<{ tag: string; text: string }> = [];
  for (const el of root.querySelectorAll('h1, h2, h3, h4, p, li')) {
    const t = collapse(el.text);
    if (t && out[out.length - 1]?.text !== t) out.push({ tag: el.tagName.toLowerCase(), text: t });
  }
  return out;
}
const blocks = (html: string): string[] => tagged(html).map(b => b.text);

// --- pure parsers -----------------------------------------------------------------------------
/** Room page URLs from the /rooms index (relative "/rooms/<slug>" links, document order). */
export function cblRoomUrls(roomsHtml: string): string[] {
  const out: string[] = [];
  for (const a of parse(roomsHtml).querySelectorAll('a[href^="/rooms/"]')) {
    const u = `${SITE}${a.getAttribute('href')!.replace(/[?#].*$/, '')}`;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

/** One room page: <h2>/<h3> room name, tagline, description paragraphs, then "Label: value" blocks. */
export function parseCblRoom(html: string, url: string): CblRoom {
  const tb = tagged(html);
  const bs = tb.map(b => b.text);
  const labelled = (label: string): string | null => {
    const b = bs.find(x => new RegExp(`^${label}\\s*:`, 'i').test(x));
    return b ? stripSemi(b.replace(new RegExp(`^${label}\\s*:\\s*`, 'i'), '')) : null;
  };
  const priceText = labelled('Price');
  const first = bs.findIndex(b => /^(Accommodates|Features|Price)\s*:/i.test(b));
  const end = first >= 0 ? first : bs.length;
  // the room heading is the last h2/h3 before the labelled blocks; the <h1> banner ("Coco", "Palm") is the fallback
  let nameIdx = -1;
  for (let i = end - 1; i >= 0; i--) if (tb[i].tag === 'h2' || tb[i].tag === 'h3') { nameIdx = i; break; }
  const name = nameIdx >= 0 ? tb[nameIdx].text : (tb.find(b => b.tag === 'h1')?.text ?? '');
  const body = bs.slice(nameIdx + 1, end).filter(b => b.toLowerCase() !== name.toLowerCase());
  const tagline = body[0] && body[0].length < 90 && !/[.!?]$/.test(body[0]) ? body[0] : null;
  const description = (tagline ? body.slice(1) : body).join(' ');
  const amountNum = priceText ? parseAmount(priceText) : null;
  return {
    slug: new URL(url).pathname.split('/').pop() ?? '',
    name,
    tagline,
    description,
    accommodates: Number(labelled('Accommodates')?.match(/\d+/)?.[0]) || null,
    features: (labelled('Features') ?? '').split(/\s*[,;]\s*/).map(f => f.replace(/^\w/, c => c.toUpperCase())).filter(Boolean),
    price: amountNum,
    currency: priceText ? (/\$|USD/.test(priceText) ? 'USD' : null) : null,
    priceText,
    includes: labelled('Includes'),
    extraCost: labelled('Extra cost'),
  };
}

export function buildCblSlots(rooms: CblRoom[]): Slot[] {
  return rooms.filter(r => r.price !== null && r.currency && /night/i.test(r.priceText ?? '')).map(r => ({
    key: keyPart(r.name || r.slug),
    startDate: null,
    endDate: null,
    unit: r.name,
    price: r.price,
    currency: r.currency,
    priceUnit: 'per_night',
    priceBasis: 'room',
    occupancy: r.accommodates,
    availability: 'unknown',
    availabilityText: null,
    spotsLeft: null,
  }));
}

export interface CblPages { home: string; rooms: string; roomPages: Array<{ url: string; html: string }> }

export function parseCampBayContent(p: CblPages): OfferContent {
  const home = blocks(p.home);
  const roomsIntro = blocks(p.rooms);
  const rooms = p.roomPages.map(r => parseCblRoom(r.html, r.url));
  const kite = home.find(b => /on-site launching and landing areas/i.test(b)) ?? '';
  const breakfast = roomsIntro.find(b => /Breakfast is included in every room rate/i.test(b)) ?? '';
  const tax = breakfast.match(/Government tax of (\d+)%/i)?.[1] ?? rooms.find(r => r.extraCost)?.extraCost?.match(/(\d+)%/)?.[1] ?? null;
  const priced = rooms.filter(r => r.price !== null);
  const min = priced.length ? Math.min(...priced.map(r => r.price!)) : null;
  const max = priced.length ? Math.max(...priced.map(r => r.price!)) : null;
  const kiteRoom = rooms.find(r => /kite/i.test(r.name));

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: [r.tagline, r.description].filter(Boolean).join(' - ') || null,
    features: [
      r.accommodates ? `Accommodates ${r.accommodates}` : null,
      ...r.features,
      r.priceText ? `Price: ${r.priceText}` : null,
      r.includes ? `Includes: ${r.includes}` : null,
      r.extraCost ? `Extra cost: ${r.extraCost}` : null,
    ].filter((x): x is string => !!x),
  }));

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  const sources: Array<[string, string]> = [
    ...(kiteRoom ? [[p.roomPages.find(x => x.url.endsWith(`/${kiteRoom.slug}`))!.html, `${SITE}/rooms/${kiteRoom.slug}`] as [string, string]] : []),
    [p.home, CBL_HOME_URL],
    ...p.roomPages.map(r => [r.html, r.url] as [string, string]),
  ];
  for (const [html, base] of sources) {
    for (const u of imageCandidates(html, base, null, 60)) {
      if (!/^https:\/\/images\.squarespace-cdn\.com\/content\//.test(u) || /\.png(\?|$)|og_image|logo|icon/i.test(u)) continue;
      const k = u.replace(/\?.*$/, '').split('/').pop()!.toLowerCase().replace(/\+%28\d+%29(?=\.[a-z]+$)/, '');
      if (seen.has(k)) continue;
      seen.add(k); imageUrls.push(u);
    }
  }

  const summary = [
    `Camp Bay Lodge is a rustic eco lodge directly on Camp Bay beach in the quiet East End of Roatán, Honduras, with ${rooms.length || 12} rooms, cabanas and studios built from natural hardwoods, a beachfront restaurant and bar.`,
    `It has on-site kite launching and landing areas and offers kitesurfing lessons (book before arrival); the Kitesurf Room sits next to the Roatán Kite School and the grassy launch area.`,
    `Breakfast is included in every room rate${min !== null ? `, which runs from USD ${min} to ${max} per night` : ''}${tax ? ` plus ${tax}% government tax` : ''}; diving, snorkeling, kayaking, boat trips and yoga are offered too.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Camp Bay Lodge',
    summary,
    continent: 'North America',
    country: 'Honduras',
    region: 'Bay Islands',
    spot: 'Camp Bay, Roatán',
    spotCoords: { lat: 16.42897224, lng: -86.29253387 }, // Google Maps link on every page of the site
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: /Kitesurfing lessons/i.test(kite) ? true : null,
    equipmentRental: null, // the site names lessons, not rental
    beginnerFriendly: null,
    includedServices: ['Breakfast', 'Fiber-optic Wi-Fi', 'Air conditioning', 'Beach towels'],
    optionalServices: ['Kitesurfing lessons (book before your stay)', 'Scuba diving', 'Snorkeling', 'Paddle boarding and kayaking', 'Boat excursions', 'Mangrove tours', 'Yoga retreats'],
    accommodation: 'beachfront rooms, cabanas and studios',
    mealPlan: 'breakfast',
    languages: ['en'],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: CBL_ROOMS_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home.filter(b => b.length > 60).join(' | ')}`,
      `rooms: ${roomsIntro.filter(b => b.length > 30).join(' | ')}`,
      ...rooms.map(r => `room ${r.name}: accommodates ${r.accommodates ?? '?'}; price ${r.priceText ?? '-'}; includes ${r.includes ?? '-'}; extra ${r.extraCost ?? '-'}; features ${r.features.join(', ')}; ${r.description}`),
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
async function loadRooms(ctx: FetchContext): Promise<{ rooms: string; roomPages: Array<{ url: string; html: string }> }> {
  const rooms = await page(CBL_ROOMS_URL);
  const urls = cblRoomUrls(rooms);
  if (urls.length === 0) throw new Error('camp-bay-lodge: no /rooms/<slug> links on the rooms page (layout changed?)');
  const roomPages: Array<{ url: string; html: string }> = [];
  for (const url of urls) {
    try { roomPages.push({ url, html: await page(url) }); } catch (e) { ctx.incomplete(`${url}: ${(e as Error).message}`); }
  }
  return { rooms, roomPages };
}

export const campBayLodgeRoatan: OfferAdapter = {
  key: 'camp-bay-lodge-roatan',
  name: 'Camp Bay Lodge Roatán',
  kind: 'accommodation',
  operator: {
    name: 'Camp Bay Lodge',
    websiteUrl: SITE,
    rootDomain: 'campbaylodgeroatan.com',
    contactEmail: 'thelodgecampbay@gmail.com',
    phone: '+50487761653',
  },
  url: CBL_ROOMS_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 15,
  async fetchContent(ctx) {
    const { rooms, roomPages } = await loadRooms(ctx);
    const home = await page(CBL_HOME_URL);
    return parseCampBayContent({ home, rooms, roomPages });
  },
  async fetchSlots(ctx) {
    const { roomPages } = await loadRooms(ctx);
    const rooms = roomPages.map(r => parseCblRoom(r.html, r.url));
    const slots = buildCblSlots(rooms);
    const unpriced = rooms.filter(r => r.price === null).map(r => r.name || r.slug);
    if (unpriced.length) ctx.note(`no "Price: $N/night" line on: ${unpriced.join(', ')}`);
    if (slots.length === 0) throw new Error('camp-bay-lodge: no room page with a "Price:" line (layout changed?)');
    return slots;
  },
};
