// ---------------------------------------------------------------------------
// Kitereizen - "The Mauritius Residency": a 7-night coaching week for intermediate to advanced kiters with King of the
// Air winner Marc Jacobs and Megaloop champion Ross-Dillon Player, at a private villa on the Bel Ombre coast (south
// Mauritius): daily pro coaching (one session a day, 6 hours in total), on-water support, Duotone test gear, breakfast,
// lunch and dinner by a private chef, an excursion, private shuttle for all transfers, daily video analysis.
// One base for the week -> KIND = 'camp'. Same organiser and store as kitereizen-kite-camp-my-hoa-phan-rang.ts
// (operator + krLines imported from there).
//
// Data path (checked 2026-10-21), LeadConnector (HighLevel) site with its own store:
//   slots    two sources, merged by start date:
//            (1) the camp page /en/mauritius: "Dates: 26 sept. - 03 oct. | 03 - 10 oct." (no year on the line; the
//                year comes from the page's header "September 2026", or from the line itself once it prints one) and
//                the price "The Residency: € 4.950,- (All-inclusive)";
//            (2) the store list /product-list, section "Mauritius (with Marc Jacobs and Ross-Dillon Player)": one
//                product per week ("October 3-10, 2026 €4950.00"; checked 2026-10-19 in the Vietnam fixture and again
//                2026-10-21). A store week gets 'available' (it can be bought), a page-only week 'on_request'.
//            One slot per future week, EUR per person (package, 7 nights). Past weeks are dropped (start before today).
//            On 2026-10-21 both 2026 weeks (26 Sep - 3 Oct, 3 - 10 Oct) are past -> 0 slots; the summary says the next
//            dates are not published yet. New 2027 weeks on either source are picked up automatically.
//   content  the camp page (inclusions, add-ons, not-included list, partner price).
// Conflicts on the page: "7 Nights. 6 Spots." / "Exclusive for 6 riders" vs "Only 9 spots available per week" -> no
//   spotsLeft. "Coaching and equipment are not included" sits under the partner option and refers to the partner.
// Flags: instantBooking yes (the "Claim your spot" buttons lead to the store's add-to-cart checkout, as for the Vietnam
//   camp; payment step not tested); liveAvailability no (no inventory read; the store's stock values are fixed).
// Location: the page says "Ultimate Comfort on the Bel Ombre Coast" and "minutes away from the lagoon and the iconic One
//   Eye break"; the villa is not named and no coordinates are printed -> spot 'Bel Ombre' for the geocoder, region
//   'Bel Ombre, Savanne' (Bel Ombre lies in Savanne district; no other adapter uses this place yet).
// Photos: the page body has one place photo (aerial of Le Morne); the other body images are the two coaches'
//   portraits and a gallery the site also labels "Sicilie" / "Lo Stagnone" / "europa" -> left out.
// robots.txt (2026-10-21): HTTP 200 with an empty body -> everything allowed.
// Requests per run: 2 (camp page + store list, memoised for content + slots).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse, parseAmount, parseRange, todayIso } from '../parse.js';
import { KR_OPERATOR, KR_PRODUCT_LIST_URL, KR_SITE, krLines } from './kitereizen-kite-camp-my-hoa-phan-rang.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

export const KRM_CAMP_URL = `${KR_SITE}/en/mauritius`;
const NIGHTS = 7;

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

export interface KrmWeek { start: string; end: string; price: number | null; currency: string; source: 'store' | 'page'; url: string | null; label: string }

const MONTH_YEAR = /^(january|february|march|april|may|june|july|august|september|october|november|december|januari|februari|maart|mei|juni|juli|augustus|oktober)\s+(20\d{2})$/i;

