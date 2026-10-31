// ---------------------------------------------------------------------------
// Campingpark Wulfener Hals, Wulfen (Fehmarn, Schleswig-Holstein, Germany) - year-round camping and holiday
// park between the Burger Binnensee and the Baltic Sea at the Wulfen surf spot; rents ~100 rental trailers,
// mobile homes, holiday homes, a beach bungalow and holiday apartments. The surf school "Windsurfing Wulfen"
// on the park (VDWS instructors) runs kitesurf courses daily from Easter to the end of October.
//
// Data path (checked 2026-10-12), Contao site (the server answers our Accept-Language "en" with its
// machine-translated English version; the parsers read structure, not wording, where they can):
//   content  / (open all year), /surfen-kiten-segeln (Windsurfing Wulfen, kite course price list), the rental pages
//            /mietwohnwagen, /ferienhaeuser-im-baltic-park, /ferienhaeuser-im-duenenpark, /mobilheimpark,
//            /strandbungalow, /ferienwohnungen-am-strand, /ferienwohnungen-am-pool (unit headings <h2>, size /
//            capacity line, equipment <ul>, original photos files/bilder/...).
//   slots    Compusoft online booking: the site's search (/suchen-buchen -> /unterkuenfte-ergebnisliste) embeds csobV2 with
//            portal key d8d8969d-… (checked 2026-10-14). Through the shared helpers of hvide-sande-camping.ts, per sample week
//            the widget's anonymous profile list (getCSProfileListViewModel) + one price call for all free units
//            (GetCSProfilePriceListMultipleProfilesV2, the GET csob.bundle.min.js makes; no login, cookie or token). The park
//            is open all year: one Saturday-to-Saturday week per month (the first Saturday from tomorrow), 12 within 12 months.
//            Units = profiles of the rental groups (subTitle "…, Mietwohnwagen / Ferienhaus / Mobilheim / Ferienwohnung") and
//            the rental-trailer specials ("…, Special Angebote Mietwohnwagen"); pitches, the motorhome park, camping
//            specials, the "Gruppen" trailer profile and the sleeping beach chair are left out.
//   fallback /specials-angebote: the specials table (thead "Special | Description | Term | Nights | Campground | Economy
//            Rental Trailers"): per special a term "02.10.-02.11.2026*" (* / ** / *** = 1 / 2 / 3 weeks within the term, else
//            exactly the term), nights and a package price for the Economy rental trailer. Used only when the engine returns
//            no priced unit (not seen on 2026-10-14). The camping price list /preise covers pitches only.
// robots.txt (2026-10-14): www.wulfenerhals.de disallows only /contao/ and /_contao/; v3.onlinebooking.dk "Allow: /".
// Requests per run: content 10, slots up to 2 per sample week (12) = 24 (+1 specials page only in the fallback) = max 35.
// Parsed (engine): slot = unit type x sample week ("comfort-rental-trailer|2027-06-05"), EUR per unit for 7 nights as quoted
//   by the engine (priceUnit 'package', packageNights 7, priceBasis 'room'); available (>= 3 free) / limited (1-2 free,
//   spotsLeft) / sold_out (0 free while another unit of the SAME rental group is free that week). When a whole group has
//   nothing free in a week (e.g. rental trailers in winter) the group is skipped for that week (closed or not offered, not
//   "sold out"); each special counts as its own group (0 = outside its term); unit types free in none of the sampled weeks
//   are left out. Limit: a group that is fully booked (all its types 0) is skipped too, never shown as sold out.
// Parsed (fallback): one slot per still bookable special (check-in not in the past), EUR per rental trailer per stay
//   (priceUnit 'package', packageNights = nights), availability 'unknown'.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, parse, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import { csobAddDays, csobKeyPart, csobSaturdaySamples, csobSlots, fetchCsobSamples, type CsobPortal, type CsobProfile, type CsobSample } from './hvide-sande-camping.js';

