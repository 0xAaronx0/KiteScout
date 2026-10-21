// ---------------------------------------------------------------------------
// Kite Sisters Boutique Morocco Kitesurf Retreat (tour Marrakech - Essaouira - Dakhla), 11 days / 10 nights in May and
// June: arrival at Marrakech airport, 3 nights in a countryside lodge near Essaouira (2 kite days, medina, argan
// cooperative), 1 night in a riad in Marrakech (guided medina day), 6 nights at an ecolodge on the Dakhla lagoon
// (5 kite days, kite trips); coaching for all levels, North beginner gear, all gourmet meals, all ground transport.
// Not included: international flights, the domestic flight to Dakhla, drinks, insurance.
//
// Data path (checked 2026-10-19): ONE page, https://kite-sisters.com/kitesurf-retreat/morocco-may-june/ (WordPress +
//   Elementor, same site as kite-sisters-brazil.ts whose visibleRoot / weekRange helpers are imported).
//   Dates: an <h4> "2027 Dates: Reservations open" followed by <li> lines
//   "Women Only Retreat: May 13th to 23rd 2027. 2 last spots." and "Couples/Co-Ed Retreat: May 27th to June 6th 2027".
//   Any "<...> Retreat: <range> <year>" line is read, so a new year's list is picked up; past starts are dropped.
//   Prices: none on the page ("request a personalized quote"); pre-sale / early-bird discounts ("EU 250 off" before
//   15 Dec 2026) are text only. Booking: quote request form (Contact Form 7), no engine.
// Decision (2026-10-19): ONE listing with two units ('women' / 'co-ed'), like the Brazil retreat, because both
//   editions share route, inclusions and page; the women-only character is in the unit and the summary.
// robots.txt kite-sisters.com (2026-10-19): only /wp-admin/ disallowed.
// Requests per run: 1 (content + slots share one memoised page fetch).
// Slots: one per edition, key `<unit>|<start>`, price null (on request); "N last spots" -> limited + spotsLeft,
//   "sold out" -> sold_out, otherwise on_request with the heading's words ("Reservations open").
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, type HTMLElement } from '../parse.js';
import type { Availability, OfferAdapter, OfferContent, Slot } from '../types.js';
import { visibleRoot, weekRange, weekStatus } from './kite-sisters-brazil.js';

export const KSM_MOROCCO_URL = 'https://kite-sisters.com/kitesurf-retreat/morocco-may-june/';

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
/** Headings and list items in document order. */
function walk(el: HTMLElement, out: HTMLElement[] = []): HTMLElement[] {
  for (const n of el.childNodes) {
    const e = n as HTMLElement;
    if (!e.tagName) continue;
    if (/^(H2|H3|H4|H5|LI)$/.test(e.tagName)) out.push(e);
    walk(e, out);
  }
  return out;
}

export interface KsmEdition { unit: 'women' | 'co-ed'; start: string; end: string; availability: Availability; text: string | null; spotsLeft: number | null; line: string }

/** "2 last spots" / "last 2 spots" / "1 spot left" -> limited; else the Brazil adapter's week wording. */
export function editionStatus(rest: string, heading: string | null): { availability: Availability; text: string | null; spotsLeft: number | null } {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const last = rest.match(/\b(\d+|one|two|three|four|five)\s+last\s+(?:spot|place)s?\b|\blast\s+(\d+|one|two|three|four|five)\s+(?:spot|place)s?\b/i);
  if (last) {
    const n = (last[1] ?? last[2]).toLowerCase();
    return { availability: 'limited', text: last[0], spotsLeft: words[n] ?? Number(n) };
  }
  return weekStatus(rest, heading);
}

export function parseKsmEditions(html: string): KsmEdition[] {
  const root = visibleRoot(html);
  const post = root.querySelector('[data-elementor-type="wp-post"]') ?? root;
  const out: KsmEdition[] = [];
  let heading: string | null = null;
  for (const el of walk(post)) {
    if (el.tagName !== 'LI') { heading = txt(el); continue; }
    const t = txt(el);
    const m = t.match(/^([^:]{3,60}?Retreat)\s*:\s*(.+)$/i);
    if (!m) continue;
    const label = m[1];
    const datePart = m[2].match(/^(.*?\b20\d{2})\b/)?.[1];
    if (!datePart) continue;
    const range = weekRange(datePart);
    if (!range) continue;
    const unit = /women/i.test(label) ? 'women' : 'co-ed';
    const rest = m[2].slice(datePart.length).replace(/^[.\s]+/, '');
    const st = editionStatus(rest, heading);
    if (out.some(e => e.unit === unit && e.start === range.start)) continue;
    out.push({ unit, start: range.start, end: range.end, availability: st.availability, text: st.text, spotsLeft: st.spotsLeft, line: t });
  }
  return out;
}

export function buildKsmSlots(eds: KsmEdition[], today: string): Slot[] {
  return eds.filter(e => e.start >= today).map(e => ({
    key: `${e.unit}|${e.start}`,
    startDate: e.start,
    endDate: e.end,
    unit: e.unit === 'women' ? 'Women-only retreat' : 'Couples / co-ed retreat',
    price: null,
    currency: null,
    priceUnit: null,
    priceBasis: null,
    occupancy: null,
    availability: e.availability,
    availabilityText: e.text,
    spotsLeft: e.spotsLeft,
  }));
}

