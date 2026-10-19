// ---------------------------------------------------------------------------
// True Surfers - Vietnam Kitesurf Tour (Mui Ne + Phan Rang): a 14-day group kite trip led by the Hungarian school's founder
// (Harmati Dániel): 7 nights in a beachfront hotel in Mui Ne, 7 nights in a beachfront resort near Phan Rang (daily shuttle
// to the lagoon spot), downwinders, 2 advanced coaching sessions, two excursions, the Cam Ranh - Ho Chi Minh City flight.
// True Surfers (true-surfers.com, kite school and shop in Hungary) runs the trip itself.
//
// Data path (checked 2026-10-19): one Shopify page per trip, /en/pages/vietnam-kitetrip-8-22-january-2027 (custom HTML).
//   slots    "Kitesurf Tour January 8-22, 2027" + the "Tour price" block: per person, "Shared accommodation / Double or twin
//            room / 1450 € / person / Until October 1 / After October 1: 1550 € / person" and "Single occupancy / Private
//            room / 2000 € / person / ... After October 1: 2100 € / person". The early price holds until October 1 of the year
//            before the tour (balance due "by December 1, 2026"); from 2026-10-02 the after-October-1 price applies.
//            Two slots (shared double/twin, private room), EUR per person (package), availability 'on_request': booking is
//            by email or WhatsApp ("Send us an email or WhatsApp message to reserve your place"); no place counts printed.
//   content  the same page (itinerary, included / not included, FAQ, photos on cdn.shopify.com, hero video file).
// robots.txt (2026-10-19): Shopify default, "Allow: /" for pages. (It also carries Shopify's generic text addressed to
//   shopping agents; nothing in it applies to reading a public page.)
// Requests per run: 1 (memoised; content and slots share it).
// Currency: the page prints "€" and the shop runs in EUR (country selector "EUR €"); the optional lessons are in USD.
// Other trip pages of the same operator: "Vietnam 8-15 January 2027" (one week, separate product, not this adapter) and
//   the past "Vietnam 1-14 February 2026" page; a future year will be a new page URL -> the run notes a newer
//   /pages/vietnam-kitetrip-* link in the menu so the adapter URL can be moved.
// Flags: liveAvailability no (page text), instantBooking no (email / WhatsApp request, EUR 600 first payment after reply).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, parseAmount, parseRange, todayIso } from '../parse.js';
import type { FetchContext, ItinerarySpot, OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';

export const TS_SITE = 'https://true-surfers.com';
export const TS_TOUR_URL = `${TS_SITE}/en/pages/vietnam-kitetrip-8-22-january-2027`;

export const TS_OPERATOR: OperatorRef = {
  name: 'True Surfers',
  websiteUrl: `${TS_SITE}/en`,
  rootDomain: 'true-surfers.com',
  contactEmail: 'daniel@true-surfers.com',
  whatsapp: '+36306833972',
  phone: '+36 30 683 3972',
};

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

export function tsLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script,style,noscript,svg')) el.remove();
  return (root.querySelector('body') ?? root).structuredText
    .split('\n').map(s => collapse(s.replace(/[​ ]/g, ' ')).replace(/[–—]/g, '-')).filter(Boolean);
}

export interface TsPrice { unit: string; occupancy: number; early: number | null; late: number | null; cutoff: string | null }
export interface TsTour { start: string | null; end: string | null; days: number | null; prices: TsPrice[] }

