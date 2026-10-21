// ---------------------------------------------------------------------------
// Kite Republic (Melbourne kite shop + school) - Aitutaki Winter Escape 2027, Cook Islands: a 13-night kite and
// wingfoil holiday based at Ranganui's Retreat beachfront bungalows on Aitutaki, with daily clinics and coaching,
// boat transfers to Honeymoon Island on kite days, lunch on kite days, scooters and airport transfers.
// One base for the whole stay -> KIND = 'camp' (Kite Republic calls it a "tour").
//
// This file also holds the shared Kite Republic + WooCommerce helpers (the Brazil safari adapter, the Shark Bay
// and Road 2 Adventure adapters import them).
//
// Data path (checked 2026-10-19): WordPress + WooCommerce variable product, one page:
//   https://www.kiterepublic.com.au/product/kr-aitutaki-winter-escape-holiday/
//   slots    the product form's own variation data (`data-product_variations`, the JSON the shop's add-to-cart
//            form uses): per variation the attributes, `display_price`, `display_regular_price`, `is_in_stock`.
//            Aitutaki: attribute "Options" (pay in full early bird / deposit only) x "Tour Date"
//            ("July 16-29, 2027", "July 30 - August 12, 2027"). One slot per future tour date, priced with the
//            "Pay in Full - Early Bird" variation (the deposit-only variation is a payment step, not a price).
//            Currency: AUD from the Product JSON-LD `priceCurrency` (the page prints only "$", "inc GST").
//   content  the product description tab (inclusions, exclusions, accommodation, suitability) + gallery.
// The conflicting figures (2026-10-19) and how they resolve:
//   - "$1,000.00 - $5,200.00" price range / JSON-LD AggregateOffer 1000-5200 = deposit variation .. early-bird price
//   - "$5,500pp" in PACKAGE PRICES = the standard pay-in-full price; the dropdown lists a "Pay in Full" option but
//     the shop has no variation for it (only early bird + deposit exist), and Tour 2's early-bird variation shows
//     regular 5,500 / sale 5,200 ("Save $300 with Early Bird pricing").
//   -> slot price = AUD 5,200 per person (twin share, pay in full early bird); 5,500 = standard price in the text.
//   No early-bird deadline is printed (the page countdown runs to the tour start) -> priceValidUntil null.
// Availability: `is_in_stock` per tour date (Tour 2 is out of stock = "TOUR 2 - SOLD OUT 100%"); the page's sold
//   bars ("TOUR 1 30%") go into availabilityText. The shop sells online with checkout -> instantBooking; the
//   per-date stock is read on every run -> liveAvailability.
// robots.txt (2026-10-19): WooCommerce defaults + /wp-json/ disallowed (so no Store API); product pages allowed.
// Requests per run: 1 (the product page, memoised for content + slots).
// spotCoords: none - the page prints no coordinates (pin from the geocoder: "Aitutaki, Cook Islands" resolves to the
//   island in OSM, checked 2026-10-19).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, daysInclusive, imageCandidates, ldOfType, parse, parseRange, todayIso } from '../parse.js';
import type { Availability, OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';

export const KR_SITE = 'https://www.kiterepublic.com.au';
export const KR_AITUTAKI_URL = `${KR_SITE}/product/kr-aitutaki-winter-escape-holiday/`;

export const KR_OPERATOR: OperatorRef = {
  name: 'Kite Republic',
  websiteUrl: KR_SITE,
  rootDomain: 'kiterepublic.com.au',
  contactEmail: 'info@kiterepublic.com.au',
  phone: '+61395370644',
};

// --- shared fetch -------------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share it */
export function memoPage(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

// --- shared WooCommerce helpers -------------------------------------------------------------------
export interface WooVariation {
  id: number;
  /** attribute name (without "attribute_") -> option value (slug or label) */
  attributes: Record<string, string>;
  price: number | null;
  regularPrice: number | null;
  inStock: boolean;
  purchasable: boolean;
  /** the shop's own stock words ("Out of stock", "Bookings available") */
  stockText: string | null;
}

/** The variation JSON of a WooCommerce variable-product form (`data-product_variations`). */
export function parseWooVariations(html: string): WooVariation[] {
  const form = parse(html).querySelector('form.variations_form[data-product_variations], [data-product_variations]');
  const raw = form?.getAttribute('data-product_variations');
  if (!raw || raw === 'false') return [];
  let list: unknown;
  try { list = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(list)) return [];
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  return list.map((v: Record<string, unknown>) => {
    const attrs: Record<string, string> = {};
    for (const [k, val] of Object.entries((v.attributes ?? {}) as Record<string, unknown>)) {
      attrs[k.replace(/^attribute_/, '')] = String(val ?? '');
    }
    const stock = clean(String(v.availability_html ?? '').replace(/<(input|div|script|style)[\s\S]*$/i, ''));
    return {
      id: Number(v.variation_id),
      attributes: attrs,
      price: num(v.display_price),
      regularPrice: num(v.display_regular_price),
      inStock: v.is_in_stock === true,
      purchasable: v.is_purchasable !== false,
      stockText: stock || null,
    };
  });
}

/** Option value -> visible label of a variation dropdown (`<select name="attribute_<name>">`). */
export function wooOptionLabels(html: string, attribute: string): Map<string, string> {
  const out = new Map<string, string>();
  const sel = parse(html).querySelector(`select[name="attribute_${attribute}"]`);
  for (const o of sel?.querySelectorAll('option') ?? []) {
    const v = o.getAttribute('value');
    if (v) out.set(v, clean(o.text));
  }
  return out;
}

/** The shop currency: Product JSON-LD offers `priceCurrency` (WooCommerce prints only the symbol). */
export function wooCurrency(html: string): string | null {
  for (const p of ldOfType(html, 'Product')) {
    const offers = Array.isArray(p.offers) ? p.offers : p.offers ? [p.offers] : [];
    for (const o of offers as Array<Record<string, unknown>>) {
      if (typeof o.priceCurrency === 'string') return o.priceCurrency;
      for (const s of (Array.isArray(o.priceSpecification) ? o.priceSpecification : []) as Array<Record<string, unknown>>) {
        if (typeof s.priceCurrency === 'string') return s.priceCurrency;
      }
    }
  }
  return null;
}

/** Visible text lines of a WordPress page (scripts, styles, header, footer, nav, related products dropped). */
export function wpLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script,style,noscript,svg,header,footer,nav,section.related,section.up-sells')) el.remove();
  return (root.querySelector('body') ?? root).structuredText
    .split('\n').map(s => collapse(s.replace(/\u200b/g, ''))).filter(Boolean);
}

/** "July 16-29, 2027" / "22nd August to 4th September 2027" -> ISO range. */
export function krRange(label: string): { start: string; end: string } | null {
  const t = label.replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/\s+to\s+/i, ' - ').replace(/,/g, ' ');
  return parseRange(t);
}