/** Weeks of the camp page's "Dates:" line ("26 sept. - 03 oct. | 03 - 10 oct."), year from the line or the page header. */
export function parseKrmPageWeeks(lines: string[]): Array<{ start: string; end: string; label: string }> {
  const header = lines.find(l => MONTH_YEAR.test(l));
  const fallbackYear = header ? Number(header.match(MONTH_YEAR)![2]) : undefined;
  const out: Array<{ start: string; end: string; label: string }> = [];
  for (const l of lines) {
    const m = l.match(/^(?:Dates?|Data|Datum)\s*:\s*(.+)$/i);
    if (!m) continue;
    for (const part of m[1].split('|').map(s => s.trim()).filter(Boolean)) {
      const r = parseRange(part.replace(/\./g, ' ').replace(/\s+/g, ' '), fallbackYear);
      if (r && !out.some(w => w.start === r.start)) out.push({ ...r, label: part });
    }
  }
  return out;
}

/** "The Residency: € 4.950,- (All-inclusive)" -> 4950 */
export function parseKrmPrice(lines: string[]): number | null {
  const l = lines.find(x => /^The Residency:\s*€/i.test(x));
  return l ? parseAmount(l.replace(/^The Residency:\s*€\s*/i, '').replace(/,-.*$/, '')) : null;
}

export function parseKrmPartner(lines: string[]): number | null {
  const l = lines.find(x => /^Partner upgrade:\s*\+\s*€/i.test(x));
  return l ? parseAmount(l.replace(/^Partner upgrade:\s*\+\s*€\s*/i, '').replace(/,-.*$/, '')) : null;
}

/** Products of the store list's "Mauritius ..." section: "October 3-10, 2026 €4950.00". */
export function parseKrmStoreWeeks(html: string): Array<{ start: string; end: string; price: number | null; url: string; label: string }> {
  const out: Array<{ start: string; end: string; price: number | null; url: string; label: string }> = [];
  for (const part of html.split(/class="ec-featured-list-heading">/).slice(1)) {
    const heading = part.slice(0, part.indexOf('<'));
    if (!/mauritius/i.test(heading)) continue;
    for (const m of part.matchAll(/<a href="(https:\/\/kitereizen\.nl\/product-details\/product\/[0-9a-f]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const text = collapse(parse(m[2]).text);
      const label = text.replace(/€\s?[\d.,]+.*$/, '').trim();
      const r = parseRange(label.replace(/,/g, ''));
      const price = text.match(/€\s?([\d.,]+)/)?.[1] ?? null;
      if (r && !out.some(o => o.start === r.start)) out.push({ ...r, price: price ? parseAmount(price) : null, url: m[1], label });
    }
  }
  return out;
}

export function mergeKrmWeeks(campHtml: string, storeHtml: string | null): KrmWeek[] {
  const lines = krLines(campHtml);
  const pagePrice = parseKrmPrice(lines);
  const weeks: KrmWeek[] = [];
  for (const s of storeHtml ? parseKrmStoreWeeks(storeHtml) : []) {
    weeks.push({ start: s.start, end: s.end, price: s.price ?? pagePrice, currency: 'EUR', source: 'store', url: s.url, label: s.label });
  }
  for (const p of parseKrmPageWeeks(lines)) {
    if (!weeks.some(w => w.start === p.start)) weeks.push({ start: p.start, end: p.end, price: pagePrice, currency: 'EUR', source: 'page', url: null, label: p.label });
  }
  return weeks.sort((a, b) => a.start.localeCompare(b.start));
}

export function buildKrmSlots(weeks: KrmWeek[], today: string): Slot[] {
  return weeks.filter(w => w.start >= today).map(w => ({
    key: w.start,
    startDate: w.start,
    endDate: w.end,
    unit: 'Rider place in the shared private villa',
    price: w.price,
    currency: w.price === null ? null : w.currency,
    priceUnit: w.price === null ? null : 'package',
    priceBasis: w.price === null ? null : 'person',
    occupancy: null,
    availability: w.source === 'store' ? 'available' : 'on_request',
    availabilityText: w.source === 'store' ? 'Listed in the Kitereizen online shop' : 'Dates on the camp page; book through "Claim your spot"',
    spotsLeft: null,
    packageNights: NIGHTS,
  }));
}

function listBetween(lines: string[], head: RegExp, stop: RegExp): string[] {
  const i = lines.findIndex(l => head.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < lines.length && !stop.test(lines[j]); j++) out.push(lines[j]);
  return out;
}

const NOT_HERE = /sicili|stagnone|itali|europa|marokk|dahkla|dakhla|duitsland|feldberg|workum|logo|vakantie|kamp|kitesurfschool|kitemobile/i;

/** Body photos before the "other trips" teasers, without coach portraits, logos and the reused Europe gallery. */
export function krmImages(html: string): string[] {
  const cut = html.search(/>\s*Andere reizen\s*</i);
  const body = html.slice(Math.max(0, html.indexOf('<body')), cut > 0 ? cut : html.length);
  const fileOf = (src: string) => src.split('/').pop() ?? src;
  const banned = new Set<string>();
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const alt = m[0].match(/\balt="([^"]*)"/i)?.[1] ?? '';
    const src = m[0].match(/\bsrc="([^"]+)"/i)?.[1] ?? '';
    if (src && NOT_HERE.test(alt)) banned.add(fileOf(src));
  }
  // coach portraits: the images from the one just before "The powerhouse" up to "The Sanctuary" (the coaches block)
  const coachFrom = body.search(/>\s*The powerhouse\s*</i);
  const coachTo = body.search(/>\s*The Sanctuary\s*</i);
  if (coachFrom > 0 && coachTo > coachFrom) {
    const imgs = [...body.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map(m => ({ at: m.index ?? 0, src: m[1] }));
    const before = imgs.filter(i => i.at < coachFrom).pop();
    for (const i of imgs) if ((before && i.at === before.at) || (i.at > coachFrom && i.at < coachTo)) banned.add(fileOf(i.src));
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    let src = m[0].match(/\bsrc="([^"]+)"/i)?.[1] ?? '';
    const inner = src.match(/\/u_(https?:\/\/.+)$/);
    if (inner) src = inner[1];
    const file = fileOf(src);
    if (!src || !/\.(jpe?g|png|webp)$/i.test(file) || banned.has(file) || seen.has(file) || /icons\//i.test(src)) continue;
    seen.add(file);
    out.push(src);
  }
  return out;
}

