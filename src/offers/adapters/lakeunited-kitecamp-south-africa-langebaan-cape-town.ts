// ---------------------------------------------------------------------------
// LakeUnited Kitecamp South Africa - Langebaan & Cape Town (Western Cape, South Africa): the Austrian kite school's
// two-week road trip for advanced riders (VDWS level 5, upwind riding required). Week 1 in villas above the Langebaan
// lagoon (Shark Bay), week 2 in beach apartments at Blouberg near Cape Town; the group drives between the two bases in
// shared rental cars picked up at Cape Town airport. Guiding, supervision and workshops (jumps, kiteloops, wave), no
// classic lessons. A separate product from LakeUnited's Djerba and Norway camps (lakeunited-djerba.ts, whose Elementor
// helpers this adapter imports).
//
// Kind 'tour' (two bases and a drive between them; the operator calls it a "camp"). itinerarySpots: Langebaan (order 1),
// Cape Town (order 2, the Blouberg beach); region 'Western Cape' as in the other Langebaan / Cape Town adapters.
//
// Data path (checked 2026-10-21): ONE page, /en/portfolio/kitecamp-southafrica-capetown (WordPress + Elementor,
//   server-rendered).
//   slots    the dated camp is an Elementor feature-list item ("05.12. - 19.12.2026 / Kitecamp for advanced kiters",
//            parsed with campWeeks from lakeunited-djerba.ts, so a 2027 edition added as a new item is picked up), the
//            price is the "Bestseller" box ("South Africa package in a double room / € 2.570,- / Including overnight
//            stay in a double room, guiding, supervision. Excluding travel, transfers, meals and equipment rental.").
//            One slot per future camp date, unit 'Double room', EUR, priceUnit 'package', packageNights 13 (the service
//            tab: "13 nights accommodation"), availability 'on_request' (inquiry -> non-binding booking link).
//   content  the same page (service tab, accommodation and conditions sections, Elementor gallery).
// Duration: the dates span 15 days (5-19 Dec) but the service tab sells 13 nights; durationDays = the printed date span
//   (15), packageNights = 13 on the slot. Single room: offered, price only with the booking link.
// Price basis: "per person" is not printed next to EUR 2,570; inferred (camp package, "double room"), as on Djerba.
// robots.txt www.lakeunited.com (2026-10-21): only /wp-admin/ and one plugin JSON disallowed.
// Requests per run: 1 (content + slots share one memoised page fetch).
// Flags: liveAvailability no (page text), instantBooking no (inquiry form, then a non-binding booking link by mail).
// Helpers imported: campWeeks / visibleRoot (Djerba), parseLunService (Norway: the Including / Excluding items).
// Note: the Norway adapter's parseLunPrice is NOT reused: on this page its trailing look-ahead backtracks to "€ 2"
//   (the sentence after the price ends in "supervision." before any "rental"), so this file has its own price parser.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, daysInclusive, detectCurrency, imageCandidates, parseAmount, todayIso, type HTMLElement } from '../parse.js';
import { upscaleCdnUrl } from '../../lib/images.js';
import type { FetchContext, ItinerarySpot, OfferAdapter, OfferContent, Slot } from '../types.js';
import { campWeeks, visibleRoot, type CampWeek } from './lakeunited-djerba.js';
import { parseLunService } from './lakeunited-snowkitecamp-norway-voringsfoss.js';

export const LUSA_URL = 'https://www.lakeunited.com/en/portfolio/kitecamp-southafrica-capetown';

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// --- pure parsers -----------------------------------------------------------------------------
export interface LusaPrice { amount: number; currency: string; room: string | null; label: string }

/** The "Bestseller" box: "South Africa package in a double room € 2.570,-". */
export function parseLusaPrice(text: string): LusaPrice | null {
  const m = text.match(/Bestseller\s+([^€]{0,80}?)\s*((?:€|EUR)\s*\d{1,3}(?:[.,]\d{3})*(?:,\d{2})?)(?:,-)?/i);
  if (!m) return null;
  const amount = parseAmount(m[2]);
  const currency = detectCurrency(m[2]);
  const room = m[1].match(/in an?\s+(single|double|triple)\s+room/i)?.[1] ?? null;
  return amount && currency ? { amount, currency, room: room ? `${cap(room.toLowerCase())} room` : null, label: collapse(m[1]) } : null;
}

