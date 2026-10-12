// ---------------------------------------------------------------------------
// Secret Island Kite Camp (Sulu Sea, Palawan, Philippines) - island kite camp with dome tents and a
// bamboo hut, reached by speedboat from Coron on fixed "Joiner Tour" dates.
//
// Data path (checked 2026-10-12):
//   secretislandkitecamp.com is a Base44 single-page app (like kite-village-hamata): the HTML is an
//   empty shell, every text lives in the JS bundle (/assets/index-<hash>.js, hash changes per deploy,
//   4OEm5eU_ on 2026-10-12). We read the shell, follow its module script and parse JS literals out of
//   the bundle (parseJsLiteral from kite-village-hamata):
//     - tour list `[{month:"December",tag:"DEC 2026",wind:"16-22 KTS",priceFrom:342,slots:[{dates:
//       ["2026-12-14","2026-12-21"],tourValue:"dec-14",image:..}]},..]` = the dated joiner tours. The
//       month-level `priceFrom` (342/288/450) is NOT shown: the card code overwrites it per tour with
//       150 + 30*nights + 20*ceil(nights/7) + 30*nights (= dormitory price for one guest).
//     - the enquiry form's cost estimator: "Speedboat transfer (2-way) - $150/person", "Full meals
//       (3x/day) - $30/person x N days", "Environmental fee - $20/person/week" and the room map
//       {dorm:{price:30,perPerson:!0,..},private:{price:80,perPerson:!1,..},lux:{price:120,..},
//       ahut:{price:50,..}}. We parse these numbers, not constants, so a price change follows.
//     - room cards `[{name:"Dormitory Dome",price:30,unit:"person/day",capacity:"Up to 6 people",..}]`,
//       course list `[{level:"01",title:"Discovery Kitesurfing",..,price:"$120 / person"}]`, FAQ
//       `[{q:..,a:..}]`, spot facts `[["750M+ Riding Zone",..],..]`, gallery arrays.
//   Kind 'camp' (not 'accommodation'): the camp is bookable only as these fixed-date joiner tours
//   ("We sail from Coron to Secret Island Kite Camp and back only on selected dates"; other dates only
//   for groups of 6+), sold as a package: return speedboat transfer, 3 meals a day, environmental fee
//   and the chosen accommodation (FAQ "What is included in the Joiners Tour?"). Kite lessons and gear
//   rental are separate add-ons.
//   Currency USD: every price on the site prints "$" (cards "$590/person", estimator, invoice), the FAQ
//   says "We accept Philippine Pesos (PHP) and US Dollars (USD)", the invoice's bank account is a "USD
//   account" (Wise). The bundle contains no "EUR"/"€" at all (checked 2026-10-12).
//   Availability: there is none to read. The only Base44 entity the site calls is BookingEnquiry
//   (create = the enquiry form; list/update/delete are the admin's, behind login - never touched).
//   Booking is an enquiry ("Send an inquiry, and we will get back to you regarding availability and
//   payment instructions"), so every slot is 'on_request'.
// robots.txt (2026-10-12): "User-agent: * / Allow: /". The sitemap is mostly drink-menu pages (ignored).
// Requests per run: 2 (shell + bundle, memoised across content + slots).
// Slots: one per dated tour x accommodation (4 x 9 = 36 on 2026-10-12), key `<room code>|<arrival>`,
//   unit = room name, priceUnit 'package', packageNights = nights, priceBasis 'person', USD.
//   Dormitory Dome is priced per person (occupancy 1, = the "FROM $X/person" on the tour card); the
//   A-Bamboo Hut, Private Dome and Lux Dome are priced per unit per night, so the slot price is the
//   per-person share at 2 guests sharing (occupancy 2, priceTotal = the estimator total for 2 guests).
//   The Lux Dome sleeps up to 4; 2 is our basis (the site recommends it "for couples").
// Coordinates: the site's own "Wind Forecast" link is windy.com/11.460/120.221 (spot forecast point);
//   used as spotCoords. The hero badge prints "11°58'N · 120°04'E", which lies in the Busuanga-Culion
//   channel about 15 km from Coron and contradicts "two hours by speedboat from Coron"/"Sulu Sea"; the
//   same Windy link centres its map on 11.443,120.065. Ask the camp for an exact pin if it matters.
// Known limits: no live availability; the A-Bamboo Hut is a single unit ("Our one unique ..."). The
//   hero video (media.base44.com/videos/.../Secret_Island_webvideo.mp4) is not used as heroVideoUrl
//   (third-party hotlink, size unchecked); it is listed in sourceText.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, todayIso } from '../parse.js';
import { parseJsLiteral } from './kite-village-hamata.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

