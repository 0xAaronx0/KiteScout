// ---------------------------------------------------------------------------
// KBC Sicily (Kiteboarding Club) - "Kitesurf Adventure Week KBC Sicily", Lo Stagnone: a 6-day all-inclusive event week
// for independent kitesurfers (from VDWS level 5) based at KBC's centre on the only sandy beach of the Lo Stagnone
// lagoon: single room at Villa Vajarassa (B&B in a renovated winery, 400 m from the lagoon), breakfast, lunch snacks
// at the spots and dinner, soft drinks / beer / wine, F-ONE kite + board for 6 days, guided sessions, an upwind /
// downwind trip, a secret spot with a night in a tent, a boat transfer to a remote spot, a session at Capo Feto,
// Trapani airport transfer and shuttles. Runs with min. 6 participants; groups of 6+ choose their own week.
// KIND = 'camp' (one base, day trips from it; durationDays 6 as sold).
//
// Data path (checked 2026-10-21):
//   content  www.kiteboarding-club.com/en/kitesurf-adventure-week-kbc-sicily/ (TYPO3, server-rendered): intro,
//            "+" highlights, villa / room / food text, day programme, "Included Services:", price box
//            (div#leao-product-price_45438 "1700€", the "Book" link https://myleao.com/calendar/product/45438/en),
//            "15% discount until the end of February - instead of €1700, only €1445 per person." (no year printed),
//            couple note "double room (with a €200 discount on the total price)". The page's "Dates" block is the
//            TYPO3 Leão connector and printed "ERROR: Please check the configuration of the plugin!" on 2026-10-21.
//   slots    booking engine = Leão Booking (myleao.com), the page's "Book" link. Its calendar page loads the
//            product's dated events anonymously from GET www.myleao.com/api/event/product/<id>/lang/en (public JSON,
//            no login, cookie, token or nonce; same endpoint as oasis-kite-kitecamp-djerba, whose parser
//            parseLeaoEvents / eventAvailability is imported). On 2026-10-21 it answers
//            {"status":1,"data":false,"error":"Error: No events found!"}.
//            - events present -> one slot per future event: engine dates, price (fallback: the page price), spots
//              left = maxParticipants - participants, availability from the engine (available / limited / sold_out /
//              closed).
//            - no events -> ONE undated slot at the page price (EUR per person, single room, package), availability
//              'on_request' with the reason ("no event dates in the booking engine; groups of 6+ pick their week").
//            The "15% until the end of February" price is used only in January / February (priceValidUntil = last
//            day of February of that year); otherwise it is quoted in the slot text.
// Flags: liveAvailability true (the engine is read on every run), instantBooking true (Leão online booking flow with
//   summary step, like the other Leão adapters). Doubt: with no events published, nothing can be booked online today.
// robots.txt (2026-10-21): kiteboarding-club.com allows the page (only TYPO3 folders, forms and tracking parameters
//   disallowed); www.myleao.com/robots.txt is 404 (= allow all).
// Requests per run: content 1, slots 1 page (memoised) + 1 engine = 2.
// Known limits: packageNights 5 is inferred (day 1 arrival, day 6 "final session before departure"); the engine's
//   event dates override it. The operator row is matched by root domain kiteboarding-club.com, which the catalog
//   already holds for "Kiteboarding Club Parajuru" (pousada-mare-alta-parajuru): the ingest only fills gaps, so this
//   offer will show that provider name.
// State 2026-10-21: 0 engine events -> 1 undated slot, EUR 1,700 per person.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, iso, parse, parseAmount, todayIso } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import { eventAvailability, parseLeaoEvents, type LeaoEvent } from './oasis-kite-kitecamp-djerba.js';

const SITE = 'https://www.kiteboarding-club.com';
export const KBC_URL = `${SITE}/en/kitesurf-adventure-week-kbc-sicily/`;
const LEAO = 'https://www.myleao.com';
export const kbcEventsUrl = (productId: number): string => `${LEAO}/api/event/product/${productId}/lang/en`;
const DEFAULT_NIGHTS = 5; // inferred, see header

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string, accept?: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, accept ? { accept } : {});
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible lines (structured text, collapsed). */
export function kbcLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('head, script, style, noscript, template')) el.remove();
  return root.structuredText.split('\n').map(l => collapse(l)).filter(Boolean);
}

export interface KbcPage {
  productId: number | null;
  bookingUrl: string | null;
  price: number | null;
  discount: { pct: number; untilMonth: string; price: number } | null;
  coupleDiscount: number | null;
  days: number | null;
}

