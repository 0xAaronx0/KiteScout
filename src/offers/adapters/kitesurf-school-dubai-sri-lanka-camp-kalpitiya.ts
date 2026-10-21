// ---------------------------------------------------------------------------
// Kitesurf School Dubai (kitesurf.ae, Kite Beach, Jumeirah) - "Kitesurf Trip to Sri Lanka, Christmas & New Year
// 2026/27": a 5-day kite program at Arasi Resort Kalpitiya with daily organised sessions, spot transfers, one
// organised island / boat kite safari, breakfast and the school's team on site. One base (the coach picks the day's
// spot around Kalpitiya) -> KIND = 'camp' (the operator calls it a "trip").
//
// Data path (checked 2026-10-21): WordPress blog post (Flatsome theme, posted 16 Sep 2026 by the school's owner):
//   https://kitesurf.ae/sri-lanka-kitesurf-trip-2/
//   slots    the date lines "📅 21–25 December 2026", "📅 28 December 2026 – 2 January 2027", "📅 4–8 January
//            2027" (each date appears twice in the post; de-duplicated by start date), the trip name from the line
//            before ("Christmas Trip" / "New Year Trip" / "January Trip"), and "Price: 4900 dhs per person" (dhs =
//            dirham -> AED). One slot per future date, AED per person, package (nights = end - start as printed).
//            Booking: "BOOK YOUR PLACE" / "WHATSAPP US FOR PRICES & AVAILABILITY" (no link, WhatsApp) ->
//            'on_request'; "Limited riders per trip" is generic copy, not a shortage signal.
//   content  the same post (program, inclusions, exclusions).
// robots.txt (2026-10-21): WordPress default for the fetched path (only /wp-admin/ rules); the page carries an
//   Imunify360 bot-check form in the footer, but served the full post to our honest UA (no challenge).
// Requests per run: 1 (memoised for content + slots).
// Known limits / doubts:
//   - durationDays 5 = the "5-Day Program"; the New Year date runs 6 days (28 Dec - 2 Jan) as printed, so that slot
//     carries 5 nights, the others 4.
//   - Meals: breakfast only; "Lunches and dinners unless specified in your final package" are excluded. Lessons,
//     private coaching, rental and airport transfers are extras (prices not printed).
//   - Images: none. The post's featured image is a third-party graphic ("...guide-kiterr.png") and the inline images
//     are hot-linked from bing.net / images.openai.com; nothing is the school's own photo -> imageUrls empty.
//   - No coordinates for Arasi Resort on the page -> spot 'Kalpitiya' for the geocoder; region as in the other
//     Kalpitiya adapters.
//   - Past dates are dropped; when all three are past the adapter returns [] and notes that the next trip is not
//     published yet (the school ran an earlier "Sri lanka Kitesurf Trip" post in 2024).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, daysInclusive, ldOfType, parse, parseAmount, parseRange, todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://kitesurf.ae';
export const KSD_SL_URL = `${SITE}/sri-lanka-kitesurf-trip-2/`;

export interface KsdTrip { name: string | null; start: string; end: string; label: string }
export interface KsdPost { lines: string[]; trips: KsdTrip[]; price: number | null; currency: string | null; priceRaw: string | null; days: number | null; resort: string | null }

// --- memoised page fetch ------------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible lines of the post body (.entry-content), emoji kept. */
export function ksdLines(html: string): string[] {
  const root = parse(html);
  const body = root.querySelector('.entry-content') ?? root.querySelector('article') ?? root.querySelector('body') ?? root;
  for (const el of body.querySelectorAll('script,style,noscript,svg')) el.remove();
  return body.structuredText.split('\n').map(s => collapse(s.replace(/ /g, ' '))).filter(Boolean);
}

