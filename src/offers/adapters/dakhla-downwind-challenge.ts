// ---------------------------------------------------------------------------
// Dakhla Downwind Challenge - annual 5-stage downwind expedition Dakhla -> Lagouira (Morocco)
//
// Data path (checked 2026-10-09): one WordPress (Elementor) page, https://dakhladownwindchallenge.com/
//   - event dates   hero heading "14 - 20 AUGUST 2027"
//   - fee           Elementor price table: original price (EUR 1700) + current price (EUR 1610),
//                   "Discount valid until May 31, 2027" in the table footer
//   - itinerary     "14 AUG / REGISTRATION / DAKHLA - PUERTITO BEACH" stage blocks
//   "BOOK NOW" / "Register now" jump to a Contact Form 7 inquiry form (#booking): no inventory, the organizer
//   confirms -> availability 'on_request' ("Spots are limited ..." is generic copy, not a shortage signal).
// robots.txt (2026-10-09): allows everything except one WP-Optimize json file.
// Requests per run: 1 (content and slots each fetch the page once).
// Parsed: one slot per event (key = start date); price = early-bird while `asOf` <= the discount deadline,
//   else the regular price (the slot price changes on the deadline even if the page does not).
// Known limits: the inclusions still say "Dakhla Downwind Challenge 2026" (stale copy on the provider page,
//   kept verbatim); edition numbers disagree on the page (12th vs 10th); videos are YouTube embeds only
//   (no file for heroVideoUrl).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, detectCurrency, imageCandidates, parse, parseAmount, parseDate, parseRange, todayIso } from '../parse.js';
import type { ItinerarySpot, OfferAdapter, OfferContent, Slot } from '../types.js';

export const DAKHLA_PAGE_URL = 'https://dakhladownwindchallenge.com/';

export interface DakhlaEvent {
  start: string;
  end: string;
  regularPrice: number | null;
  currentPrice: number | null;
  currency: string | null;
  discountUntil: string | null;
  priceNote: string | null;
  features: string[];
}

function textLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script,style,noscript,svg')) el.remove();
  return (root.querySelector('body') ?? root).structuredText
    .split('\n').map(s => collapse(s.replace(/​/g, ''))).filter(Boolean);
}
const titleCase = (s: string): string => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());

// --- pure parsers -------------------------------------------------------------------------------
export function parseDakhlaEvent(html: string): DakhlaEvent | null {
  const root = parse(html);
  let range: { start: string; end: string } | null = null;
  for (const h of root.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    const t = collapse(h.text);
    if (/\b20\d{2}\b/.test(t) && /\d{1,2}\s*-\s*\d{1,2}\s+[A-Za-z]+/.test(t)) { range = parseRange(t); if (range) break; }
  }
  if (!range) return null;
  const table = root.querySelector('.elementor-price-table');
  const num = (sel: string) => { const t = collapse(table?.querySelector(sel)?.text ?? ''); return t ? parseAmount(t) : null; };
  const regular = num('.elementor-price-table__original-price');
  const intPart = collapse(table?.querySelector('.elementor-price-table__integer-part')?.text ?? '');
  const frac = collapse(table?.querySelector('.elementor-price-table__fractional-part')?.text ?? '');
  const current = intPart ? parseAmount(frac ? `${intPart}.${frac}` : intPart) : null;
  const info = collapse(table?.querySelector('.elementor-price-table__additional_info')?.text ?? '');
  const until = info.match(/valid until\s+([A-Za-z]+\.?\s+\d{1,2},?\s+20\d{2}|\d{1,2}\s+[A-Za-z]+\.?\s+20\d{2}|\d{1,2}[./]\d{1,2}[./]20\d{2})/i)?.[1];
  const currencyText = collapse(table?.querySelector('.elementor-price-table__currency')?.text ?? '');
  return {
    start: range.start,
    end: range.end,
    regularPrice: regular ?? current,
    currentPrice: current ?? regular,
    currency: detectCurrency(currencyText) ?? (regular || current ? 'EUR' : null),
    discountUntil: until ? parseDate(until) : null,
    priceNote: info.split(/-{3,}/)[0].replace(/^PLEASE NOTE\s*:\s*/i, '').trim() || null,
    features: table?.querySelectorAll('.elementor-price-table__features-list li').map(li => collapse(li.text)).filter(Boolean) ?? [],
  };
}

