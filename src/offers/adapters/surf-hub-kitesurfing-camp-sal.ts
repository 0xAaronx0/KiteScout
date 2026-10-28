// ---------------------------------------------------------------------------
// Surf Hub Cabo Verde "Kitesurfing Camp", Santa Maria (Sal, Cape Verde) - a 7-night kite camp run by the Surf Hub
// watersports school: 8 hours of private kitesurf lessons (4 sessions) with IKO instructors and IKO qualification,
// bed and breakfast in a simple hotel 30 seconds from the ocean, airport transfers, a sailing trip, an island tour
// and alternative activities on no-wind days.
//
// Data path (checked 2026-10-28): ONE WordPress page https://www.surfhubcapeverde.com/kitesurfing-camp/ (Qode theme,
//   WPBakery rendered server-side; the WP REST copy /wp-json/wp/v2/pages/3656 holds raw shortcodes, so the HTML is
//   read). Yoast JSON-LD dateModified 2025-12-08. The "Kitesurfing Camp Highlights" list (included services), the
//   "Kitesurfing Skill level" list, "Instruction in ..." (languages), "Camp Facilities" (the hotel), and the price
//   caption h3 "Kitesurfing Camp Bed & Breakfast Accommodation" + span.qodef-st-caption
//   "1 Person 7 Nights 1,295€ - 2 Person 7 Nights 2,115€".
// Slots: undated (the caption has no dates or season), one per printed guest count, EUR, priceUnit 'package',
//   packageNights 7, normalised per person (2 persons: 1,057.50 pp, priceTotal 2,115; sharing a room is inferred).
//   GATE: the undated price is used only while the page was edited within the last 15 months (like
//   pensao-alcinda-santa-kite-sal.ts); otherwise fetchSlots returns [] with a note (price on request).
// Booking: "BOOK NOW" links to the contact page (form, WhatsApp, e-mail) -> 'on_request', instantBooking unset.
// robots.txt surfhubcapeverde.com (2026-10-28): Yoast block "User-agent: * / Disallow:" -> allowed.
// Images: served through the Optimole CDN (mld7tujf17wf.i.optimole.com/w:../h:../<original url>); the original
//   wp-content URL on the operator's own host is taken instead. Kite photos (2023/07 kite-*, all-camps-*) and the
//   hotel photos uploaded 2025-12 (Twin, Double, Kitchen, Living Room, External, Location); surf-camp photos skipped.
// Requests per run: content 1, slots 1.
// Doubts: the hotel is called "Misturod" on the page (probably a typo; not shown); whether the lesson gear is
//   included is not stated in the highlights (the program mentions "equipment rental", the meta description says
//   "Lessons, rentals and accommodations all included"), so gear is not listed as included. The same site sells
//   surf, wingfoil and yoga camps (not kite products, not listed).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, todayIso } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

export const SURF_HUB_URL = 'https://www.surfhubcapeverde.com/kitesurfing-camp/';
const NIGHTS = 7;
const FRESH_MONTHS = 15;

export interface SurfHubPrice { persons: number; nights: number; total: number }

/** "1 Person 7 Nights 1,295€ - 2 Person 7 Nights 2,115€" -> [{1,7,1295},{2,7,2115}] */
export function parseSurfHubPrices(caption: string): SurfHubPrice[] {
  const out: SurfHubPrice[] = [];
  for (const m of caption.matchAll(/(\d+)\s*Persons?\s*(\d+)\s*Nights?\s*(?:€\s*)?(\d{1,3}(?:[.,]\d{3})*|\d+)\s*€?/gi)) {
    const total = Number(m[3].replace(/[.,]/g, ''));
    if (total > 0) out.push({ persons: Number(m[1]), nights: Number(m[2]), total });
  }
  return out;
}

