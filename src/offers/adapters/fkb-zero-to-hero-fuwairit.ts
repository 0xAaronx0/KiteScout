// ---------------------------------------------------------------------------
// Fuwairit Kite Beach (FKB, Al Shamal, northern Qatar) - "Zero to Hero" kitesurf course of the resort's kite school
// (Qatar Airways / Discover Qatar; the resort is part of Hilton's Tapestry Collection). Two days of lessons for complete
// beginners in a shallow lagoon; Duotone gear, IKO affiliated school; season November to July, side-onshore 15-30 kn.
//
// Data path (checked 2026-10-30): www.fkb.qa (own CMS, server-rendered).
//   course   /kitesurfing/ "Courses available to book online": "Zero to Hero Course" + "From QAR 2,610 (USD 717) pp";
//            the length comes from "2 Day Packages (Zero to Hero lessons)" in "Available Programs upon Request";
//            season from "running from November to July with side onshore wind speeds from 15-30 knots".
//   photos   /kitesurfing/ + home + /accommodation/ images ("images/<name>/<size>/?m=nbf", served as JPEG; the
//            'gallery_master' size is the largest).
// Booking: "Book Now" goes to discoverqatar.qa/zero-to-hero-course-1 (answers 403 to non-browser clients, so it is only
//   linked, never fetched). The rooms (Twin / King Kite Beach rooms) book through hilton.com and print no price on
//   fkb.qa -> only mentioned. Group, private and semi-private tuition on request.
// Contact (/contact-us/): fkbkitesurf@qatarairways.com.qa, +974 3990 2420, 8am-6pm.
// robots.txt (2026-10-30): only booking scripts (quicksearch.php, payment.php, ...) disallowed.
// Requests per run: 3 (kitesurfing, home, accommodation; memoised, slots reuse the kitesurfing page).
// Slots: one band for the running or next November-July season (no dates are printed), QAR per person per course,
//   availability 'on_request' (booked through Discover Qatar, no inventory visible to us).
// Map pin = Google Maps directions link on /contact-us/ (!1d51.381822 !2d26.0196145).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, parseAmount, todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.fkb.qa';
export const FKB_KITE_URL = `${SITE}/kitesurfing/`;
export const FKB_HOME_URL = `${SITE}/`;
export const FKB_STAY_URL = `${SITE}/accommodation/`;
const BOOKING_URL = 'https://www.discoverqatar.qa/zero-to-hero-course-1';
/** Google Maps directions link on /contact-us/ (2026-10-30). */
export const FKB_COORDS = { lat: 26.0196145, lng: 51.381822 };

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines (scripts and styles dropped), split at tags. */
export function fkbLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<[^>]+>/)
    .map(s => clean(s))
    .filter(Boolean);
}

