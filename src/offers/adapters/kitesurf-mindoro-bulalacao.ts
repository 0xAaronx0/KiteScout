// ---------------------------------------------------------------------------
// Kitesurf Mindoro (Makani Resort & Glamping), Bislig Beach (Bulalacao, Oriental Mindoro, Philippines) - small eco
// resort with its own kite and wing station: 5 bungalows, 6 glamping pods, dorm beds / hammocks / tree tents, all
// full board; VDWS-standard one-on-one lessons, North rental gear, downwinders and kite safaris to nearby islands.
// The accommodation page still calls the resort "Amansinaya Resort"; the site header says "Makani Resort & Glamping".
//
// Found 2026-10-12 as Google Maps pin "Kitesurf Mindoro" (hotel, 4.9/51) on the south coast of Mindoro.
// Liveness (2026-10-12): Google Maps reviews dated about 7 and 9 months back (March / January 2026) with owner replies
//   6 and 9 months back (read in the built-in browser, a hint, not data); the contact page carries an image uploaded
//   2025-11-08 (Jimdo image version timestamp) and current travel notes (Clark - San Jose flights, Coron ferry);
//   "We are open - Kiteseason is on from November - End of April!". Verdict LIVE.
// Data path (checked 2026-10-12): Jimdo Creator site, server-rendered text:
//   content  / (intro, highlights), /resort/ (units, meals, inclusions), /watersports/kite-wing-1/ (spot, lessons,
//            rental). Booking: contact form / e-mail -> no engine.
//   slots    /resort/ prints per-person nightly rates (bungalow single 75 / double 50 EUR p.p., glamping pod 55 / 40,
//            hammock or dorm 30, full board) WITHOUT a date or season; the page's newest photo is from 2023-09 and the
//            kite page speaks of "latest 2024 North Gear". Per the recheck rule (prices only when they plausibly apply to
//            the next season) fetchSlots returns [] (price on request) and notes why. The parser stays live: once the
//            resort page names the current year or later (e.g. "2026/27 prices"), the same rates are returned as slots.
//   coordinates  none on the site (the contact map embed only queries "Bulalacao"); spotCoords omitted.
// robots.txt (2026-10-12): disallows /app/ and /j/ only; "Crawl-Delay: 5" -> this adapter waits 5 s between its own
//   live requests (local helper `mdGet`; http.ts does not read Crawl-delay). The contact e-mail is published behind
//   Cloudflare's e-mail protection (data-cfemail), decoded here once by hand: info@kitesurf-mindoro.com.
// Requests per run: content 3, slots 1.
// Known limits: no inventory, no dates; lesson / rental prices are undated too and are not copied into the services.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kitesurf-mindoro.com';
export const MD_HOME_URL = `${SITE}/`;
export const MD_RESORT_URL = `${SITE}/resort/`;
export const MD_KITE_URL = `${SITE}/watersports/kite-wing-1/`;
const CONTACT_URL = `${SITE}/contact/`;
const CRAWL_DELAY_MS = 5_000;

// --- local helpers ----------------------------------------------------------------------------
/** robots.txt asks for Crawl-delay: 5 - waits between live requests (no wait when replaying fixtures). */
let lastLive = 0;
async function mdGet(url: string): Promise<string> {
  if (!process.env.OFFERS_FIXTURE_DIR) {
    const wait = lastLive + CRAWL_DELAY_MS - Date.now();
    if (lastLive > 0 && wait > 0) await new Promise(r => setTimeout(r, wait));
    lastLive = Date.now();
  }
  return fetchText(url, { accept: 'text/html' });
}

/** Visible text lines (scripts, styles, SVG dropped), one per text node. */
export function mdLines(html: string): string[] {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, '');
  return body.split(/<[^>]+>/).map(s => clean(s).replace(/​/g, '').trim()).filter(Boolean);
}

/** Content photos of a Jimdo page: <img> with width >= 600 and aspect <= 2 (drops the 890x309 header logo), as 2048 px JPEGs. */
export function mdImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const p = tag.match(/image\.jimcdn\.com\/app\/cms\/image\/transf\/[^/]+\/path\/([a-z0-9]+)\/image\/(i[0-9a-f]{16})\/version\/(\d+)\//);
    const w = Number(tag.match(/\bwidth="(\d+)"/)?.[1] ?? 0);
    const h = Number(tag.match(/\bheight="(\d+)"/)?.[1] ?? 0);
    if (!p || w < 600 || !h || w / h > 2) continue;
    const u = `https://image.jimcdn.com/app/cms/image/transf/dimension=2048x2048:format=jpg/path/${p[1]}/image/${p[2]}/version/${p[3]}/image.jpg`;
    if (!out.some(x => x.includes(`/image/${p[2]}/`))) out.push(u);
  }
  return out;
}