export function parseKrmContent(campHtml: string, weeks: KrmWeek[], today: string): OfferContent {
  const lines = krLines(campHtml);
  if (!lines.some(l => /Mauritius Residency/i.test(l))) throw new Error('kitereizen-mauritius: "The Mauritius Residency" not on the camp page (layout changed?)');
  const included = listBetween(lines, /^what.s included:?$/i, /^optional add-ons:?$/i);
  const optional = listBetween(lines, /^optional add-ons:?$/i, /^andere reizen$/i);
  const notIncluded = listBetween(lines, /^Not included:?$/i, /^Still unsure\??$/i);
  const price = parseKrmPrice(lines);
  const partner = parseKrmPartner(lines);
  const future = weeks.filter(w => w.start >= today);
  const past = weeks.filter(w => w.start < today);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtD = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;
  const span = (w: KrmWeek) => `${fmtD(w.start)} to ${fmtD(w.end)} ${w.end.slice(0, 4)}`;
  const priceText = price ? `EUR ${price.toLocaleString('en-US')} per rider, all-inclusive${partner ? `, plus EUR ${partner.toLocaleString('en-US')} for a non-coached partner` : ''}` : 'price on request';

  const summary = [
    'Dutch kite-travel organiser Kitereizen runs The Mauritius Residency, a 7-night coaching week for intermediate to advanced kiters with King of the Air winner Marc Jacobs and Megaloop champion Ross-Dillon Player, based at a private villa with ocean views on the Bel Ombre coast in south Mauritius, a few minutes from the lagoon and the One Eye wave.',
    'Daily pro coaching (6 hours over the week), on-water support by kite instructors, Duotone test gear, three meals a day by a private chef, an excursion, all transfers by private shuttle and daily video analysis are included; flights, insurance, spirits and own kite gear are not.',
    future.length
      ? `Weeks: ${future.map(span).join(' and ')}, ${priceText}.`
      : `The next dates are not published yet${past.length ? ` (last weeks: ${past.map(span).join(' and ')})` : ''}; ${priceText}.`,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Kitereizen The Mauritius Residency with Marc Jacobs and Ross-Dillon Player, Bel Ombre',
    summary,
    continent: 'Africa',
    country: 'Mauritius',
    region: 'Bel Ombre, Savanne',
    spot: 'Bel Ombre',
    itinerarySpots: [],
    durationDays: NIGHTS + 1,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: false,
    includedServices: included,
    optionalServices: optional.length ? optional : partner ? [`Partner or friend (+EUR ${partner})`] : [],
    accommodation: 'Private villa with panoramic ocean views on the Bel Ombre coast (max 6 guests per villa)',
    mealPlan: 'full_board',
    languages: ['nl', 'en'],
    rooms: [],
    imageUrls: krmImages(campHtml).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KRM_CAMP_URL,
    bookingUrl: future.find(w => w.url)?.url ?? KR_PRODUCT_LIST_URL,
    sourceText: [
      lines.slice(0, Math.max(0, lines.findIndex(l => /^andere reizen$/i.test(l)))).join('\n'),
      `not included: ${notIncluded.join(' | ')}`,
      `weeks: ${weeks.map(w => `${w.label} (${w.start}..${w.end}, ${w.source}, ${w.currency} ${w.price})`).join(' | ')}`,
    ].join('\n'),
  };
}