const SITE = 'https://www.wulfenerhals.de';
export const WH_HOME_URL = `${SITE}/`;
export const WH_KITE_URL = `${SITE}/surfen-kiten-segeln`;
export const WH_SPECIALS_URL = `${SITE}/specials-angebote`;
const BOOKING_URL = `${SITE}/suchen-buchen`;
/** rental pages -> unit category label */
export const WH_RENTAL_PAGES: Array<{ path: string; category: string }> = [
  { path: 'mietwohnwagen', category: 'Rental trailer' },
  { path: 'ferienhaeuser-im-baltic-park', category: 'Holiday home Baltic-Park' },
  { path: 'ferienhaeuser-im-duenenpark', category: 'Holiday home Dünenpark' },
  { path: 'mobilheimpark', category: 'Mobile home' },
  { path: 'strandbungalow', category: 'Beach bungalow' },
  { path: 'ferienwohnungen-am-strand', category: 'Beach apartment' },
  { path: 'ferienwohnungen-am-pool', category: 'Pool apartment' },
];
export const WH_ECONOMY_UNIT = 'Economy rental trailer';

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share it */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** The <main> element (header navigation and footer dropped). */
export function whMain(html: string): string {
  const a = html.indexOf('<main');
  const b = html.indexOf('</main>');
  return a >= 0 && b > a ? html.slice(a, b) : html;
}
const text = (html: string): string => clean(html.replace(/<[^>]+>/g, ' '));
/** Visible lines of the main element. */
export function whLines(html: string): string[] {
  return whMain(html)
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|a|strong)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- specials (slots) ---------------------------------------------------------------------------
export interface WhSpecial { name: string; start: string; end: string; nights: number; flexibleWeeks: number; price: number; benefits: string }

/** Specials table: header columns located by name (term / nights / economy rental trailer), rows by <th> name. */
export function parseWhSpecials(html: string): WhSpecial[] {
  const root = parse(whMain(html));
  const table = root.querySelectorAll('table').find(t => /economy/i.test(t.querySelector('thead')?.text ?? ''));
  if (!table) return [];
  const heads = table.querySelectorAll('thead th').map(th => clean(th.text).toLowerCase());
  const col = (re: RegExp, fallback: number) => { const i = heads.findIndex(h => re.test(h)); return i >= 0 ? i : fallback; };
  const iTerm = col(/term|zeitraum|period/, 2);
  const iNights = col(/roofs|nights|n[äa]chte/, 3);
  const iEco = col(/economy/, 5);
  const iDesc = col(/description|beschreibung|leistung/, 1);
  const pageYear = Number(text(html).match(/\b(20\d{2})\b/)?.[1] ?? NaN);
  const out: WhSpecial[] = [];
  for (const tr of table.querySelectorAll('tbody tr')) {
    const cells = tr.querySelectorAll('th, td').map(c => clean(c.text));
    if (cells.length <= Math.max(iTerm, iNights, iEco)) continue;
    const term = cells[iTerm];
    const m = term.match(/(\d{1,2})\.(\d{1,2})\.(?:(\d{2,4})\.?)?\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{4})?(\**)/);
    const nights = Number(cells[iNights]);
    const price = parseAmount(cells[iEco]);
    if (!m || !Number.isInteger(nights) || nights < 1 || !price) continue;
    const endYear = m[6] ? Number(m[6]) : pageYear;
    if (!endYear) continue;
    const startYear = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : endYear;
    let start = iso(startYear, Number(m[2]), Number(m[1]));
    const end = iso(endYear, Number(m[5]), Number(m[4]));
    if (start > end) start = iso(endYear - 1, Number(m[2]), Number(m[1]));
    out.push({ name: cells[0], start, end, nights, flexibleWeeks: m[7].length, price, benefits: cells[iDesc] ?? '' });
  }
  return out;
}

const addDays = (d: string, n: number): string => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

/**
 * Specials still bookable on `today`. A fixed term (no asterisk) is one stay from the term's first to its last day
 * (check-out); a flexible term (* / ** / ***) is a stay of `nights` anywhere inside the term.
 * Slot dates = possible nights: startDate = first night, endDate = last possible night (check-out day - 1).
 */
export function buildWhSlots(specials: WhSpecial[], today: string): Slot[] {
  const out: Slot[] = [];
  for (const s of specials) {
    const lastCheckIn = s.flexibleWeeks > 0 ? addDays(s.end, -s.nights) : s.start;
    if (lastCheckIn < today) continue;
    out.push({
      key: `economy-rental-trailer|${keyPart(s.name)}|${s.start}`,
      startDate: s.start,
      endDate: addDays(s.end, -1),
      unit: `${WH_ECONOMY_UNIT} - ${s.name}`,
      price: s.price,
      currency: 'EUR',
      priceUnit: 'package',
      priceBasis: 'room',
      occupancy: null, // the table's rule: up to 4 people of one family (2 adults + 2 children under 12, or 3 adults)
      availability: 'unknown',
      availabilityText: s.flexibleWeeks > 0 ? `${s.nights} nights within the period` : null,
      spotsLeft: null,
      packageNights: s.nights,
    });
  }
  return out;
}