/**
 * Product photos via imageCandidates (gallery + description images, CDN originals) after dropping header, footer,
 * nav and the related-products block; logos / icons and the `.jpg.webp` / `-WxH` / `-scaled` twins are removed.
 */
export function wpImages(html: string, baseUrl: string, skip: RegExp | null = null): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('header,footer,nav,section.related,section.up-sells')) el.remove();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of imageCandidates(root.toString(), baseUrl, null, 80)) {
    if (!/\/wp-content\/uploads\//.test(u) || !/\.(jpe?g|png|webp)(\?|$)/i.test(u)) continue;
    if (/logo|icon|favicon|placeholder|payment|badge/i.test(u) || (skip && skip.test(u))) continue;
    const orig = u.replace(/\?.*$/, '').replace(/(\.(?:jpe?g|png))\.webp$/i, '$1').replace(/-\d{2,4}x\d{2,4}(\.[a-z]+)$/i, '$1');
    const stem = orig.replace(/-scaled(\.[a-z]+)$/i, '$1').toLowerCase();
    if (seen.has(stem)) continue;
    seen.add(stem);
    out.push(orig);
  }
  return out;
}

// --- shared Kite Republic tour parser -------------------------------------------------------------
export interface KrTour {
  name: string;
  currency: string | null;
  variations: WooVariation[];
  /** tour dates: from the "Tour Date" dropdown, else the page's "TOUR DATES:" line */
  dates: Array<{ start: string; end: string; label: string; index: number }>;
  /** sold share of each tour from the page's progress bars ("TOUR 1 30%", "SOLD 40%"), by tour number (1-based) */
  soldPct: Map<number, number>;
  lines: string[];
}

