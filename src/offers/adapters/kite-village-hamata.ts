// ---------------------------------------------------------------------------
// Kite Village, Hamata (Red Sea, Egypt) - bungalows + tiny houses with half board, own VDWS kite school.
//
// Data path (checked 2026-10-09):
//   content  kite-village.com is a Base44 single-page app: the HTML is an empty shell, every text
//            lives in the JS bundle (/assets/index-<hash>.js, hash changes per deploy) as an i18n
//            object {en:{nav:{...},hero:{...},accommodation:{...},...},de:{...},...} plus an image map
//            and the accommodation JSX (priceDouble "€ 110" etc.). We read the shell, follow its
//            module script, cut the `en` object out of the bundle and parse it as a JS literal.
//   slots    booking engine = Leão Booking (myleao.com, station 101), public JSON without login:
//            GET /api/product/station/101  -> all products; rooms are sold as "<room> N Nächte"
//                                             variants, the 1-night variant gives the nightly price
//            GET /api/product/available/<parentProduct>/<resource>/<startUnix>/<endUnix>/en/0
//                                          -> month check for one room resource: no `error` = some room
//                                             of that type is free every night; otherwise `notAvail`
//                                             lists the nights the engine's best room is taken and
//                                             `error` says "may not be available for the entire travel
//                                             period"; `bookedOut: true` = nothing bookable.
//            Rates are flat across the season (the per-date variation endpoint returned the same 110 EUR
//            for Nov, Dec and Mar on 2026-10-09), so the month price is the 1-night product price.
// robots.txt (2026-10-09): kite-village.com "Allow: /"; www.myleao.com/robots.txt is 404 (= allow all).
// Requests per run: content 2 (shell + bundle), slots 1 + 2 resources x MONTHS (6) = 13.
// Parsed: slot = room type x occupancy x month ("bungalow-double|2026-11"), EUR per room per night,
//   occupancy = persons the product is sold for (1/2/3).
// Known limits: resource ids (bungalow 500, tiny house 606) are constants from
//   /api/ressource/product/<id>/en (2026-10-09) - a re-setup of the station changes them, which shows
//   as `bookedOut` on every month and is then reported as an error instead of "sold out".
//   The month check reflects the engine's best single room, so "limited" means no room of that type
//   is free for the whole month, not that only a few rooms are left.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, iso, runsOf, todayIso } from '../parse.js';
import type { Availability, ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

export const KV_SITE = 'https://kite-village.com';
export const KV_PAGE_URL = `${KV_SITE}/accommodation`;
const LEAO = 'https://www.myleao.com';
export const KV_PRODUCTS_URL = `${LEAO}/api/product/station/101`;
const BOOKING_URL = `${LEAO}/station/101/en`;
const MONTHS = 6;

/** Leão room resources per room category (from /api/ressource/product/<parent>/en, 2026-10-09). */
export const KV_RESOURCES: Record<KvCategory, number> = { bungalow: 500, 'tiny-house': 606 };

export type KvCategory = 'bungalow' | 'tiny-house';
export interface KvRoomProduct {
  category: KvCategory;
  /** stable slug, e.g. "bungalow-double" */
  slug: string;
  unit: string;
  parentId: number;
  persons: number;
  nightly: number;
  currency: string;
}
export interface KvMonthStatus { availability: Availability; text: string | null }

// --- JS literal parsing (the bundle's i18n object is a JS object literal, not JSON) -------------
/** Index just past the value starting at `i` ({...} / [...] / string), honoring strings and templates. */
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

type JsVal = string | number | boolean | null | JsVal[] | { [k: string]: JsVal };

/** Minimal parser for minified object literals: identifier/quoted keys, strings, template strings
 *  without ${}, numbers, !0/!1, nested objects/arrays. Anything else becomes null. */
export function parseJsLiteral(src: string): JsVal {
  let i = 0;
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const str = (): string => {
    const q = src[i];
    const end = endOfValue(src, i);
    const body = src.slice(i + 1, end - 1);
    i = end;
    if (q === '`') return body;
    try { return JSON.parse(`"${body.replace(/\\'/g, "'").replace(/"/g, '\\"').replace(/\\\\"/g, '\\"')}"`); } catch { return body; }
  };
  const val = (): JsVal => {
    ws();
    const c = src[i];
    if (c === '{') {
      i++;
      const o: { [k: string]: JsVal } = {};
      for (;;) {
        ws();
        if (src[i] === '}') { i++; return o; }
        let key: string;
        if (src[i] === '"' || src[i] === "'") key = str();
        else { const m = src.slice(i).match(/^[A-Za-z_$][\w$]*/); if (!m) return o; key = m[0]; i += key.length; }
        ws(); if (src[i] === ':') i++;
        o[key] = val();
        ws(); if (src[i] === ',') i++;
      }
    }
    if (c === '[') {
      i++;
      const a: JsVal[] = [];
      for (;;) {
        ws();
        if (src[i] === ']') { i++; return a; }
        a.push(val());
        ws(); if (src[i] === ',') i++;
      }
    }
    if (c === '"' || c === "'" || c === '`') return str();
    if (src.startsWith('!0', i)) { i += 2; return true; }
    if (src.startsWith('!1', i)) { i += 2; return false; }
    const num = src.slice(i).match(/^-?\d+(?:\.\d+)?/);
    if (num) { i += num[0].length; return Number(num[0]); }
    // unknown expression: skip to the next , } or ] at this depth
    while (i < src.length && !/[,}\]]/.test(src[i])) i++;
    return null;
  };
  return val();
}