/** Tour dates ("Kitesurf Tour January 8-22, 2027") and the per-person prices of the "Tour price" block. */
export function parseTsTour(html: string): TsTour {
  const lines = tsLines(html);
  const head = lines.find(l => /^kitesurf tour\s+[a-z]+\s+\d/i.test(l)) ?? null;
  const range = head ? parseRange(head.replace(/^kitesurf tour\s+/i, '').replace(/,/g, '')) : null;
  const daysLine = lines.find(l => /^\d{1,2} days\b/i.test(l));
  const prices: TsPrice[] = [];
  const at = lines.findIndex(l => /^tour price$/i.test(l));
  if (at >= 0 && range) {
    const block = lines.slice(at, at + 40);
    const variants: Array<{ head: RegExp; unit: string; occupancy: number }> = [
      { head: /^shared accommodation$/i, unit: 'Shared double or twin room', occupancy: 2 },
      { head: /^single occupancy$/i, unit: 'Private room (single occupancy)', occupancy: 1 },
    ];
    for (const v of variants) {
      const i = block.findIndex(l => v.head.test(l));
      if (i < 0) continue;
      const seg = block.slice(i, i + 8);
      const earlyLine = seg.find(l => /^[\d.,]+\s*€\s*\/\s*person$/i.test(l));
      const lateLine = seg.find(l => /^after\s+[a-z]+\s+\d{1,2}\s*:\s*[\d.,]+\s*€/i.test(l));
      const cut = (lateLine ?? seg.find(l => /^until\s+[a-z]+\s+\d{1,2}$/i.test(l)) ?? '').match(/(?:after|until)\s+([a-z]+)\s+(\d{1,2})/i);
      let cutoff: string | null = null;
      if (cut) {
        // the year is not printed: the latest such day before the tour start
        const y0 = Number(range.start.slice(0, 4));
        for (const y of [y0, y0 - 1]) {
          const d = parseRange(`${cut[2]}-${cut[2]} ${cut[1]} ${y}`)?.start ?? null;
          if (d && d < range.start) { cutoff = d; break; }
        }
      }
      prices.push({
        unit: v.unit,
        occupancy: v.occupancy,
        early: earlyLine ? parseAmount(earlyLine) : null,
        late: lateLine ? parseAmount(lateLine.replace(/^[^:]+:/, '')) : null,
        cutoff,
      });
    }
  }
  return { start: range?.start ?? null, end: range?.end ?? null, days: daysLine ? Number(daysLine.match(/^(\d{1,2})/)![1]) : null, prices };
}

export function buildTsSlots(t: TsTour, today: string): Slot[] {
  if (!t.start || !t.end || t.start < today) return [];
  return t.prices.map(p => {
    const earlyValid = p.early !== null && p.cutoff !== null && today <= p.cutoff;
    const price = earlyValid ? p.early : (p.late ?? (p.cutoff === null ? p.early : null));
    return {
      key: `${t.start}|${p.occupancy === 1 ? 'private' : 'shared'}`,
      startDate: t.start,
      endDate: t.end,
      unit: p.unit,
      price,
      currency: price !== null ? 'EUR' : null,
      priceUnit: price !== null ? 'package' : null,
      priceBasis: price !== null ? 'person' : null,
      occupancy: p.occupancy,
      availability: 'on_request',
      availabilityText: earlyValid
        ? `Early booking EUR ${p.early} per person until ${p.cutoff}, then EUR ${p.late}; reserve by email or WhatsApp (EUR 600 first payment)`
        : `EUR ${price} per person${p.early ? ` (early booking price EUR ${p.early} ended ${p.cutoff})` : ''}; reserve by email or WhatsApp (EUR 600 first payment)`,
      spotsLeft: null,
      priceValidUntil: earlyValid ? p.cutoff : null,
    };
  });
}

/** Trip pages linked in the shop menu ("/pages/vietnam-kitetrip-..."), for spotting next year's page. */
export function tsTripPages(html: string): string[] {
  return [...new Set([...html.matchAll(/\/pages\/(vietnam-kitetrip-[a-z0-9-]+)/g)].map(m => m[1]))];
}

export const TS_STOPS: ItinerarySpot[] = [
  { name: 'Mui Ne', country: 'Vietnam', region: 'Lam Dong (Binh Thuan)', order: 1 },
  { name: 'Phan Rang', country: 'Vietnam', region: 'Ninh Thuan', order: 2 },
];

function listAfter(lines: string[], head: RegExp, stop: RegExp): string[] {
  const i = lines.findIndex(l => head.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < lines.length && !stop.test(lines[j]); j++) out.push(lines[j]);
  return out;
}

