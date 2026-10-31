// ---------------------------------------------------------------------------
// Lazy Kite School Surf House, Tarifa (Cadiz, Andalusia, Spain) - the kite school LazyKite Tarifa's own surf house in
// the centre of Tarifa, steps from Puerta de Jerez and a minute from El Balneario beach: a bright duplex with sea and
// Africa views, private, double, triple and quadruple rooms, a fully equipped kitchen and a street-level garage for
// kite and surf gear. The school (kite, wing and surf courses, camps, rental) is at Carril Playa, N-340 km 80.
//
// Data path (checked 2026-10-12): WordPress/Elementor, ONE page https://lazykiteschooltarifa.com/en/accommodation-tarifa/
//   slots    TablePress table #tablepress-31: header "Price / Night | Low (October / June) | Mid (July / September) |
//            High (August)", rows Private / Double / Triple / Quadruple Room, cells "40€"; the text above: "Price per
//            person per night. Our rooms are subject to availability. This will be confirmed after receiving your
//            request by email or phone. Prices include service and cleaning charges."
//   content  the same page (surf house text, FAQ: rooms, services, towels/bedding, garage, minimum two people for
//            shared rooms, cancellation policy; contact footer), hero photo from the Elementor section background.
//   photos   (2026-10-21) the accommodation page has a single house photo, so the school's own kitesurfing course page
//            https://lazykiteschooltarifa.com/en/kitesurfing-courses-tarifa/ adds Tarifa kite photos (private and group
//            lessons on the beach, boat-assisted lessons, the station at the beach, the group). Capped so that house
//            photo + course photos stay <= 10: the vision QC only sees the 10 largest, and the course originals are
//            much larger than the house photo, which must not be crowded out. The about-us page (staff portraits)
//            and the camp page (no house photos) are not used. Best effort: a failed course page only costs photos.
// Season months: "/" lists months ("Mid (July / September)" around "High (August)"), so the table prices June and
//   October (low), July and September (mid) and August (high); November-May are not in it.
// Year: the table has none and the page carries no date (WordPress REST says the page was last modified 2025-05-20,
//   checked once 2026-10-12, not fetched per run). The page is still the live price list and the house is operating in
//   2026 (Google review of 07/09/2026 on the page: "La casa estaba muy limpiada y muy bien ubicada"). Since 2026-10-31
//   (so the app can price the month a guest picks) each printed month is dated as its next occurrence that has not
//   ended yet, like punta-trettu / seven-beaufort (inferred year; the table prints months only): on 2026-10-31 that is
//   October 2026 and June-September 2027. Before, the slots carried the season label but no dates.
// No booking engine: contact form / e-mail / phone -> 'on_request'.
// robots.txt (2026-10-12): only /wp-admin/ disallowed (admin-ajax allowed).
// Requests per run: content 2 (accommodation page + course page for photos), slots 1 (memoised, shared with content).
// Parsed: 20 slots = room type x printed month ("double-room|low|2027-06", whole calendar month), EUR per person per
//   night, occupancy = beds in the room type (private 1, double 2, triple 3, quadruple 4), datePrecision 'month',
//   availability 'on_request'.
// Known limits: only one photo of the house itself on the whole site (WordPress media library checked 2026-10-21);
//   no address or map of the house (no spotCoords).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, detectCurrency, imageCandidates, iso, monthOf, parse, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://lazykiteschooltarifa.com';
export const LAZY_URL = `${SITE}/en/accommodation-tarifa/`;
/** the school's own course page: Tarifa kite photos (the accommodation page has one house photo only) */
export const LAZY_PHOTOS_URL = `${SITE}/en/kitesurfing-courses-tarifa/`;
/** the vision QC sees the 10 largest candidates; keep the total at that so the house photo always reaches it */
const LAZY_MAX_PHOTOS = 10;

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text split at block tags (script/style bodies dropped). */
export function lazyLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|article|header|footer|nav|table)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- pure parsers -------------------------------------------------------------------------------------
export interface LazySeason { key: string; label: string; months: string }
export interface LazyRate { room: string; season: LazySeason; amount: number; currency: string }

const OCCUPANCY: Record<string, number> = { private: 1, single: 1, double: 2, triple: 3, quadruple: 4 };
export const lazyOccupancy = (room: string): number | null => OCCUPANCY[room.toLowerCase().split(/\s+/)[0]] ?? null;

