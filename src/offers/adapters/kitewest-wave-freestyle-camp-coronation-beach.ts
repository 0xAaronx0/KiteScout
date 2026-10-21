// ---------------------------------------------------------------------------
// KiteWest Water Sports (with Shark Bay Kitesurfing) - Wave & Freestyle Kite Camp, Coronation Beach (Geraldton,
// Western Australia): 7 days / 6 nights at the school's yurt camp on a private property 15 min from Coronation Beach
// (shared, private single or private double yurt tents, outdoor bathroom), all meals, a 12-hour package of daily wave
// riding clinics, downwinders, freestyle / progression / safety clinics with video coaching, local transport, airport
// or town pick-up; intermediate and advanced riders, 4-10 students. One base -> KIND = 'camp'.
//
// Data path (checked 2026-10-19): WordPress, one page /wave-freestyle/ (no shop product: "Book now" goes to the
//   /contact/ form; 50% deposit by Wise / direct transfer -> request booking):
//   dates    "WAVE & FREESTYLE / 7 days In Geraldton / 2027 Calendar dates TBA" -> no dated weeks today -> [] (price on
//            request), the summary says the 2027 dates are not published yet. The parser reads any short dated line
//            of the page ("08-15 November 2027", "28 Nov - 05 Dec 2027", the format of the partner Shark Bay page),
//            so dates appear without a code change; dates before today are dropped.
//   prices   "* Prices are per person in an all included package", "* Shared tent 2 beds $3295/pers",
//            "* Private single 1 bed $3395/pers", "* Private double bed $3595/pers", "From AU$3295*" -> AUD (the
//            "AU$" of the From line), per person, package. Used for dated slots once dates appear, and in the summary.
//   content  the same page (inclusions, camp, meals, travel, optional activities).
//   photos   (2026-10-21) kitewest.com.au serves every photo under the robots-disallowed /wp-content/, so its own
//            uploads are never used. The same camp is also sold on the co-operator's site Shark Bay Kitesurfing (same
//            business: same phone +61 449 021 784, the camp page says "KiteWest Water Sports and Shark Bay
//            Kitesurfing have linked up"): /product/wave-riding-kite-camp-coronation-beach/ carries the same camp
//            photos (yurt tents, Coronation Beach sign, kiters on the beach, FullSizeRender-8 / IMG_1756 ...) under
//            sharkbaykitesurfing.com/wp-content/uploads/, which that host's robots.txt allows. Taken from <img> and
//            the GenerateBlocks CSS backgrounds, minus logos, the pexels food / lifestyle stock, the F-ONE Madagascar
//            promo shot, the optional-activity tiles (fishing, diving, Abrolhos, wing foil), drinks, fins and the gear
//            shop (PARTNER_NOT_CAMP). The partner's prices differ from KiteWest's (AUD 2,695-2,995 vs 3,295-3,595,
//            2026-10-21); prices stay KiteWest's, only photos come from the partner page.
// robots.txt (2026-10-19): kitewest.com.au "Disallow: /wp-content/" (only plugin / cache JS and CSS re-allowed);
//   sharkbaykitesurfing.com (2026-10-21) only WooCommerce internals, /wp-admin/ and add-to-cart disallowed.
// Requests per run: content 2 (camp page + partner camp page for photos; a failing partner page only drops the
//   photos), slots 1 (memoised in the same run).
// Flags: liveAvailability / instantBooking unset (contact form + bank transfer deposit).
// spotCoords: none on the site (footer address "Coronation Beach Camp, Coronation Beach road, Chapman Valley WA 6532";
//   "Coronation Beach, Western Australia" is left to the geocoder).
// ---------------------------------------------------------------------------
import { clean, detectCurrency, parseAmount, parseRange, todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';
import { memoPage, wpLines } from './kite-republic-aitutaki-winter-escape.js';

export const KITEWEST_SITE = 'https://kitewest.com.au';
export const KITEWEST_WAVE_URL = `${KITEWEST_SITE}/wave-freestyle/`;
export const KITEWEST_CONTACT_URL = `${KITEWEST_SITE}/contact/`;
/** The co-operator's page for the same camp; photos only (kitewest.com.au disallows /wp-content/ for bots). */
export const KITEWEST_PARTNER_CAMP_URL = 'https://sharkbaykitesurfing.com/product/wave-riding-kite-camp-coronation-beach/';

export const KITEWEST_OPERATOR: OperatorRef = {
  name: 'KiteWest Water Sports',
  websiteUrl: KITEWEST_SITE,
  rootDomain: 'kitewest.com.au',
  contactEmail: 'info@kitewest.com.au',
  phone: '+61449021784',
};

export interface KwRoom { unit: string; price: number; occupancy: number | null }
export interface KwWeek { start: string; end: string; label: string }
export interface KwCamp { weeks: KwWeek[]; rooms: KwRoom[]; currency: string | null; days: number | null; nights: number | null; datesNote: string | null; lines: string[] }

export function parseKwCamp(html: string): KwCamp {
  const lines = wpLines(html);
  const weeks: KwWeek[] = [];
  for (const l of lines) {
    // a short line that starts with a day or a month and ends with the year: "08-15 November 2027", "28 Nov - 05 Dec 2027"
    if (l.length > 40 || !/^(\d{1,2}|[A-Z][a-z]{2,8}\.?\s\d{1,2})\s?[-– ].*\b20\d{2}$/.test(l)) continue;
    const r = parseRange(l);
    if (r && !weeks.some(w => w.start === r.start)) weeks.push({ ...r, label: l });
  }
  const rooms: KwRoom[] = [];
  for (const l of lines) {
    const m = l.match(/^\*?\s*(.{4,40}?)\s+(?:AU)?\$\s?([\d,]+)\s*\/\s*pers/i);
    if (!m) continue;
    const price = parseAmount(m[2]);
    if (price === null) continue;
    const name = clean(m[1]);
    rooms.push({ unit: name, price, occupancy: /shared|2 beds/i.test(name) ? 2 : /single|1 bed/i.test(name) ? 1 : null });
  }
  const from = lines.find(l => /^From\s+(AU\$|A\$|AUD|\$)/i.test(l));
  const days = Number(lines.find(l => /^\d+ days In /i.test(l))?.match(/^(\d+)/)?.[1] ?? 0) || null;
  const nights = Number(lines.find(l => /^\d+ nights accommodation/i.test(l))?.match(/^(\d+)/)?.[1] ?? 0) || null;
  const datesNote = lines.find(l => /^20\d{2} Calendar( dates)? TBA$/i.test(l)) ?? null;
  // detectCurrency() reads "AU$" as USD (it matches "A$" / "AUD" only), so AU$ is checked first
  const currency = from ? (/AU\$|A\$|AUD/.test(from) ? 'AUD' : detectCurrency(from)) : null;
  return { weeks, rooms, currency, days, nights, datesNote, lines };
}

/** Partner-page uploads that are not camp photos: logos, stock (pexels), the F-ONE Madagascar promo and the
 *  Kite-slide-show board ad, the optional-activity tiles (IMG_0015 fishing, r7EwU Abrolhos, dive-ocean-Park, LLfOS
 *  wing foil), the lobster plate (uePQj), fins (YhwqG), the gear shop (2CyKD), the drinks (09-pm) and kite-silhouette
 *  (58-pm) graphics, the kangaroo banner and the Shark Bay downwinder background (SBDW22). */
const PARTNER_NOT_CAMP = /logo|pexels|map-grey|accredited|action-sport|fone_|f-one|slide-show|kangooro|(?:09|58)-pm[.-]|IMG_0015|uePQj|YhwqG|2CyKD|LLfOS|r7EwU|dive-ocean|SBDW22/i;

/** Camp photos from the partner page: <img> sources and CSS background images under /wp-content/uploads/, WordPress
 *  "-WxH" thumbnails mapped to the original (a re-upload suffix like "-600x600-1.jpg" is the file itself). */
export function parseKwPartnerImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/https:\/\/sharkbaykitesurfing\.com\/wp-content\/uploads\/[^"'\s)<>,]+?\.(?:jpe?g|png|webp)/gi)) {
    const u = m[0].replace(/-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp)$)/i, '');
    if (!PARTNER_NOT_CAMP.test(u) && !out.includes(u)) out.push(u);
  }
  return out;
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function buildKwSlots(c: KwCamp, today: string): Slot[] {
  const out: Slot[] = [];
  for (const w of c.weeks) {
    if (w.start < today) continue;
    for (const r of c.rooms) {
      out.push({
        key: `${w.start}|${slug(r.unit)}`,
        startDate: w.start,
        endDate: w.end,
        unit: r.unit,
        price: r.price,
        currency: c.currency ?? 'AUD',
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: r.occupancy,
        availability: 'on_request',
        availabilityText: 'Book through the contact form; 50% deposit by bank transfer (min 4, max 10 students)',
        spotsLeft: null,
      });
    }
  }
  return out;
}

