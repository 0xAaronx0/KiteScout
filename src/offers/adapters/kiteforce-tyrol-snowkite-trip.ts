// ---------------------------------------------------------------------------
// Kiteforce Tyrol Kite Trip - a SNOWKITE motorhome trip (kiting on snow, not on water) run by the Czech kite school
// CZECH KITE FORCE s.r.o. since 2014: 5 nights in a rented 6-berth motorhome (max. 5 guests) parked by the frozen
// Reschensee / Lago di Resia (South Tyrol, Italy), with days on the lake, Haidersee, and - when the forecast fits - the
// Bernina Pass (Lago Bianco) and Lake Silvaplana in the Engadin (Switzerland). Coaching, gear testing / rental, diesel
// and organisation included; snowkite courses (1-3 days) optional. Departure from the Czech Republic.
//
// Data path (checked 2026-10-19): WordPress + Elementor, server-rendered, ONE page /en/kite-trips/tyrol-kite-trip/:
//   slots    "DATE: 18.-25.1.2026" (the week in which the 5-night trip runs; the start day follows the forecast),
//            "Kite Trip PRICE: 19 500 CZK" and the price list "19 500 CZK / 5 nights". One slot per listed date window
//            that has not started, CZK per person (inferred: "Kite Trip PRICE" for a shared motorhome place; "per person"
//            is printed only next to the course prices), priceUnit 'package', packageNights 5, availability 'on_request'
//            (order form "We will then contact you"). The only date (January 2026) is past -> [] until the page lists
//            new dates (the parser reads every dotted range on the DATE line).
//   content  the same page (program, accommodation, inclusions, course prices, gallery).
// Booking: request form only -> instantBooking false.
// robots.txt (2026-10-19): only /wp-admin/ disallowed.
// Requests per run: 1 (content + slots share one memoised page fetch).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, iso, parse, parseAmount, todayIso, type HTMLElement } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://kiteforce.cz';
export const KFT_URL = `${SITE}/en/kite-trips/tyrol-kite-trip/`;

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
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
function bodyRoot(html: string): HTMLElement {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, form, [data-elementor-type="header"], [data-elementor-type="footer"]')) el.remove();
  return root.querySelector('[data-elementor-type="wp-page"]') ?? root.querySelector('main') ?? root.querySelector('body') ?? root;
}