export function parseKbcPage(html: string): KbcPage {
  const root = parse(html);
  const btn = root.querySelector('a.leao-product-btn_book') ?? root.querySelector('a[href*="myleao.com/calendar/product/"]');
  const href = btn?.getAttribute('href') ?? null;
  const productId = Number(href?.match(/\/product\/(\d+)/)?.[1] ?? btn?.getAttribute('id')?.match(/(\d+)$/)?.[1] ?? NaN);
  const priceEl = root.querySelector('.leao-product-price');
  const text = kbcLines(html).join('\n');
  const d = text.match(/(\d+)%\s*discount until the end of ([A-Za-z]+)[^\n]*?only\s*€\s*([\d.,]+)/i);
  const couple = text.match(/double room \(with a €\s*([\d.,]+) discount/i);
  const days = text.match(/(\d+)-Day All-Inclusive/i);
  return {
    productId: Number.isFinite(productId) ? productId : null,
    bookingUrl: href,
    price: priceEl ? parseAmount(clean(priceEl.text)) : null,
    discount: d ? { pct: +d[1], untilMonth: d[2], price: parseAmount(d[3])! } : null,
    coupleDiscount: couple ? parseAmount(couple[1]) : null,
    days: days ? +days[1] : null,
  };
}

const nightsBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const UNIT = 'Single room at Villa Vajarassa, full board + drinks, F-ONE gear, guiding, transfers';

/** The page price that applies on `today` ("15% until the end of February" only in Jan/Feb). */
export function kbcPrice(p: KbcPage, today: string): { price: number | null; validUntil: string | null; note: string | null } {
  const month = +today.slice(5, 7);
  if (p.discount && /^feb/i.test(p.discount.untilMonth) && month <= 2) {
    const y = +today.slice(0, 4);
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return { price: p.discount.price, validUntil: iso(y, 2, leap ? 29 : 28), note: `${p.discount.pct}% early discount until the end of February (instead of EUR ${p.price ?? '?'})` };
  }
  const note = p.discount ? `the page also offers ${p.discount.pct}% off until the end of ${p.discount.untilMonth} (EUR ${p.discount.price}; year not printed)` : null;
  return { price: p.price, validUntil: null, note };
}

export function buildKbcSlots(p: KbcPage, events: LeaoEvent[], today: string): Slot[] {
  const cur = kbcPrice(p, today);
  const couple = p.coupleDiscount ? `couples in a double room get EUR ${p.coupleDiscount} off the total` : null;
  const future = events.filter(e => e.startdate >= today).sort((a, b) => a.startdate.localeCompare(b.startdate));
  if (future.length === 0) {
    return [{
      key: 'single-room',
      startDate: null,
      endDate: null,
      unit: UNIT,
      price: cur.price,
      currency: cur.price !== null ? 'EUR' : null,
      priceUnit: cur.price !== null ? 'package' : null,
      priceBasis: cur.price !== null ? 'person' : null,
      occupancy: 1,
      availability: 'on_request',
      availabilityText: ['No event dates in the KBC booking engine at the moment; groups of 6+ choose their own week; the event runs with min. 6 participants', cur.note, couple].filter(Boolean).join('; '),
      spotsLeft: null,
      packageNights: DEFAULT_NIGHTS,
      priceValidUntil: cur.validUntil,
    }];
  }
  return future.map(e => {
    const st = eventAvailability(e);
    const engine = parseAmount(String(e.price ?? ''));
    const currency = /^[A-Z]{3}$/.test(String(e.currency ?? '')) ? String(e.currency) : null;
    const price = engine && currency ? engine : cur.price;
    const n = nightsBetween(e.startdate, e.enddate);
    return {
      key: e.startdate,
      startDate: e.startdate,
      endDate: e.enddate,
      unit: UNIT,
      price,
      currency: engine && currency ? currency : (price !== null ? 'EUR' : null),
      priceUnit: price !== null ? 'package' as const : null,
      priceBasis: price !== null ? 'person' as const : null,
      occupancy: 1,
      availability: st.availability,
      availabilityText: [st.text, 'min. 6 participants', engine && currency ? null : cur.note, couple].filter(Boolean).join('; ') || null,
      spotsLeft: st.spotsLeft,
      packageNights: n > 0 && n <= 60 ? n : DEFAULT_NIGHTS,
      priceValidUntil: engine && currency ? null : cur.validUntil,
    };
  });
}

export async function fetchKbcSlots(ctx: FetchContext, today = todayIso()): Promise<Slot[]> {
  const p = parseKbcPage(await page(KBC_URL));
  if (p.productId === null) throw new Error('kbc-sicily: no Leão product link on the page (layout changed?)');
  if (p.price === null) ctx.note('kbc-sicily: no price box found; price on request');
  let events: LeaoEvent[] = [];
  try {
    events = parseLeaoEvents(await page(kbcEventsUrl(p.productId), 'application/json'));
  } catch (e) {
    ctx.incomplete(`leao events failed (${(e as Error).message})`);
  }
  const past = events.filter(e => e.startdate < today);
  if (past.length) ctx.note(`past event(s) dropped: ${past.map(e => e.startdate).join(', ')}`);
  if (events.length - past.length === 0) ctx.note('no future events in the Leão engine; undated slot at the page price');
  return buildKbcSlots(p, events, today);
}

// --- content ----------------------------------------------------------------------------------------------------------
function listAfter(lines: string[], head: RegExp, stop: RegExp): string[] {
  const i = lines.findIndex(l => head.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(i + 1, i + 40)) {
    if (stop.test(l)) break;
    out.push(l);
  }
  return out;
}

/** Content photos (img.image-embed-item, >= 500x330 by their width/height attributes), og:image first if any. */
export function kbcImages(html: string): string[] {
  const out: string[] = [];
  const root = parse(html);
  const og = root.querySelector('meta[property="og:image"]')?.getAttribute('content');
  if (og) out.push(new URL(og, SITE).toString());
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? img.getAttribute('data-src');
    if (!src || !/\.(jpe?g|png|webp)$/i.test(src) || /logo|icon|flag/i.test(src)) continue;
    const w = Number(img.getAttribute('width') ?? 0);
    const h = Number(img.getAttribute('height') ?? 0);
    if (w < 500 || h < 330) continue;
    const u = new URL(src, SITE).toString();
    if (!out.includes(u)) out.push(u);
  }
  return out.slice(0, 16);
}