export function parseKwContent(html: string, today = todayIso(), imageUrls: string[] = []): OfferContent {
  const c = parseKwCamp(html);
  if (!c.rooms.length) throw new Error('kitewest-wave: no "$.../pers" price lines (layout changed?)');
  const future = c.weeks.filter(w => w.start >= today);
  const cur = c.currency ?? 'AUD';
  const lo = Math.min(...c.rooms.map(r => r.price));
  const hi = Math.max(...c.rooms.map(r => r.price));
  const nights = c.nights ?? 6;
  const days = c.days ?? nights + 1;
  const year = c.datesNote?.match(/20\d{2}/)?.[0] ?? null;
  const datesText = future.length
    ? `Camp dates: ${future.map(w => `${w.start} to ${w.end}`).join(', ')}`
    : `Runs in the September to April wind season; ${year ? `the ${year} dates are` : 'the next dates are'} not published yet`;

  const summary = [
    `KiteWest and Shark Bay Kitesurfing run a ${days}-day wave and freestyle kite camp at Coronation Beach near Geraldton, Western Australia, for intermediate and advanced riders in groups of 4 to 10.`,
    `It includes ${nights} nights at a yurt camp with ocean views on a private property 15 minutes from the beach, all meals, a 12-hour package of daily wave riding clinics, downwinders, freestyle, progression and safety clinics with video coaching, local transport and a free airport or town pick-up in Geraldton.`,
    `${datesText}.`,
    `Prices are per person, all included: ${cur} ${lo.toLocaleString('en-US')} in a shared tent to ${cur} ${hi.toLocaleString('en-US')} in a private double; bookings by enquiry with a 50% deposit.`,
  ].join(' ');

  const start = c.lines.findIndex(l => /^ENJOY THE THRILL/i.test(l));
  const end = c.lines.findIndex(l => /^What.s Up with Kitewest/i.test(l));
  return {
    kind: 'camp',
    title: 'KiteWest Wave & Freestyle Kite Camp Coronation Beach',
    summary,
    continent: 'Oceania',
    country: 'Australia',
    region: 'Geraldton, Western Australia',
    spot: 'Coronation Beach',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: days,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: false,
    includedServices: [
      '12-hour package: daily wave riding clinics and downwinders, kite progression, freestyle and safety clinics',
      'Video coaching, photo and video souvenirs',
      `${nights} nights in a yurt tent (shared, private single or private double)`,
      'All meals: breakfast, morning tea, lunch and dinner',
      'Local transport, free airport or town pick-up in Geraldton',
      'Kite equipment during lessons',
    ],
    optionalServices: ['Rental equipment', 'Wing foiling course', 'Abrolhos Islands tour', 'Diving, spearfishing and fishing charter trips', 'Beginner or improver kite course on request'],
    accommodation: 'yurt tent camp on a private property (shared, private single or double tents), outdoor bathroom',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: c.rooms.map(r => ({ name: r.unit, description: null, features: [] })),
    imageUrls, // the co-operator's camp page (kitewest.com.au's own /wp-content/ is robots-disallowed)
    heroVideoUrl: null,
    sourceUrl: KITEWEST_WAVE_URL,
    bookingUrl: KITEWEST_CONTACT_URL,
    sourceText: [
      c.lines.slice(start >= 0 ? start : 0, end > start ? end : undefined).join('\n'),
      `parsed: weeks ${c.weeks.map(w => `${w.start}..${w.end}`).join(', ') || 'none'} (${c.datesNote ?? 'no TBA note'}); rooms ${c.rooms.map(r => `${r.unit}=${r.price}`).join(', ')}; currency ${c.currency}`,
    ].join('\n'),
  };
}

