// ---------------------------------------------------------------------------
// Airzone Kitesurf School Kite/Wing Camp, Rangiputa (Karikari Peninsula, Northland, New Zealand) - the British-run
// school's winter base in the Far North: one to four weeks in shared self-catering accommodation at kite camp, a three
// day kitesurfing or wing course (or supervised gear hire for riders), all training, equipment hire and camp
// activities. Kind 'camp'. The fast-track IKO instructor course (12 weeks) is a separate product and NOT built here.
//
// Data path (checked 2026-10-19): WordPress (Yoast), server-rendered.
//   slots    /kitesurf-in-new-zealand/ "Kite/Wing Camp prices": "One week - $1495", "Two weeks - $2985",
//            "Three weeks - $4200", "Four weeks - $5861" -> 4 undated slots, priceUnit 'package', packageNights
//            7/14/21/28. Currency: the camp page prints only "$"; the operator's instructor-course page on the same
//            site states "Our prices above are in NZ$" -> NZD (inferred for the camp page, consistent with the NZ
//            phone number and location). priceBasis 'person' is inferred: "Camp prices are based on shared self
//            catering accommodation" (a bed in shared accommodation per guest). Supplements (+$50/night 20 Dec -
//            12 Jan and holiday weekends, single supplement $500/week) are text in availabilityText.
//            Availability 'on_request': booking by e-mail / phone, no engine, no dates.
//   season / year evidence: the camp page has no year ("Nov and April each year" on Facebook, "each UK winter");
//            the operator's dated IKO ATC/ITC courses at the same base (/become-an-iko-instructor/: 7-11 Dec 2026,
//            14-18 Dec 2026, 22-27 Feb 2027, 1-5 Mar 2027, "The course will be at our base in Rangiputa") prove the
//            2026/27 season. fetchSlots re-reads that page and notes when no future course date is printed.
//   content  the camp page (text, photos) + the instructor page (base location "Rangiputa on the Karikari
//            Peninsula", season evidence).
// robots.txt (2026-10-19): Yoast "User-agent: * Disallow:" (empty) -> everything allowed.
// Requests per run: 2 (both pages memoised across content + slots).
// Known limits / doubts: season months: the site says "between Nov and April"; the research note said Nov-May - we
//   follow the site. No spotCoords (none on the site). The wing camp shares the price list with the kite camp; one
//   listing covers both ("Kite/Wing Camp prices").
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, monthOf, parse, parseAmount, todayIso, type HTMLElement } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kitesurfnz.com';
export const AIRZONE_CAMP_URL = `${SITE}/kitesurf-in-new-zealand/`;
export const AIRZONE_IKO_URL = `${SITE}/become-an-iko-instructor/`;
const CURRENCY = 'NZD';

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

function visible(html: string): HTMLElement {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, iframe, header, footer, nav')) el.remove();
  return root;
}
function lines(html: string): string[] {
  return visible(html).structuredText.split('\n').map(s => collapse(s)).filter(Boolean);
}

// --- pure parsers ------------------------------------------------------------------------------
export interface AirzonePrice { weeks: number; amount: number }
export interface AirzoneCamp {
  prices: AirzonePrice[];
  /** "$50 per night" peak supplement and its window as printed */
  peakSupplement: { amount: number; text: string } | null;
  singleSupplementPerWeek: number | null;
}

const WEEK_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/** "One week - $1495" ... "Four weeks - $5861" + the supplements under "Kite/Wing Camp prices". */
export function parseAirzoneCamp(html: string): AirzoneCamp {
  const t = lines(html).join('\n').replace(/[–—]/g, '-');
  const prices: AirzonePrice[] = [];
  for (const m of t.matchAll(/\b(one|two|three|four|five|six|\d)\s+weeks?\s*-\s*(?:NZ)?\$\s?(\d[\d,.]*)/gi)) {
    const weeks = WEEK_WORDS[m[1].toLowerCase()] ?? Number(m[1]);
    const amount = parseAmount(m[2]);
    if (weeks > 0 && amount && !prices.some(p => p.weeks === weeks)) prices.push({ weeks, amount });
  }
  prices.sort((a, b) => a.weeks - b.weeks);
  const peak = t.match(/supplement of (?:NZ)?\$\s?(\d[\d,]*) per night applies ([^\n]*?)\.(?:\s|$)/i);
  const single = t.match(/single supplement (?:NZ)?\$\s?(\d[\d,]*) per week/i);
  return {
    prices,
    peakSupplement: peak ? { amount: parseAmount(peak[1]) ?? 0, text: collapse(peak[2]) } : null,
    singleSupplementPerWeek: single ? parseAmount(single[1]) : null,
  };
}