export function parseKbcContent(html: string, today = todayIso()): OfferContent {
  const lines = kbcLines(html);
  const p = parseKbcPage(html);
  const cur = kbcPrice(p, today);
  const included = listAfter(lines, /^Included Services:?$/i, /^The event will only take place/i)
    .filter(l => !/^Daily Meals:?$/i.test(l));
  const level = lines.join(' ').match(/from VDWS Level (\d+)/i)?.[1];
  const days = p.days ?? 6;
  const summary = [
    `KBC Sicily, the Kiteboarding Club's centre on the only sandy beach of the Lo Stagnone lagoon near Marsala, runs a ${days}-day all-inclusive Kitesurf Adventure Week for independent kitesurfers${level ? ` (from VDWS level ${level})` : ''}.`,
    `Guests stay in single rooms at Villa Vajarassa, a B&B in a renovated winery 400 m from the lagoon, with breakfast, lunch snacks at the spots, dinner and drinks, and ride F-ONE gear on guided sessions: an upwind and downwind trip, a secret spot with a night in a tent, a boat transfer to a remote spot and a session at Capo Feto (a boat trip to the Egadi Islands if the wind fails).`,
    `${cur.price !== null ? `The week costs EUR ${cur.price.toLocaleString('en-US')} per person${p.coupleDiscount ? ` (couples sharing a double room get EUR ${p.coupleDiscount} off the total)` : ''}, Trapani airport transfer included; ` : ''}it runs with at least 6 participants, and groups of 6 or more can pick their own week.`,
    `Dates and booking run through KBC's online booking engine.`,
  ].join(' ');
  return {
    kind: 'camp',
    title: 'KBC Kitesurf Adventure Week Sicily, Lo Stagnone',
    summary,
    continent: 'Europe',
    country: 'Italy',
    region: 'Lo Stagnone, Sicily',
    spot: 'Lo Stagnone',
    // no spotCoords: the page prints none
    itinerarySpots: [],
    durationDays: days,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: false,
    equipmentRental: true,
    beginnerFriendly: false,
    includedServices: included,
    optionalServices: [
      ...(p.coupleDiscount ? [`Double room for couples (EUR ${p.coupleDiscount} off the total price)`] : []),
      'Private Adventure Week on a date of your choice for groups of 6 or more',
    ],
    accommodation: 'Villa Vajarassa (B&B in a renovated winery, 400 m from the lagoon), single rooms with own bathroom',
    mealPlan: 'full_board',
    languages: ['en', 'de'],
    rooms: [],
    imageUrls: kbcImages(html),
    heroVideoUrl: null,
    sourceUrl: KBC_URL,
    bookingUrl: p.bookingUrl ?? KBC_URL,
    sourceText: [
      `page: ${lines.slice(1, 90).join(' / ')}`,
      `parsed: ${JSON.stringify(p)}`,
    ].join('\n'),
  };
}

export const kbcAdventureWeekLoStagnone: OfferAdapter = {
  key: 'kbc-adventure-week-lo-stagnone',
  name: 'KBC Kitesurf Adventure Week Sicily, Lo Stagnone',
  kind: 'camp',
  operator: {
    name: 'KBC Sicily (Kiteboarding Club)',
    websiteUrl: SITE,
    rootDomain: 'kiteboarding-club.com',
    contactEmail: 'sizilien@KBC-World.com',
  },
  url: KBC_URL,
  slotMethod: 'booking_engine',
  liveAvailability: true,
  instantBooking: true,
  fetchBudget: 3,
  async fetchContent() {
    const html = await page(KBC_URL);
    if (!/Adventure Week/i.test(html)) throw new Error('kbc-sicily: "Adventure Week" missing on the page (layout changed?)');
    return parseKbcContent(html);
  },
  fetchSlots: ctx => fetchKbcSlots(ctx),
};
