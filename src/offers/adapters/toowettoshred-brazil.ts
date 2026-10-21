// ---------------------------------------------------------------------------
// Too Wet to Shred - Kite Camp Brazil (moving group trip Cumbuco -> Jericoacoara / Barra Grande)
//
// Data path (checked 2026-10-09): one WordPress (Divi) page,
//   https://www.toowettoshred.com/camps/kitesurf-camp-brazil/
//   - departure cards  .bz-card  (month "October 2026", date "21 Oct", "11 or 15 days", stops, status badge)
//   - room cards       .rm-card  (type, beds, "From" price per person for 11 days .rm-p11 and 15 days .rm-p15)
//   - inclusion lists  Divi text modules "included" / "Not included" / "Add-ons"
// Booking runs on Bookinglayer (bookings.toowettoshred.com, a JS shell); its data API api.bookinglayer.io
// has robots.txt "Disallow: /" -> we do NOT call it. Availability = the page's status badge only.
// robots.txt (2026-10-09): www.toowettoshred.com disallows only /wp-admin/.
// Requests per run: 1 (content and slots each fetch the page once).
// Parsed: one slot per departure x duration x room type (unit = room name, so package_offers.rooms joins),
//   end = start + days - 1, EUR "From" price p.p., availability from the badge ("Spots available",
//   "Waitlist only").
// Known limits: prices are "From" prices per room type, not per date; the badge is per departure,
//   not per room type; no seat counts on the page.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import {
  availabilityFromText, collapse, detectCurrency, imageCandidates, iso, monthOf, parse, parseAmount, spotsLeftFromText,
  type HTMLElement,
} from '../parse.js';
import type { ContentRoom, ItinerarySpot, OfferAdapter, OfferContent, Slot } from '../types.js';

export const TWTS_PAGE_URL = 'https://www.toowettoshred.com/camps/kitesurf-camp-brazil/';
const BOOKING_URL = 'https://bookings.toowettoshred.com/en/product/kitesurf-camp-brazil';

export interface TwtsDeparture { start: string; days: number[]; stops: string[]; status: string | null }
export interface TwtsRoom { type: string; name: string; beds: string | null; description: string | null; prices: Record<number, number>; currency: string | null }

function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// --- pure parsers ---------------------------------------------------------------------------
/** Departure cards: year from the card's month line ("October 2026"). */
export function parseTwtsDepartures(html: string): TwtsDeparture[] {
  const out: TwtsDeparture[] = [];
  for (const card of parse(html).querySelectorAll('.bz-card')) {
    const year = txt(card.querySelector('.bz-card-month')).match(/\b(20\d{2})\b/)?.[1];
    const dm = txt(card.querySelector('.bz-card-date')).match(/^(\d{1,2})\s+([A-Za-z]+)/);
    if (!year || !dm || !monthOf(dm[2])) continue;
    const durText = txt(card.querySelector('.bz-card-dur')).split('·')[0];
    const days = [...durText.matchAll(/\d+/g)].map(m => Number(m[0])).filter(n => n > 1 && n < 60);
    const stops = card.querySelectorAll('.bz-stops li').map(li => txt(li).replace(/\s*\(\d+d(?: only)?\)\s*$/i, ''));
    out.push({
      start: iso(Number(year), monthOf(dm[2])!, Number(dm[1])),
      days,
      stops,
      status: txt(card.querySelector('.bz-badge')) || null,
    });
  }
  return out;
}

/** Room cards with one "From" price per trip length (span.rm-p11, span.rm-p15, ...). */
export function parseTwtsRooms(html: string): TwtsRoom[] {
  return parse(html).querySelectorAll('.rm-card').map(card => {
    const prices: Record<number, number> = {};
    let currency: string | null = null;
    for (const span of card.querySelectorAll('.rm-card-price span')) {
      const len = (span.getAttribute('class') ?? '').match(/\brm-p(\d+)\b/)?.[1];
      const amount = parseAmount(txt(span));
      if (len && amount) { prices[Number(len)] = amount; currency ??= detectCurrency(txt(span)); }
    }
    return {
      type: txt(card.querySelector('.rm-card-type')),
      name: txt(card.querySelector('.rm-card-title')),
      beds: txt(card.querySelector('.rm-card-beds')) || null,
      description: txt(card.querySelector('.rm-card-desc')) || null,
      prices,
      currency,
    };
  }).filter(r => r.name);
}