export function parseTsContent(html: string, today: string): OfferContent {
  const lines = tsLines(html);
  const t = parseTsTour(html);
  const slots = buildTsSlots(t, today);
  // "✓ Included in the price" list ("✓" lines; the last item wraps onto the next line)
  const incAt = lines.findIndex(l => /^included in the tour$/i.test(l));
  const included: string[] = [];
  if (incAt >= 0) {
    for (let j = incAt + 1; j < lines.length && !/^not included$/i.test(lines[j]); j++) {
      const l = lines[j].replace(/^✓\s*/, '').trim();
      if (l) included.push(l);
    }
  }
  const excluded = listAfter(lines, /^paid separately$/i, /^vietnam kitesurf tour/i).map(l => l.replace(/^-\s*/, ''));
  const root = parse(html);
  // page photos (og:image is the shop logo; one photo is a .heic browsers cannot show)
  const imageUrls = imageCandidates(html, TS_TOUR_URL)
    .filter(u => /cdn\.shopify\.com\/s\/files\//.test(u) && !/\.heic(\?|$)/i.test(u) && !/logo/i.test(u));
  const hero = root.querySelector('#tsHeroVideo source')?.getAttribute('src') ?? null;
  const shared = slots.find(s => s.occupancy === 2);
  const priv = slots.find(s => s.occupancy === 1);
  const fmt = (n: number | null | undefined) => (n ? n.toLocaleString('en-US') : null);
  const days = t.days ?? 14;
  const day = (d: string) => `${Number(d.slice(8, 10))} ${new Date(`${d}T00:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })}`;
  const dateText = t.start && t.end ? `${day(t.start)} - ${day(t.end)} ${t.end.slice(0, 4)}` : null;

  const summary = [
    `True Surfers, a Hungarian kite school, runs a ${days}-day group kite trip in southern Vietnam: a week in Mui Ne (beachfront hotel, downwinders, waves and coaching) and a week at a beachfront resort near Phan Rang with a daily shuttle to the flat-water lagoon, where 20-30 knots are typical.`,
    `The tour leader guides the group on the water; 2 advanced coaching sessions, breakfast, land transfers, the Ta Cu Mountain and Vinh Hy Bay excursions and the Cam Ranh - Ho Chi Minh City flight are included, lessons and gear rental are extra and beginners are welcome.`,
    dateText
      ? `${dateText}${shared?.price ? `: EUR ${fmt(shared.price)} per person in a shared double or twin room` : ''}${priv?.price ? `, EUR ${fmt(priv.price)} in a private room` : ''}; international flights not included.`
      : 'Dates and prices are on the trip page.',
  ].join(' ');

  return {
    kind: 'tour',
    title: 'True Surfers Vietnam Kitesurf Tour: Mui Ne and Phan Rang',
    summary,
    continent: 'Asia',
    country: 'Vietnam',
    region: 'Lam Dong (Binh Thuan)',
    spot: 'Mui Ne',
    itinerarySpots: TS_STOPS,
    durationDays: days,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: included,
    optionalServices: [
      'Private or semi-private kitesurf lessons (USD, per hour package)',
      'Surf lessons and board rental in Mui Ne (USD)',
      'Kitesurf equipment rental at both spots',
      'Optional excursion to Dalat',
    ],
    accommodation: '7 nights in a beachfront hotel in Mui Ne and 7 nights in a beachfront resort near Phan Rang; shared double or twin room or private room',
    mealPlan: 'breakfast',
    languages: ['en', 'hu'],
    rooms: [],
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: hero,
    sourceUrl: TS_TOUR_URL,
    bookingUrl: 'mailto:daniel@true-surfers.com?subject=Vietnam%20Kitesurf%20Tour%202027',
    sourceText: [
      lines.slice(lines.findIndex(l => /^kitesurf tour\s/i.test(l)), lines.findIndex(l => /^international flights$/i.test(l))).join('\n'),
      `parsed: ${t.start}..${t.end}, ${days} days; ${t.prices.map(p => `${p.unit}: early ${p.early} until ${p.cutoff}, after ${p.late}`).join('; ')}`,
      `not included: ${excluded.join('; ')}`,
    ].join('\n'),
  };
}

export async function fetchTsSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const html = await page(TS_TOUR_URL);
  const t = parseTsTour(html);
  if (!t.start || t.prices.length === 0) throw new Error('true-surfers: "Kitesurf Tour <dates>" or the "Tour price" block not found (layout changed?)');
  const own = TS_TOUR_URL.split('/pages/')[1];
  const newer = tsTripPages(html).filter(p => p !== own && Number(p.match(/(20\d{2})$/)?.[1] ?? 0) > Number(own.match(/(20\d{2})$/)![1]));
  if (newer.length) ctx?.note(`newer trip page(s) in the menu: ${newer.join(', ')} (move the adapter URL)`);
  const slots = buildTsSlots(t, today);
  if (slots.length === 0) ctx?.note(`the ${t.start} tour has started or passed; no newer dates on this page`);
  return slots;
}

export const trueSurfersVietnamKiteTourMuiNePhanRang: OfferAdapter = {
  key: 'true-surfers-vietnam-kite-tour-mui-ne-phan-rang',
  name: 'True Surfers Vietnam Kitesurf Tour (Mui Ne + Phan Rang)',
  kind: 'tour',
  operator: TS_OPERATOR,
  url: TS_TOUR_URL,
  slotMethod: 'html_dates',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() {
    return parseTsContent(await page(TS_TOUR_URL), todayIso());
  },
  fetchSlots: ctx => fetchTsSlots(todayIso(), ctx),
};
