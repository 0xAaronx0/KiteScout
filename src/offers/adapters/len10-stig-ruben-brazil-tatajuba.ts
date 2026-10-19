// ---------------------------------------------------------------------------
// LEN10 Experience "Stig x Ruben Brazil" - a coached kite week with pro riders Ruben Lenten and Stig Hoefnagel at
// La Ventana Tatajuba (Tatajuba, Ceará, Brazil): 7 days / 6 nights, shared or private room, three chef-cooked meals a
// day, coaching with video analysis, 4x4 spot transport, downwinders, yoga. Kind 'camp' (one base, coaching).
//
// Data path (checked 2026-10-19), Astro static site, server-rendered:
//   slots    /experience prints the featured trip card: "ONLY 4 ROOMS LEFT · From €2,999 p.p." + "STIG × RUBEN ·
//            BRAZIL 2026" + "2–8 November 2026 · Tatajuba, Brazil" + "7 days / 6 nights". One slot per featured
//            BRAZIL card whose start is in the future: EUR per person (package, the "From" price = lowest room
//            type; the page does not split shared / private), availability from the rooms-left badge.
//            The other "Upcoming trips" (Cape Town / Egypt / BVI / Madagascar 2027, "Register interest") are
//            other products and carry no dates; they are not read.
//   booking  "Book Your Spot" links to a WeTravel trip checkout (tri.ps short link); the FAQ: "Directly via
//            WeTravel with an initial deposit from €1,500 ... allocated on a first-come basis". We never call
//            WeTravel; instantBooking = true rests on that own-page wording (deposit checkout, no request step).
//   content  /experience (FAQ inclusions / exclusions, level). Photos are the page's own (generic LEN10 photos,
//            the Brazil card image first).
// robots.txt (2026-10-19): "User-agent: * Allow: /".
// Requests per run: 1 (memoised across content + slots).
// Known limits: rooms left are rooms, not guests; the price is "From" (cheapest room).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, daysInclusive, htmlToText, iso, monthOf, parseAmount, todayIso } from '../parse.js';
import type { Availability, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.len10.com';
export const LEN10_URL = `${SITE}/experience`;

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

export interface Len10Trip {
  title: string;           // "STIG × RUBEN · BRAZIL 2026"
  start: string;
  end: string;
  place: string | null;    // "Tatajuba, Brazil"
  price: number | null;
  currency: string | null;
  roomsLeft: number | null;
  badge: string | null;    // "ONLY 4 ROOMS LEFT"
  nights: number | null;
}

/** Featured trip cards: "<badge> · From €2,999 p.p. <TITLE> <d>–<d> <Month> <yyyy> · <place> ... <n> days / <m> nights". */
export function parseLen10Trips(html: string): Len10Trip[] {
  const t = collapse(htmlToText(html)).replace(/[–—]/g, '-');
  const out: Len10Trip[] = [];
  const re = /(?:([A-Z0-9 ]*(?:LEFT|SOLD OUT|FULL|WAITLIST)[A-Z0-9 ]*)\s*·\s*)?From\s*(€|EUR|\$|USD)\s?([\d.,]+)\s*p\.?p\.?\s+(.{3,80}?)\s+(\d{1,2})\s*-\s*(?:(\d{1,2})\s+)?([A-Za-z]+)\s+(?:-\s*(\d{1,2})\s+([A-Za-z]+)\s+)?(20\d{2})(?:\s*·\s*([A-Z][\p{L} ]+,\s*[A-Z][\p{L}]+))?/gu;
  for (const m of t.matchAll(re)) {
    const y = Number(m[10]);
    const mo = monthOf(m[7]);
    if (!mo) continue;
    let start: string; let end: string;
    if (m[6]) { start = iso(y, mo, +m[5]); end = iso(y, mo, +m[6]); }            // 2-8 November 2026
    else if (m[8] && m[9] && monthOf(m[9])) { start = iso(y, mo, +m[5]); end = iso(y, monthOf(m[9])!, +m[8]); }
    else continue;
    if (end < start) end = iso(y + 1, +end.slice(5, 7), +end.slice(8, 10));
    const tail = t.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 300);
    const nights = tail.match(/(\d+)\s*days?\s*\/\s*(\d+)\s*nights?/i);
    const left = m[1]?.match(/(\d+)\s+(?:ROOMS?|SPOTS?|PLACES?)\s+LEFT/i);
    out.push({
      title: m[4].trim(),
      start, end,
      place: m[11]?.trim() || null,
      price: parseAmount(m[3]),
      currency: /€|EUR/.test(m[2]) ? 'EUR' : 'USD',
      roomsLeft: left ? Number(left[1]) : null,
      badge: m[1]?.trim() || null,
      nights: nights ? Number(nights[2]) : null,
    });
  }
  return out;
}

const isBrazil = (tr: Len10Trip) => /brazil|brasil/i.test(tr.title) || /brazil|brasil/i.test(tr.place ?? '');

function availabilityOf(tr: Len10Trip): Availability {
  const b = tr.badge ?? '';
  if (/sold out|full/i.test(b)) return 'sold_out';
  if (/waitlist/i.test(b)) return 'waitlist';
  if (tr.roomsLeft !== null) return tr.roomsLeft === 0 ? 'sold_out' : 'limited';
  return tr.price !== null ? 'available' : 'unknown';
}