/** One slot for the event. `asOf` (YYYY-MM-DD) decides early-bird vs regular price. */
export function parseDakhlaSlots(html: string, asOf: string): Slot[] {
  const ev = parseDakhlaEvent(html);
  if (!ev) return [];
  const early = ev.discountUntil !== null && asOf <= ev.discountUntil;
  const price = ev.discountUntil === null ? ev.currentPrice : early ? ev.currentPrice : ev.regularPrice;
  return [{
    key: ev.start,
    startDate: ev.start,
    endDate: ev.end,
    unit: null,
    price,
    currency: price !== null ? ev.currency : null,
    priceUnit: 'package',
    priceBasis: 'person',
    occupancy: null,
    availability: 'on_request',
    availabilityText: ev.priceNote,
    spotsLeft: null,
    priceValidUntil: early ? ev.discountUntil : null,
  }];
}

/** Stage blocks: "15 AUG" / "Down wind" / "PUERTITO BEACH - SHIPWRECK BEACH". */
export function parseDakhlaStages(html: string): Array<{ day: string; label: string; from: string; to: string }> {
  const lines = textLines(html);
  const out: Array<{ day: string; label: string; from: string; to: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\d{1,2}\s+[A-Z]{3,}$/i.test(lines[i]) || !/^\d{1,2}\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/i.test(lines[i])) continue;
    for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
      const m = lines[j].match(/^(.+?)\s+-\s+(.+)$/);
      if (m && m[1].length < 40 && m[2].length < 40) {
        out.push({ day: lines[i], label: j > i + 1 ? lines[i + 1] : '', from: titleCase(m[1].trim()), to: titleCase(m[2].trim()) });
        break;
      }
    }
  }
  return out;
}

const IMAGE_SKIP = /\.png$|Asset-\d|logo/i;

