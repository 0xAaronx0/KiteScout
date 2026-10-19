// ---------------------------------------------------------------------------
// Ölandkite "Progression Kitecamp", Färjestaden (Öland, Sweden) - the kite school's yearly progression weekend for
// riders who have done a course but are not yet independent: instructors coach over the long weekend, 3 nights in
// the school's Surf & Sleep Kitehouse (shared bedrooms, wood-fired hot tub) with breakfast buffet and dinners, max
// 6 participants. Kind 'camp'.
//
// Data path (checked 2026-10-19): WordPress, Swedish, ONE page /kitecamps/oland/ (dateModified 2026-03-20):
//   "PROGRESSION KITECAMP" / "14-17 maj 2026" / ... "I campet ingår boende 3 nätter på Surf & Sleep Kitehouse" /
//   "Pris 6.995 kr" / "Max 6 deltagare". The parser reads the date line under the heading (day range in one month,
//   or across two months, with a year) and keeps it only when it has not started.
//   Currency: the page prints "kr" only; SEK is inferred (Swedish site, Swedish phone numbers, Swish payment).
//   priceBasis 'person' inferred (a binding per-participant registration, "Max 6 deltagare"); priceUnit 'package',
//   packageNights from "boende N nätter".
//   The other camp on the page ("Kitecamp Kristihimmelsfärd", surf & sleep without coaching) is not this product.
// robots.txt olandkite.se (2026-10-19): Yoast default "Disallow:" (everything allowed). Our honest UA gets HTTP 200
//   (an earlier scratch fetch with another client got a "455 Security Incident" WAF page; not seen with our UA).
// Requests per run: 1 (content + slots share one memoised fetch).
// State 2026-10-19: the only date is 14-17 May 2026 (past) -> 0 slots; the summary says the 2027 date is not
//   published yet. The page calls it a recurring "success camp" and runs its yearly kick-off camp over the Ascension
//   (Kristi himmelsfärd) weekend; that the progression camp itself is yearly is inferred, so the summary says only
//   when it was held.
// Flags: registration by e-mail, paid by Swish after confirmation -> instantBooking false; liveAvailability false.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { imageCandidates, iso, parseAmount, todayIso } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import { blockLines } from './jaguaribe-lodge-fortim.js';

const SITE = 'https://olandkite.se';
export const OKP_URL = `${SITE}/kitecamps/oland/`;

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

const MANAD: Record<string, number> = {
  januari: 1, jan: 1, februari: 2, feb: 2, mars: 3, mar: 3, april: 4, apr: 4, maj: 5, juni: 6, jun: 6, juli: 7, jul: 7,
  augusti: 8, aug: 8, september: 9, sep: 9, oktober: 10, okt: 10, november: 11, nov: 11, december: 12, dec: 12,
};

export interface OkpCamp { start: string | null; end: string | null; dateText: string | null; price: number | null; nights: number | null; maxParticipants: number | null }

/** "14-17 maj 2026" or "30 maj - 2 juni 2027" -> ISO range. */
export function parseSvRange(text: string): { start: string; end: string } | null {
  const t = text.toLowerCase().replace(/[–—]/g, '-');
  let m = t.match(/(\d{1,2})\s*-\s*(\d{1,2})\s+([a-zåäö]+)\s+(20\d{2})/);
  if (m && MANAD[m[3]]) return { start: iso(+m[4], MANAD[m[3]], +m[1]), end: iso(+m[4], MANAD[m[3]], +m[2]) };
  m = t.match(/(\d{1,2})\s+([a-zåäö]+)\s*-\s*(\d{1,2})\s+([a-zåäö]+)\s+(20\d{2})/);
  if (m && MANAD[m[2]] && MANAD[m[4]]) return { start: iso(+m[5], MANAD[m[2]], +m[1]), end: iso(+m[5], MANAD[m[4]], +m[3]) };
  return null;
}

export function parseOkpCamp(html: string): OkpCamp {
  const lines = blockLines(html);
  const i = lines.findIndex(l => /^PROGRESSION KITECAMP$/i.test(l));
  const empty: OkpCamp = { start: null, end: null, dateText: null, price: null, nights: null, maxParticipants: null };
  if (i < 0) return empty;
  const block = lines.slice(i + 1, i + 14);
  const dateLine = block.slice(0, 2).find(l => parseSvRange(l)) ?? null;
  const range = dateLine ? parseSvRange(dateLine) : null;
  const text = block.join('\n');
  const price = text.match(/Pris\s*([\d.,\s]+)\s*kr/i);
  const nights = text.match(/boende\s*(\d+)\s*nätter/i);
  const max = text.match(/Max\s*(\d+)\s*deltagare/i);
  return {
    start: range?.start ?? null,
    end: range?.end ?? null,
    dateText: dateLine,
    price: price ? parseAmount(price[1].trim()) : null,
    nights: nights ? Number(nights[1]) : null,
    maxParticipants: max ? Number(max[1]) : null,
  };
}

