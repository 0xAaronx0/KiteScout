// ---------------------------------------------------------------------------
// X-FLY Kiteboarding Camp School in Miyako Island (Miyakojima, Okinawa, Japan) - the Kanagawa kite school's winter
// "training camp" school ("like a residential driving-licence course") on Miyakojima: guesthouse accommodation, kite
// school, equipment rental, guesthouse shower and insurance, 3 days for JPY 66,000 plus JPY 17,000 per extra day. A
// rental car is needed (not included). Kind 'camp'.
//
// Data path (checked 2026-10-19): WordPress (SWELL theme), server-rendered.
//   page     the English camp page /kiteboard-program/【in宮古島】カイトボード合宿スクールプラン♪-2/ (linked as
//            "Click here for more details!!" from /kiteboard-program-eg/ and from the menu "【in Miyako Island】
//            Kiteboarding Camp School"); the Japanese twin (same slug without "-2") prints the same facts.
//            Price: "3days ¥66,000(tax include)" + "＋¥17,000 per day" (JPY, tax included). Window: "The event dates
//            vary from year to year. In 2025, the event will be held from November 27th to January 13th." (the
//            Japanese page: "2025年度は 11/27~1/13", i.e. 27 Nov 2025 - 13 Jan 2026).
//   slots    DECISION (2026-10-19): the price has no year, but the only window the page prints (2025/26) is over and
//            the 2026/27 window is not posted. An undated slot would advertise a bookable camp we cannot date, so
//            fetchSlots returns [] (price on request) until the page prints a window that has not ended; then it
//            returns ONE window slot (startDate/endDate = the printed window, datePrecision 'season'), JPY 66,000
//            per person (inferred: a per-student school fee) for the 3-day package, availability 'on_request'
//            (booking by e-mail / phone; the guesthouse may be full, then JPY 4,000 per day is refunded).
//   content  the same page (text, photos); the summary carries the price and the last window.
// robots.txt (2026-10-19): only /wp-admin/ disallowed.
// Requests per run: 1 (memoised across content + slots).
// Known limits: the site's header "予約する" (book) button goes to asoview.com (an activity marketplace, general lessons
//   only) - not used, never fetched. Nights in the 3-day package are not stated (packageNights left empty). No
//   spotCoords and no beach name on the site.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, monthOf, parse, parseAmount, todayIso, type HTMLElement } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://x-fly.jp';
export const XFLY_CAMP_URL = `${SITE}/kiteboard-program/%e3%80%90in%e5%ae%ae%e5%8f%a4%e5%b3%b6%e3%80%91%e3%82%ab%e3%82%a4%e3%83%88%e3%83%9c%e3%83%bc%e3%83%89%e5%90%88%e5%ae%bf%e3%82%b9%e3%82%af%e3%83%bc%e3%83%ab%e3%83%97%e3%83%a9%e3%83%b3%e2%99%aa-2/`;
export const XFLY_CONTACT_URL = `${SITE}/contact/`;

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

function visible(html: string): HTMLElement {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, iframe, header, footer, nav, .l-header, .l-footer, #sidebar, .p-spMenu')) el.remove();
  return root;
}
function lines(html: string): string[] {
  const root = visible(html);
  const main = root.querySelector('.post_content') ?? root.querySelector('main') ?? root;
  return main.structuredText.split('\n').map(s => collapse(s.replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xfee0)))).filter(Boolean);
}

// --- pure parsers ------------------------------------------------------------------------------
export interface XflyCamp {
  days: number | null;
  price: number | null;
  extraDay: number | null;
  /** the printed window (season year = the year the window starts) */
  window: { start: string; end: string; label: string } | null;
  included: string[];
}