export const SIK_SITE = 'https://secretislandkitecamp.com';
export const SIK_PAGE_URL = `${SIK_SITE}/`;
const BOOKING_URL = `${SIK_SITE}/#booking`;
/** The site's own Wind Forecast link (windy.com/11.460/120.221), checked 2026-10-12. */
export const SIK_COORDS = { lat: 11.46, lng: 120.221 };

type JsVal = ReturnType<typeof parseJsLiteral>;
type Dict = { [k: string]: JsVal };
const dict = (v: JsVal | undefined): Dict => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const list = (v: JsVal | undefined): JsVal[] => (Array.isArray(v) ? v : []);
const str = (v: JsVal | undefined): string => (typeof v === 'string' ? collapse(v) : '');
const num = (v: JsVal | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** The site uses en/em dashes and the multiplication sign in labels; normalise for text output. */
const plain = (s: string): string => s.replace(/[–—]/g, '-').replace(/×/g, 'x');

// --- local helpers ----------------------------------------------------------------------------
/** Index just past the {...}/[...] value starting at `i`, honoring strings and template strings. */
function endOfValue(src: string, i: number): number {
  const open = src[i];
  if (open === '"' || open === "'" || open === '`') {
    for (let j = i + 1; j < src.length; j++) {
      if (src[j] === '\\') { j++; continue; }
      if (src[j] === open) return j + 1;
    }
    return src.length;
  }
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '"' || c === "'" || c === '`') { j = endOfValue(src, j) - 1; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return j + 1; }
  }
  return src.length;
}

/** Parse the array literal that starts at the first match of `anchor` (the match must start at `[`). */
function arrayAt(bundle: string, anchor: RegExp): JsVal[] {
  const m = anchor.exec(bundle);
  if (!m) return [];
  const start = m.index + m[0].indexOf('[');
  return list(parseJsLiteral(bundle.slice(start, endOfValue(bundle, start))));
}

const memo = new Map<string, { at: number; p: Promise<string> }>();
function once(url: string, accept?: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, accept ? { accept } : {});
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