export function parseDakhlaContent(html: string): OfferContent {
  const ev = parseDakhlaEvent(html);
  if (!ev) throw new Error('dakhla: no event date range (e.g. "14 - 20 AUGUST 2027") on the page');
  const lines = textLines(html);
  const text = lines.join('\n');
  const year = ev.start.slice(0, 4);
  const title = text.match(/Welcome to the (Dakhla Downwind Challenge \d{4})/i)?.[1] ?? `Dakhla Downwind Challenge ${year}`;
  const stages = parseDakhlaStages(html);
  const names: string[] = [];
  for (const s of stages) for (const n of [s.from, s.to]) if (!names.includes(n)) names.push(n);
  const itinerarySpots: ItinerarySpot[] = names.map((name, i) => ({ name, country: 'Morocco', region: 'Dakhla-Oued Ed-Dahab', order: i + 1 }));
  const km = text.match(/(\d{3})\s*km/i)?.[1];
  const perDay = text.match(/around\s+(\d+)\s*[–-]\s*(\d+)\s*km per day/i);
  const days = Math.round((Date.parse(ev.end) - Date.parse(ev.start)) / 86400000) + 1;
  const expeditionDays = text.match(/(\d+)-day kitesurfing expedition/i)?.[1];
  const fmt = (n: number | null) => (n === null ? '?' : n.toLocaleString('en-US'));

  const included = ev.features.filter(f => !/upgrades? available|can also be booked/i.test(f));
  const optional = ev.features.filter(f => /upgrades? available|can also be booked/i.test(f));

  const summary = [
    `A guided kitesurf downwind expedition of about ${km ?? 500} km from the Dakhla lagoon to Lagouira near the Mauritanian border, with 4x4 support vehicles, a support team and nights in desert camps.`,
    `The ${year} edition runs ${ev.start} to ${ev.end}${expeditionDays ? ` with a ${expeditionDays}-day expedition` : ''}${perDay ? ` of about ${perDay[1]}-${perDay[2]} km a day` : ''}; it is not a race and riders can skip a stage in the support cars.`,
    'It suits confident intermediate and advanced riders who can ride upwind and downwind; absolute beginners cannot join and riders bring their own gear.',
    ev.discountUntil && ev.regularPrice !== ev.currentPrice
      ? `The fee is ${ev.currency} ${fmt(ev.currentPrice)} per person until ${ev.discountUntil}, then ${ev.currency} ${fmt(ev.regularPrice)}, and includes three hotel nights at New Spirit Dakhla, meals and logistics during the downwind.`
      : `The fee is ${ev.currency} ${fmt(ev.currentPrice)} per person and includes three hotel nights at New Spirit Dakhla, meals and logistics during the downwind.`,
  ].join(' ');

  // drop logos and the athlete portraits ("Meet our hero's" section); keep event photos
  const aStart = html.indexOf('ATHLETES and more');
  const aEnd = html.indexOf('A ONCE IN A LIFETIME');
  const portraits = new Set(aStart > 0 && aEnd > aStart ? [...html.slice(aStart, aEnd).matchAll(/uploads\/[^"'\s)]+/g)].map(m => m[0]) : []);
  const imageUrls = imageCandidates(html, DAKHLA_PAGE_URL, null, 80)
    .filter(u => !IMAGE_SKIP.test(u) && ![...portraits].some(p => u.includes(p)));

  const fStart = lines.findIndex(l => /^ITINERARY$/.test(l)); // the heading, not the nav link "Itinerary"
  const fEnd = lines.findIndex(l => /^OUR PARTNERS$/i.test(l));
  const faq = lines.findIndex(l => /^A Typical Day/i.test(l));
  const faqEnd = lines.findIndex(l => /^\d+(st|nd|rd|th) Edition/i.test(l));
  const sourceText = [
    `event ${ev.start}..${ev.end}; fee ${ev.currency} ${ev.currentPrice} (regular ${ev.regularPrice}, discount until ${ev.discountUntil}); ${ev.priceNote ?? ''}`,
    `includes: ${ev.features.join('; ')}`,
    ...(fStart >= 0 && fEnd > fStart ? lines.slice(fStart, fEnd) : []),
    ...(faq >= 0 && faqEnd > faq ? lines.slice(faq, faqEnd) : []),
  ].join('\n');

  return {
    kind: 'tour',
    title,
    summary,
    continent: 'Africa',
    country: 'Morocco',
    region: 'Dakhla-Oued Ed-Dahab',
    spot: names[0] ?? 'Dakhla',
    itinerarySpots,
    durationDays: days,
    // FAQ (2026-10-09): "confident kiteboarders who are able to ride upwind and downwind", "not suitable for absolute beginners"
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: false,
    equipmentRental: false,        // "You'll need your own kitesurfing gear"
    beginnerFriendly: false,
    includedServices: included,
    optionalServices: optional,
    accommodation: 'Hotel nights at New Spirit Dakhla plus tents in desert camps during the downwind stages',
    mealPlan: /all meals/i.test(text) ? 'full_board' : null,
    languages: ['en', 'fr'],       // site in French/English, Moroccan organizer
    rooms: [],
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,            // only YouTube embeds on the page
    sourceUrl: DAKHLA_PAGE_URL,
    bookingUrl: `${DAKHLA_PAGE_URL}#booking`,
    sourceText,
  };
}

export const dakhlaDownwindChallenge: OfferAdapter = {
  key: 'dakhla-downwind-challenge',
  name: 'Dakhla Downwind Challenge',
  kind: 'tour',
  operator: {
    name: 'Dakhla Downwind Challenge',
    websiteUrl: 'https://dakhladownwindchallenge.com',
    rootDomain: 'dakhladownwindchallenge.com',
    contactEmail: 'info@dakhladownwindchallenge.com',
    phone: '+212661661863',
  },
  url: DAKHLA_PAGE_URL,
  slotMethod: 'html_dates',
  fetchBudget: 2,
  async fetchContent() {
    return parseDakhlaContent(await fetchText(DAKHLA_PAGE_URL));
  },
  async fetchSlots(ctx) {
    const html = await fetchText(DAKHLA_PAGE_URL);
    const ev = parseDakhlaEvent(html);
    if (!ev) throw new Error('dakhla: no event date range on the page - layout changed');
    if (ev.currentPrice === null) ctx.note('no participation fee found in the price table');
    return parseDakhlaSlots(html, todayIso());
  },
};