export async function fetchKwSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const c = parseKwCamp(await memoPage(KITEWEST_WAVE_URL));
  if (!c.rooms.length) throw new Error('kitewest-wave: no "$.../pers" price lines (layout changed?)');
  const past = c.weeks.filter(w => w.start < today);
  if (past.length) ctx?.note(`${past.length} past camp date(s) dropped (${past.map(w => w.start).join(', ')})`);
  if (!c.weeks.length) ctx?.note(`no camp dates on the page (${c.datesNote ?? 'no dated lines'}): price on request`);
  return buildKwSlots(c, today);
}

export const kitewestWaveFreestyleCampCoronationBeach: OfferAdapter = {
  key: 'kitewest-wave-freestyle-camp-coronation-beach',
  name: 'KiteWest Wave & Freestyle Kite Camp, Coronation Beach',
  kind: 'camp',
  operator: KITEWEST_OPERATOR,
  url: KITEWEST_WAVE_URL,
  slotMethod: 'html_dates',
  fetchBudget: 3,
  async fetchContent(ctx) {
    const html = await memoPage(KITEWEST_WAVE_URL);
    let images: string[] = [];
    try {
      images = parseKwPartnerImages(await memoPage(KITEWEST_PARTNER_CAMP_URL));
    } catch (e) {
      ctx.note(`partner camp page for photos unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
    return parseKwContent(html, todayIso(), images);
  },
  fetchSlots: ctx => fetchKwSlots(todayIso(), ctx),
};