export function buildLen10Slots(trips: Len10Trip[], today: string): Slot[] {
  return trips.filter(isBrazil).filter(tr => tr.start >= today).map(tr => ({
    key: tr.start,
    startDate: tr.start,
    endDate: tr.end,
    unit: 'Shared or private room at La Ventana Tatajuba',
    price: tr.price,
    currency: tr.price !== null ? tr.currency : null,
    priceUnit: tr.price !== null ? 'package' : null,
    priceBasis: tr.price !== null ? 'person' : null,
    occupancy: 1,
    availability: availabilityOf(tr),
    availabilityText: [tr.badge, tr.price !== null ? `From ${tr.currency} ${tr.price} p.p.` : null].filter(Boolean).join(' · ') || null,
    spotsLeft: tr.roomsLeft,
  }));
}

export function parseLen10Content(html: string, today = todayIso()): OfferContent {
  const text = collapse(htmlToText(html));
  const trips = parseLen10Trips(html).filter(isBrazil);
  const tr = trips.find(x => x.start >= today) ?? trips[0] ?? null;
  const nights = tr?.nights ?? (tr ? daysInclusive(tr.start, tr.end) - 1 : 6);
  const human = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const datesLine = tr && tr.start >= today
    ? `Next dates: ${human(tr.start)} to ${human(tr.end)}${tr.price ? `, from ${tr.currency} ${tr.price.toLocaleString('en-US')} per person` : ''}${tr.badge ? ` (${tr.badge.toLowerCase()})` : ''}.`
    : `Runs as a yearly trip; the next Brazil dates are not published yet${tr ? ` (last: ${human(tr.start)} to ${human(tr.end)})` : ''}.`;
  const gear = text.match(/gear rental \(available as an add-on for (€|EUR)\s?([\d.,]+)\)/i);
  const deposit = text.match(/initial deposit from (€|EUR)\s?([\d.,]+)/i);
  const imgs = ['kite-tropical', 'kite-heli', 'capetown', 'heli-cockpit']
    .filter(n => html.includes(`/assets/photos/${n}.jpg`))
    .map(n => `${SITE}/assets/photos/${n}.jpg`);

  return {
    kind: 'camp',
    title: 'LEN10 Experience: Stig x Ruben Brazil',
    summary: [
      `A coached kite week in Tatajuba (Ceará, Brazil) with pro riders Ruben Lenten and Stig Hoefnagel: ${nights + 1} days / ${nights} nights at La Ventana Tatajuba in a shared or private room, three chef-cooked meals a day, on- and off-water coaching with video analysis, 4x4 transport to the spots, downwinders and yoga.`,
      'Aimed at confident intermediate to pro riders who already ride upwind; flat-water lagoons, waves and downwinders in the November trade winds.',
      datesLine,
    ].join(' '),
    continent: 'South America',
    country: 'Brazil',
    region: 'Ceará',
    spot: 'Tatajuba',
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: gear ? true : null,
    beginnerFriendly: false,
    includedServices: [
      `${nights} nights at La Ventana Tatajuba (shared or private room)`,
      '3 chef-cooked meals daily',
      'Pro coaching by Ruben Lenten and Stig Hoefnagel, video analysis',
      '4x4 spot transport, downwinders, yoga and group activities',
    ],
    optionalServices: gear ? [`Gear rental (+${gear[1] === '€' ? 'EUR' : gear[1]} ${parseAmount(gear[2])})`] : [],
    accommodation: 'kite lodge (La Ventana Tatajuba), shared or private room',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: [],
    imageUrls: imgs,
    heroVideoUrl: null,
    sourceUrl: LEN10_URL,
    bookingUrl: html.match(/href="(https:\/\/tri\.ps\/[^"]+)"/)?.[1] ?? LEN10_URL,
    sourceText: [
      `experience: ${text}`,
      `parsed: ${trips.map(x => `${x.title} ${x.start}..${x.end} ${x.currency} ${x.price} rooms left ${x.roomsLeft}`).join('; ')}${deposit ? `; deposit from EUR ${parseAmount(deposit[2])}` : ''}`,
    ].join('\n'),
  };
}

export async function fetchLen10Slots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const trips = parseLen10Trips(await page(LEN10_URL));
  const brazil = trips.filter(isBrazil);
  if (trips.length === 0) throw new Error('len10: no featured trip card ("From €… p.p." + dates) found (layout changed?)');
  const slots = buildLen10Slots(trips, today);
  if (brazil.length === 0) ctx?.note('no Brazil trip card on /experience; no dates published');
  else if (slots.length === 0) ctx?.note(`Brazil trip dates are past (${brazil.map(x => x.start).join(', ')}); next dates not published yet`);
  return slots;
}

export const len10StigRubenBrazilTatajuba: OfferAdapter = {
  key: 'len10-stig-ruben-brazil-tatajuba',
  name: 'LEN10 Experience Stig x Ruben Brazil, Tatajuba',
  kind: 'camp',
  operator: {
    name: 'LEN10 (Ruben Lenten)',
    websiteUrl: SITE,
    rootDomain: 'len10.com',
    whatsapp: '+31613882555',
  },
  url: LEN10_URL,
  slotMethod: 'html_dates',
  liveAvailability: false,
  instantBooking: true,
  fetchBudget: 2,
  async fetchContent() { return parseLen10Content(await page(LEN10_URL)); },
  fetchSlots: ctx => fetchLen10Slots(todayIso(), ctx),
};