/** EN "In 2025, the event will be held from November 27th to January 13th." / JA "2025年度は 11/27~1/13". */
export function parseXflyWindow(text: string): XflyCamp['window'] {
  let m = text.match(/In (20\d{2}),?[^.]*?from ([A-Z][a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)? to ([A-Z][a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?/);
  if (m && monthOf(m[2]) && monthOf(m[4])) {
    const y = Number(m[1]);
    const m1 = monthOf(m[2])!; const m2 = monthOf(m[4])!;
    return { start: iso(y, m1, +m[3]), end: iso(m2 < m1 ? y + 1 : y, m2, +m[5]), label: m[0] };
  }
  m = text.match(/(20\d{2})年度?は?\s*(\d{1,2})\/(\d{1,2})\s*[~〜～\-]\s*(\d{1,2})\/(\d{1,2})/);
  if (m) {
    const y = Number(m[1]);
    const m1 = +m[2]; const m2 = +m[4];
    return { start: iso(y, m1, +m[3]), end: iso(m2 < m1 ? y + 1 : y, m2, +m[5]), label: m[0] };
  }
  return null;
}

export function parseXflyCamp(html: string): XflyCamp {
  const ls = lines(html);
  const t = ls.join('\n');
  const base = t.match(/(\d+)\s*days?\s*[¥￥]\s*([\d,]+)/i) ?? t.match(/(\d+)\s*days?\s*([\d,]+)\s*円/i);
  const extra = t.match(/[¥￥]\s*([\d,]+)\s*per day/i) ?? t.match(/1\s*day\s*につき\s*\+?\s*[¥￥]\s*([\d,]+)/i);
  const included: string[] = [];
  const i = ls.findIndex(l => /^【\s*Include\s*】/i.test(l));
  if (i >= 0) {
    for (const l of ls.slice(i + 1)) {
      if (/^【/.test(l)) break;
      if (/^[・\-–]/.test(l)) included.push(l.replace(/^[・\-–]\s*/, ''));
    }
  }
  return {
    days: base ? Number(base[1]) : null,
    price: base ? parseAmount(base[2]) : null,
    extraDay: extra ? parseAmount(extra[1]) : null,
    window: parseXflyWindow(t),
    included,
  };
}

export function buildXflySlots(c: XflyCamp, today: string): Slot[] {
  if (!c.window || c.window.end < today || !c.price) return [];
  const y = c.window.start.slice(0, 4);
  return [{
    key: `season-${y}`,
    startDate: c.window.start,
    endDate: c.window.end,
    unit: `${c.days ?? 3}-day camp school (guesthouse, lessons, gear, insurance)`,
    price: c.price,
    currency: 'JPY',
    priceUnit: 'package',
    priceBasis: 'person',
    occupancy: 1,
    availability: 'on_request',
    availabilityText: `JPY ${c.price.toLocaleString('en-US')} for ${c.days ?? 3} days${c.extraDay ? ` + JPY ${c.extraDay.toLocaleString('en-US')} per extra day` : ''}, any days inside the ${y} window (${c.window.start} to ${c.window.end}); booking by e-mail or phone, guesthouse subject to availability`,
    spotsLeft: null,
    datePrecision: 'season',
  }];
}

const INCLUDED_EN: Array<[RegExp, string]> = [
  [/guesthouse accommodation|ゲストハウスの宿泊/i, 'Guesthouse accommodation on Miyakojima (JPY 4,000 per day refunded if the guesthouse is full)'],
  [/school fee|スクール料金/i, 'Kiteboarding school (lessons)'],
  [/equipment rental|機材のレンタル/i, 'Equipment rental (kite, board, harness, helmet, life jacket)'],
  [/shower|シャワー/i, 'Guesthouse shower fee'],
  [/insurance|保険/i, 'Insurance'],
];

export function parseXflyContent(html: string, today: string): OfferContent {
  const c = parseXflyCamp(html);
  const ls = lines(html);
  const included = c.included
    .filter(l => !/^\(/.test(l))
    .map(l => INCLUDED_EN.find(([re]) => re.test(l))?.[1] ?? l);
  const fmt = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const open = c.window && c.window.end >= today;
  const windowText = c.window
    ? open
      ? `This season's camp window: ${fmt(c.window.start)} to ${fmt(c.window.end)}.`
      : `The window changes every year (${c.window.start.slice(0, 4)}/${c.window.end.slice(2, 4)}: ${fmt(c.window.start)} to ${fmt(c.window.end)}); the ${Number(c.window.start.slice(0, 4)) + 1}/${String(Number(c.window.end.slice(0, 4)) + 1).slice(2)} dates are not yet published.`
    : 'The camp runs in a winter window that changes every year; dates on request.';

  const summary = [
    `X-FLY, a kite school from Kanagawa, runs a winter kiteboarding camp school on Miyakojima in Okinawa, where the water stays warm in winter: guesthouse accommodation, kite lessons, equipment rental, shower fee and insurance in one package, aimed at learning in a few consecutive days.`,
    c.price ? `Price: JPY ${c.price.toLocaleString('en-US')} for ${c.days ?? 3} days${c.extraDay ? ` plus JPY ${c.extraDay.toLocaleString('en-US')} per extra day` : ''}, tax included; a rental car is needed and not included.` : 'Price on request; a rental car is needed and not included.',
    windowText,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'X-FLY Kiteboarding Camp School, Miyakojima',
    summary,
    continent: 'Asia',
    country: 'Japan',
    region: 'Miyako Islands, Okinawa',
    spot: 'Miyakojima',
    itinerarySpots: [],
    durationDays: c.days ?? 3,
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: included.length ? included : INCLUDED_EN.map(x => x[1]),
    optionalServices: c.extraDay ? [`Extra camp day (JPY ${c.extraDay.toLocaleString('en-US')})`] : [],
    accommodation: 'guesthouse on Miyakojima',
    mealPlan: null, // not stated on the page
    languages: ['ja', 'en'],
    rooms: [],
    imageUrls: imageCandidates(html, XFLY_CAMP_URL).filter(u => !/logo|cropped-/i.test(u)).slice(0, 20),
    heroVideoUrl: null,
    sourceUrl: XFLY_CAMP_URL,
    bookingUrl: XFLY_CONTACT_URL,
    sourceText: [
      ls.join('\n'),
      `parsed: ${c.days} days JPY ${c.price}, extra day JPY ${c.extraDay}; window ${c.window ? `${c.window.start}..${c.window.end}` : 'none'}`,
    ].join('\n'),
  };
}

export async function fetchXflySlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const c = parseXflyCamp(await page(XFLY_CAMP_URL));
  if (!c.price) throw new Error('x-fly-miyako: "3days ¥66,000" price line not found (layout changed?)');
  const slots = buildXflySlots(c, today);
  if (slots.length === 0) {
    ctx?.note(c.window
      ? `camp window ${c.window.start}..${c.window.end} is over; next window not published yet (price on request)`
      : 'no camp window printed (price on request)');
  }
  return slots;
}

export const xFlyKiteboardingCampMiyako: OfferAdapter = {
  key: 'x-fly-kiteboarding-camp-miyako',
  name: 'X-FLY Kiteboarding Camp School, Miyakojima',
  kind: 'camp',
  operator: {
    name: 'X-FLY',
    websiteUrl: `${SITE}/`,
    rootDomain: 'x-fly.jp',
    contactEmail: 'info@x-fly.jp',
    phone: '+81465791870',
  },
  url: XFLY_CAMP_URL,
  slotMethod: 'html_dates',
  instantBooking: false, // request only (e-mail / phone / message), no online checkout
  fetchBudget: 2,
  confidence: 'medium',
  async fetchContent() {
    return parseXflyContent(await page(XFLY_CAMP_URL), todayIso());
  },
  fetchSlots: ctx => fetchXflySlots(todayIso(), ctx),
};
