// ---------------------------------------------------------------------------
// Kite Republic (Melbourne kite shop + school) - "2027 KR Mauritius Waves Dream - Winter Escape": a 13-night kite and
// wingfoil wave holiday in Mauritius, 1-14 August 2027, at a beachfront 4-star all-inclusive resort (meals, snacks,
// drinks incl. alcohol), with airport transfers, boat support in the waves, lagoon sessions, a photoshoot, a Le Morne
// hike and a Port Louis visit. One base for the whole stay -> KIND = 'camp' (Kite Republic calls it a "tour").
//
// Data path (checked 2026-10-21): WordPress + WooCommerce variable product, one page; helpers imported from
// kite-republic-aitutaki-winter-escape.ts (parseKrTour, buildKrSlots, wpImages, memoPage, KR_OPERATOR):
//   slots    the product form's variation data (`data-product_variations`): attribute "Options" with three variations
//            "1 Person - Private Room" AUD 6,950, "2 People Twin Share Room" AUD 9,900 and "Deposit Only" AUD 1,000.
//            The deposit is a payment step, not a price -> skipped. The twin-share variation is the price for TWO
//            people: the description prints "Cost $4950 per person Twin Shared room" = 9,900 / 2, so the slot carries
//            4,950 per person (priceTotal 9,900, occupancy 2); the private room is 6,950 for one person.
//            The shop has no "Tour Date" dropdown for this product, so the date comes from the page's "TOUR DATES"
//            block ("August 1st - August 14th, 2027 (13 NIGHTS)"); a future dropdown is read first (parseKrTour).
//            Availability: `is_in_stock` per variation + the page's sold bar ("SOLD 10%"; >= 90% -> 'limited').
//            Currency AUD from the Product JSON-LD (the page prints "$ ... inc GST").
//   content  the description tab (included, optional extras, conditions) + the gallery.
// Flags (same shop and model as the Aitutaki adapter): instantBooking yes (add to cart + checkout, PayPal / card);
//   liveAvailability yes (the shop's own stock status per variation is read on every run).
// Location: the page names no resort and no town. It mentions the kite wave "One Eye", a "Hike to Le Morne Mountain"
//   and "the main kiting spot right in front of the resort" -> spot 'Le Morne' and region 'Le Morne, Black River'
//   (as mauritius-surf-holidays-kite-camp-la-gaulette.ts) are INFERRED; the resort may sit elsewhere on that coast.
// robots.txt (2026-10-21): WooCommerce defaults + /wp-json/ disallowed; product pages allowed.
// Requests per run: 1 (the product page, memoised for content + slots).
// ---------------------------------------------------------------------------
import {
  KR_OPERATOR, buildKrSlots, krRange, memoPage, parseKrTour, unEmoji, wpImages, type KrTour,
} from './kite-republic-aitutaki-winter-escape.js';
import { daysInclusive, todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

export const KR_MAURITIUS_URL = 'https://www.kiterepublic.com.au/product/kr-mauritius-waves-dream-winter-escape/';

const DATE_LINE = /^[A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?\s*[-\u2013\u2014]\s*(?:[A-Z][a-z]+\s+)?\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2}/;

/** The tour: shop dropdown dates when present, else every date line of the page's "TOUR DATES" blocks. */
export function parseKrMauritius(html: string): KrTour {
  const t = parseKrTour(html);
  if (t.dates.length) return t;
  const dates: KrTour['dates'] = [];
  t.lines.forEach((l, i) => {
    if (!/^TOUR DATES?:?$/i.test(t.lines[i - 1] ?? '') || !DATE_LINE.test(l)) return;
    const r = krRange(l.replace(/\(.*?\)/g, ''));
    if (r && !dates.some(d => d.start === r.start)) dates.push({ ...r, label: l, index: dates.length + 1 });
  });
  return { ...t, dates };
}

/** option slug -> room unit; null for the deposit-only payment option */
export const mauritiusUnit = (option: string): string | null =>
  /deposit/i.test(option) ? null
    : /twin|2-people/i.test(option) ? 'Twin share room (2 people)'
      : /private|1-person/i.test(option) ? 'Private room (1 person)'
        : null;

/** One slot per future tour date x room; the twin-share variation (price for two) is normalised to per person. */
export function buildKrMauritiusSlots(t: KrTour, today: string): Slot[] {
  return buildKrSlots(t, today, mauritiusUnit).map(s => {
    const persons = Number(s.unit?.match(/\((\d+) people\)/)?.[1] ?? 1);
    if (persons <= 1 || s.price === null) return { ...s, occupancy: 1 };
    return {
      ...s,
      price: Math.round((s.price / persons) * 100) / 100,
      priceTotal: s.price,
      occupancy: persons,
      availabilityText: `${s.availabilityText}; shop price ${t.currency ?? ''} ${s.price.toLocaleString('en-US')} for ${persons} people`.replace('  ', ' '),
    };
  });
}

export function parseKrMauritiusSlots(html: string, today = todayIso()): Slot[] {
  return buildKrMauritiusSlots(parseKrMauritius(html), today);
}

const after = (lines: string[], head: RegExp, stop: RegExp): string[] => {
  const i = lines.findIndex(l => head.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) { if (stop.test(l)) break; out.push(l); }
  return out;
};

export function parseKrMauritiusContent(html: string, today = todayIso()): OfferContent {
  const t = parseKrMauritius(html);
  if (!t.dates.length) throw new Error('kite-republic-mauritius: no tour dates on the page (layout changed?)');
  const first = t.dates[0];
  const year = first.start.slice(0, 4);
  const nights = daysInclusive(first.start, first.end) - 1;
  const text = t.lines.join('\n');
  const cur = t.currency ?? 'AUD';
  const fmt = (n: number) => n.toLocaleString('en-US');
  const slots = buildKrMauritiusSlots(t, '0000-00-00');
  const twin = slots.find(s => (s.occupancy ?? 1) > 1)?.price ?? null;
  const priv = slots.find(s => s.occupancy === 1)?.price ?? null;
  const deposit = t.variations.find(v => /deposit/i.test(v.attributes['pa_options'] ?? ''))?.price ?? null;
  const wind = text.match(/WIND CONDITIONS\n([^\n]+)/i)?.[1] ?? null;
  const waveM = text.match(/Wave CONDITIONS\n[^\n]*?(\d+)\s*(?:foot|feet|ft)\s*to\s*(\d+)\s*(?:foot|feet|ft)/i);
  const waves = waveM ? `${waveM[1]}-${waveM[2]} ft` : null;
  const flights = text.match(/Flights \(not included\):\s*([^\n]+)/i)?.[1] ?? null;
  const included = after(t.lines, /^WHAT.S INCLUDED$/i, /^OPTIONAL EXTRAS$/i).map(unEmoji).filter(Boolean);
  const optional = after(t.lines, /^OPTIONAL EXTRAS$/i, /^Secure Your Spot/i).map(unEmoji).filter(Boolean);
  const past = first.end < today;
  const dateList = t.dates.map(d => `${d.start} to ${d.end}`).join(' and ');

  const summary = [
    `Kite Republic's Mauritius Waves Dream is a ${nights}-night kitesurf and wingfoil wave holiday in Mauritius at a beachfront 4-star all-inclusive resort (not named), with the main kite spot in front of the resort and the One Eye wave near Le Morne.`,
    'Meals, snacks and drinks including alcohol, two local dinners, airport transfers, boat support in the waves, flat-water lagoon sessions, a photoshoot, a hike up Le Morne and a visit to Port Louis are included; flights are extra.',
    `${past ? `The last dates were ${dateList}; new dates are not published yet` : `The ${year} dates are ${dateList}`}${wind ? `; wind ${wind.replace(/\s*[\u2013\u2014-]\s*/g, '-')}` : ''}${waves ? `, waves ${waves}` : ''}.`,
    `The price is ${cur} ${twin ? fmt(twin) : '?'} per person in a twin share${priv ? ` or ${cur} ${fmt(priv)} in a private room` : ''}${deposit ? `; a deposit of ${cur} ${fmt(deposit)} secures a place` : ''}.`,
  ].join(' ').replace(/\s\./g, '.');

  return {
    kind: 'camp',
    title: `Kite Republic Mauritius Waves Dream Winter Escape ${year}`,
    summary,
    continent: 'Africa',
    country: 'Mauritius',
    region: 'Le Morne, Black River',
    spot: 'Le Morne',
    itinerarySpots: [],
    durationDays: nights + 1,
    // "perfect for kiteboarders of all levels, from beginners to advanced riders"; no beginner course is included
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: null,
    equipmentRental: false,
    beginnerFriendly: null,
    includedServices: included,
    optionalServices: optional,
    accommodation: 'Beachfront 4-star all-inclusive resort (twin share, private room on request)',
    mealPlan: 'all_inclusive',
    languages: ['en'],
    rooms: [],
    // the shop's sticky bar shows the other tours' product photos; the 2025 reel cover is a video thumbnail
    imageUrls: wpImages(html, KR_MAURITIUS_URL, /Brazil|Aitutaki|reel/i).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KR_MAURITIUS_URL,
    bookingUrl: KR_MAURITIUS_URL,
    sourceText: [
      text,
      `parsed: dates ${t.dates.map(d => `${d.start}..${d.end}`).join(', ')}; variations ${t.variations.map(v => `${Object.values(v.attributes).join('/')}=${v.price}${v.inStock ? '' : ' (out of stock)'}`).join(', ')}; currency ${t.currency}; sold ${[...t.soldPct].map(([k, v]) => `tour ${k} ${v}%`).join(', ')}; flights ${flights ?? '-'}`,
    ].join('\n'),
  };
}

export async function fetchKrMauritiusSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const t = parseKrMauritius(await memoPage(KR_MAURITIUS_URL));
  if (!t.variations.length) throw new Error('kite-republic-mauritius: no variation data on the product page (layout changed?)');
  if (!t.dates.length) throw new Error('kite-republic-mauritius: no tour dates on the page (layout changed?)');
  if (!t.currency) ctx?.note('no priceCurrency in the Product JSON-LD');
  const printed = t.lines.join('\n').match(/Cost \$\s?([\d,]+) per person Twin/i)?.[1]?.replace(/,/g, '');
  const slots = buildKrMauritiusSlots(t, today);
  const twin = slots.find(s => (s.occupancy ?? 1) > 1);
  if (printed && twin && Number(printed) !== twin.price) ctx?.note(`page prints ${printed} per person twin share, shop variation gives ${twin.price}`);
  if (!slots.length) ctx?.note(`no future tour date (${t.dates.map(d => d.start).join(', ')}); next dates not in the shop yet`);
  return slots;
}

export const kiteRepublicMauritiusWavesDreamWinterEscape: OfferAdapter = {
  key: 'kite-republic-mauritius-waves-dream-winter-escape',
  name: 'Kite Republic Mauritius Waves Dream Winter Escape',
  kind: 'camp',
  operator: KR_OPERATOR,
  url: KR_MAURITIUS_URL,
  slotMethod: 'booking_engine',
  liveAvailability: true,          // per-variation WooCommerce stock of the shop's own product, read every run
  instantBooking: true,            // add to cart + checkout (PayPal / card) on the shop
  fetchBudget: 2,
  async fetchContent() {
    return parseKrMauritiusContent(await memoPage(KR_MAURITIUS_URL));
  },
  fetchSlots: ctx => fetchKrMauritiusSlots(todayIso(), ctx),
};
