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
//   slots    /specials-angebote: the specials table (thead "Special | Description | Term | Nights | Campground |
//            Economy Rental Trailers"): per special a term "02.10.-02.11.2026*" (* / ** / *** = 1 / 2 / 3 weeks
//            within the term, else exactly the term), nights and a package price for the Economy rental trailer
//            (up to 4 people of one family). Only the rental-trailer column is used (pitches are not listed).
//            The camping price list /preise covers pitches only; rental prices are otherwise only in a 9.8 MiB PDF
//            and the Compusoft booking engine.
// Booking engine: Compusoft onlinebooking (v3.onlinebooking.dk, portal key in the page). robots.txt allows all
//   and the profile list answers without a session, but prices need one extra call per unit type and stay
//   (GetCSProfilePriceList) - not built; documented for a shared engine module.
// robots.txt (2026-10-12): www.wulfenerhals.de disallows only /contao/ and /_contao/.
// Requests per run: content 10, slots 1 (memoised: 0 extra when content ran in the same process).
// Parsed: one slot per still bookable special (check-in not in the past), EUR per rental trailer per stay
//   (priceUnit 'package', packageNights = nights), availability 'unknown'. When the current table has no future
//   special (e.g. after 2 Nov 2026 until the 2027 specials appear) fetchSlots returns [] ("price on request").
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, parse, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

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
    for (const u of us) rooms.push({ name: u.name.toLowerCase().includes(cat.split(' ')[0].toLowerCase()) ? u.name : `${cat}: ${u.name}`, description: u.info, features: u.features });
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

export const campingparkWulfenerHalsFehmarn: OfferAdapter = {
  key: 'campingpark-wulfener-hals-fehmarn',
  name: 'Campingpark Wulfener Hals Fehmarn',
  kind: 'accommodation',
  operator: {
    name: 'Campingpark Wulfener Hals',
    websiteUrl: SITE,
    rootDomain: 'wulfenerhals.de',
    contactEmail: 'info@wulfenerhals.de',
    phone: '+49437186280',
  },
  url: WH_KITE_URL,
  slotMethod: 'price_table',
  fetchBudget: 11,
  confidence: 'medium', // prices only for the Economy rental trailer specials; other units on request
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
    const slots = await fetchWhSlots(todayIso());
    if (slots.length === 0) ctx.note('wulfener-hals: no rental-trailer special still bookable in the current table - price on request until the next season\'s specials appear');
    return slots;
  },
};