async function fetchWeeks(ctx?: Pick<FetchContext, 'note' | 'incomplete'>): Promise<{ camp: string; weeks: KrmWeek[] }> {
  const camp = await page(KRM_CAMP_URL);
  let store: string | null = null;
  try { store = await page(KR_PRODUCT_LIST_URL); } catch (e) { ctx?.incomplete(`store list ${KR_PRODUCT_LIST_URL}: ${(e as Error).message}`); }
  return { camp, weeks: mergeKrmWeeks(camp, store) };
}

export async function fetchKrmSlots(today: string, ctx?: Pick<FetchContext, 'note' | 'incomplete'>): Promise<Slot[]> {
  const { camp, weeks } = await fetchWeeks(ctx);
  if (!weeks.length) throw new Error('kitereizen-mauritius: no week on the camp page ("Dates:" line) or in the store (layout changed?)');
  if (parseKrmPrice(krLines(camp)) === null) ctx?.note('no "The Residency: € ..." price line on the camp page');
  const slots = buildKrmSlots(weeks, today);
  const past = weeks.filter(w => w.start < today);
  if (past.length) ctx?.note(`${past.length} past week(s) dropped (${past.map(w => w.start).join(', ')})`);
  if (!slots.length) ctx?.note('no future week published yet');
  return slots;
}

export const kitereizenMauritiusResidencyBelOmbre: OfferAdapter = {
  key: 'kitereizen-mauritius-residency-bel-ombre',
  name: 'Kitereizen The Mauritius Residency, Bel Ombre',
  kind: 'camp',
  operator: KR_OPERATOR,
  url: KRM_CAMP_URL,
  slotMethod: 'html_dates',
  instantBooking: true,
  fetchBudget: 3,
  async fetchContent(ctx) {
    const { camp, weeks } = await fetchWeeks(ctx);
    return parseKrmContent(camp, weeks, todayIso());
  },
  fetchSlots: ctx => fetchKrmSlots(todayIso(), ctx),
};