/** Split a list at commas that are not inside parentheses ("dinner set meal (soup, maindish, dessert) , water"). */
function splitTop(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(x => x.replace(/\s+/g, ' ').replace(/\s+\)/g, ')').trim()).filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
export interface MdUnit {
  name: string;
  description: string;
  /** EUR per person per night, full board */
  single: number | null;
  double: number | null;
  flat: number | null;
  /** the "included:" / "incl:" list */
  included: string[];
}

/** Unit blocks on /resort/: "Bungalows", "Glamping Pods", "Hammock or Dorm" - description, price line, inclusions. */
export function parseMdUnits(html: string): MdUnit[] {
  const lines = mdLines(html);
  const start = lines.findIndex(l => /^All meals are included/i.test(l));
  const end = lines.findIndex(l => /^We are open/i.test(l));
  if (start < 0) return [];
  const block = lines.slice(start + 1, end > start ? end : undefined);
  const out: MdUnit[] = [];
  let cur: MdUnit | null = null;
  for (const l of block) {
    if (l.length < 30 && !/\d|[.:]/.test(l)) {
      cur = { name: l, description: '', single: null, double: null, flat: null, included: [] };
      out.push(cur); continue;
    }
    if (!cur) continue;
    const single = l.match(/single occupation:\s*(\d+)\s*Euro per person/i);
    const double = l.match(/double occupation:\s*(\d+)\s*Euro per person/i);
    const flat = l.match(/Price per night:\s*(\d+)\s*Euro\s*\/\s*person/i);
    if (single) cur.single = Number(single[1]);
    if (double) cur.double = Number(double[1]);
    if (flat) cur.flat = Number(flat[1]);
    if (/Breakfastbuffet/i.test(l)) cur.included = splitTop(l.replace(/^.*?(Breakfastbuffet)/i, '$1'));
    else if (!single && !double && !flat) cur.description = [cur.description, l].filter(Boolean).join(' ');
  }
  return out;
}

/** Slots per unit and occupancy (EUR per person per night, full board, on request, no dates). */
export function buildMdSlots(units: MdUnit[]): Slot[] {
  const out: Slot[] = [];
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  for (const u of units) {
    const base = {
      startDate: null, endDate: null, unit: u.name, currency: 'EUR', priceUnit: 'per_night' as const,
      priceBasis: 'person' as const, availability: 'on_request' as const, availabilityText: null, spotsLeft: null,
    };
    if (u.double !== null) out.push({ ...base, key: `${key(u.name)}-double`, price: u.double, occupancy: 2 });
    if (u.single !== null) out.push({ ...base, key: `${key(u.name)}-single`, price: u.single, occupancy: 1 });
    if (u.flat !== null) out.push({ ...base, key: key(u.name), price: u.flat, occupancy: 1 });
  }
  return out;
}

/** Newest year (20xx) printed in the visible text of a page, or null; a season "2026/27" counts as 2027. */
export function mdNewestYear(html: string): number | null {
  const ys = [...mdLines(html).join(' ').matchAll(/\b(20[2-9]\d)(?:\s?[/-]\s?(\d{2}))?\b/g)].map(m => (m[2] ? 2000 + Number(m[2]) : Number(m[1])));
  return ys.length ? Math.max(...ys) : null;
}

export interface MdPages { home: string; resort: string; kite: string }