/** Persons sharing the room the p.p. price assumes ("2 single beds" -> 2, "1 double bed" -> 2, "Varies" -> null). */
function occupancyOf(beds: string | null): number | null {
  if (!beds) return null;
  const n = beds.match(/(\d+)\s+(?:single|separate)\s+beds?/i);
  if (n) return Number(n[1]);
  if (/double bed/i.test(beds)) return 2;
  return null;
}

/** Departure x trip length x room type. */
export function parseToowettoshredSlots(html: string): Slot[] {
  const rooms = parseTwtsRooms(html);
  const out: Slot[] = [];
  for (const dep of parseTwtsDepartures(html)) {
    const availability = (dep.status && availabilityFromText(dep.status)) || 'unknown';
    for (const days of dep.days) {
      for (const room of rooms) {
        const price = room.prices[days] ?? null;
        if (price === null) continue; // no price for this trip length = not offered in this room
        out.push({
          // keyed on the room name ("Triple Room" -> triple), not the badge ("Triple · Female" may change)
          key: `${keyPart(room.name.replace(/\s*room$/i, '')) || keyPart(room.type)}-${days}d|${dep.start}`,
          startDate: dep.start,
          endDate: addDays(dep.start, days - 1),
          unit: room.name,
          price,
          currency: room.currency ?? 'EUR',
          priceUnit: 'package',
          priceBasis: 'person',
          occupancy: occupancyOf(room.beds),
          availability,
          availabilityText: dep.status,
          spotsLeft: dep.status ? spotsLeftFromText(dep.status) : null,
        });
      }
    }
  }
  return out;
}

/** Divi text modules: a label module ("included" / "Not included" / "Add-ons") followed by a <ul>. */
export function parseTwtsLists(html: string): { included: string[]; excluded: string[]; addons: string[] } {
  const res = { included: [] as string[], excluded: [] as string[], addons: [] as string[] };
  let label = '';
  for (const mod of parse(html).querySelectorAll('.et_pb_text_inner')) {
    const ul = mod.querySelector('ul');
    if (!ul) { label = txt(mod).toLowerCase(); continue; }
    const items = ul.querySelectorAll('li').map(li => txt(li)).filter(Boolean);
    if (/not included/.test(label)) res.excluded.push(...items);
    else if (/\bincluded\b/.test(label)) res.included.push(...items);
    else if (/add-ons?/.test(label)) res.addons.push(...items);
    label = '';
  }
  return res;
}

const REGIONS: Array<[RegExp, string]> = [
  [/cumbuco|ta[ií]ba|icar[aá][ií]|guajiru|jericoacoara|patos|guri[uú]/i, 'Ceará'],
  [/barra grande|m[aá]cap[aá]|parna[ií]ba/i, 'Piauí'],
];