/** TablePress price table: header seasons "Low (October / June)", rows "Double Room | 25€ | 35€ | 45€". */
export function parseLazyRates(html: string): LazyRate[] {
  const table = html.match(/<table[^>]*class="[^"]*tablepress[^"]*"[\s\S]*?<\/table>/i)?.[0];
  if (!table) return [];
  const head = [...(table.match(/<thead[\s\S]*?<\/thead>/i)?.[0] ?? '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(m => clean(m[1].replace(/<[^>]+>/g, ' ')));
  const seasons: LazySeason[] = head.slice(1).map(h => {
    const m = h.match(/^(\w+)\s*\(([^)]*)\)/);
    return { key: keyPart(m?.[1] ?? h), label: m?.[1] ?? h, months: collapse(m?.[2] ?? '') };
  });
  const out: LazyRate[] = [];
  for (const tr of (table.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] ?? '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => clean(m[1].replace(/<[^>]+>/g, ' ')));
    if (cells.length < 2 || !cells[0]) continue;
    cells.slice(1).forEach((c, i) => {
      const amount = parseAmount(c);
      if (amount && seasons[i]) out.push({ room: cells[0], season: seasons[i], amount, currency: detectCurrency(c) ?? 'EUR' });
    });
  }
  return out;
}

/** The sentence block above the table ("Price per person per night. ..."). */
export function parseLazyPriceNote(html: string): string | null {
  return lazyLines(html).find(l => /^Price per person per night/i.test(l)) ?? null;
}

/** Calendar months a season header names ("October / June" -> [10, 6]). */
export function lazySeasonMonths(months: string): number[] {
  return (months.match(/[A-Za-z]+/g) ?? []).map(monthOf).filter((m): m is number => m !== null);
}

const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Next occurrence of a calendar month that has not ended on `today` (the table has no year). */
export function lazyMonthBand(month: number, today: string): { start: string; end: string } {
  let y = Number(today.slice(0, 4));
  if (iso(y, month, lastDay(y, month)) < today) y++;
  return { start: iso(y, month, 1), end: iso(y, month, lastDay(y, month)) };
}

export function buildLazySlots(rates: LazyRate[], note: string | null, today = todayIso()): Slot[] {
  const perPerson = !note || /per person/i.test(note);
  return rates.flatMap(r => lazySeasonMonths(r.season.months).map(month => {
    const band = lazyMonthBand(month, today);
    return {
      key: `${keyPart(r.room)}|${r.season.key}|${band.start.slice(0, 7)}`,
      startDate: band.start,
      endDate: band.end,
      unit: r.room,
      price: r.amount,
      currency: r.currency,
      priceUnit: 'per_night' as const,
      priceBasis: perPerson ? 'person' as const : 'room' as const,
      occupancy: lazyOccupancy(r.room),
      availability: 'on_request' as const,
      availabilityText: `${r.season.label} season (${r.season.months}); price table without year, applied to the next occurrence; rooms subject to availability, confirmed by email or phone`,
      spotsLeft: null,
      datePrecision: 'month' as const,
    };
  })).sort((x, y) => x.startDate.localeCompare(y.startDate) || x.key.localeCompare(y.key));
}

/** FAQ question -> answer pairs (Elementor accordion: question line followed by the answer line). */
export function parseLazyFaq(html: string): Array<{ q: string; a: string }> {
  const lines = lazyLines(html);
  const start = lines.findIndex(l => /^Frequently Asked Questions$/i.test(l));
  const out: Array<{ q: string; a: string }> = [];
  if (start < 0) return out;
  for (let i = start + 1; i < lines.length - 1; i++) {
    if (/^Still have questions\?/i.test(lines[i])) break;
    if (/\?$/.test(lines[i]) && !/\?$/.test(lines[i + 1])) out.push({ q: lines[i], a: lines[i + 1] });
  }
  return out;
}

export function lazyImages(html: string): string[] {
  const urls = [
    ...[...html.matchAll(/background-image:\s*url\(["']?(https:\/\/lazykiteschooltarifa\.com\/wp-content\/uploads\/[^"')]+)["']?\)/gi)].map(m => m[1]),
    ...[...html.matchAll(/<img[^>]+src="(https:\/\/lazykiteschooltarifa\.com\/wp-content\/uploads\/[^"]+)"/gi)].map(m => m[1]),
  ].filter(u => /\.(jpe?g|webp)$/i.test(u) && !/logo|gorra|diseno-sin-titulo|icon/i.test(u));
  // "DSC_6444-scaled.jpg" and its mobile copy "DSC_6444-scaled-1.webp" are the same photo
  const seen = new Set<string>();
  return urls.filter(u => {
    const k = u.replace(/-scaled(?:-\d+)?|-\d+x\d+|\.(?:jpe?g|webp)$/gi, '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Kite photos of the school's course page (graphics, logos, flags and screenshots dropped). */
export function lazyCoursePhotos(html: string): string[] {
  return imageCandidates(html, LAZY_PHOTOS_URL, null, 40)
    .filter(u => /^https:\/\/lazykiteschooltarifa\.com\/wp-content\/uploads\/[^?]+\.(?:jpe?g|webp)$/i.test(u))
    .filter(u => !/logo|gorra|diseno-sin-titulo|icon|bandera|screenshot/i.test(u));
}

/** House photo(s) first, then course photos, capped at LAZY_MAX_PHOTOS. */
export function lazyPhotoCandidates(houseHtml: string, courseHtml: string | null): string[] {
  const house = lazyImages(houseHtml);
  const out = [...house];
  for (const u of courseHtml ? lazyCoursePhotos(courseHtml) : []) {
    if (out.length >= LAZY_MAX_PHOTOS) break;
    const k = u.replace(/-scaled(?:-\d+)?|\.(?:jpe?g|webp)$/gi, '');
    if (!out.some(o => o.replace(/-scaled(?:-\d+)?|\.(?:jpe?g|webp)$/gi, '') === k)) out.push(u);
  }
  return out;
}

export function parseLazyContent(html: string, courseHtml: string | null = null): OfferContent {
  const lines = lazyLines(html);
  const intro = lines.filter(l => /Surf House|duplex/i.test(l) && l.length > 150);
  const faq = parseLazyFaq(html);
  const rates = parseLazyRates(html);
  const note = parseLazyPriceNote(html);
  const ans = (re: RegExp) => faq.find(f => re.test(f.q))?.a ?? null;
  const rooms: ContentRoom[] = [...new Set(rates.map(r => r.room))].map(room => ({
    name: room,
    description: `${room} in the LazyKite Surf House${lazyOccupancy(room) ? ` (${lazyOccupancy(room)} ${lazyOccupancy(room) === 1 ? 'person' : 'people'})` : ''}.`,
    features: rates.filter(r => r.room === room).map(r => `${r.season.label} season (${r.season.months}): EUR ${r.amount} per person per night`),
  }));
  const min = rates.length ? Math.min(...rates.map(r => r.amount)) : null;
  const max = rates.length ? Math.max(...rates.map(r => r.amount)) : null;
  const address = lines.find(l => /carril playa/i.test(l)) ?? null;

  const summary = [
    `The LazyKite Surf House is the kite school LazyKite Tarifa's own house in the centre of Tarifa, Spain, steps from Puerta de Jerez and a minute from El Balneario beach: a bright duplex with sea and Africa views and several balconies over the Strait and the castle.`,
    `It has private, double, triple and quadruple rooms, free Wi-Fi, a fully equipped kitchen, cleaning, towels and bedding, and a street-level garage for kite and surf gear; shared rooms are for groups of at least two booking together.`,
    `${min !== null ? `Prices run from EUR ${min} to ${max} per person per night by room type and season (June and October low, July and September mid, August high), confirmed on request; ` : ''}the school runs kite, wing and surf courses, camps and rental.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'LazyKite Surf House',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Tarifa town',
    spot: 'Tarifa',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'], // footer: kitesurf, wingfoil, surf courses and camps
    kiteLessons: /Kitesurf Courses in Tarifa/i.test(html),
    equipmentRental: />\s*Rental\s*</i.test(html),
    beginnerFriendly: true,
    includedServices: ['Cleaning', 'Towels and bedding', 'Free Wi-Fi', 'Fully equipped kitchen and lounge', 'Garage for kite and surf equipment'],
    optionalServices: ['Kitesurf courses (LazyKite Tarifa)', 'Wingfoil and surf courses', 'Kitesurf and surf camps', 'Equipment rental'],
    accommodation: 'surf house (duplex) of the kite school with private and shared rooms',
    mealPlan: 'self_catering',
    languages: [],
    rooms,
    imageUrls: lazyPhotoCandidates(html, courseHtml),
    heroVideoUrl: null,
    sourceUrl: LAZY_URL,
    bookingUrl: `${LAZY_URL}#contact`,
    sourceText: [
      `surf house: ${intro.join(' ')}`,
      `price note: ${note ?? '-'}`,
      `rates: ${rates.map(r => `${r.room} ${r.season.label} (${r.season.months}) ${r.amount} ${r.currency}`).join('; ')}`,
      `faq: ${faq.map(f => `${f.q} ${f.a}`).join(' | ')}`,
      `cancellation: ${ans(/cancellation/i) ?? '-'} ${lines.filter(l => /^Cancellation (with|between)/i.test(l)).join(' ')}`,
      `school: ${address ?? '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------------
export const lazyKiteSurfHouseTarifa: OfferAdapter = {
  key: 'lazy-kite-surf-house-tarifa',
  name: 'LazyKite Surf House Tarifa',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'LazyKite School Tarifa',
    websiteUrl: `${SITE}/`,
    rootDomain: 'lazykiteschooltarifa.com',
    contactEmail: 'info@lazykiteschooltarifa.com',
    phone: '+34678983986',
  },
  url: LAZY_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  confidence: 'medium', // year-less season table on a page last edited 2025
  async fetchContent(ctx) {
    const html = await page(LAZY_URL);
    let courseHtml: string | null = null;
    try { courseHtml = await page(LAZY_PHOTOS_URL); }
    catch (e) { ctx.note(`lazy-kite: photo page ${LAZY_PHOTOS_URL} failed (${(e as Error).message})`); }
    return parseLazyContent(html, courseHtml);
  },
  async fetchSlots() {
    const html = await page(LAZY_URL);
    const rates = parseLazyRates(html);
    if (rates.length === 0) throw new Error('lazy-kite-surf-house: TablePress room price table not found (layout changed?)');
    const undated = [...new Set(rates.filter(r => lazySeasonMonths(r.season.months).length === 0).map(r => r.season.label))];
    if (undated.length) throw new Error(`lazy-kite-surf-house: season header without a month name (${undated.join(', ')}; layout changed?)`);
    return buildLazySlots(rates, parseLazyPriceNote(html));
  },
};