async function loadSite(): Promise<{ shell: string; bundle: string }> {
  const shell = await once(SIK_PAGE_URL);
  const bundleUrl = sikBundleUrl(shell);
  if (!bundleUrl) throw new Error('secret-island: no /assets/index-*.js module script in the page shell (site rebuilt?)');
  const bundle = await once(bundleUrl, 'application/javascript,*/*;q=0.8');
  if (!/=\[\{month:"/.test(bundle)) throw new Error('secret-island: joiner tour list [{month:..}] not found in the bundle');
  return { shell, bundle };
}

// --- pure parsers -----------------------------------------------------------------------------
/** The module script of the Base44 shell ("/assets/index-<hash>.js"). */
export function sikBundleUrl(shellHtml: string): string | null {
  const m = shellHtml.match(/<script[^>]+src="(\/assets\/index-[^"]+\.js)"/);
  return m ? new URL(m[1], SIK_SITE).toString() : null;
}

export interface SikStay {
  /** form value, e.g. "dec-14" */
  code: string;
  arrival: string;
  departure: string;
  nights: number;
  tag: string;
  wind: string | null;
  teaser: string | null;
  image: string | null;
}

function nightsBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** The dated joiner tours: one entry per `slots[].dates` pair of the month list. */
export function parseSikStays(bundle: string): SikStay[] {
  const out: SikStay[] = [];
  for (const monthVal of arrayAt(bundle, /=\[\{month:"/)) {
    const month = dict(monthVal);
    for (const slotVal of list(month.slots)) {
      const slot = dict(slotVal);
      const dates = list(slot.dates).map(d => str(d));
      if (dates.length !== 2 || !/^\d{4}-\d{2}-\d{2}$/.test(dates[0]) || !/^\d{4}-\d{2}-\d{2}$/.test(dates[1])) continue;
      const nights = nightsBetween(dates[0], dates[1]);
      if (!(nights > 0)) continue;
      out.push({
        code: str(slot.tourValue) || dates[0],
        arrival: dates[0],
        departure: dates[1],
        nights,
        tag: str(month.tag),
        wind: str(month.wind) ? plain(str(month.wind)) : null,
        teaser: str(slot.teaser) || str(month.teaser) || null,
        image: str(slot.image) || null,
      });
    }
  }
  return out.sort((a, b) => a.arrival.localeCompare(b.arrival) || a.code.localeCompare(b.code));
}

export interface SikRoomRate { code: string; name: string; price: number; perPerson: boolean }
export interface SikPricing {
  currency: string;
  /** 2-way speedboat Coron - island, per person */
  transfer: number;
  /** 3 meals, per person per night of the tour */
  meals: number;
  /** per person per started week */
  envFee: number;
  rooms: SikRoomRate[];
}

/** Price components of the enquiry form's cost estimator. */
export function parseSikPricing(bundle: string): SikPricing | null {
  const transfer = bundle.match(/Speedboat transfer \(2-way\) — \$(\d+)\/person/)?.[1];
  const meals = bundle.match(/Full meals \(3×\/day\) — \$(\d+)\/person/)?.[1];
  const envFee = bundle.match(/Environmental fee — \$(\d+)\/person\/week/)?.[1];
  const rooms: SikRoomRate[] = [];
  for (const m of bundle.matchAll(/([a-z]+):\{price:(\d+),perPerson:(!0|!1),label:"([^"]+)"\}/g)) {
    rooms.push({ code: m[1], name: collapse(m[4].split(' — ')[0]), price: Number(m[2]), perPerson: m[3] === '!0' });
  }
  if (!transfer || !meals || !envFee || rooms.length === 0) return null;
  // every amount on the site is printed with "$"; the FAQ names USD (and PHP cash) as accepted currencies
  return { currency: 'USD', transfer: Number(transfer), meals: Number(meals), envFee: Number(envFee), rooms };
}

/** Package price per person for one guest (shared rooms) or for `guests` sharing one unit. */
export function sikTotal(p: SikPricing, room: SikRoomRate, nights: number, guests: number): number {
  const weeks = Math.ceil(nights / 7);
  const perGuest = p.transfer + p.meals * nights + p.envFee * weeks;
  const lodging = room.perPerson ? room.price * nights * guests : room.price * nights;
  return perGuest * guests + lodging;
}

/**
 * The "FROM $X/person" formula of the tour cards, `w=150+30*l+20*p+30*l` (l = nights, p = ceil(l/7)),
 * as { base, perNight, perWeek } (checked 2026-10-12: 150 / 60 / 20). Null when the code changed shape.
 */
export function parseSikCardFormula(bundle: string): { base: number; perNight: number; perWeek: number } | null {
  const m = bundle.match(/\w=(\d+)\+(\d+)\*(\w)\+(\d+)\*(\w)\+(\d+)\*(\w);return\{\.\.\.\w,arrival:/);
  if (!m || m[3] !== m[7] || m[5] === m[3]) return null;
  return { base: Number(m[1]), perNight: Number(m[2]) + Number(m[6]), perWeek: Number(m[4]) };
}

export function sikCardPrice(f: { base: number; perNight: number; perWeek: number }, nights: number): number {
  return f.base + f.perNight * nights + f.perWeek * Math.ceil(nights / 7);
}

const ROOM_ORDER = ['dorm', 'ahut', 'private', 'lux'];

export function buildSikSlots(stays: SikStay[], pricing: SikPricing, today: string, availabilityText: string | null): Slot[] {
  const out: Slot[] = [];
  const rooms = [...pricing.rooms].sort((a, b) => ROOM_ORDER.indexOf(a.code) - ROOM_ORDER.indexOf(b.code));
  for (const s of stays) {
    if (s.departure < today) continue;
    for (const r of rooms) {
      const guests = r.perPerson ? 1 : 2;
      const total = sikTotal(pricing, r, s.nights, guests);
      out.push({
        key: `${r.code}|${s.arrival}`,
        startDate: s.arrival,
        endDate: s.departure,
        unit: r.name,
        price: Math.round((total / guests) * 100) / 100,
        currency: pricing.currency,
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: guests,
        availability: 'on_request',
        availabilityText,
        spotsLeft: null,
        priceTotal: guests > 1 ? total : null,
        packageNights: s.nights,
      });
    }
  }
  return out;
}

export interface SikRoomCard { name: string; price: number | null; unit: string; capacity: string; description: string; image: string | null }

/** `X="https://media.base44.com/..."` constant assignments, so `image:VD` can be resolved. */
function urlConstants(bundle: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of bundle.matchAll(/(?:const |,)([A-Za-z_$][\w$]*)="(https:\/\/media\.base44\.com\/images\/public\/[^"]+)"/g)) out.set(m[1], m[2]);
  return out;
}

export function parseSikRoomCards(bundle: string): SikRoomCard[] {
  const consts = urlConstants(bundle);
  const at = bundle.search(/=\[\{name:"Dormitory/);
  if (at < 0) return [];
  const src = bundle.slice(at + 1, endOfValue(bundle, at + 1));
  // image is a string or a constant name (parseJsLiteral turns identifiers into null): read it from the source
  const images = new Map<string, string>();
  for (const m of src.matchAll(/\{name:"([^"]+)",icon:[\w$]+,image:(?:"([^"]+)"|([A-Za-z_$][\w$]*))/g)) {
    const url = m[2] ?? consts.get(m[3]);
    if (url) images.set(m[1], url);
  }
  return list(parseJsLiteral(src)).map(v => {
    const c = dict(v);
    const name = str(c.name);
    return { name, price: num(c.price), unit: str(c.unit), capacity: str(c.capacity), description: str(c.desc), image: images.get(name) ?? null };
  }).filter(r => r.name);
}

export interface SikCourse { title: string; subtitle: string; description: string; price: string }
export function parseSikCourses(bundle: string): SikCourse[] {
  return arrayAt(bundle, /=\[\{level:"01"/).map(v => {
    const c = dict(v);
    return { title: str(c.title), subtitle: str(c.subtitle), description: str(c.desc), price: plain(str(c.price)) };
  }).filter(c => c.title);
}

export function parseSikFaq(bundle: string): Array<{ q: string; a: string }> {
  return arrayAt(bundle, /=\[\{q:"/).map(v => ({ q: str(dict(v).q), a: str(dict(v).a) })).filter(x => x.q && x.a);
}

/** The spot facts list ["750M+ Riding Zone","Plenty of room ..."], ["16-26 Knots", ...], ... */
export function parseSikSpotFacts(bundle: string): Array<[string, string]> {
  const i = bundle.indexOf('Reliable Amihan');
  if (i < 0) return [];
  const start = bundle.lastIndexOf('[[', i);
  if (start < 0) return [];
  return list(parseJsLiteral(bundle.slice(start, endOfValue(bundle, start))))
    .map(p => list(p).map(x => plain(str(x))))
    .filter((p): p is [string, string] => p.length === 2 && !!p[0]);
}

/** "Your Joiners Tour includes: a, b, 3 meals a day – breakfast, lunch and dinner, ..." -> items. */
export function sikInclusions(faq: Array<{ q: string; a: string }>): string[] {
  const a = faq.find(f => /included in the joiners? tour/i.test(f.q))?.a;
  if (!a) return [];
  const body = a.replace(/^.*?includes:\s*/i, '').split(/\.\s/)[0].replace(/\.$/, '')
    .replace(/\s+[–—-]\s+(breakfast, lunch and dinner)/i, ' ($1)');
  return body.split(/,\s*(?![^()]*\))/).map(x => collapse(x.replace(/^and\s+/i, '').replace(/^your\s+/i, '')))
    .filter(Boolean).map(x => x[0].toUpperCase() + x.slice(1));
}

/** Logo file name from the shell's favicon (same photo is og:image, JSON-LD logo and invoice logo). */
export function sikLogoName(shellHtml: string): string | null {
  const href = shellHtml.match(/<link[^>]+href="([^"]+)"[^>]*rel="icon"/)?.[1] ?? shellHtml.match(/<link[^>]+rel="icon"[^>]*href="([^"]+)"/)?.[1];
  const file = href?.split('/').pop();
  // "1ef9ef86e_469066337_..._n.jpg": drop the Base44 upload prefix, keep the original name
  return file ? file.replace(/^[0-9a-f]{9}_/, '') : null;
}

const NOT_A_PHOTO = /screenshot\d|generated_image|logo/i;

/** Camp photos, best first (hero, spot, tour cards, rooms, course, galleries); no drink posters, no logo. */
export function sikImages(bundle: string, logoName: string | null, max = 30): string[] {
  const consts = urlConstants(bundle);
  const posterVars = new Set([...bundle.matchAll(/src:([A-Za-z_$][\w$]*),alt:"[^"]*(?:poster|lineup|menu)[^"]*"/gi)].map(m => m[1]));
  const posters = new Set([...posterVars].map(v => consts.get(v)).filter((u): u is string => !!u));
  const out: string[] = [];
  for (const m of bundle.matchAll(/https:\/\/media\.base44\.com\/images\/public\/[^"'`\s)]+\.(?:jpe?g|png|webp)/gi)) {
    const u = m[0];
    if (posters.has(u) || NOT_A_PHOTO.test(u)) continue;
    if (logoName && u.endsWith(logoName)) continue;
    if (!out.includes(u)) out.push(u);
  }
  return out.slice(0, max);
}

export function sikHeroVideo(bundle: string): string | null {
  return bundle.match(/https:\/\/media\.base44\.com\/videos\/public\/[^"'`\s)]+\.mp4/)?.[0] ?? null;
}

/** The enquiry form's own words about availability. */
export function sikAvailabilityText(bundle: string): string | null {
  return bundle.match(/Send an inquiry, and we will get back to you regarding availability[^"]*/)?.[0] ?? null;
}

function mode(xs: number[]): number | null {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: number | null = null;
  for (const [x, n] of counts) if (best === null || n > counts.get(best)! || (n === counts.get(best)! && x < best)) best = x;
  return best;
}

const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function parseSecretIslandContent(shell: string, bundle: string): OfferContent {
  const stays = parseSikStays(bundle);
  const pricing = parseSikPricing(bundle);
  const card = parseSikCardFormula(bundle);
  const roomCards = parseSikRoomCards(bundle);
  const courses = parseSikCourses(bundle);
  const faq = parseSikFaq(bundle);
  const facts = parseSikSpotFacts(bundle);
  const included = sikInclusions(faq);
  const nights = stays.map(s => s.nights);
  const typicalNights = mode(nights);
  const lessons = courses.filter(c => !/rental/i.test(c.title));
  const rental = courses.find(c => /rental/i.test(c.title));
  const faqA = (re: RegExp) => faq.find(f => re.test(f.q))?.a ?? '';
  const season = facts.find(f => /→|->/.test(f[0]))?.[0]?.replace(/\s*(→|->)\s*/, ' to ') ?? null;
  const knots = facts.find(f => /knots/i.test(f[0]))?.[0] ?? null;

  const rooms: ContentRoom[] = roomCards.map(r => ({
    name: r.name,
    description: r.description || null,
    features: [
      r.capacity || null,
      r.price !== null ? `USD ${r.price} per ${r.unit.replace(/\/day$/, '/night').replace('/', ' per ')}` : null,
    ].filter((x): x is string => !!x),
  }));

  const first = stays[0]?.arrival;
  const last = stays[stays.length - 1]?.departure;
  const summary = [
    'Secret Island Kite Camp is a kite camp on a remote island in the Sulu Sea off Palawan, about two hours by speedboat from Coron.',
    `Guests join scheduled ${nights.length ? `${Math.min(...nights)}- to ${Math.max(...nights)}-night ` : ''}joiner tours${first && last ? ` (${fmtDate(first)} to ${fmtDate(last)})` : ''} that include the return speedboat transfer, three meals a day, the environmental fee and a bed in a dome tent or the bamboo hut.`,
    `The riding area is flat, shallow water with a sandy bottom, about 750 m across the wind; the main season runs ${season ?? 'November to April'} with Amihan trade winds of ${knots ? knots.toLowerCase() : 'about 16-26 knots'}.`,
    'Kite lessons for beginners and refreshers and gear rental are booked separately on the island.',
  ].join(' ');

  const optional = [
    ...lessons.map(c => `${c.title}${c.price ? ` (${c.price.replace(/\$(\d+)/g, 'USD $1')})` : ''}`),
    ...(rental ? rental.price.split(/\s*·\s*/).map(p => `Kite gear rental: ${p.replace(/\$(\d+)/g, 'USD $1')}`) : []),
    'Bar drinks',
    /minimum 6 pax/i.test(bundle) ? 'Custom dates for groups of at least 6 guests' : null,
  ].filter((x): x is string => !!x);

  const sourceLines = [
    `meta: ${collapse(shell.match(/<meta content="([^"]+)" name="description"/)?.[1] ?? '')}`,
    `spot: ${facts.map(f => `${f[0]}: ${f[1]}`).join(' | ')}`,
    `wind forecast: windy.com/${SIK_COORDS.lat.toFixed(3)}/${SIK_COORDS.lng}`,
    ...stays.map(s => `tour ${s.code}: ${s.arrival}..${s.departure} (${s.nights} nights) ${s.tag} wind ${s.wind ?? '-'}${card ? ` card price ${sikCardPrice(card, s.nights)} USD/person` : ''}`),
    pricing ? `estimator: transfer ${pricing.transfer} USD/person, meals ${pricing.meals} USD/person/day, environmental fee ${pricing.envFee} USD/person/week; rooms ${pricing.rooms.map(r => `${r.name} ${r.price} USD/${r.perPerson ? 'person' : 'unit'}/night`).join(', ')}` : 'estimator: not found',
    ...roomCards.map(r => `room: ${r.name} - ${r.capacity} - ${r.description}`),
    ...courses.map(c => `course: ${c.title} (${c.subtitle}) ${c.price} - ${c.description}`),
    `included: ${faqA(/included in the joiners? tour/i)}`,
    `meals: ${faqA(/meals included/i)}`,
    `payment: ${faqA(/bring cash/i)}`,
    `meeting point: ${faqA(/where and when do we meet/i)}`,
    `booking: ${faqA(/how do i book/i)} ${sikAvailabilityText(bundle) ?? ''}`,
    `hero video: ${sikHeroVideo(bundle) ?? '-'}`,
  ];

  return {
    kind: 'camp',
    title: 'Secret Island Kite Camp',
    summary,
    continent: 'Asia',
    country: 'Philippines',
    region: 'Palawan',
    spot: 'Secret Island',
    spotCoords: SIK_COORDS,
    itinerarySpots: [],
    durationDays: typicalNights !== null ? typicalNights + 1 : null,
    // FAQ "Do I need to know how to kitesurf?": "from complete beginners ... to experienced riders"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: lessons.length > 0,
    equipmentRental: !!rental,
    beginnerFriendly: /good for beginners/i.test(faq.map(f => f.q).join(' ')),
    includedServices: included,
    optionalServices: optional,
    accommodation: 'dome tents and a bamboo hut by the water',
    mealPlan: 'full_board',
    languages: [],
    rooms,
    imageUrls: sikImages(bundle, sikLogoName(shell)),
    heroVideoUrl: null,
    sourceUrl: SIK_PAGE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: sourceLines.join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const secretIslandKiteCampPalawan: OfferAdapter = {
  key: 'secret-island-kite-camp-palawan',
  name: 'Secret Island Kite Camp',
  kind: 'camp',
  operator: {
    name: 'Secret Island Kite Camp',
    websiteUrl: SIK_SITE,
    rootDomain: 'secretislandkitecamp.com',
    // FAQ "Who is in charge ...": "WhatsApp: +63 947 794 2821. Email: jakobsentour@gmail.com." (2026-10-12)
    contactEmail: 'jakobsentour@gmail.com',
    whatsapp: '+639477942821',
  },
  url: SIK_PAGE_URL,
  slotMethod: 'html_dates',
  fetchBudget: 3,
  async fetchContent() {
    const { shell, bundle } = await loadSite();
    return parseSecretIslandContent(shell, bundle);
  },
  async fetchSlots(ctx) {
    const { bundle } = await loadSite();
    const stays = parseSikStays(bundle);
    if (stays.length === 0) throw new Error('secret-island: no dated joiner tours in the bundle');
    const pricing = parseSikPricing(bundle);
    if (!pricing) throw new Error('secret-island: cost estimator (transfer / meals / fee / room prices) not found in the bundle');
    // guard: the estimator's dormitory price must equal the "FROM $X/person" the tour cards print
    const dorm = pricing.rooms.find(r => r.perPerson);
    const card = parseSikCardFormula(bundle);
    if (!card) ctx.note('tour-card price formula not found in the bundle (site code changed?)');
    else if (dorm) {
      const off = stays.filter(s => sikTotal(pricing, dorm, s.nights, 1) !== sikCardPrice(card, s.nights));
      if (off.length) ctx.note(`dormitory price differs from the tour card for ${off.map(s => s.code).join(', ')}: check the bundle`);
    }
    return buildSikSlots(stays, pricing, todayIso(), sikAvailabilityText(bundle));
  },
};