/** Footnotes and occupancy rule under the specials table. */
export function parseWhSpecialsNotes(html: string): string[] {
  return whLines(html).filter(l => /^\*{1,3} \d week|^Accommodations for up to \d people|^Prices include|^Plus tourist tax/i.test(l));
}

// --- content ----------------------------------------------------------------------------------
export interface WhUnit { category: string; name: string; info: string | null; features: string[] }

/** Unit sections of a rental page: an <h2> with a size / capacity line and an equipment list before the next <h2>. */
export function parseWhUnits(html: string, category: string): WhUnit[] {
  const main = whMain(html);
  const parts = main.split(/(?=<h2[\s>])/);
  const out: WhUnit[] = [];
  for (const seg of parts) {
    const h = seg.match(/^<h2[^>]*>([\s\S]*?)<\/h2>/);
    if (!h) continue;
    const heading = text(h[1]);
    const features = [...seg.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(x => text(x[1])).filter(x => x && x.length < 200);
    const strong = seg.match(/<p[^>]*>\s*<strong>([\s\S]*?)<\/strong>/)?.[1];
    const firstP = seg.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1];
    const info = strong ? text(strong) : firstP ? text(firstP) : null;
    const sized = /m²|square meters|people|persons|sleeps/i.test(`${info ?? ''} ${features.slice(0, 4).join(' ')}`);
    // numbered model headings ("4. Romantiksuite Model") count even without a size line
    if (features.length < 3 || !(sized || /^\d+\.\s/.test(heading))) continue;
    const quoted = heading.match(/["“]([^"”]+)["”]/)?.[1];
    const name = (quoted ?? heading).replace(/^\d+\.\s*/, '').replace(/\s*\*+$/, '').replace(/:$/, '').trim();
    out.push({ category, name, info: info && info.length <= 160 && /m²|people|persons|sleeps|floor/i.test(info) ? info : null, features });
  }
  return out;
}

/** First descriptive paragraph of a page (intro under the title). */
export function whIntro(html: string): string | null {
  return whLines(html).find(l => l.length > 120) ?? null;
}

/** Original photos (files/bilder/...) of the main element: floor plans, logos and layout graphics dropped. */
export function whImages(html: string): string[] {
  const out: string[] = [];
  for (const m of whMain(html).matchAll(/<img src="(files\/bilder\/[^"]+)"/g)) {
    if (/Grundriss|logo|layout|auszeichnung|\.svg|\.png/i.test(m[1])) continue;
    const u = `${SITE}/${m[1]}`;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

/** Kite course prices ("Basis-Block" + "4 hours / 4 students" + "125 EUR per person"). */
export function parseWhKitePrices(html: string): Array<{ course: string; detail: string; price: number }> {
  const ls = whLines(html);
  const i = ls.findIndex(l => /Prices for Our Kiteboarding Courses|Preise.*Kite/i.test(l));
  if (i < 0) return [];
  const out: Array<{ course: string; detail: string; price: number }> = [];
  for (let k = i + 1; k + 2 < ls.length && !/License|Lizenz/i.test(ls[k]); k++) {
    const m = ls[k + 2].match(/^(\d+)\s*EUR per person/i);
    if (m) { out.push({ course: ls[k], detail: ls[k + 1], price: Number(m[1]) }); k += 2; }
  }
  return out;
}

export interface WhPages { home: string; kite: string; specials: string; rentals: Array<{ path: string; html: string }> }

/** Content room name of a unit card: the unit name when it already says the category, else "<category>: <unit>". */
const whRoomName = (cat: string, u: WhUnit) => u.name.toLowerCase().includes(cat.split(' ')[0].toLowerCase()) ? u.name : `${cat}: ${u.name}`;

/** Content room names per rental category (as parseWulfenerHalsContent builds them). */
export function whRoomsByCategory(rentals: WhPages['rentals']): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rentals) {
    const cat = WH_RENTAL_PAGES.find(x => x.path === r.path)?.category ?? r.path;
    const us = parseWhUnits(r.html, cat);
    out.set(cat, us.length ? us.map(u => whRoomName(cat, u)) : [cat]);
  }
  return out;
}