export interface FkbCourse { price: number; usd: number | null; days: number; seasonFrom: number; seasonTo: number; text: string }

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function parseFkbCourse(html: string): FkbCourse | null {
  const l = fkbLines(html);
  const i = l.findIndex(x => /^Zero to Hero Course$/i.test(x));
  if (i < 0) return null;
  const priceLine = l.slice(i + 1, i + 4).find(x => /QAR/.test(x));
  const m = priceLine?.match(/QAR\s*([\d,]+)(?:\s*\(USD\s*([\d,]+)\))?/);
  const price = m ? parseAmount(m[1]) : null;
  if (!price) return null;
  const text = l.join(' ');
  const days = Number(text.match(/(\d)\s*Day Packages \(Zero to Hero/i)?.[1]) || 2;
  const season = text.match(/from (January|February|March|April|May|June|July|August|September|October|November|December) to (January|February|March|April|May|June|July|August|September|October|November|December)/i);
  return {
    price,
    usd: m?.[2] ? parseAmount(m[2]) : null,
    days,
    seasonFrom: season ? MONTHS.indexOf(season[1].toLowerCase()) + 1 : 11,
    seasonTo: season ? MONTHS.indexOf(season[2].toLowerCase()) + 1 : 7,
    text: `${l[i]} ${priceLine} | ${season?.[0] ?? 'season not found'}`,
  };
}

const cap = (w: string) => w[0].toUpperCase() + w.slice(1);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The running or next season only (a season spans the turn of the year, November-July); later seasons have no printed price yet. */
export function buildFkbSlots(c: FkbCourse, today: string): Slot[] {
  const y = Number(today.slice(0, 4));
  const out: Slot[] = [];
  for (const start of [y - 1, y]) {
    const end = c.seasonTo < c.seasonFrom ? start + 1 : start;
    const s = iso(start, c.seasonFrom, 1);
    const e = iso(end, c.seasonTo, lastDay(end, c.seasonTo));
    if (e < today) continue;
    out.push({
      key: `zero-to-hero|${s}`,
      startDate: s < today ? today : s,
      endDate: e,
      unit: `Zero to Hero course (${c.days} days)`,
      price: c.price,
      currency: 'QAR',
      priceUnit: 'package',
      priceBasis: 'person',
      occupancy: null,
      availability: 'on_request',
      availabilityText: `"From QAR ${c.price.toLocaleString('en-US')}${c.usd ? ` (USD ${c.usd})` : ''} pp", booked online via Discover Qatar; season ${cap(MONTHS[c.seasonFrom - 1])} to ${cap(MONTHS[c.seasonTo - 1])}`,
      spotsLeft: null,
      datePrecision: 'season',
    });
    break;
  }
  return out;
}

const SKIP_IMG = /icon|play-video|facebook|instagram|iko-affiliate|social_cover|video-thumbnail|fullscreen|favicon/i;

export function fkbImages(...pages: string[]): string[] {
  const out: string[] = [];
  for (const html of pages) {
    for (const m of html.matchAll(/"(?:https:\/\/www\.fkb\.qa)?\/?images\/([A-Za-z0-9_.-]+)\/[a-z_]+\/\?m=nbf"/g)) {
      if (SKIP_IMG.test(m[1])) continue;
      const u = `${SITE}/images/${m[1]}/gallery_master/?m=nbf`;
      if (!out.includes(u)) out.push(u);
    }
  }
  return out;
}

export interface FkbPages { kite: string; home: string; stay: string }

export function parseFkbContent(p: FkbPages): OfferContent {
  const c = parseFkbCourse(p.kite);
  const kite = fkbLines(p.kite);
  const intro = kite.find(l => /longest kitesurfing seasons/i.test(l)) ?? null;
  const facilities = (() => {
    const i = kite.findIndex(l => /^Everything for kitesurfers$/i.test(l));
    return i < 0 ? [] : kite.slice(i + 1, i + 11);
  })();
  const rooms = fkbLines(p.stay).filter(l => /^(Twin|King) Kite/i.test(l));

  const summary = [
    'Fuwairit Kite Beach (FKB) is a kite resort on the northern coast of Qatar with one of the longest seasons anywhere: November to July, side-onshore winds of 15 to 30 knots and a shallow lagoon for all levels.',
    `The Zero to Hero course is ${c?.days ?? 2} days of lessons for complete beginners with the resort's IKO-affiliated school and current Duotone gear${c ? `, from QAR ${c.price.toLocaleString('en-US')} per person` : ''}.`,
    'Rooms with sea view at the resort (Tapestry Collection by Hilton) are booked separately; group, private and semi-private lessons, rental and day access are offered as well.',
  ].join(' ');

  return {
    kind: 'course',
    title: 'Fuwairit Kite Beach Zero to Hero Course, Qatar',
    summary,
    continent: 'Asia',
    country: 'Qatar',
    region: 'Al Shamal',
    spot: 'Fuwairit Kite Beach',
    spotCoords: FKB_COORDS,
    itinerarySpots: [],
    durationDays: c?.days ?? 2,
    skillLevels: ['beginner'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: ['Kitesurf lessons over 2 days with IKO-affiliated instructors', 'Kite gear (Duotone)'],
    optionalServices: [
      'Rooms at Fuwairit Kite Beach (Tapestry Collection by Hilton), booked separately',
      'Rental wetsuits, helmets, life vests, harnesses',
      'Group, private and semi-private tuition on request',
    ],
    accommodation: null,
    mealPlan: null,
    languages: ['en'],
    rooms: [],
    imageUrls: fkbImages(p.kite, p.home, p.stay).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: FKB_KITE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `kite: ${intro ?? ''}`,
      `facilities: ${facilities.join('; ')}`,
      `course: ${c?.text ?? 'not found'}`,
      `rooms: ${rooms.join('; ')}`,
    ].join('\n'),
  };
}

export const fkbZeroToHeroFuwairit: OfferAdapter = {
  key: 'fkb-zero-to-hero-fuwairit',
  name: 'Fuwairit Kite Beach Zero to Hero Course',
  kind: 'course',
  operator: {
    name: 'Fuwairit Kite Beach',
    websiteUrl: SITE,
    rootDomain: 'fkb.qa',
    contactEmail: 'fkbkitesurf@qatarairways.com.qa',
    phone: '+97439902420',
  },
  url: FKB_KITE_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  async fetchContent() {
    const kite = await page(FKB_KITE_URL);
    if (!parseFkbCourse(kite)) throw new Error('fkb: "Zero to Hero Course" with a QAR price missing on /kitesurfing/ (course gone?)');
    return parseFkbContent({ kite, home: await page(FKB_HOME_URL), stay: await page(FKB_STAY_URL) });
  },
  async fetchSlots(ctx) {
    const c = parseFkbCourse(await page(FKB_KITE_URL));
    if (!c) throw new Error('fkb: "Zero to Hero Course" with a QAR price missing on /kitesurfing/ (course gone?)');
    const slots = buildFkbSlots(c, todayIso());
    if (!slots.length) ctx.note('fkb: no current or next season');
    return slots;
  },
};