/** Service tab: "13 nights accommodation in a double or single room in a two-room apartment (...)". */
export function parseLusaNights(text: string): { nights: number | null; stay: string | null } {
  const m = text.match(/(\d{1,2})\s+nights\s+accommodation\s+([^.]*)\./i);
  return m ? { nights: Number(m[1]), stay: collapse(`${m[1]} nights accommodation ${m[2]}`) } : { nights: null, stay: null };
}

export function buildLusaSlots(weeks: CampWeek[], price: LusaPrice | null, nights: number | null, cta: string, today: string): Slot[] {
  const out: Slot[] = [];
  const seen = new Set<string>();
  for (const w of weeks) {
    if (seen.has(w.start) || w.start < today) continue;
    seen.add(w.start);
    // the box prices the two-week camp; a one-week date (if ever added) is not covered by it
    const priced = price && daysInclusive(w.start, w.end) >= 14;
    out.push({
      key: w.start,
      startDate: w.start,
      endDate: w.end,
      unit: price?.room ?? 'Double room',
      price: priced ? price!.amount : null,
      currency: priced ? price!.currency : null,
      priceUnit: 'package',
      priceBasis: 'person', // inferred, see header
      occupancy: 2,
      availability: 'on_request',
      availabilityText: `${cta} (non-binding inquiry)${w.label ? `; ${w.label}` : ''}`,
      spotsLeft: null,
      packageNights: nights,
    });
  }
  return out;
}

function ctaOf(root: HTMLElement): string {
  const ctas = root.querySelectorAll('a[href*="kitecamps-request"]').map(a => txt(a)).filter(Boolean);
  return ctas.find(c => /send request/i.test(c)) ?? ctas[0] ?? 'Send request';
}

export function parseLusaSlots(html: string, today: string): { slots: Slot[]; weeks: CampWeek[]; hiddenWeeks: string[] } {
  const { root, hidden } = visibleRoot(html);
  const weeks = campWeeks(root);
  const text = txt(root);
  const slots = buildLusaSlots(weeks, parseLusaPrice(text), parseLusaNights(text).nights, ctaOf(root), today);
  return { slots, weeks, hiddenWeeks: hidden.flatMap(h => campWeeks(h).map(w => w.raw)) };
}

export const LUSA_STOPS: ItinerarySpot[] = [
  { name: 'Langebaan', country: 'South Africa', region: 'Western Cape', order: 1 },
  { name: 'Cape Town', country: 'South Africa', region: 'Western Cape', order: 2 },
];

/** Photos of this camp: South Africa / Cape Town / Langebaan / Blouberg / the two lodgings (no team portraits, no
 *  photos of other LakeUnited camps from the "more camps" teasers, no restaurant shots, no event photos). */