type Dict = { [k: string]: JsVal };
const dict = (v: JsVal | undefined): Dict => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const s = (v: JsVal | undefined): string => (typeof v === 'string' ? collapse(v) : '');

// --- pure parsers -----------------------------------------------------------------------------
/** The module script of the Base44 shell ("/assets/index-<hash>.js"). */
export function kvBundleUrl(shellHtml: string): string | null {
  const m = shellHtml.match(/<script[^>]+src="(\/assets\/index-[^"]+\.js)"/);
  return m ? new URL(m[1], KV_SITE).toString() : null;
}

/** The English i18n object of the bundle (`{en:{nav:{home:...}}}`). */
export function kvTexts(bundle: string): Dict {
  const at = bundle.indexOf('{en:{nav:{');
  if (at < 0) return {};
  const start = at + '{en:'.length;
  return dict(parseJsLiteral(bundle.slice(start, endOfValue(bundle, start))));
}

/** Site languages = top-level i18n keys next to `en` ({en:{nav..},de:{nav..},it:...}). */
export function kvLanguages(bundle: string): string[] {
  const out: string[] = [];
  for (const m of bundle.matchAll(/[{,]([a-z]{2}):\{nav:\{home:/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

export interface KvAccommodationCard { key: string; title: string; description: string; amenities: string[]; priceDouble: string | null; priceSingle: string | null; included: string | null }

/** The two accommodation cards of the JSX (title/description/amenities reference the i18n keys). */
export function kvAccommodationCards(bundle: string, texts: Dict): KvAccommodationCard[] {
  const acc = dict(texts.accommodation);
  const out: KvAccommodationCard[] = [];
  const re = /title:e\.accommodation\.(\w+),description:e\.accommodation\.(\w+),amenities:\[([^\]]*)\],priceDouble:"([^"]*)"/g;
  for (const m of bundle.matchAll(re)) {
    const tail = bundle.slice(m.index! + m[0].length, m.index! + m[0].length + 800);
    const single = tail.match(/^[^}]*?priceSingle:"([^"]*)"/)?.[1] ?? null;
    const included = tail.match(/included:t==="de"\?"[^"]*":"([^"]*)"/)?.[1] ?? null;
    out.push({
      key: m[1],
      title: s(acc[m[1]]) || m[1],
      description: s(acc[m[2]]),
      amenities: [...m[3].matchAll(/e\.accommodation\.(\w+)/g)].map(a => s(acc[a[1]])).filter(Boolean),
      priceDouble: m[4] || null,
      priceSingle: single,
      included: included ? collapse(included.replace(/^\*\s*/, '')) : null,
    });
  }
  return out;
}

const PHOTO_JUNK = /logo|generated|\/images\.jpe?g$|unknown\.jpg$/i;

/** Real photos from the bundle, best first: the accommodation image map (Ot = {bungalow:..}) first. */
export function kvImages(bundle: string, max = 30): string[] {
  const all = [...bundle.matchAll(/https:\/\/media\.base44\.com\/images\/public\/[^"'`\s)]+\.(?:jpe?g|webp)/gi)].map(m => m[0]);
  const out: string[] = [];
  for (const u of all) if (!PHOTO_JUNK.test(u) && !out.includes(u)) out.push(u);
  return out.slice(0, max);
}

export function kvPriceLists(bundle: string): string[] {
  return [...new Set([...bundle.matchAll(/https:\/\/media\.base44\.com\/files\/public\/[^"'`\s]+\.pdf/g)].map(m => m[0]))];
}

const PERSONS_LABEL: Record<number, string> = { 1: 'single', 2: 'double', 3: 'triple' };
export const KV_ROOM_NAMES: Record<KvCategory, string> = { bungalow: 'Bungalow', 'tiny-house': 'Tiny House' };
const CARD_CATEGORY: Record<string, KvCategory> = { bungalows: 'bungalow', tinyHouses: 'tiny-house' };

/** 1-night room products of the Leão station (prices per room per night). */
export function parseKvRoomProducts(json: string): KvRoomProduct[] {
  const data = (JSON.parse(json) as { data?: Record<string, { tag_name: string; products: Array<Record<string, unknown>> }> }).data ?? {};
  const out: KvRoomProduct[] = [];
  for (const tag of Object.values(data)) {
    const tagName = String(tag.tag_name ?? '');
    for (const p of tag.products ?? []) {
      const name = String(p.name ?? '');
      if (Number(p.duration_net) !== 86400 || !(Number(p.price) > 0)) continue;
      const category: KvCategory | null = /tiny house/i.test(`${tagName} ${name}`) ? 'tiny-house'
        : /bungalow|hotel/i.test(`${tagName} ${name}`) ? 'bungalow' : null;
      if (!category) continue;
      const persons = Number(p.students) || 0;
      if (persons < 1 || !PERSONS_LABEL[persons]) continue;
      out.push({
        category,
        slug: `${category}-${PERSONS_LABEL[persons]}`,
        // unit = the room name of OfferContent.rooms (ingest joins on it); occupancy says single/double/triple
        unit: KV_ROOM_NAMES[category],
        parentId: Number(p.p_id),
        persons,
        nightly: Number(p.price),
        currency: String(p.currency ?? 'EUR'),
      });
    }
  }
  return out;
}

/** Days in a month (month 1-12). */
function daysIn(year: number, month: number): number { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

/** UTC unix window of a calendar month, as the engine answers it (end = last second of the month). */
export function kvMonthWindow(year: number, month: number): { start: number; end: number } {
  return { start: Date.UTC(year, month - 1, 1) / 1000, end: Date.UTC(year, month, 1) / 1000 - 1 };
}

/** One month check of /api/product/available for one room resource. */
export function parseKvMonth(json: string, year: number, month: number): KvMonthStatus {
  const d = (JSON.parse(json) as { data?: Record<string, unknown> }).data ?? {};
  const err = typeof d.error === 'string' ? collapse(d.error) : null;
  if (d.bookedOut === true) return { availability: 'sold_out', text: err ?? 'booked out' };
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const blocked = (Array.isArray(d.notAvail) ? d.notAvail : []).filter((x): x is string => typeof x === 'string' && x.startsWith(prefix));
  const nights = daysIn(year, month);
  if (!err && blocked.length === 0) return { availability: 'available', text: null };
  if (blocked.length >= nights) return { availability: 'sold_out', text: `no night free in ${prefix.slice(0, 7)}${err ? ` (${err})` : ''}` };
  if (blocked.length > 0) {
    return {
      availability: 'limited',
      text: `${nights - blocked.length} of ${nights} nights free in one room (taken ${blocked[0]}..${blocked[blocked.length - 1]})${err ? `; ${err}` : ''}`,
    };
  }
  return { availability: 'unknown', text: err };
}

export type KvNightState = 'free' | 'taken' | 'booked_out' | 'unknown';

/** Night-level state of one month check: `notAvail` lists the taken nights (YYYY-MM-DD). */
export function parseKvNights(json: string, year: number, month: number): Array<{ date: string; state: KvNightState }> {
  const d = (JSON.parse(json) as { data?: Record<string, unknown> }).data ?? {};
  const err = typeof d.error === 'string' ? collapse(d.error) : null;
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const blocked = new Set((Array.isArray(d.notAvail) ? d.notAvail : []).filter((x): x is string => typeof x === 'string' && x.startsWith(prefix)));
  const out: Array<{ date: string; state: KvNightState }> = [];
  for (let day = 1; day <= daysIn(year, month); day++) {
    const date = iso(year, month, day);
    const state: KvNightState = d.bookedOut === true ? 'booked_out'
      : blocked.has(date) ? 'taken'
      : err && blocked.size === 0 ? 'unknown'
      : 'free';
    out.push({ date, state });
  }
  return out;
}

const KV_NIGHT_TEXT: Record<KvNightState, string> = {
  free: 'free every night',
  // the engine answers for the one room item it would assign; with dozens of bungalows other rooms may be free (unverified)
  taken: 'not free in the room the engine offers; other rooms may be free',
  booked_out: 'booked out',
  unknown: 'no availability answer',
};

/**
 * Bands by night state: one slot per room product and run of nights with the same state, so a
 * band ends where the engine's availability changes, not at a month end. Prices are flat across
 * seasons (EUR 110 double bungalow in Nov, Dec and Mar, checked 2026-10-09). Nights before
 * `today` are dropped.
 */
export function buildKvRunSlots(
  rooms: KvRoomProduct[],
  nights: Partial<Record<KvCategory, Array<{ date: string; state: KvNightState }>>>,
  today: string,
): Slot[] {
  const out: Slot[] = [];
  for (const r of rooms) {
    const list = (nights[r.category] ?? []).filter(n => n.date >= today).sort((x, y) => x.date.localeCompare(y.date));
    for (const run of runsOf(list, n => n.state)) {
      const st = run.first.state;
      out.push({
        key: `${r.slug}|${run.start}`,
        startDate: run.start,
        endDate: run.end,
        unit: r.unit,
        price: r.nightly,
        currency: r.currency,
        priceUnit: 'per_night',
        priceBasis: 'room',
        occupancy: r.persons,
        availability: st === 'free' ? 'available' : st === 'taken' ? 'limited' : st === 'booked_out' ? 'sold_out' : 'unknown',
        availabilityText: KV_NIGHT_TEXT[st],
        spotsLeft: null,
      });
    }
  }
  return out;
}

/** Months to check: the current month and the following ones. */
export function kvMonths(today: string, n = MONTHS): Array<{ year: number; month: number }> {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const out: Array<{ year: number; month: number }> = [];
  for (let k = 0; k < n; k++) {
    out.push({ year: y, month: m });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** Slot = room product x month; status comes from the month check of its resource. */
export function buildKvSlots(
  rooms: KvRoomProduct[],
  months: Array<{ year: number; month: number; status: Partial<Record<KvCategory, KvMonthStatus>> }>,
): Slot[] {
  const out: Slot[] = [];
  for (const { year, month, status } of months) {
    for (const r of rooms) {
      const st = status[r.category] ?? { availability: 'unknown' as Availability, text: null };
      out.push({
        key: `${r.slug}|${year}-${String(month).padStart(2, '0')}`,
        startDate: iso(year, month, 1),
        endDate: iso(year, month, daysIn(year, month)),
        unit: r.unit,
        price: r.nightly,
        currency: r.currency,
        priceUnit: 'per_night',
        priceBasis: 'room',
        occupancy: r.persons,
        availability: st.availability,
        availabilityText: st.text,
        spotsLeft: null,
      });
    }
  }
  return out;
}

export function parseKiteVillageContent(bundle: string): OfferContent {
  const t = kvTexts(bundle);
  const hero = dict(t.hero);
  const spot = dict(t.spotguide);
  const acc = dict(t.accommodation);
  const school = dict(t.kiteschool);
  const act = dict(t.activities);
  const contact = dict(t.contact);
  const cards = kvAccommodationCards(bundle, t);
  const count = (re: RegExp, text: string) => text.match(re)?.[1] ?? null;
  const nBungalows = count(/(\d+)\s+bungalows/i, s(acc.bungalowDesc));
  const nTiny = count(/(\d+)\s+tiny houses/i, s(acc.tinyHouseDesc));
  const area = s(spot.desc).match(/approximately\s+([\d\s×x]+km)/i)?.[1]?.replace(/\s*×\s*/, ' x ') ?? null;

  const courses = ['beginner', 'refresh', 'crash', 'private'].filter(k => s(school[k])).map(k => {
    const det = dict(school[`${k}Details`]);
    const price = s(det.price).replace(/^Price:\s*/i, '');
    const pricing = Array.isArray(det.pricing) ? det.pricing.map(p => `${s(dict(p).label)} ${s(dict(p).price)}`).join(', ') : '';
    return `${s(school[k])}${price ? ` (${price})` : pricing ? ` (${pricing})` : ''}`;
  });
  const activities = ['sup', 'snorkel', 'dolphin', 'quad', 'desert'].map(k => s(act[k])).filter(Boolean);
  const included = cards[0]?.included?.replace(/^Price includes:\s*/i, '').split(/,\s*|\s+and\s+/).map(x => collapse(x)).filter(Boolean)
    ?? ['Breakfast', 'dinner'];

  const rooms: ContentRoom[] = cards.map(c => ({
    name: CARD_CATEGORY[c.key] ? KV_ROOM_NAMES[CARD_CATEGORY[c.key]] : c.title,
    description: c.description || null,
    features: [
      ...c.amenities,
      c.priceDouble ? `Double room from ${c.priceDouble.replace('€', 'EUR').trim()} per night (half board)` : null,
      c.priceSingle ? `Single room from ${c.priceSingle.replace('€', 'EUR').trim()} per night (half board)` : null,
    ].filter((x): x is string => !!x),
  }));

  const summary = [
    `Kite-Village Hamata is a kite resort with its own kite school on the Red Sea coast of southern Egypt, at a shallow lagoon${area ? ` of about ${area}` : ''} that is mostly knee- to waist-deep.`,
    `Guests stay in ${nBungalows ? `${nBungalows} ` : ''}bungalows (2-minute walk to the kite station) or ${nTiny ? `${nTiny} ` : ''}tiny houses (5-minute walk); breakfast and dinner are included.`,
    `The VDWS school runs beginner, refresher, crash and private courses and rents equipment; the nearest airport is Marsa Alam (RMF).`,
  ].join(' ');

  const sourceLines = [
    `hero: ${s(hero.sub)} ${s(hero.text)}`,
    `spot: ${s(spot.desc)} | wind: ${s(spot.windDesc)} | water: ${s(spot.waterDesc)} | temperature: ${s(spot.tempDesc)}`,
    ...cards.map(c => `room: ${c.title} - ${c.description} | ${c.amenities.join(', ')} | double ${c.priceDouble ?? '-'} | single ${c.priceSingle ?? '-'} | ${c.included ?? ''}`),
    `courses: ${courses.join('; ')}`,
    `rental: ${s(school.rentalDesc)}`,
    `activities: ${activities.join(', ')}`,
    `getting there: ${s(contact.howToReachDesc)}`,
    `price lists: ${kvPriceLists(bundle).join(' ')}`,
  ];

  return {
    kind: 'accommodation',
    title: 'Kite Village Hamata',
    summary,
    continent: 'Africa',
    country: 'Egypt',
    region: 'Red Sea',
    spot: 'Hamata',
    itinerarySpots: [],
    durationDays: null,
    // spot guide: "perfect destination for riders of all skill levels"; courses for beginners and advanced (2026-10-09)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: courses.length > 0,
    equipmentRental: !!s(school.rental),
    beginnerFriendly: /beginner/i.test(`${s(dict(t.why).lagoonDesc)} ${s(spot.desc)}`) || !!s(school.beginner),
    includedServices: included,
    optionalServices: [...courses, s(school.rental) && 'Equipment rental', s(school.storage) && 'Equipment storage',
      'Airport transfer Marsa Alam / Hurghada', ...activities].filter((x): x is string => !!x),
    accommodation: cards.length ? cards.map(c => c.title.toLowerCase()).join(' and ') : 'bungalows and tiny houses',
    mealPlan: 'half_board',
    languages: kvLanguages(bundle),
    rooms,
    imageUrls: kvImages(bundle),
    heroVideoUrl: null,
    sourceUrl: KV_PAGE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: sourceLines.join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const kiteVillageHamata: OfferAdapter = {
  key: 'kite-village-hamata',
  name: 'Kite Village Hamata',
  kind: 'accommodation',
  operator: {
    name: 'Kite Village',
    websiteUrl: KV_SITE,
    rootDomain: 'kite-village.com',
    contactEmail: 'office@kite-village.com',
    phone: '+201061825751',
  },
  url: KV_PAGE_URL,
  // 1-night product ids per guest count from the station feed (checked 2026-10-12; test asserts they still exist).
  // GET /api/product/available/<product>/<resource>/<start>/<end> answers with a variation priced for that stay.
  quote: {
    engine: 'leao',
    stationId: 101,
    rooms: [
      { unit: KV_ROOM_NAMES.bungalow, resource: KV_RESOURCES.bungalow, products: { '1': 33689, '2': 34093, '3': 34007 } },
      { unit: KV_ROOM_NAMES['tiny-house'], resource: KV_RESOURCES['tiny-house'], products: { '1': 44673, '2': 44716 } },
    ],
  },
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 15,
  async fetchContent() {
    const shell = await fetchText(KV_PAGE_URL);
    const bundleUrl = kvBundleUrl(shell);
    if (!bundleUrl) throw new Error('kite-village: no /assets/index-*.js module script in the page shell (site rebuilt?)');
    const bundle = await fetchText(bundleUrl, { accept: 'application/javascript,*/*;q=0.8' });
    if (!bundle.includes('{en:{nav:{')) throw new Error('kite-village: i18n object {en:{nav:..}} not found in the bundle');
    return parseKiteVillageContent(bundle);
  },
  async fetchSlots(ctx) {
    const rooms = parseKvRoomProducts(await fetchText(KV_PRODUCTS_URL, { accept: 'application/json' }));
    if (rooms.length === 0) throw new Error('kite-village: no 1-night room products in the Leão station feed');
    const parents = new Map<KvCategory, number>();
    for (const r of rooms) if (!parents.has(r.category) || r.persons === 2) parents.set(r.category, r.parentId);
    const months: Array<{ year: number; month: number; status: Partial<Record<KvCategory, KvMonthStatus>> }> = [];
    const nights: Partial<Record<KvCategory, Array<{ date: string; state: KvNightState }>>> = {};
    let failed = 0;
    for (const { year, month } of kvMonths(todayIso())) {
      const status: Partial<Record<KvCategory, KvMonthStatus>> = {};
      for (const [category, parentId] of parents) {
        const w = kvMonthWindow(year, month);
        try {
          const json = await fetchText(`${LEAO}/api/product/available/${parentId}/${KV_RESOURCES[category]}/${w.start}/${w.end}/en/0`, { accept: 'application/json' });
          status[category] = parseKvMonth(json, year, month);
          (nights[category] ??= []).push(...parseKvNights(json, year, month));
        } catch (e) {
          failed++;
          ctx.note(`availability ${category} ${year}-${month}: ${(e as Error).message}`);
        }
      }
      months.push({ year, month, status });
    }
    if (failed > 0) ctx.incomplete(`${failed} month checks failed`);
    // a wrong resource id answers bookedOut for every month: refuse instead of reporting "sold out"
    for (const category of parents.keys()) {
      const all = months.map(m => m.status[category]).filter((x): x is KvMonthStatus => !!x);
      if (all.length >= 3 && all.every(x => x.availability === 'sold_out' && /booked out|not available for this time period/i.test(x.text ?? ''))) {
        throw new Error(`kite-village: resource ${KV_RESOURCES[category]} (${category}) is booked out in every month - resource id probably changed`);
      }
    }
    return buildKvRunSlots(rooms, nights, todayIso());
  },
};