export function parseMindoroContent(p: MdPages): OfferContent {
  const home = mdLines(p.home);
  const resort = mdLines(p.resort);
  const kite = mdLines(p.kite);
  const units = parseMdUnits(p.resort);
  const intro = resort.find(l => /Resort has \d+ bungalows/i.test(l)) ?? '';
  const nBung = intro.match(/has (\d+) bungalows/i)?.[1] ?? null;
  const nPods = intro.match(/(\d+) luxury furnished glampingpods/i)?.[1] ?? null;
  const kiteText = kite.join(' ');
  const season = [...home, ...resort].find(l => /Kiteseason is on from/i.test(l)) ?? null;
  const islands = home.join(' ').match(/(\d+) different islands to kite on/i)?.[1] ?? null;
  const daytrip = home.find(l => /^Join us for a trip to the nearby islands/i.test(l)) ?? null;
  const included = units.find(u => u.included.length)?.included ?? [];

  const rooms: ContentRoom[] = units.map(u => ({
    name: u.name,
    description: u.description || null,
    features: [
      ...(/^Bungalow/i.test(u.name) && nBung ? [`${nBung} bungalows`] : []),
      ...(/^Glamping/i.test(u.name) && nPods ? [`${nPods} glamping pods`] : []),
      ...(/view of the ocean|from your terrace/i.test(`${u.description} ${intro}`) && /^Bungalow/i.test(u.name) ? ['Ocean view terrace'] : []),
      ...(/outdoor private bathroom/i.test(u.description) ? ['Outdoor private bathroom'] : []),
      ...(/25 sqm/i.test(u.description) ? ['25 sqm hut with 360 degree view'] : []),
      ...(/shared/i.test(u.description) ? ['Shared bathroom'] : []),
      ...(/private locker/i.test(u.description) ? ['Private locker'] : []),
      'Full board (breakfast and lunch buffet, set dinner)',
    ],
  }));

  const imageUrls: string[] = [];
  for (const u of [...mdImages(p.resort), ...mdImages(p.home), ...mdImages(p.kite)]) if (!imageUrls.includes(u)) imageUrls.push(u);

  const summary = [
    'Kitesurf Mindoro (Makani Resort & Glamping) is a small eco resort with its own kite and wing station on Bislig Beach near Bulalacao in Oriental Mindoro, Philippines; the beginner spot, a shallow flat-water bay with side-onshore wind, lies right in front of the bungalows, about 50 km from Boracay.',
    `The resort has ${nBung ?? 'several'} bungalows with ocean view and outdoor private bathrooms, ${nPods ?? 'several'} glamping pods with a shared shower house, and dorm beds, hammocks and tree tents; every stay is full board and includes kite gear storage, beach rescue and yoga.`,
    `Lessons follow the VDWS standard one-on-one for kitesurfing and wing foiling, North equipment is rented to certified riders, and downwinders and 3-day kite safaris go to the nearby islands; the kite season runs from November to the end of April.`,
    'Stays are booked through the contact form; the published room rates carry no date, so prices are on request.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Kitesurf Mindoro - Makani Resort & Glamping',
    summary,
    continent: 'Asia',
    country: 'Philippines',
    region: 'MIMAROPA (Oriental Mindoro)',
    spot: 'Bislig Beach, Bulalacao',
    itinerarySpots: [],
    durationDays: null,
    // home: "A perfect bay to learn from zero to hero or to progress your level"; kite page: beginner levels 1-3 + advanced course
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /Kitecourses/i.test(kiteText),
    equipmentRental: /Gear Rental/i.test(kiteText),
    beginnerFriendly: /beginner kite spot/i.test(kiteText),
    includedServices: included.length
      ? included.map(s => s.replace(/^Breakfastbuffet/i, 'Breakfast buffet').replace(/^lunchbuffet/i, 'Lunch buffet').replace(/maindish/gi, 'main dish').replace(/^kitegear/i, 'Kite gear')).map(s => s.charAt(0).toUpperCase() + s.slice(1))
      : ['Breakfast, lunch and dinner'],
    optionalServices: [
      'Kite lessons (VDWS standard, one-on-one, beginner levels 1-3 and advanced coaching with video analysis)',
      'Wing foil lessons (one-on-one)',
      'Kite and wing foil equipment rental (North, JP Australia; international licence required)',
      `Downwind day trips to the nearby islands${daytrip ? ' (Maasin, Liwagao, Nagubat, Suguicay, Aslom)' : ''}`,
      'Kite & wing safari, 3 days / 2 nights, island to island',
      'SUP tour', 'Mountain biking', 'Hiking', 'Freediving', 'Massage',
    ],
    accommodation: 'eco resort bungalows, glamping pods and dorm on the kite beach',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: MD_RESORT_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `home: ${home.filter(l => l.length > 60 && !/cookie/i.test(l)).join(' ')}`,
      `resort: ${intro} ${resort.find(l => /^All meals are included/i.test(l)) ?? ''}`,
      `units (undated rates, EUR p.p./night full board): ${units.map(u => `${u.name}: single ${u.single ?? '-'} double ${u.double ?? '-'} flat ${u.flat ?? '-'}`).join('; ')}`,
      `kite: ${kite.filter(l => l.length > 80).join(' ')}`,
      `season: ${season ?? ''}${islands ? ` | ${islands} islands to kite on` : ''}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const kitesurfMindoroBulalacao: OfferAdapter = {
  key: 'kitesurf-mindoro-bulalacao',
  name: 'Kitesurf Mindoro - Makani Resort & Glamping (Bulalacao)',
  kind: 'accommodation',
  operator: {
    name: 'Kitesurf Mindoro',
    websiteUrl: SITE,
    rootDomain: 'kitesurf-mindoro.com',
    contactEmail: 'info@kitesurf-mindoro.com', // page footer (Cloudflare e-mail protection), 2026-10-12
  },
  url: MD_RESORT_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'low', // undated rates -> price on request
  async fetchContent() {
    const home = await mdGet(MD_HOME_URL);
    const resort = await mdGet(MD_RESORT_URL);
    const kite = await mdGet(MD_KITE_URL);
    return parseMindoroContent({ home, resort, kite });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    const html = await mdGet(MD_RESORT_URL);
    const units = parseMdUnits(html);
    if (units.length === 0) throw new Error('kitesurf-mindoro: unit blocks not found on /resort/ (layout changed?)');
    const year = mdNewestYear(html);
    if (year === null || year < Number(todayIso().slice(0, 4))) {
      ctx.note(`/resort/ rates are undated (newest year on the page: ${year ?? 'none'}): price on request`);
      return [];
    }
    return buildMdSlots(units);
  },
};