export function parseToowettoshredContent(html: string): OfferContent {
  const root = parse(html);
  const deps = parseTwtsDepartures(html);
  const rooms = parseTwtsRooms(html);
  const lists = parseTwtsLists(html);
  const title = txt(root.querySelector('h1')) || 'Kite Camp Brazil';
  const text = collapse((root.querySelector('#main-content') ?? root.querySelector('body') ?? root).text);

  // itinerary: the longest route first (its stops in order), then stops only the other route visits
  const names: string[] = [];
  for (const d of [...deps].sort((a, b) => Math.max(...b.days) - Math.max(...a.days) || b.stops.length - a.stops.length)) {
    for (const s of d.stops) if (!names.includes(s)) names.push(s);
  }
  // keep the provider's coastal order: the October route (Icaraí) sits between Cumbuco and Guajiru
  const order = ['cumbuco', 'icara', 'guajiru', 'jericoacoara', 'barra grande', 'macapa'];
  const rank = (n: string) => { const k = n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); const i = order.findIndex(o => k.includes(o)); return i < 0 ? 99 : i; };
  names.sort((a, b) => rank(a) - rank(b));
  const itinerarySpots: ItinerarySpot[] = names.map((name, i) => ({
    name, country: 'Brazil', region: REGIONS.find(([re]) => re.test(name))?.[1] ?? null, order: i + 1,
  }));

  const allDays = [...new Set(deps.flatMap(d => d.days))].sort((a, b) => a - b);
  const minDays = allDays[0] ?? null;
  const cheapest = rooms.flatMap(r => Object.entries(r.prices).map(([d, p]) => ({ d: Number(d), p, r })))
    .sort((a, b) => a.p - b.p)[0];
  const facilities = root.querySelectorAll('.rm-fac').map(f => txt(f).replace(/^[^A-Za-z]+/, '')).filter(Boolean);
  const maxRiders = text.match(/Max\s+(\d+)\s+riders/i)?.[1];
  const depText = deps.map(d => `${d.start} (${d.days.join(' or ')} days${d.status ? `, ${d.status.toLowerCase()}` : ''})`).join(' and ');

  const summary = [
    `A moving kite camp along the Ceará coast of Brazil for intermediate and advanced riders: the group stays about three days at each stop (${names.slice(0, 4).join(', ')}${names.length > 4 ? ' and beyond' : ''}) for lagoon sessions, coaching and a few downwinders${maxRiders ? `, with at most ${maxRiders} riders` : ''}.`,
    deps.length ? `Departures: ${depText}.` : null,
    `Accommodation, transfers, breakfasts, five group dinners, trick coaching, yoga and airport pick-up are included; flights, other meals and insurance are not.`,
    cheapest ? `Prices start at EUR ${cheapest.p.toLocaleString('en-US')} per person (${cheapest.r.name}, ${cheapest.d} days) and depend on room type and trip length.` : null,
  ].filter(Boolean).join(' ');

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: r.description,
    features: [r.beds, ...Object.entries(r.prices).map(([d, p]) => `${d} days from EUR ${p} p.p.`)].filter((x): x is string => !!x),
  }));

  const images = imageCandidates(html, TWTS_PAGE_URL, null, 60).filter(u => !/logo|cropped-|icon/i.test(u));
  const dedup: string[] = [];
  const seen = new Set<string>();
  for (const u of images) {
    const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
    if (!seen.has(k)) { seen.add(k); dedup.push(u); }
  }

  const sourceLines = [
    `departures: ${deps.map(d => `${d.start} ${d.days.join('/')}d [${d.stops.join(' > ')}] ${d.status ?? ''}`).join(' | ')}`,
    `rooms: ${rooms.map(r => `${r.name} ${JSON.stringify(r.prices)}`).join(' | ')}`,
    `included: ${lists.included.join('; ')}`,
    `not included: ${lists.excluded.join('; ')}`,
    `add-ons: ${lists.addons.join('; ')}`,
    text,
  ];

  return {
    kind: 'tour',
    title,
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Ceará',
    spot: names[0] ?? 'Cumbuco',
    itinerarySpots,
    durationDays: minDays,
    // "perfect for intermediate to advanced riders"; FAQ: "we prefer you are independent already" (2026-10-09)
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: false,
    equipmentRental: lists.addons.some(a => /rental/i.test(a)),
    beginnerFriendly: false,
    includedServices: lists.included,
    optionalServices: lists.addons,
    accommodation: rooms.length
      ? `Rooms at each stop (${rooms.map(r => r.name).join(', ')})${facilities.length ? `; ${facilities.join(', ').toLowerCase()}` : ''}`
      : null,
    mealPlan: 'breakfast',
    languages: ['en'],
    rooms: contentRooms,
    imageUrls: dedup.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: TWTS_PAGE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: sourceLines.join('\n'),
  };
}

export const toowettoshredBrazil: OfferAdapter = {
  key: 'toowettoshred-brazil',
  name: 'Too Wet to Shred - Kite Camp Brazil',
  kind: 'tour',
  operator: {
    name: 'Too Wet to Shred',
    websiteUrl: 'https://www.toowettoshred.com',
    rootDomain: 'toowettoshred.com',
    contactEmail: 'never@toowettoshred.com',
    phone: '+31633023099',
  },
  url: TWTS_PAGE_URL,
  slotMethod: 'html_dates',
  fetchBudget: 2,
  async fetchContent() {
    return parseToowettoshredContent(await fetchText(TWTS_PAGE_URL));
  },
  async fetchSlots(ctx) {
    const html = await fetchText(TWTS_PAGE_URL);
    const deps = parseTwtsDepartures(html);
    const rooms = parseTwtsRooms(html);
    if (deps.length === 0 || rooms.length === 0) throw new Error(`toowettoshred: page layout changed (${deps.length} departure cards, ${rooms.length} room cards)`);
    const slots = parseToowettoshredSlots(html);
    for (const d of deps) {
      for (const n of d.days) if (!rooms.some(r => r.prices[n])) ctx.note(`no room prices for the ${n}-day option of ${d.start}`);
    }
    return slots;
  },
};