export function parseKsmContent(html: string, today: string): OfferContent {
  const root = visibleRoot(html);
  const post = root.querySelector('[data-elementor-type="wp-post"]') ?? root;
  const text = collapse(post.structuredText);
  const eds = parseKsmEditions(html).filter(e => e.start >= today);
  const days = Number(text.match(/(\d+)-day\s*\/\s*\d+-night/i)?.[1]) || 11;
  const earlyBird = text.match(/Early bird:\s*Book your spot before ([A-Za-z]+ \d{1,2})(?:st|nd|rd|th)? (20\d{2}) and get a EU (\d+) off/i);
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const datesLine = eds.length
    ? `Editions: ${eds.map(e => `${e.unit === 'women' ? 'women only' : 'couples / co-ed'} ${fmt(e.start)} to ${fmt(e.end)}${e.availability === 'limited' && e.spotsLeft ? ` (${e.spotsLeft} spots left)` : e.availability === 'sold_out' ? ' (sold out)' : ''}`).join('; ')}.`
    : 'Runs every year in May and June; the next dates are not published yet.';

  const summary = [
    `Kite Sisters' ${days}-day boutique kitesurf retreat through Morocco: from Marrakech airport to a countryside lodge near Essaouira (2 kite days, medina and an argan cooperative), one night in a Marrakech riad with a guided medina day, then 6 nights at an ecolodge on the Dakhla lagoon with 5 kite days and kite trips.`,
    `Coaching for all levels, beginner gear, all meals and ground transport are included; the domestic flight to Dakhla is not.`,
    `${datesLine} Prices on request${earlyBird ? `; early bird EUR ${earlyBird[3]} off when booked before ${earlyBird[1]} ${earlyBird[2]}` : ''}.`,
  ].join(' ');

  const incHead = post.querySelectorAll('h2, h3, h4, h5').find(h => /What is included/i.test(txt(h)) && !/not included/i.test(txt(h)));
  const incWidget = incHead?.closest('.elementor-element')?.nextElementSibling ?? null;
  const included = (incWidget?.querySelectorAll('li') ?? []).map(li => {
    const t = txt(li);
    const strong = txt(li.querySelector('strong, b')).replace(/:$/, '');
    return (t.match(/^([^:]{3,80}):/)?.[1] ?? (strong.length >= 3 && t.startsWith(strong) ? strong : t)).replace(/[.!]$/, '').trim();
  }).filter(Boolean);

  return {
    kind: 'tour',
    title: 'Kite Sisters Boutique Morocco Kitesurf Retreat',
    summary,
    continent: 'Africa',
    country: 'Morocco',
    region: 'Marrakech-Safi',
    spot: 'Essaouira',
    // map stops = the kite spots only; Marrakech (arrival + one riad night) would pin the tour 140 km inland
    itinerarySpots: [
      { name: 'Essaouira', country: 'Morocco', region: 'Marrakech-Safi', order: 1 },
      { name: 'Dakhla', country: 'Morocco', region: 'Dakhla-Oued Ed-Dahab', order: 2 },
    ],
    durationDays: days,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: /gear for beginners/i.test(text) || null,
    beginnerFriendly: true,
    includedServices: included,
    optionalServices: ['Companion package for non-kiters', 'Upgrade to a private bedroom', 'Gear rental for intermediate / advanced riders'],
    accommodation: 'riad in Marrakech, countryside lodge near Essaouira, ecolodge bungalows on the Dakhla lagoon',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: [],
    imageUrls: imageCandidates(html, KSM_MOROCCO_URL, null, 40).filter(u => !/logo|icon|favicon/i.test(u)),
    heroVideoUrl: null,
    sourceUrl: KSM_MOROCCO_URL,
    bookingUrl: KSM_MOROCCO_URL,
    sourceText: text,
  };
}

export async function fetchKsmSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const eds = parseKsmEditions(await page(KSM_MOROCCO_URL));
  if (eds.length === 0) throw new Error('kite-sisters-morocco: no "<...> Retreat: <dates>" lines found (layout changed?)');
  const slots = buildKsmSlots(eds, today);
  if (slots.length === 0) ctx?.note(`all listed editions are past (${eds.map(e => e.start).join(', ')}); next dates not published yet`);
  return slots;
}

export const kiteSistersMoroccoRetreat: OfferAdapter = {
  key: 'kite-sisters-morocco-retreat',
  name: 'Kite Sisters - Boutique Morocco Kitesurf Retreat (Marrakech, Essaouira, Dakhla)',
  kind: 'tour',
  operator: {
    name: 'Kite Sisters',
    websiteUrl: 'https://kite-sisters.com/',
    rootDomain: 'kite-sisters.com',
  },
  url: KSM_MOROCCO_URL,
  slotMethod: 'html_dates',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() {
    return parseKsmContent(await page(KSM_MOROCCO_URL), new Date().toISOString().slice(0, 10));
  },
  fetchSlots: ctx => fetchKsmSlots(new Date().toISOString().slice(0, 10), ctx),
};