export function parseKrTour(html: string): KrTour {
  const lines = wpLines(html);
  const product = ldOfType(html, 'Product')[0];
  const name = clean(String(product?.name ?? parse(html).querySelector('h1')?.text ?? ''));
  const variations = parseWooVariations(html);
  const dates: KrTour['dates'] = [];
  const dateLabels = wooOptionLabels(html, 'tour-date');
  if (dateLabels.size) {
    let i = 0;
    for (const [value, label] of dateLabels) {
      const r = krRange(label) ?? krRange(value);
      i++;
      if (r) dates.push({ ...r, label, index: i });
    }
  } else {
    const line = lines.find(l => /^TOUR DATES?:\s*\S/i.test(l)) ?? lines.find(l => /^\d{1,2}(st|nd|rd|th)?\s+[A-Za-z]+\s+to\s+\d{1,2}/.test(l));
    const r = line ? krRange(line.replace(/^TOUR DATES?:\s*/i, '').split('|')[0]) : null;
    if (r && line) dates.push({ ...r, label: line.replace(/^TOUR DATES?:\s*/i, ''), index: 1 });
  }
  const soldPct = new Map<number, number>();
  for (const l of lines) {
    let m = l.match(/^TOUR\s*(\d)\b[^%]*?(\d{1,3})%$/i);
    if (m) { soldPct.set(Number(m[1]), Number(m[2])); continue; }
    m = l.match(/^SOLD(?:\s+OUT)?\s*(\d{1,3})%$/i);
    if (m && !soldPct.has(1)) soldPct.set(1, Number(m[1]));
  }
  return { name, currency: wooCurrency(html), variations, dates, soldPct, lines };
}

/**
 * One slot per future tour date x room option. `unitOf(optionValue)` names the room for an option and returns
 * null for payment-only options (deposit); several payment options of the same room keep the cheapest
 * pay-in-full price.
 */