export function parseWulfenerHalsContent(p: WhPages): OfferContent {
  const kite = whLines(p.kite);
  const kitePrices = parseWhKitePrices(p.kite);
  const basis = kitePrices.find(x => /basis/i.test(x.course));
  const season = kite.find(l => /Courses run daily from Easter through the end of October/i.test(l)) ? 'daily from Easter to the end of October' : null;
  const homeText = whLines(p.home).join(' ');
  const units: WhUnit[] = [];
  const rooms: ContentRoom[] = [];
  const imgs: string[] = [];
  for (const r of p.rentals) {
    const cat = WH_RENTAL_PAGES.find(x => x.path === r.path)?.category ?? r.path;
    const us = parseWhUnits(r.html, cat);
    units.push(...us);
    if (us.length === 0) rooms.push({ name: cat, description: whIntro(r.html), features: [] });
    for (const u of us) rooms.push({ name: whRoomName(cat, u), description: u.info, features: u.features });
    for (const u of whImages(r.html).slice(0, 4)) if (!imgs.includes(u)) imgs.push(u);
  }
  for (const u of [...whImages(p.home).slice(0, 6), ...whImages(p.kite)]) if (!imgs.includes(u)) imgs.push(u);
  const trailers = p.rentals.find(r => r.path === 'mietwohnwagen');
  const nTrailers = trailers ? whLines(trailers.html).join(' ').match(/approximately (\d+) rental trailers/i)?.[1] ?? null : null;
  const specials = parseWhSpecials(p.specials);
  const notes = parseWhSpecialsNotes(p.specials);

  const summary = [
    `Campingpark Wulfener Hals is a camping and holiday park on Fehmarn in the Baltic Sea (Schleswig-Holstein, Germany) between the Burger Binnensee and the Baltic Sea, next to the Wulfen surf and kite spot${/open for you all year round/i.test(homeText) ? ', open all year' : ''}.`,
    `Besides pitches it rents ${nTrailers ? `about ${nTrailers}` : ''} rental trailers, mobile homes, holiday homes in the Baltic-Park and Dünenpark, a beach bungalow and holiday apartments by the beach and the pool.`.replace('rents  rental', 'rents rental'),
    `The Windsurfing Wulfen school on the park teaches kitesurfing in small groups with VDWS instructors in shallow water${season ? `, ${season}` : ''}${basis ? ` (basic block ${basis.detail}, EUR ${basis.price} per person)` : ''}, alongside windsurfing, wingfoil and catamaran courses and a rental station.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Campingpark Wulfener Hals',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Schleswig-Holstein',
    spot: 'Wulfen, Fehmarn',
    itinerarySpots: [],
    durationDays: null,
    // kite page: "Experts and beginners alike come from all over to surf and kiteboard in Wulfen"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: kitePrices.length > 0 || kite.some(l => /Want to learn how to kitesurf/i.test(l)),
    equipmentRental: kite.some(l => /rent or purchase equipment/i.test(l)),
    beginnerFriendly: kite.some(l => /ideal for beginners/i.test(l)),
    includedServices: ['Bedding and towels in mobile homes, holiday homes and apartments', 'Pool and hot tub (April to October)', 'Basic Wi-Fi in the rentals'],
    optionalServices: [
      ...kitePrices.map(x => `Kite course ${x.course} (${x.detail}): EUR ${x.price} per person`),
      'VDWS kite license', 'Windsurf, wingfoil, SUP and catamaran courses (Windsurfing Wulfen)', 'Equipment rental at the surf shop',
      'Breakfast buffet, half board or full board', 'Sauna and wellness', 'Golf (Golfpark Fehmarn next door)',
    ],
    accommodation: 'rental trailers, mobile homes, holiday homes, a beach bungalow and holiday apartments on a camping park',
    mealPlan: 'self_catering',
    languages: ['de', 'en'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: WH_KITE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `kite: ${kite.filter(l => l.length > 60).slice(0, 14).join(' | ')}`,
      `kite prices: ${kitePrices.map(x => `${x.course} ${x.detail} ${x.price} EUR`).join('; ')}`,
      `units: ${units.map(u => `${u.category}: ${u.name} (${u.info ?? '-'})`).join('; ')}`,
      `specials (economy rental trailer): ${specials.map(s => `${s.name} ${s.start}..${s.end}${'*'.repeat(s.flexibleWeeks)} ${s.nights}n EUR ${s.price}`).join('; ')}`,
      `specials notes: ${notes.join(' | ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export async function fetchWhSlots(today: string): Promise<Slot[]> {
  const specials = parseWhSpecials(await page(WH_SPECIALS_URL));
  if (specials.length === 0) throw new Error('wulfener-hals: specials table with an "Economy" rental-trailer column not found on /specials-angebote');
  return buildWhSlots(specials, today);
}

// --- Compusoft engine ------------------------------------------------------------------------------
const WH_RENTAL_GROUP = /,\s*(Mietwohnwagen|Ferienhaus|Mobilheim|Ferienwohnung|Special Angebote Mietwohnwagen)\)$/;
export const WH_PORTAL: CsobPortal = {
  portalKey: 'd8d8969d-04b9-4145-b912-dea6ecb852b4',
  language: 'de',
  currency: 'EUR',
  isUnit: p => WH_RENTAL_GROUP.test(p.subTitle) && !/^Gruppen$/i.test(p.title),
};
/** rental group of a profile ("Mietwohnwagen", "Ferienhaus", ..., "Special Angebote Mietwohnwagen") */
export const whGroup = (p: Pick<CsobProfile, 'subTitle'>): string => p.subTitle.match(WH_RENTAL_GROUP)?.[1] ?? '';

/** Engine profile -> English unit name ("Komfort" trailer -> "Comfort rental trailer", "Mobilheim Chatel" -> "Mobile home Chatel"). */
export function whUnitName(p: Pick<CsobProfile, 'title' | 'subTitle'>): string {
  const t = clean(p.title);
  switch (whGroup(p)) {
    case 'Mietwohnwagen': return `${t.replace(/^Komfort$/i, 'Comfort')} rental trailer`;
    case 'Special Angebote Mietwohnwagen': return `Economy rental trailer special: ${t.replace(/^Special\s+/i, '').replace(/\s+Mietwohnwagen$/i, '')}`;
    case 'Ferienhaus': return t.replace(/^Ferienhaus\s+/i, 'Holiday home ');
    case 'Mobilheim': return t.replace(/^Mobilheim\s+/i, 'Mobile home ');
    case 'Ferienwohnung':
      if (/Golfplatz/i.test(t)) return 'Holiday apartment at the golf course';
      if (/Campingplatz/i.test(t)) return 'Holiday apartment on the campsite';
      return t.replace(/^Ferienwohnung(en)?\s+/i, 'Holiday apartment ');
    default: return t;
  }
}

/** Availability group: the rental group, but every special on its own (a special at 0 is outside its term, not sold out). */
const whAvailGroup = (p: Pick<CsobProfile, 'title' | 'subTitle'>): string => {
  const g = whGroup(p);
  return g === 'Special Angebote Mietwohnwagen' ? `${g}|${p.title}` : g;
};

/** Per sample week, rental groups with no free unit at all are dropped (closed / not offered that week, not sold out). */
export function whOpenGroupsOnly(samples: CsobSample[]): CsobSample[] {
  return samples.map(s => {
    const open = new Set(s.profiles.filter(p => p.units > 0).map(whAvailGroup));
    return { ...s, profiles: s.profiles.filter(p => open.has(whAvailGroup(p))) };
  });
}

/**
 * English engine unit -> content room, only where one engine profile prices exactly one content room (or variants of it:
 * the three trailer classes all rent the "Rental trailer" of /mietwohnwagen). Left unlinked: "Holiday home Dünenpark"
 * (one profile for two different house models), the two apartment profiles (golf course = apartments at the Golf Park in
 * Burg, not on our pages; "on the campsite" = beach or pool apartments, not said which) and the trailer specials (offers).
 */
export const WH_ROOMS: Record<string, string> = {
  'Economy rental trailer': 'Rental trailer',
  'Comfort rental trailer': 'Rental trailer',
  'Premium rental trailer': 'Rental trailer',
  'Holiday home Baltikpark': 'Holiday home Baltic-Park: Seeschwalbe', // the only house of the Baltic-Park page
  'Mobile home Sumba': 'Mobile home: Sumba Model',
  'Mobile home Ocala': 'Mobile home: Ocala Model',
  'Mobile home Chatel': 'Mobile home: Chatel Model',
};

/**
 * Engine profiles that price several content rooms at once, by rental category (Aaron 2026-10-31: "1+2+3 ja", the one
 * price shows as "from" on each): Dünenpark = both house models, "on the campsite" = the beach and pool apartments.
 * The golf course apartments are not on our pages and stay unlinked.
 */
export const WH_SHARED: Record<string, string[]> = {
  'Holiday home Dünenpark': ['Holiday home Dünenpark'],
  'Holiday apartment on the campsite': ['Beach apartment', 'Pool apartment'],
};

/** Engine samples -> slots with English unit names, keys "<unit>|<check-in>" and the content room(s) (WH_ROOMS, WH_SHARED). */
export function buildWhEngineSlots(samples: CsobSample[], ctx?: Pick<FetchContext, 'note'>, roomsByCategory = new Map<string, string[]>()): Slot[] {
  const names = new Map<string, string>();
  for (const s of samples) for (const p of s.profiles) names.set(p.title, whUnitName(p));
  return csobSlots(whOpenGroupsOnly(samples), ctx).map(s => {
    const unit = s.unit ? names.get(s.unit) ?? s.unit : s.unit;
    const room = unit ? WH_ROOMS[unit] : undefined;
    const rooms = unit ? (WH_SHARED[unit] ?? []).flatMap(c => roomsByCategory.get(c) ?? []) : [];
    return { ...s, unit, key: `${csobKeyPart(unit ?? '')}|${s.startDate}`, ...(room ? { room } : {}), ...(rooms.length ? { rooms, priceIsMinimum: true } : {}) };
  });
}

/** Sample check-ins: first Saturday from tomorrow in each of the next 12 months (the park is open all year). */
export function whSampleCheckIns(today: string): string[] {
  return csobSaturdaySamples(today, [{ start: today, end: csobAddDays(today, 400) }], { max: 12, horizonMonths: 12 });
}

/** Engine first; the specials table only when the engine has no priced unit. */
export async function fetchWhLiveSlots(today: string, ctx: FetchContext): Promise<Slot[]> {
  // the rental pages are memoized: fetchContent of the same run already loaded them
  const rentals: WhPages['rentals'] = [];
  for (const c of new Set(Object.values(WH_SHARED).flat())) {
    const path = WH_RENTAL_PAGES.find(x => x.category === c)!.path;
    rentals.push({ path, html: await page(`${SITE}/${path}`) });
  }
  const engine = buildWhEngineSlots(await fetchCsobSamples(WH_PORTAL, whSampleCheckIns(today), ctx), ctx, whRoomsByCategory(rentals));
  if (engine.some(s => s.price != null)) return engine;
  ctx.note('wulfener-hals: no rental unit priced by the compusoft engine in any sample week - specials table used');
  return fetchWhSlots(today);
}

export const campingparkWulfenerHalsFehmarn: OfferAdapter = {
  key: 'campingpark-wulfener-hals-fehmarn',
  name: 'Campingpark Wulfener Hals Fehmarn',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Campingpark Wulfener Hals',
    websiteUrl: SITE,
    rootDomain: 'wulfenerhals.de',
    contactEmail: 'info@wulfenerhals.de',
    phone: '+49437186280',
  },
  url: WH_KITE_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 35,
  // 12 sample weeks x 2 Compusoft calls, strictly sequential per host: ~6 s per answer locally, >10 s from the GitHub
  // runner, so the default 240 s ran out every day (cron from 2026-10-17 on). Fewer weeks would drop bookable specials.
  timeoutMs: 8 * 60_000,
  async fetchContent() {
    const home = await page(WH_HOME_URL);
    const kite = await page(WH_KITE_URL);
    const specials = await page(WH_SPECIALS_URL);
    const rentals: Array<{ path: string; html: string }> = [];
    for (const r of WH_RENTAL_PAGES) rentals.push({ path: r.path, html: await page(`${SITE}/${r.path}`) });
    if (parseWhKitePrices(kite).length === 0 && !/kitesurf/i.test(whLines(kite).join(' '))) throw new Error('wulfener-hals: kite course block not found on /surfen-kiten-segeln');
    return parseWulfenerHalsContent({ home, kite, specials, rentals });
  },
  async fetchSlots(ctx) {
    const slots = await fetchWhLiveSlots(todayIso(), ctx);
    if (slots.length === 0) ctx.note('wulfener-hals: neither the engine nor the specials table has a bookable unit - price on request');
    return slots;
  },
};