// --- pure parsers -------------------------------------------------------------------------------------
export function parseKsdPost(html: string): KsdPost {
  const lines = ksdLines(html);
  const trips: KsdTrip[] = [];
  lines.forEach((l, i) => {
    if (!/📅/.test(l)) return;
    const r = parseRange(l.replace(/📅/g, '').replace(/[–—]/g, '-'));
    if (!r || trips.some(t => t.start === r.start)) return;
    const prev = lines[i - 1] ?? '';
    const name = /\btrip\b/i.test(prev) && prev.length < 40 && !/📅/.test(prev) ? prev.replace(/^[^A-Za-z]+/, '').trim() : null;
    trips.push({ name, start: r.start, end: r.end, label: l.replace(/📅/g, '').trim() });
  });
  // a later block repeats the dates with emoji titles ("🎄 Christmas Kite Trip" + "21–25 December 2026"): use it
  // for names the first block did not give, and for dates printed without the calendar emoji
  lines.forEach((l, i) => {
    if (!/kite trip$/i.test(l) || l.length > 40) return;
    const r = parseRange((lines[i + 1] ?? '').replace(/[–—]/g, '-'));
    if (!r) return;
    const t = trips.find(x => x.start === r.start);
    if (!t) trips.push({ name: l.replace(/^[^A-Za-z]+/, '').trim(), start: r.start, end: r.end, label: lines[i + 1] });
    else if (!t.name) t.name = l.replace(/^[^A-Za-z]+/, '').trim();
  });
  trips.sort((a, b) => a.start.localeCompare(b.start));
  const pm = lines.join('\n').match(/Price:\s*(?:AED\s*)?([\d.,]+)\s*(dhs|dirhams?|AED)?\s*per person/i);
  const days = Number(lines.join('\n').match(/(\d+)-Day Program/i)?.[1] ?? NaN) || null;
  const resort = lines.join('\n').match(/Stay at ([A-Z][A-Za-z ]+? Resort(?: Kalpitiya)?)/)?.[1] ?? null;
  return {
    lines,
    trips,
    price: pm ? parseAmount(pm[1]) : null,
    currency: pm && (pm[2] || /AED/i.test(pm[0])) ? 'AED' : null,
    priceRaw: pm?.[0] ?? null,
    days,
    resort,
  };
}

export function buildKsdSlots(p: KsdPost, today: string): Slot[] {
  const out: Slot[] = [];
  for (const t of p.trips) {
    if (t.start < today) continue;
    out.push({
      key: t.start,
      startDate: t.start,
      endDate: t.end,
      unit: t.name,
      price: p.price,
      currency: p.price === null ? null : p.currency,
      priceUnit: p.price === null ? null : 'package',
      priceBasis: 'person',
      occupancy: null,
      availability: 'on_request',
      availabilityText: `Book via WhatsApp ("WhatsApp us for prices & availability"); limited riders per trip${p.priceRaw ? `; "${p.priceRaw}"` : ''}`,
      spotsLeft: null,
      packageNights: daysInclusive(t.start, t.end) - 1,
    });
  }
  return out;
}

function listAfter(lines: string[], head: RegExp, stop: RegExp, mark: RegExp): string[] {
  const i = lines.findIndex(l => head.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < lines.length && !stop.test(lines[j]); j++) {
    if (mark.test(lines[j])) out.push(lines[j].replace(mark, '').trim());
  }
  return out;
}