export function buildKrSlots(t: KrTour, today: string, unitOf: (option: string) => string | null): Slot[] {
  const out = new Map<string, Slot>();
  for (const d of t.dates) {
    if (d.start < today) continue;
    for (const v of t.variations) {
      const dateAttr = v.attributes['tour-date'];
      if (dateAttr !== undefined && dateAttr !== '' && (krRange(dateAttr)?.start ?? null) !== d.start) continue;
      const option = v.attributes['pa_options'] ?? '';
      const unit = unitOf(option);
      if (!unit || v.price === null) continue;
      const key = `${d.start}|${unit.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
      const sold = t.soldPct.get(d.index);
      const availability: Availability = !v.inStock || !v.purchasable ? 'sold_out' : sold !== undefined && sold >= 90 ? 'limited' : 'available';
      const words = [
        v.inStock ? 'In stock in the Kite Republic shop' : (v.stockText ?? 'Out of stock'),
        sold !== undefined ? `page bar: ${sold}% sold` : null,
        v.regularPrice && v.regularPrice > v.price ? `early bird (regular ${t.currency ?? ''} ${v.regularPrice.toLocaleString('en-US')})`.replace('  ', ' ') : null,
      ].filter(Boolean).join('; ');
      const slot: Slot = {
        key,
        startDate: d.start,
        endDate: d.end,
        unit,
        price: v.price,
        currency: t.currency,
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: /private|single/i.test(unit) ? 1 : 2,
        availability,
        availabilityText: words,
        spotsLeft: null,
      };
      const prev = out.get(key);
      if (!prev || (prev.price ?? Infinity) > v.price) out.set(key, slot);
    }
  }
  return [...out.values()];
}

// --- Aitutaki ----------------------------------------------------------------------------------------
const aitUnit = (option: string): string | null => (/deposit/i.test(option) ? null : 'Twin-share beachfront bungalow');

export function parseKrAitutakiSlots(html: string, today = todayIso()): Slot[] {
  return buildKrSlots(parseKrTour(html), today, aitUnit);
}

const after = (lines: string[], head: RegExp, stop: RegExp): string[] => {
  const i = lines.findIndex(l => head.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) { if (stop.test(l)) break; out.push(l); }
  return out;
};
/** drop leading emoji / pictographs from a list line */
export const unEmoji = (s: string): string =>
  collapse(s.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\uFE0F\u200d]/gu, '')).replace(/\s*[\u2013\u2014]\s*/g, ' - ');

export function parseKrAitutakiContent(html: string): OfferContent {
  const t = parseKrTour(html);
  if (!t.dates.length) throw new Error('kite-republic-aitutaki: no "Tour Date" options (layout changed?)');
  const first = t.dates[0];
  const year = first.start.slice(0, 4);
  const text = t.lines.join('\n');
  const standard = text.match(/\$\s?([\d,]+)\s?pp\s*[\u2013\u2014-]/)?.[1]?.replace(/,/g, '') ?? null;
  const deposit = text.match(/Only \$\s?([\d,]+)\s?pp deposit/i)?.[1]?.replace(/,/g, '') ?? null;
  const early = t.variations.filter(v => /early/i.test(v.attributes['pa_options'] ?? '') && v.price).map(v => v.price!);
  const cheapest = early.length ? Math.min(...early) : null;
  // the list mixes services with sales lines ("Warm water, sunshine & tropical island vibes"): keep the services
  const included = after(t.lines, /^WHAT.S INCLUDED/i, /^WHAT.S NOT INCLUDED/i).map(unEmoji)
    .filter(l => l && !/vibes|playground|destination|magic|exceptional conditions|guaranteed progression|in .* paradise/i.test(l));
  const excluded = after(t.lines, /^WHAT.S NOT INCLUDED/i, /^PACKAGE PRICES/i).map(unEmoji).filter(Boolean);
  const nights = daysInclusive(first.start, first.end) - 1;
  const groupMax = text.match(/maximum of (\d+) people/i)?.[1] ?? null;
  const cur = t.currency ?? 'AUD';
  const fmt = (n: number | string | null): string => (n === null ? '?' : Number(n).toLocaleString('en-US'));
  const dateList = t.dates.map(d => `${d.start} to ${d.end}`).join(' and ');

  const summary = [
    `Kite Republic's Aitutaki Winter Escape is a ${nights}-night kiteboarding and wingfoiling holiday on Aitutaki in the Cook Islands, based at Ranganui's Retreat beachfront bungalows on the lagoon${groupMax ? `, for a group of at most ${groupMax}` : ''}.`,
    'Daily kite and wing clinics and on-water coaching by the Kite Republic team, boat transfers to Honeymoon Island on kite days, lunch on kite days, twin-share scooters, airport transfers and one whale swim are included; breakfast and dinner are self-catered.',
    `The ${year} dates are ${dateList}; riders of all levels and non-riding partners are welcome.`,
    `The early-bird pay-in-full price is ${cur} ${fmt(cheapest)} per person in a twin share (standard ${cur} ${fmt(standard)}), with a ${cur} ${fmt(deposit)} deposit; flights are extra.`,
  ].join(' ');

  return {
    kind: 'camp',
    title: `Kite Republic Aitutaki Winter Escape ${year}`,
    summary,
    continent: 'Oceania',
    country: 'Cook Islands',
    region: 'Aitutaki',
    spot: 'Aitutaki',
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: null,
    beginnerFriendly: true,
    includedServices: included.length ? included : ['Coaching and clinics', 'Twin-share beachfront bungalow', 'Boat transfers on kite days', 'Lunch on kite days'],
    optionalServices: [
      'Private room or private scooter upgrade',
      'Private beginner lessons through the local school (extra cost)',
      'Non-sailor rates on request',
    ],
    accommodation: "beachfront bungalows at Ranganui's Retreat (twin share or double, a few private singles)",
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms: [],
    // other tours' product images also appear in the shop's sticky bar outside section.related
    imageUrls: wpImages(html, KR_AITUTAKI_URL, /Brazil|Mauritius/i).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KR_AITUTAKI_URL,
    bookingUrl: KR_AITUTAKI_URL,
    sourceText: [
      text,
      `parsed: dates ${t.dates.map(d => `${d.start}..${d.end}`).join(', ')}; variations ${t.variations.map(v => `${Object.values(v.attributes).join('/')}=${v.price}${v.inStock ? '' : ' (out of stock)'}`).join(', ')}; currency ${t.currency}; excluded ${excluded.join(' | ')}`,
    ].join('\n'),
  };
}

export async function fetchKrAitutakiSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const html = await memoPage(KR_AITUTAKI_URL);
  const t = parseKrTour(html);
  if (!t.variations.length) throw new Error('kite-republic-aitutaki: no variation data on the product page (layout changed?)');
  if (!t.dates.length) throw new Error('kite-republic-aitutaki: no tour dates in the variation form (layout changed?)');
  if (!t.currency) ctx?.note('no priceCurrency in the Product JSON-LD');
  const slots = buildKrSlots(t, today, aitUnit);
  if (!slots.length) ctx?.note(`all tour dates are past (${t.dates.map(d => d.start).join(', ')}); no new dates in the shop yet`);
  return slots;
}

export const kiteRepublicAitutakiWinterEscape: OfferAdapter = {
  key: 'kite-republic-aitutaki-winter-escape',
  name: 'Kite Republic Aitutaki Winter Escape',
  kind: 'camp',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: KR_OPERATOR,
  url: KR_AITUTAKI_URL,
  slotMethod: 'booking_engine',
  liveAvailability: true,          // per-date WooCommerce stock of the shop's own product, read every run
  instantBooking: true,            // add to cart + checkout (PayPal / card) on the shop
  fetchBudget: 2,
  async fetchContent() {
    return parseKrAitutakiContent(await memoPage(KR_AITUTAKI_URL));
  },
  fetchSlots: ctx => fetchKrAitutakiSlots(todayIso(), ctx),
};