export interface AirzoneCourseDate { start: string; end: string; label: string }

/** Dated IKO courses on the instructor page ("7th to 11th December 2026", "22nd to 27th February 2027"). */
export function parseAirzoneCourseDates(html: string): AirzoneCourseDate[] {
  const t = lines(html).join('\n');
  const out: AirzoneCourseDate[] = [];
  const re = /(\d{1,2})(?:st|nd|rd|th)?(?:\s+([A-Z][a-z]+))?\s+to\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Z][a-z]+)\s+(20\d{2})/g;
  for (const m of t.matchAll(re)) {
    const endMonth = monthOf(m[4]);
    const startMonth = m[2] ? monthOf(m[2]) : endMonth;
    if (!endMonth || !startMonth) continue;
    const y = Number(m[5]);
    const start = iso(startMonth > endMonth ? y - 1 : y, startMonth, Number(m[1]));
    const end = iso(y, endMonth, Number(m[3]));
    if (!out.some(d => d.start === start)) out.push({ start, end, label: m[0] });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export function buildAirzoneSlots(c: AirzoneCamp): Slot[] {
  const extras = [
    c.peakSupplement ? `+NZD ${c.peakSupplement.amount} per night ${c.peakSupplement.text}` : null,
    c.singleSupplementPerWeek ? `single supplement NZD ${c.singleSupplementPerWeek} per week (if available)` : null,
  ].filter(Boolean).join('; ');
  return c.prices.map(p => ({
    key: `${p.weeks}w`,
    startDate: null,
    endDate: null,
    unit: `${p.weeks} week${p.weeks > 1 ? 's' : ''}, shared self-catering accommodation + course / gear hire`,
    price: p.amount,
    currency: CURRENCY,
    priceUnit: 'package' as const,
    priceBasis: 'person' as const,
    occupancy: 1,
    availability: 'on_request' as const,
    availabilityText: `NZD ${p.amount} for ${p.weeks} week${p.weeks > 1 ? 's' : ''} at kite camp (season November to April, any dates; booking by e-mail or phone)${extras ? `; ${extras}` : ''}`,
    spotsLeft: null,
    packageNights: p.weeks * 7,
  }));
}

function airzoneImages(html: string): string[] {
  return imageCandidates(html, AIRZONE_CAMP_URL)
    // screenshots of social posts and the partner operator's (Water Nomads) photo are not camp photos
    .filter(u => !/screenshot|water-nomads|C6B47597/i.test(u));
}

export interface AirzonePages { camp: string; iko: string }

export function parseAirzoneContent(p: AirzonePages, today: string): OfferContent {
  const c = parseAirzoneCamp(p.camp);
  const courses = parseAirzoneCourseDates(p.iko).filter(d => d.end >= today);
  const one = c.prices.find(x => x.weeks === 1);
  const four = c.prices.find(x => x.weeks === 4);
  const seasonEvidence = courses.length
    ? ` The school's dated instructor courses at the same base (${courses[0].start.slice(0, 7)} to ${courses[courses.length - 1].end.slice(0, 7)}) confirm the coming season.`
    : '';
  const summary = [
    `Airzone Kitesurf School runs kitesurf and wing foil camps from its base in Rangiputa on the Karikari Peninsula in the Far North of New Zealand, with flat water for learning and freestyle and wave beaches nearby; the school is there from November to April each year.`,
    `A camp week includes shared self-catering accommodation and a three-day kitesurfing or wing course (or supervised equipment hire for riders), with all training, equipment hire and camp activities; beginners get in-water coaching, improvers coaching from transitions to first jumps.`,
    one ? `Prices: NZD ${one.amount.toLocaleString('en-US')} for one week${four ? ` up to NZD ${four.amount.toLocaleString('en-US')} for four weeks` : ''}${c.singleSupplementPerWeek ? `, single supplement NZD ${c.singleSupplementPerWeek} per week` : ''}${c.peakSupplement ? `, NZD ${c.peakSupplement.amount} per night extra over Christmas / New Year and holiday weekends` : ''}; booking by e-mail or phone.${seasonEvidence}` : `Prices on request.${seasonEvidence}`,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Airzone Kite & Wing Foil Camp, Rangiputa',
    summary,
    continent: 'Oceania',
    country: 'New Zealand',
    region: 'Karikari Peninsula, Northland',
    spot: 'Rangiputa',
    itinerarySpots: [],
    durationDays: 8,
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      '7 nights shared self-catering accommodation at kite camp (per week booked)',
      'Three-day kitesurfing or wing surf / wing foil course, or supervised equipment hire for riders',
      'All training and equipment hire during the camp',
      'Camp activities (SUP, surfing, snorkelling, woodland gym)',
    ],
    optionalServices: [
      ...(c.singleSupplementPerWeek ? [`Single room supplement (NZD ${c.singleSupplementPerWeek} per week, if available)`] : []),
      'Longer stays: 2, 3 or 4 weeks (see prices)',
      'IKO instructor courses (ATC / ITC) at the same base',
    ],
    accommodation: 'shared self-catering accommodation at the kite camp',
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms: [],
    imageUrls: airzoneImages(p.camp).slice(0, 20),
    heroVideoUrl: null,
    sourceUrl: AIRZONE_CAMP_URL,
    bookingUrl: `${SITE}/contact/`,
    sourceText: [
      `camp page: ${lines(p.camp).join('\n')}`,
      `parsed: ${c.prices.map(x => `${x.weeks}w NZD ${x.amount}`).join(', ')}; peak +${c.peakSupplement?.amount ?? '-'} (${c.peakSupplement?.text ?? ''}); single +${c.singleSupplementPerWeek ?? '-'}/week`,
      `season evidence (instructor courses): ${parseAirzoneCourseDates(p.iko).map(d => `${d.start}..${d.end}`).join(', ')}`,
    ].join('\n'),
  };
}