export function parseKsdContent(html: string): OfferContent {
  const p = parseKsdPost(html);
  if (!p.trips.length) throw new Error('kitesurf-school-dubai-sri-lanka: no dated trips found (post changed?)');
  if (p.price === null) throw new Error('kitesurf-school-dubai-sri-lanka: "Price: ... per person" not found (post changed?)');
  const days = p.days ?? daysInclusive(p.trips[0].start, p.trips[0].end);
  const included = listAfter(p.lines, /^What’s Included$|^What's Included$/i, /^What’s Not Included$|^What's Not Included$/i, /^✓\s*/);
  const excluded = listAfter(p.lines, /^What’s Not Included$|^What's Not Included$/i, /^Travel insurance covering/i, /^✗\s*/);
  const published = (ldOfType(html, 'Article')[0]?.datePublished ?? ldOfType(html, 'WebPage')[0]?.datePublished ?? null) as string | null;
  const resort = p.resort ?? 'Arasi Resort Kalpitiya';
  const dates = p.trips.map(t => `${t.name ? `${t.name} ` : ''}${t.start} to ${t.end}`).join(', ');

  const summary = [
    `Kitesurf School Dubai runs a ${days}-day winter kite trip to Kalpitiya in north-western Sri Lanka, based at ${resort}, over Christmas and New Year.`,
    `Daily organised kite sessions on the Kalpitiya lagoon with the school's coaches, spot transfers, one boat-supported island kite safari (Navy Point, Vella Island or Dream Spot depending on the wind), a progression day (with a guided downwinder when riders and wind allow) and breakfast are included; lessons, private coaching, rental and airport transfers are extra.`,
    `The dates are ${dates}; the price is AED ${p.price.toLocaleString('en-US')} per person, booked via WhatsApp.`,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Kitesurf School Dubai Sri Lanka Kite Trip',
    summary,
    continent: 'Asia',
    country: 'Sri Lanka',
    region: 'North Western Province',
    spot: 'Kalpitiya',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: days,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: included.length ? included : [`Accommodation at ${resort}`, 'Daily breakfast', 'Daily organised kitesurf sessions', 'Organised island / boat kite trip'],
    optionalServices: [
      'Daily kite lessons and private coaching (price on request)',
      'Kite equipment rental (price on request)',
      'Airport transfers',
      'Lunches and dinners',
      'Excursions: Wilpattu National Park, dolphin watching, extra boat trips',
      ...(excluded.length ? [`Not included: ${excluded.join('; ')}`] : []),
    ],
    accommodation: resort,
    mealPlan: 'breakfast',
    languages: ['en'],
    rooms: [],
    imageUrls: [],
    heroVideoUrl: null,
    sourceUrl: KSD_SL_URL,
    bookingUrl: KSD_SL_URL,
    sourceText: [
      `post (published ${published ?? '?'}):`,
      ...p.lines,
      `parsed: trips ${p.trips.map(t => `${t.name}=${t.start}..${t.end}`).join(', ')}; price ${p.price} ${p.currency}`,
    ].join('\n'),
  };
}

export async function fetchKsdSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const p = parseKsdPost(await page(KSD_SL_URL));
  if (!p.trips.length) throw new Error('kitesurf-school-dubai-sri-lanka: no dated trips found (post changed?)');
  if (p.price === null) ctx?.note('no "Price: ... per person" line; slots without price');
  const slots = buildKsdSlots(p, today);
  if (!slots.length) ctx?.note(`all trip dates are past (${p.trips.map(t => t.start).join(', ')}); next dates not published yet`);
  return slots;
}

export const kitesurfSchoolDubaiSriLankaCampKalpitiya: OfferAdapter = {
  key: 'kitesurf-school-dubai-sri-lanka-camp-kalpitiya',
  name: 'Kitesurf School Dubai Sri Lanka Kite Trip (Kalpitiya)',
  kind: 'camp',
  operator: {
    name: 'Kitesurf School Dubai',
    websiteUrl: SITE,
    rootDomain: 'kitesurf.ae',
    contactEmail: 'xavier@kitesurf.ae', // business contact in the site footer
    whatsapp: '+971502547440',
    phone: '+971502547440',
  },
  url: KSD_SL_URL,
  slotMethod: 'html_dates',
  instantBooking: false, // WhatsApp request; the site's WooCommerce shop does not sell this trip
  fetchBudget: 2,
  async fetchContent() {
    return parseKsdContent(await page(KSD_SL_URL));
  },
  fetchSlots: ctx => fetchKsdSlots(todayIso(), ctx),
};
