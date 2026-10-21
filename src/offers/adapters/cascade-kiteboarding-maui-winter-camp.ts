// ---------------------------------------------------------------------------
// Cascade Kiteboarding Maui Winter Camp (Maui, Hawaii, USA) - a one-week kiteboarding / wing foil
// coaching camp run by Cascade Kiteboarding (Hood River, OR) in private oceanfront accommodation on
// Maui: 6 nights, daily coaching, two chef-prepared meals a day, yoga, airport transport.
//
// Data path (checked 2026-10-14): Squarespace site cascadekiteboarding.com, page /new-page-3
//   ("Maui, Hawaii - Winter 2026"): <h3>DATES:</h3> + "December 13th [em dash] December 19th, 2026",
//   <h3>Cost:</h3> + "$5,000 per private room" / "7 Days / 6 Nights" / "Add a second guest to the same
//   room for $1,000", <h3>What's Included:</h3> + <p> list. "RESERVE HERE" links to an Acuity
//   Scheduling catalog cart (app.acuityscheduling.com/catalog.php?...action=addCart) - a cart action,
//   not a data endpoint; we never call it -> no live availability.
// Currency: the page prints only "$"; USD is the site's own Squarespace store setting
//   ("selectedCurrency":"USD") and the business is in the US -> USD (inferred from that setting).
// robots.txt www.cascadekiteboarding.com (Squarespace defaults, 2026-10-14): the page is allowed.
//   app.acuityscheduling.com robots.txt disallows /api/* and schedule.php appointment paths (not used).
// Requests per run: 1 (content + slots share the memoised page).
// Slots: one per dated camp week found on the page (key "private-room|<start>"), USD per private
//   room for the whole camp (priceUnit 'package', 1 guest), availability 'unknown' (the page says
//   nothing about places left). Weeks that already ended are dropped. The +$1,000 second guest goes
//   into the room features (no separate slot).
// Known limits: the page does not name the Maui beach or house -> spot "Maui", no map pin. The page
//   URL ("new-page-3") is a builder default and may change when the 2027 edition is published.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { parseAmount, parseRange, todayIso, daysInclusive } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import { sqsBlocks, sqsCurrency, sqsImages } from './floras-lake-house-langlois.js';

const SITE = 'https://www.cascadekiteboarding.com';
export const CK_MAUI_URL = `${SITE}/new-page-3`;