export async function fetchAirzoneSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const c = parseAirzoneCamp(await page(AIRZONE_CAMP_URL));
  if (c.prices.length === 0) throw new Error('airzone: "Kite/Wing Camp prices" list not found (layout changed?)');
  try {
    const future = parseAirzoneCourseDates(await page(AIRZONE_IKO_URL)).filter(d => d.end >= today);
    if (future.length === 0) ctx?.note('no future dated instructor course on /become-an-iko-instructor/ (season evidence missing): check the camp is still running');
  } catch (e) {
    ctx?.note(`instructor page (season evidence) not readable: ${String(e)}`);
  }
  return buildAirzoneSlots(c);
}

export const airzoneKiteWingCampRangiputa: OfferAdapter = {
  key: 'airzone-kite-wing-camp-rangiputa',
  name: 'Airzone Kite & Wing Foil Camp, Rangiputa',
  kind: 'camp',
  operator: {
    name: 'Airzone Kitesurf School NZ',
    websiteUrl: `${SITE}/`,
    rootDomain: 'kitesurfnz.com',
    contactEmail: 'lessons@kitesurfnz.com',
    phone: '+64212027949',
  },
  url: AIRZONE_CAMP_URL,
  slotMethod: 'price_table',
  instantBooking: false, // request only (e-mail / phone / message), no online checkout
  fetchBudget: 3,
  async fetchContent() {
    const [camp, iko] = await Promise.all([page(AIRZONE_CAMP_URL), page(AIRZONE_IKO_URL)]);
    return parseAirzoneContent({ camp, iko }, todayIso());
  },
  fetchSlots: ctx => fetchAirzoneSlots(todayIso(), ctx),
};