export function surfHubModified(html: string): string | null {
  return html.match(/"dateModified":"(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

/** An undated price counts while its page was edited within the last FRESH_MONTHS months. */
export function surfHubFresh(modified: string, today: string): boolean {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - FRESH_MONTHS);
  return modified >= d.toISOString().slice(0, 10);
}

function priceCaption(html: string): string {
  const root = parse(html);
  const head = root.querySelectorAll('h3.qodef-st-title').find(h => /Kitesurfing Camp/i.test(h.text) && /Accommodation/i.test(h.text));
  return collapse(head?.parentNode?.querySelector('.qodef-st-caption')?.text ?? '');
}

export function buildSurfHubSlots(prices: SurfHubPrice[]): Slot[] {
  return prices.map(p => ({
    key: `${p.persons}-person-${p.nights}-nights`,
    startDate: null,
    endDate: null,
    unit: `Kitesurfing camp, bed & breakfast, ${p.persons} ${p.persons === 1 ? 'person' : 'persons'}`,
    price: Math.round((p.total / p.persons) * 100) / 100,
    currency: 'EUR',
    priceUnit: 'package',
    priceBasis: 'person',
    occupancy: p.persons,
    availability: 'on_request',
    availabilityText: `${p.persons} Person ${p.nights} Nights EUR ${p.total.toLocaleString('en-US')}; booking by request (contact form)`,
    spotsLeft: null,
    priceTotal: p.persons > 1 ? p.total : null,
    packageNights: p.nights,
  }));
}

/** Optimole CDN URL -> the original upload on the operator's own host. */
export function unwrapOptimole(u: string): string {
  const m = u.match(/^https?:\/\/[a-z0-9]+\.i\.optimole\.com\/.*?\/(https?:\/\/.+)$/i);
  return (m ? m[1] : u).replace(/^http:\/\//, 'https://');
}

const listAfter = (root: ReturnType<typeof parse>, heading: RegExp): string[] => {
  const h = root.querySelectorAll('h3').find(e => heading.test(e.text));
  const ul = h?.nextElementSibling;
  return ul?.tagName === 'UL' ? ul.querySelectorAll('li').map(li => collapse(li.text)).filter(Boolean) : [];
};

export function parseSurfHubContent(html: string, today = todayIso()): OfferContent {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript')) el.remove();
  const highlights = listAfter(root, /Kitesurfing Camp Highlights/i);
  const levels = listAfter(root, /Kitesurfing Skill level/i).map(s => s.toLowerCase()).filter(s => ['beginner', 'intermediate', 'advanced'].includes(s));
  const facilities = root.querySelectorAll('h3').find(e => /^Camp Facilities$/i.test(collapse(e.text)))?.nextElementSibling;
  const facilitiesText = collapse(facilities?.text ?? '');
  const langLine = collapse(root.querySelectorAll('strong').map(s => s.text).find(t => /Instruction in/i.test(t)) ?? '');
  const LANGS: Record<string, string> = { english: 'en', french: 'fr', italian: 'it', portuguese: 'pt', spanish: 'es', german: 'de' };
  const hits = Object.entries(LANGS).filter(([n]) => new RegExp(n, 'i').test(langLine));
  const languages = hits.map(([, c]) => c);
  const langNames = hits.map(([n]) => n[0].toUpperCase() + n.slice(1));
  const prices = parseSurfHubPrices(priceCaption(html));
  const modified = surfHubModified(html);
  const fresh = !!modified && surfHubFresh(modified, today);
  const one = prices.find(p => p.persons === 1);
  const two = prices.find(p => p.persons === 2);
  const lessons = highlights.find(h => /kitesurf lessons/i.test(h)) ?? '8 hours of private kitesurf lessons';

  const summary = [
    `Surf Hub's kitesurfing camp in Santa Maria on Sal, Cape Verde: 7 nights with daily breakfast in a simple hotel about 30 seconds from the ocean and two minutes' walk from the town centre (all rooms with private bathroom), ${lessons.replace(/PRIVATE/, 'private')} with IKO instructors and an IKO qualification, airport transfers, a sailing trip, an island tour and other activities on days without wind.`,
    `Lessons are for beginners to advanced riders${langNames.length ? `, taught in ${langNames.join(', ').replace(/, ([^,]*)$/, ' and $1')}` : ''}; times follow the tide and forecast.`,
    one && fresh
      ? `The camp costs EUR ${one.total.toLocaleString('en-US')} for one person${two ? ` or EUR ${two.total.toLocaleString('en-US')} for two` : ''} for 7 nights (no dates printed); booking by request.`
      : 'The page prints an undated camp price last edited over a year ago, so the camp is priced on request.',
  ].join(' ');

  const seen = new Set<string>();
  const imageUrls = imageCandidates(html, SURF_HUB_URL, null, 80)
    .map(unwrapOptimole)
    .filter(u => /\/wp-content\/uploads\/20\d\d\/\d\d\/[^/]+\.jpe?g$/i.test(u) && !/surf-camp|logo|icon|sidearea/i.test(u))
    .filter(u => { const k = u.replace(/^.*\//, ''); if (seen.has(k)) return false; seen.add(k); return true; });

  return {
    kind: 'camp',
    title: 'Surf Hub Kitesurfing Camp, Sal',
    summary,
    continent: 'Africa',
    country: 'Cape Verde',
    region: 'Sal',
    spot: 'Santa Maria, Sal',
    itinerarySpots: [],
    durationDays: NIGHTS + 1,
    skillLevels: levels.length ? levels : ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: /equipment rental/i.test(collapse(root.text)),
    beginnerFriendly: true,
    includedServices: highlights.map(h => h.replace(/PRIVATE/, 'private')),
    optionalServices: ['Surf, wingfoil and SUP lessons', 'Kite equipment rental'],
    accommodation: 'simple hotel near the beach in Santa Maria, rooms with private bathroom (bed and breakfast)',
    mealPlan: 'breakfast',
    languages: languages.length ? languages : ['en'],
    rooms: [],
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: SURF_HUB_URL,
    bookingUrl: 'https://www.surfhubcapeverde.com/contact-surf-hub/',
    sourceText: [
      `highlights: ${highlights.join('; ')}`,
      `levels: ${levels.join(', ')}`,
      `languages: ${langLine}`,
      `facilities: ${facilitiesText}`,
      `price: ${priceCaption(html)} (page modified ${modified ?? 'unknown'})`,
    ].join('\n'),
  };
}

export async function fetchSurfHubSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const html = await fetchText(SURF_HUB_URL);
  const prices = parseSurfHubPrices(priceCaption(html));
  if (prices.length === 0) throw new Error('surf-hub: camp price caption not found (layout changed?)');
  const modified = surfHubModified(html);
  if (!modified || !surfHubFresh(modified, today)) {
    ctx?.note(`camp price is undated and the page was last edited ${modified ?? '(unknown)'}: offer stays "price on request"`);
    return [];
  }
  return buildSurfHubSlots(prices);
}

export const surfHubKitesurfingCampSal: OfferAdapter = {
  key: 'surf-hub-kitesurfing-camp-sal',
  name: 'Surf Hub Kitesurfing Camp, Sal',
  kind: 'camp',
  operator: {
    name: 'Surf Hub Cabo Verde',
    websiteUrl: 'https://www.surfhubcapeverde.com/',
    rootDomain: 'surfhubcapeverde.com',
    contactEmail: 'surfhubcv@gmail.com',
    phone: '+2385955794',
  },
  url: SURF_HUB_URL,
  slotMethod: 'price_table',
  liveAvailability: false,
  fetchBudget: 2,
  confidence: 'medium',
  async fetchContent() {
    return parseSurfHubContent(await fetchText(SURF_HUB_URL));
  },
  fetchSlots: (ctx: FetchContext) => fetchSurfHubSlots(todayIso(), ctx),
};