export function lusaImages(html: string, root: HTMLElement): string[] {
  const gallery = root.querySelectorAll('[data-thumbnail]').map(e => upscaleCdnUrl(new URL(e.getAttribute('data-thumbnail')!, LUSA_URL).toString()));
  const all = [...imageCandidates(html, LUSA_URL, null, 60), ...gallery].map(u => upscaleCdnUrl(u));
  const out: string[] = [];
  for (const u of all) {
    if (!/\/wp-content\/uploads\//.test(u)) continue;
    if (!/suedafrika|kapstadt|capetown|blouberg|langebaan|shark-bay|pinguine/i.test(u)) continue;
    if (/[-_]Team[-_.]|logo|icon|abendessen|kulinarik|gemuese|lokal-in|red-bull|header-/i.test(u)) continue;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export function parseLusaContent(html: string, today = todayIso()): OfferContent {
  const { root } = visibleRoot(html);
  const post = root.querySelector('[data-elementor-type="wp-post"]') ?? root;
  const text = txt(post);
  const weeks = campWeeks(root);
  const future = weeks.filter(w => w.start >= today);
  const price = parseLusaPrice(text);
  const { nights, stay } = parseLusaNights(text);
  const service = parseLunService(post); // Including / Excluding list items of the service tab
  const day = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const span = weeks[0] ? daysInclusive(weeks[0].start, weeks[0].end) : null;
  const vdws = text.match(/VDWS Level (\d)/i)?.[1] ?? null;

  const summary = [
    'LakeUnited, an Austrian kite school, runs a two-week kite trip in the Western Cape for advanced riders: the first week in villas above the shallow, flat-water Langebaan lagoon, the second week in beach apartments at Blouberg near Cape Town, where the south-easterly "Cape Doctor" blows about 20-45 knots over waves.',
    `The group drives between the two bases in shared rental cars from Cape Town airport; the coaches provide guiding, supervision and workshops on jumps, kiteloops and wave riding rather than classic lessons, and riders must reliably ride upwind${vdws ? ` (VDWS level ${vdws})` : ''}.`,
    `${price ? `The package costs ${price.currency} ${price.amount.toLocaleString('en-US')} in a double room` : 'The package price is on the camp page'}${nights ? ` for ${nights} nights` : ''}; flights, transfers, meals and gear rental are extra.`,
    future.length
      ? `Next camp: ${future.map(w => `${day(w.start)} to ${day(w.end)} ${w.end.slice(0, 4)}`).join(', ')}; booking is by non-binding request.`
      : weeks.length ? `The published camp (${weeks[0].start.slice(0, 4)}) is over; the next dates are not published yet.` : 'Booking is by non-binding request.',
  ].join(' ');

  return {
    kind: 'tour',
    title: 'LakeUnited Kitecamp South Africa: Langebaan and Cape Town',
    summary,
    continent: 'Africa',
    country: 'South Africa',
    region: 'Western Cape',
    spot: 'Langebaan',
    itinerarySpots: LUSA_STOPS,
    durationDays: span ?? (nights ? nights + 1 : 15),
    skillLevels: ['advanced'],
    kiteLessons: false, // "Supervision is not coaching or traditional kite lessons"
    equipmentRental: /equipment for rent|kite equipment can be booked/i.test(text),
    beginnerFriendly: false,
    includedServices: [
      ...(stay ? [stay] : []),
      ...service.including,
      'Workshops on jump technique, kiteloops and wave kiting (depending on wind)',
    ],
    optionalServices: [
      'Kite equipment rental (kites and boards: Flysurfer, Core, Ozone, Duotone)',
      'Single room in the shared apartment',
      'Travel and cancellation insurance',
    ],
    accommodation: 'Villas above the Langebaan lagoon (Shark Bay), then beach apartments in a hotel complex at Blouberg, Cape Town; double or single rooms in two-room apartments with kitchen',
    mealPlan: 'self_catering',
    languages: ['de', 'en'],
    rooms: [
      { name: 'Double room', description: 'Room for two in a two-room apartment (shared kitchen, lounge and bathroom); single beds in Langebaan', features: ['Shared kitchen', 'Sea view'] },
      { name: 'Single room', description: 'Room for one in a two-room apartment (shared kitchen, lounge and bathroom)', features: ['Shared kitchen'] },
    ],
    imageUrls: lusaImages(html, root).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: LUSA_URL,
    bookingUrl: root.querySelector('a[href*="kitecamps-request"]')?.getAttribute('href') ?? LUSA_URL,
    sourceText: [
      text,
      `parsed: dates ${weeks.map(w => `${w.start}..${w.end}`).join(', ')}; price ${price ? `${price.currency} ${price.amount} (${price.label})` : 'none'}; ${nights ?? '?'} nights; excluding ${service.excluding.join(', ')}`,
    ].join('\n'),
  };
}

export async function fetchLusaSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const html = await page(LUSA_URL);
  const { slots, weeks, hiddenWeeks } = parseLusaSlots(html, today);
  if (weeks.length === 0) throw new Error('lakeunited-south-africa: no dated camp found (page layout changed?)');
  if (hiddenWeeks.length) ctx?.note(`dates hidden on the page (not emitted): ${hiddenWeeks.join('; ')}`);
  if (slots.length === 0) ctx?.note(`the published camp date(s) ${weeks.map(w => w.raw).join(', ')} are past; next edition not published`);
  else if (slots.some(s => s.price === null)) ctx?.note('Bestseller price not parsed or not a two-week date: slot(s) without price');
  return slots;
}

export const lakeunitedKitecampSouthAfricaLangebaanCapeTown: OfferAdapter = {
  key: 'lakeunited-kitecamp-south-africa-langebaan-cape-town',
  name: 'LakeUnited - Kitecamp South Africa (Langebaan & Cape Town)',
  kind: 'tour',
  operator: {
    name: 'LakeUnited',
    websiteUrl: 'https://www.lakeunited.com/',
    rootDomain: 'lakeunited.com',
  },
  url: LUSA_URL,
  slotMethod: 'html_dates',
  instantBooking: false, // inquiry form, then a non-binding booking link by mail
  fetchBudget: 2,
  async fetchContent() {
    return parseLusaContent(await page(LUSA_URL), todayIso());
  },
  fetchSlots: ctx => fetchLusaSlots(todayIso(), ctx),
};
