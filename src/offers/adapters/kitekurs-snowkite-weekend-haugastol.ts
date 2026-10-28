// ---------------------------------------------------------------------------
// Kitekurs.no "Helgekurs Haugastøl" - weekend SNOWKITE course for beginners (kiting on snow with skis or a
// snowboard, not on water) on the Hardangervidda plateau, meeting at Haugastøl Turistsenter (Rv7); Saturday and
// Sunday 09:15-16:00, kite gear (Cabrinha / Ozone, 4-15 m²) and harness included, "wind guarantee" (a free place on
// another weekend when the wind fails). The school has taught at Haugastøl for over 20 years. Stay and meals are
// booked separately with Haugastøl Turistsenter (listed as its own accommodation).
//
// Data path (checked 2026-10-28): WordPress + WooCommerce, server-rendered; ONE page /produkt/kitekurs-haugstol/.
//   slots    the add-to-cart form's variation data (`data-product_variations`, shared helper parseWooVariations):
//            one variation per course weekend, attribute pa_velg-kurs = "<day>-<month>" slug of the Saturday
//            ("9-jan", "6-mars", "10-april"), display_price 4400, stock text "12 på lager" (spots left).
//            The "Velg kurs" attribute list also names weekends without a variation; the page says "Kurshelger som
//            ikke vises er dessverre fullbooket" -> those are sold_out slots.
//            The year is not printed: each weekend gets the first year (this or next) in which that day is a
//            Saturday that has not passed (2026-10-28: Jan-Apr 2027; the gear text says "2026/2027 modeller").
//            NOK (Product JSON-LD priceCurrency) per person per weekend, priceUnit 'package'.
//   content  the same page (course program, gear, wind guarantee, age limit, stay note) + its product photos.
// Booking: WooCommerce cart + checkout (Vipps / card) -> instantBooking; stock per weekend = live shop inventory
//   -> liveAvailability, slotMethod 'booking_engine'.
// Contact: phone +47 452 92 084 and a contact form; no e-mail address on the site (2026-10-28), so KCS cannot offer
//   an inquiry for this listing (flagged to Aaron).
// Liveness (2026-10-28): Product JSON-LD dateModified 2026-10-27; 14 bookable weekends Jan-Apr 2027.
// robots.txt (2026-10-28): WooCommerce defaults (logs, transient files, add-to-cart query) disallowed; pages allowed.
// Requests per run: 1 (content + slots share one memoised fetch).
// Known limits: the refresh course ("Refresh kitekurs", NOK 3,270) and private lessons are separate products, only
//   mentioned in the text.
// ---------------------------------------------------------------------------
import { ldOfType, todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';
import { memoPage, parseWooVariations, wooCurrency, wpImages, wpLines } from './kite-republic-aitutaki-winter-escape.js';

const SITE = 'https://kitekurs.no';
export const KK_URL = `${SITE}/produkt/kitekurs-haugstol/`;

const NO_MONTHS: Record<string, number> = {
  jan: 1, januar: 1, feb: 2, februar: 2, mars: 3, mar: 3, april: 4, apr: 4, mai: 5, juni: 6, jun: 6, juli: 7, jul: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, nov: 11, november: 11, des: 12, desember: 12,
};
const iso = (y: number, m: number, d: number): string => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** "9-jan" / "30.-31.-jan" / "10.-11.april" -> day + month of the Saturday */
export function kkDayMonth(label: string): { day: number; month: number } | null {
  const m = label.toLowerCase().match(/^(\d{1,2})[.\s-]*(?:\d{1,2}[.\s-]*)?([a-zæøå]+)/);
  const month = m ? NO_MONTHS[m[2]] : undefined;
  return m && month ? { day: Number(m[1]), month } : null;
}

/** first year (this or next) in which day/month is a Saturday on or after today */
export function kkSaturday(day: number, month: number, today: string): string | null {
  const y0 = Number(today.slice(0, 4));
  for (const y of [y0, y0 + 1]) {
    const d = iso(y, month, day);
    if (d >= today && new Date(`${d}T00:00:00Z`).getUTCDay() === 6) return d;
  }
  return null;
}

/** the weekend names of the "Velg kurs" attribute row ("10.-11.april, 13.-14.feb, ...") */
export function kkWeekendLabels(lines: string[]): string[] {
  const i = lines.lastIndexOf('Velg kurs');
  const row = i >= 0 ? lines[i + 1] ?? '' : '';
  return row.split(/,\s*/).map(s => s.trim()).filter(s => kkDayMonth(s));
}

export function buildKkSlots(html: string, today: string): Slot[] {
  const currency = wooCurrency(html) ?? 'NOK';
  const byStart = new Map<string, Slot>();
  for (const v of parseWooVariations(html)) {
    const dm = kkDayMonth(Object.values(v.attributes)[0] ?? '');
    const start = dm ? kkSaturday(dm.day, dm.month, today) : null;
    if (!start || v.price === null) continue;
    const left = Number(v.stockText?.match(/(\d+)\s*på lager/i)?.[1] ?? NaN);
    const spotsLeft = Number.isFinite(left) ? left : null;
    byStart.set(start, {
      key: start, startDate: start, endDate: addDays(start, 1), unit: 'Weekend course (Saturday and Sunday)',
      price: v.price, currency, priceUnit: 'package', priceBasis: 'person', occupancy: 1,
      availability: !v.inStock ? 'sold_out' : spotsLeft !== null && spotsLeft <= 3 ? 'limited' : 'available',
      availabilityText: v.stockText, spotsLeft: v.inStock ? spotsLeft : 0,
    });
  }
  const price = [...byStart.values()][0]?.price ?? null;
  for (const label of kkWeekendLabels(wpLines(html))) {
    const dm = kkDayMonth(label)!;
    const start = kkSaturday(dm.day, dm.month, today);
    if (!start || byStart.has(start)) continue;
    byStart.set(start, {
      key: start, startDate: start, endDate: addDays(start, 1), unit: 'Weekend course (Saturday and Sunday)',
      price, currency: price !== null ? currency : null, priceUnit: price !== null ? 'package' : null, priceBasis: price !== null ? 'person' : null,
      occupancy: 1, availability: 'sold_out', availabilityText: 'Kurshelger som ikke vises er dessverre fullbooket', spotsLeft: 0,
    });
  }
  return [...byStart.values()].sort((a, b) => a.startDate!.localeCompare(b.startDate!));
}

export function parseKkContent(html: string, today = todayIso()): OfferContent {
  const text = wpLines(html).join('\n');
  if (!/HELGEKURS HAUGASTØL/i.test(text)) throw new Error('kitekurs: course heading missing (page changed?)');
  const slots = buildKkSlots(html, today);
  const open = slots.filter(s => s.availability !== 'sold_out');
  const price = slots.find(s => s.price !== null)?.price ?? null;
  const fmt = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const years = /over 20 års erfaring/i.test(text) ? 'for over 20 years' : 'for many years';
  const refresh = /REFRESH KITEKURS[\s\S]{0,60}?([\d,.]+)\s*kr/i.exec(text)?.[1]?.replace(/[,.]/g, '');

  const summary = [
    `Kitekurs.no has taught snowkiting at Haugastøl on the edge of the Hardangervidda plateau in Norway ${years}; its weekend course takes beginners from flying the kite on Saturday to riding on skis or a snowboard by Sunday, wherever the wind is best along the Rv7.`,
    `Both days run from 09:15 to about 16:00 from Haugastøl Turistsenter; kites (Cabrinha and Ozone, 4 to 15 m²) and harness are included, and if the wind fails you get a free place on another weekend.`,
    open.length
      ? `${open.length} weekends from ${fmt(open[0].startDate!)} to ${fmt(open[open.length - 1].startDate!)} are bookable online${price ? ` at NOK ${price.toLocaleString('en-US')} per person` : ''}; stay and meals are booked separately with Haugastøl Turistsenter.`
      : 'The next course weekends are not published yet; stay and meals are booked separately with Haugastøl Turistsenter.',
  ].join(' ');

  const product = ldOfType(html, 'Product')[0];
  return {
    kind: 'course',
    title: 'Kitekurs.no Snowkite Weekend Course, Haugastøl',
    summary,
    continent: 'Europe',
    country: 'Norway',
    region: 'Hardangervidda',
    spot: 'Haugastøl, Hardangervidda',
    spotCoords: { lat: 60.5124, lng: 7.8531 }, // meeting point Haugastøl Turistsenter (OSM way 434843122)
    itinerarySpots: [],
    durationDays: 2,
    skillLevels: ['beginner'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      'Two days of snowkite instruction (Saturday and Sunday, 09:15-16:00)',
      'Kite, bar, lines and harness (Cabrinha / Ozone, 4-15 m²)',
      'Wind guarantee: a free place on another weekend if the course cannot run',
      'Gear discounts after the course',
    ],
    optionalServices: [
      'Stay and meals at Haugastøl Turistsenter (booked separately)',
      ...(refresh ? [`Refresh course for returning kiters (NOK ${refresh})`] : []),
      'Private instructor on request',
      'Not included: skis or snowboard, transport to the kite spots along the Rv7',
    ],
    accommodation: null,
    mealPlan: null,
    languages: ['no', 'en'],
    rooms: [],
    imageUrls: wpImages(html, KK_URL, /cropped-|sol-e\d+/i).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KK_URL,
    bookingUrl: KK_URL,
    sourceText: [`product: ${String(product?.name ?? '')}`, `slots: ${slots.map(s => `${s.key} ${s.price} ${s.availability} ${s.availabilityText}`).join(' | ')}`, text].join('\n'),
  };
}

export const kitekursSnowkiteWeekendHaugastol: OfferAdapter = {
  key: 'kitekurs-snowkite-weekend-haugastol',
  name: 'Kitekurs.no Snowkite Weekend Course, Haugastøl',
  kind: 'course',
  disciplines: ['snowkite'],
  operator: {
    name: 'Kitekurs.no',
    websiteUrl: `${SITE}/`,
    rootDomain: 'kitekurs.no',
    contactEmail: null,
    phone: '+4745292084',
  },
  url: KK_URL,
  slotMethod: 'booking_engine',
  liveAvailability: true,
  instantBooking: true,
  fetchBudget: 2,
  async fetchContent() {
    return parseKkContent(await memoPage(KK_URL));
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await memoPage(KK_URL);
    if (!parseWooVariations(html).length && !kkWeekendLabels(wpLines(html)).length) {
      throw new Error('kitekurs: no course weekends in the variation form (page changed?)');
    }
    const slots = buildKkSlots(html, todayIso());
    if (!slots.length) ctx.note('kitekurs: no upcoming course weekends listed');
    return slots;
  },
};