const memo = new Map<string, Promise<string>>();
function page(url: string): Promise<string> {
  let p = memo.get(url);
  if (!p) { p = fetchText(url, { accept: 'text/html' }); memo.set(url, p); p.catch(() => memo.delete(url)); }
  return p;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface CkCamp {
  heading: string;                     // "Maui, Hawaii - Winter 2026"
  weeks: Array<{ start: string; end: string; text: string }>;
  price: number | null;                // per private room
  secondGuest: number | null;
  nights: number | null;
  included: string[];
  day: string[];
  noWind: string[];
  reserveUrl: string | null;
  currency: string;
}

/** Paragraphs after an <h3> label ("DATES:", "Cost:") up to the next heading. */
function section(blocks: Array<{ tag: string; text: string }>, label: RegExp): string[] {
  const i = blocks.findIndex(b => /^h[1-6]$/.test(b.tag) && label.test(b.text));
  if (i < 0) return [];
  const out: string[] = [];
  for (const b of blocks.slice(i + 1)) {
    if (/^h[1-6]$/.test(b.tag)) break;
    out.push(b.text);
  }
  return out;
}

export function parseCkCamp(html: string): CkCamp {
  const blocks = sqsBlocks(html);
  const heading = blocks.find(b => b.tag === 'h3' && /Maui/i.test(b.text))?.text ?? 'Maui, Hawaii';
  const yearInHeading = Number(heading.match(/\b(20\d{2})\b/)?.[1] ?? NaN);
  const weeks = section(blocks, /^DATES:?$/i)
    .map(t => ({ t, r: parseRange(t.replace(/(\d)(st|nd|rd|th)\b/g, '$1'), Number.isFinite(yearInHeading) ? yearInHeading : undefined) }))
    .filter(x => x.r)
    .map(x => ({ start: x.r!.start, end: x.r!.end, text: x.t }));
  const cost = section(blocks, /^Cost:?$/i);
  const priceLine = cost.find(t => /per private room/i.test(t)) ?? null;
  const secondLine = cost.find(t => /second guest/i.test(t)) ?? null;
  const nightsLine = cost.find(t => /Nights?/i.test(t)) ?? '';
  // "What does a typical day look like?" runs until "No Wind?" (a <p>, not a heading)
  const dayAll = section(blocks, /typical day/i);
  const nw = dayAll.findIndex(t => /^No Wind\??$/i.test(t));
  const day = (nw >= 0 ? dayAll.slice(0, nw) : dayAll);
  const noWind = nw >= 0 ? dayAll.slice(nw + 1).filter(t => !/additional information|BLOG$/i.test(t)) : [];
  const reserve = html.match(/href="(https:\/\/app\.acuityscheduling\.com\/catalog\.php[^"]+)"/)?.[1]?.replace(/&amp;/g, '&') ?? null;
  return {
    heading,
    weeks,
    price: priceLine ? parseAmount(priceLine) : null,
    secondGuest: secondLine ? parseAmount(secondLine.replace(/^[^$]*/, '')) : null,
    nights: Number(nightsLine.match(/(\d+)\s*Nights?/i)?.[1] ?? NaN) || null,
    included: section(blocks, /^What'?s Included/i),
    day,
    noWind,
    reserveUrl: reserve,
    currency: sqsCurrency(html) ?? 'USD',
  };
}

export function buildCkSlots(c: CkCamp, today = todayIso()): Slot[] {
  return c.weeks.filter(w => w.end >= today).map(w => ({
    key: `private-room|${w.start}`,
    startDate: w.start,
    endDate: w.end,
    unit: 'Private room (1 guest)',
    price: c.price,
    currency: c.price === null ? null : c.currency,
    priceUnit: c.price === null ? null : 'package',
    priceBasis: c.price === null ? null : 'room',
    occupancy: 1,
    availability: 'unknown',
    availabilityText: null,
    spotsLeft: null,
  }));
}

export function parseCkContent(html: string, url = CK_MAUI_URL): OfferContent {
  const c = parseCkCamp(html);
  const w = c.weeks[0] ?? null;
  const days = w ? daysInclusive(w.start, w.end) : (c.nights ? c.nights + 1 : 7);
  const cur = (n: number) => `${c.currency} ${n.toLocaleString('en-US')}`;
  const disciplines = c.included.filter(t => /^(Kiteboarding|Wing Foiling|Surfing)$/i.test(t));
  const included = c.included.filter(t => !/^(Kiteboarding|Wing Foiling|Surfing)$/i.test(t) && !/^Access to multiple disciplines/i.test(t));
  const rooms: ContentRoom[] = [{
    name: 'Private room',
    description: c.included.find(t => /Private bedroom/i.test(t)) ?? null,
    features: [
      ...(c.price ? [`${cur(c.price)} per private room for the ${c.nights ?? days - 1}-night camp`] : []),
      ...(c.secondGuest ? [`second guest in the same room +${cur(c.secondGuest)}`] : []),
      ...c.included.filter(t => /oceanfront|beach access|hot tub/i.test(t)),
    ],
  }];
  const summary = [
    `Cascade Kiteboarding, a kite school from Hood River (Oregon), runs a ${days}-day / ${c.nights ?? days - 1}-night kiteboarding and wing foil camp on Maui, Hawaii${w ? ` (${w.text.replace(/\s*[–—]\s*/g, ' - ').replace(/\s+/g, ' ')})` : ''}.`,
    'Guests stay in private bedrooms of oceanfront accommodation with direct beach access; daily coaching and guided sessions are tailored to each rider in a small group, with two chef-prepared meals a day, daily yoga and airport transport included.',
    c.price ? `The camp costs ${cur(c.price)} per private room${c.secondGuest ? `, plus ${cur(c.secondGuest)} for a second guest in the same room` : ''}; on days without wind the group surfs or explores the island.` : null,
  ].filter(Boolean).join(' ');
  return {
    kind: 'camp',
    title: 'Cascade Kiteboarding Maui Winter Camp',
    summary,
    continent: 'North America',
    country: 'United States',
    region: 'Maui, Hawaii',
    spot: 'Maui',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: days,
    skillLevels: [], // "tailored to your skill level" - no levels named
    kiteLessons: c.included.some(t => /coaching/i.test(t)) ? true : null,
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: included,
    optionalServices: [],
    accommodation: 'private bedrooms in oceanfront accommodation with direct beach access',
    mealPlan: c.included.some(t => /Two .*meals/i.test(t)) ? 'half_board' : null,
    languages: ['en'],
    rooms,
    imageUrls: sqsImages(html, 20),
    heroVideoUrl: null,
    sourceUrl: url,
    bookingUrl: c.reserveUrl ?? url,
    sourceText: [
      c.heading,
      `dates: ${c.weeks.map(x => x.text).join(' | ')}`,
      `cost: ${section(sqsBlocks(html), /^Cost:?$/i).join(' | ')}`,
      `included: ${c.included.join(' | ')}`,
      `disciplines: ${disciplines.join(', ')}`,
      `typical day: ${c.day.join(' | ')}`,
      `no wind: ${c.noWind.join(' | ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const cascadeKiteboardingMauiWinterCamp: OfferAdapter = {
  key: 'cascade-kiteboarding-maui-winter-camp',
  name: 'Cascade Kiteboarding Maui Winter Camp',
  kind: 'camp',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Cascade Kiteboarding',
    websiteUrl: `${SITE}/`,
    rootDomain: 'cascadekiteboarding.com',
    contactEmail: 'cascadekiteboarding@gmail.com', // page footer, 2026-10-14
    phone: '+15413921212',                         // "(541) 392-1212"
  },
  url: CK_MAUI_URL,
  slotMethod: 'html_dates',
  instantBooking: true,
  fetchBudget: 2,
  confidence: 'medium',
  async fetchContent() {
    return parseCkContent(await page(CK_MAUI_URL));
  },
  async fetchSlots(ctx: FetchContext) {
    const c = parseCkCamp(await page(CK_MAUI_URL));
    if (c.weeks.length === 0) throw new Error('cascade-maui: no camp dates under "DATES:" (layout changed or page moved?)');
    if (c.price === null) ctx.note('no "per private room" price under "Cost:"');
    const slots = buildCkSlots(c);
    if (slots.length === 0) ctx.note(`all camp dates are past (${c.weeks.map(w => w.start).join(', ')})`);
    return slots;
  },
};