/** Every dotted range: "18.-25.1.2026", "29.1.-5.2.2027", "18.1.-25.1.2026". */
export function dottedRanges(text: string): Array<{ start: string; end: string; raw: string }> {
  const out: Array<{ start: string; end: string; raw: string }> = [];
  for (const m of text.replace(/[–—]/g, '-').matchAll(/(\d{1,2})\.(?:(\d{1,2})\.)?(?:(20\d{2}))?\s*-\s*(\d{1,2})\.(\d{1,2})\.\s*(20\d{2})/g)) {
    const y = Number(m[6]);
    const m2 = Number(m[5]);
    const m1 = m[2] ? Number(m[2]) : m2;
    const y1 = m[3] ? Number(m[3]) : m1 > m2 ? y - 1 : y;
    out.push({ start: iso(y1, m1, Number(m[1])), end: iso(y, m2, Number(m[4])), raw: m[0] });
  }
  return out;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface KftFacts {
  dates: Array<{ start: string; end: string; raw: string }>;
  dateLine: string | null;
  location: string | null;
  price: number | null;
  currency: string | null;
  nights: number | null;
  courses: Array<{ days: number; price: number }>;
  included: string[];
  excluded: string[];
}

export function parseKftFacts(html: string): KftFacts {
  const root = bodyRoot(html);
  const paras = root.querySelectorAll('p, li').map(p => txt(p));
  const line = (re: RegExp): string | null => paras.find(p => re.test(p)) ?? null;
  const dateLine = line(/^DATE:/i);
  const priceLine = line(/^Kite Trip PRICE:/i);
  const perNights = line(/^[\d\s.,]+\s*CZK\s*\/\s*\d+\s*nights?$/i);
  const pm = priceLine?.match(/([\d\s.,]+)\s*(CZK|EUR|€)/i);
  const courses: Array<{ days: number; price: number }> = [];
  for (const p of paras) {
    const m = p.match(/^(\d)\s*days?\s*[–-]\s*([\d\s.,]+)\s*CZK$/i);
    if (m && !courses.some(c => c.days === Number(m[1]))) courses.push({ days: Number(m[1]), price: parseAmount(m[2])! });
  }
  const listAfter = (re: RegExp): string[] => {
    const head = root.querySelectorAll('p').find(p => re.test(txt(p)));
    let el = head?.nextElementSibling ?? null;
    while (el && el.tagName !== 'UL') el = el.nextElementSibling;
    return el ? el.querySelectorAll('li').map(li => txt(li)).filter(Boolean) : [];
  };
  return {
    dates: dateLine ? dottedRanges(dateLine) : [],
    dateLine,
    location: line(/^LOCATION:/i)?.replace(/^LOCATION:\s*/i, '') ?? null,
    price: pm ? parseAmount(pm[1]) : null,
    currency: pm ? (/czk/i.test(pm[2]) ? 'CZK' : 'EUR') : null,
    nights: Number(perNights?.match(/(\d+)\s*nights?/i)?.[1] ?? NaN) || null,
    courses,
    included: listAfter(/^Included in the price/i),
    excluded: listAfter(/^Price does not include/i),
  };
}

export function buildKftSlots(f: KftFacts, today: string): Slot[] {
  return f.dates.filter(d => d.start >= today).map(d => ({
    key: d.start,
    startDate: d.start,
    endDate: d.end,
    unit: `Place in the motorhome${f.nights ? `, ${f.nights} nights` : ''}`,
    price: f.price,
    currency: f.price !== null ? f.currency : null,
    priceUnit: f.price !== null ? 'package' : null,
    priceBasis: f.price !== null ? 'person' : null, // inferred, see header
    occupancy: null,
    availability: 'on_request',
    availabilityText: `Order form, the school replies; trip runs within ${d.raw} (start day by the forecast)`,
    spotsLeft: null,
    packageNights: f.nights,
  }));
}

export function parseKftContent(html: string, today = todayIso()): OfferContent {
  const f = parseKftFacts(html);
  const root = bodyRoot(html);
  const text = txt(root);
  const fmt = (n: number): string => n.toLocaleString('en-US');
  const day = (d: string, y = true): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', ...(y ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  const future = f.dates.filter(d => d.start >= today);
  const past = f.dates.filter(d => d.start < today);
  const nights = f.nights ?? 5;
  const gallery = root.querySelectorAll('.gallery-item a[href]').map(a => new URL(a.getAttribute('href')!, SITE).toString())
    .filter(u => /\.(jpe?g|png|webp)$/i.test(u));

  const dates = future.length
    ? `Next dates: ${future.map(d => `${day(d.start, false)} to ${day(d.end)}`).join(', ')} (the trip runs within that week, the start day follows the forecast); booking by request form.`
    : past.length
      ? `Runs every winter; ${Number(past[past.length - 1].start.slice(0, 4)) + 1} dates not yet published (${past[past.length - 1].start.slice(0, 4)}: ${past.map(d => `${day(d.start, false)} to ${day(d.end)}`).join(', ')}).`
      : 'Dates are announced on the trip page; booking by request form.';

  const summary = [
    'Kiteforce, a Czech kite school, runs a snowkiting road trip - kiting on snow with skis or a snowboard, not on water - to the frozen lakes of Tyrol and the Engadin, as it has done several times a winter since 2014.',
    `The group of up to five lives ${nights} nights in a rented motorhome next to the Reschensee (Lago di Resia) in South Tyrol and kites there and on the Haidersee, and when the forecast fits on Lago Bianco at the Bernina Pass and on Lake Silvaplana in Switzerland; coaching, gear testing and rental and the diesel are included, and beginners can add a snowkite course.`,
    f.price ? `The trip costs ${f.currency} ${fmt(f.price)}${f.courses.length ? `, courses ${f.courses.map(c => `${c.days} day${c.days > 1 ? 's' : ''} ${f.currency} ${fmt(c.price)}`).join(', ')} per person` : ''}.` : '',
    dates,
  ].filter(Boolean).join(' ');

  return {
    kind: 'tour',
    title: 'Kiteforce Tyrol Snowkite Trip',
    summary,
    continent: 'Europe',
    country: 'Italy',
    region: 'South Tyrol',
    spot: 'Reschensee, South Tyrol',
    spotCoords: null,
    itinerarySpots: [
      { name: 'Reschensee', country: 'Italy', region: 'South Tyrol', order: 1 },
      { name: 'Haidersee', country: 'Italy', region: 'South Tyrol', order: 2 },
      { name: 'Lago Bianco, Bernina Pass', country: 'Switzerland', region: 'Graubünden', order: 3 },
      { name: 'Silvaplana', country: 'Switzerland', region: 'Engadin, Graubünden', order: 4 },
    ],
    durationDays: nights + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: f.courses.length > 0,
    equipmentRental: f.included.some(i => /rental/i.test(i)),
    beginnerFriendly: /intended for beginners/i.test(text),
    includedServices: f.included.map(i => cap(i.replace(/^kouching your/i, 'coaching of your').replace(/^kouching/i, 'coaching'))),
    optionalServices: [
      ...f.courses.map(c => `Snowkite course, ${c.days} day${c.days > 1 ? 's' : ''} (3 hours a day, kite gear included): ${f.currency} ${fmt(c.price)} per person`),
      ...f.excluded.map(e => `Not included: ${e.replace(/\(6 euro\)/i, '(EUR 6)')}`),
    ],
    accommodation: 'Rented 6-berth motorhome (heating, toilet, shower, kitchenette; max. 5 guests)',
    mealPlan: 'self_catering', // breakfast on your own, one shared cooked meal a day, restaurants
    languages: ['cs', 'en', 'de'],
    rooms: [],
    imageUrls: gallery.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KFT_URL,
    bookingUrl: KFT_URL,
    sourceText: [
      `date line: ${f.dateLine ?? '?'}; location: ${f.location ?? '?'}; price ${f.currency} ${f.price} / ${f.nights} nights`,
      `page: ${text}`,
    ].join('\n'),
  };
}

export async function fetchKftSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const f = parseKftFacts(await page(KFT_URL));
  if (!f.dateLine) throw new Error('kiteforce-tyrol: "DATE:" line not found (layout changed?)');
  if (!f.dates.length) ctx?.note(`kiteforce-tyrol: no date range on the DATE line ("${f.dateLine}")`);
  const slots = buildKftSlots(f, today);
  if (f.dates.length && !slots.length) ctx?.note(`kiteforce-tyrol: listed date is past (${f.dateLine}); next dates not published yet`);
  return slots;
}

// --- adapter ----------------------------------------------------------------------------------
export const kiteforceTyrolSnowkiteTrip: OfferAdapter = {
  key: 'kiteforce-tyrol-snowkite-trip',
  name: 'Kiteforce - Tyrol Kite Trip (snowkite motorhome trip, Reschensee / Bernina / Silvaplana)',
  kind: 'tour',
  disciplines: ['snowkite'],
  operator: {
    name: 'Kiteforce (CZECH KITE FORCE, s.r.o.)',
    websiteUrl: `${SITE}/en/`,
    rootDomain: 'kiteforce.cz',
    contactEmail: 'info@kiteforce.cz',
    phone: '+420 731 180 794',
  },
  url: KFT_URL,
  slotMethod: 'html_dates',
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() {
    return parseKftContent(await page(KFT_URL));
  },
  fetchSlots: ctx => fetchKftSlots(todayIso(), ctx),
};