export function buildOkpSlots(c: OkpCamp, today: string): Slot[] {
  if (!c.start || !c.end || c.start < today) return [];
  return [{
    key: c.start,
    startDate: c.start,
    endDate: c.end,
    unit: `Progression camp: ${c.nights ?? 3} nights in the Surf & Sleep Kitehouse (shared room) + coaching`,
    price: c.price,
    currency: c.price !== null ? 'SEK' : null, // "kr" on a Swedish site (inferred, see header)
    priceUnit: c.price !== null ? 'package' : null,
    priceBasis: c.price !== null ? 'person' : null,
    occupancy: 1,
    availability: 'on_request',
    availabilityText: `${c.price !== null ? `SEK ${c.price} ("${c.price.toLocaleString('sv-SE')} kr")` : 'price on request'}; registration by e-mail, max ${c.maxParticipants ?? 6} participants, first come first served`,
    spotsLeft: null,
    ...(c.nights ? { packageNights: c.nights } : {}),
  }];
}

const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function parseOkpContent(html: string, today: string): OfferContent {
  const lines = blockLines(html);
  const c = parseOkpCamp(html);
  const nights = c.nights ?? 3;
  const year = c.start ? Number(c.start.slice(0, 4)) : null;
  const when = c.start && c.end ? `${Number(c.start.slice(8, 10))}-${Number(c.end.slice(8, 10))} ${MONTH_EN[Number(c.start.slice(5, 7)) - 1]}${c.end.slice(5, 7) !== c.start.slice(5, 7) ? ` to ${MONTH_EN[Number(c.end.slice(5, 7)) - 1]}` : ''}` : null;
  const dates = c.start && c.start >= today
    ? `Next camp: ${when} ${year}.`
    : `${year ? `Held in ${year} over the Ascension long weekend (${when}); the ${year + 1} date is not yet published` : 'The next date is not yet published'}.`;
  const summary = [
    'Ölandkite, a kite school on the Swedish island of Öland, runs a yearly Progression Kitecamp for riders who have taken a course but are not yet independent: its instructors coach them over a long weekend towards riding on their own.',
    `The camp includes ${nights} nights in the school's Surf & Sleep Kitehouse near Färjestaden (shared bedrooms, wood-fired hot tub) with breakfast buffet and dinners; lunch is not included and guests bring their own bed linen.`,
    `${c.price ? `The price is ${c.price.toLocaleString('en-US')} Swedish kronor per participant, ` : ''}max ${c.maxParticipants ?? 6} participants, registration by e-mail. ${dates}`,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Ölandkite Progression Kitecamp, Öland',
    summary,
    continent: 'Europe',
    country: 'Sweden',
    region: 'Färjestaden, Öland',
    spot: 'Färjestaden',
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: true,
    equipmentRental: null,
    beginnerFriendly: false, // for riders who already took a course
    includedServices: [
      `${nights} nights in the Surf & Sleep Kitehouse (shared bedroom, wood-fired hot tub)`,
      'Breakfast buffet and dinners (non-alcoholic drinks)',
      'Coaching by the school\'s instructors over the weekend',
    ],
    optionalServices: [],
    accommodation: 'shared bedrooms in the school\'s kite house',
    mealPlan: 'half_board',
    languages: ['sv'],
    rooms: [],
    imageUrls: imageCandidates(html, OKP_URL)
      .filter(u => /\.(jpe?g|png|webp)$/i.test(u) && !/logo/i.test(u))
      .filter((u, _, all) => /-scaled\./.test(u) || !all.includes(u.replace(/(\.\w+)$/, '-scaled$1'))) // keep the 2560 px copy
      .slice(0, 15),
    heroVideoUrl: null,
    sourceUrl: OKP_URL,
    bookingUrl: OKP_URL,
    sourceText: [lines.slice(0, 64).join('\n'), `parsed: ${JSON.stringify(c)}`].join('\n'),
  };
}

export async function fetchOkpSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const c = parseOkpCamp(await page(OKP_URL));
  if (!c.start) { ctx?.note('olandkite: no dated "PROGRESSION KITECAMP" on the page (not published yet?)'); return []; }
  const slots = buildOkpSlots(c, today);
  if (!slots.length) ctx?.note(`the listed camp (${c.dateText}) is past; next date not published yet`);
  return slots;
}

export const olandkiteProgressionKitecampFarjestaden: OfferAdapter = {
  key: 'olandkite-progression-kitecamp-farjestaden',
  name: 'Ölandkite Progression Kitecamp, Öland',
  kind: 'camp',
  operator: {
    name: 'Ölandkite',
    websiteUrl: SITE,
    rootDomain: 'olandkite.se',
    contactEmail: 'info@olandkite.se',
    phone: '+46 73 934 84 67',
  },
  url: OKP_URL,
  slotMethod: 'html_dates',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 1,
  async fetchContent() { return parseOkpContent(await page(OKP_URL), todayIso()); },
  fetchSlots: ctx => fetchOkpSlots(todayIso(), ctx),
};
