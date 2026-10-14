// ---------------------------------------------------------------------------
// Camping Flügger Strand, Flügge (Fehmarn, Germany) - four-star family campsite on the natural beach at the south-west tip
// of Fehmarn. Kite link (Aaron's call 2026-10-14, described as printed): there is no kite school on the campsite; kiters
// launch at the end of the site (advanced riders only, south-west or north-west wind, outside the buoyed bathing area), the
// Foil Academy gives foil courses for advanced wind- and kitesurfers at the campsite, and kite courses are in Orth (about
// 3 km, the site links windgeister.de). Campsite rule: only the 7 rental caravans and the 9 holiday cottages (mobile
// homes) are listed, never the pitches.
//
// Data path (checked 2026-10-14), Contao site www.fluegger-strand.de (German):
//   content  / (four stars, season 2026 "27. März bis zum 18. Oktober 2026", news 28.08.2026), surfen.html (kite text),
//            mietwohnwagen.html (caravan categories 1-A / 1-B / 2-A / 2-B: model, persons, row to the sea, unit numbers),
//            ferienhaeuschen.html (cottage equipment).
//   slots    preise-mietwohnwagen.html and preise-ferienhaeuschen.html, "Preise 2026 pro Übernachtung in €": per season tier
//            (Nebensaison / Zwischensaison / Hauptsaison) the date ranges and the nightly price per caravan category /
//            cottage type; the "bereits ausgebucht" line (caravans 06.07. bis 22.08.2026, cottages 13.06. bis 13.09.2026)
//            and the "frei vom … bis …" exceptions under it. Ranges are arrival-to-departure (neighbouring ranges share
//            their boundary day; the caravan season "bis zum 11. Oktober" is the end of the last range), so a range's last
//            night is the day before its end date.
// Booking: online request form (buchungsanfrage.html) or phone; no booking engine -> 'on_request'.
// robots.txt (2026-10-14): only /contao/ disallowed.
// Requests per run: content 6, slots 2 (both price pages, memoised; a full run makes 6).
// Parsed: per unit (4 caravan categories, 2 cottage types) and night: tier price + booked-out flag; runs of equal state
//   become slots ("caravan-1-a|2026-06-27"), EUR per unit and night for up to 4 persons (occupancy 4; 5th person +EUR 10),
//   'sold_out' inside the printed booked-out range, 'limited' for a printed "frei vom …" exception (its words as
//   availabilityText), else 'on_request'. minNights 7 in the summer high season (cottages: every high-season range), else
//   none (the spring high-season caravan range mixes "Himmelfahrt mind. 4" and "Pfingsten mind. 3" -> left empty).
//   Runs that ended before today are dropped: on 2026-10-14 only the cottages' last range (to 18.10.2026) is left, after
//   that the offer shows "price on request" until the 2027 list ("Anfragen für 2027 … erst ab Oktober 2026").
// Known limits: short-stay surcharge (+EUR 10 per night under 7 nights in mid / low season), cottage energy flat rate
//   (EUR 4-7 per night) and the final cleaning fee (EUR 40-65) are in the room features, not in the price. Map pin = the
//   GPS line on lage-anfahrt.html (54° 27' 06" N, 11° 00' 25" E; constant below).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, monthOf, parseAmount, runsOf, todayIso } from '../parse.js';
import type { Availability, ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.fluegger-strand.de';
export const CFS_HOME_URL = `${SITE}/`;
export const CFS_SURF_URL = `${SITE}/surfen.html`;
export const CFS_CARAVANS_URL = `${SITE}/mietwohnwagen.html`;
export const CFS_COTTAGES_URL = `${SITE}/ferienhaeuschen.html`;
export const CFS_CARAVAN_PRICES_URL = `${SITE}/preise-mietwohnwagen.html`;
export const CFS_COTTAGE_PRICES_URL = `${SITE}/preise-ferienhaeuschen.html`;
const REQUEST_URL = `${SITE}/buchungsanfrage.html`;
/** GPS line on lage-anfahrt.html: 54° 27' 06" N, 11° 00' 25" E (2026-10-14). */
export const CFS_COORDS = { lat: 54.4517, lng: 11.0069 };

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the price pages */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines (scripts, styles, SVGs dropped), split at block tags and <br>. */
export function cfsLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|header|footer|article)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
type Tier = 'low' | 'mid' | 'high';
const TIERS: Record<string, Tier> = { Nebensaison: 'low', Zwischensaison: 'mid', Hauptsaison: 'high' };

export interface CfsPrice { unit: string; persons: string | null; tier: Tier; ranges: Array<{ start: string; end: string }>; price: number }
export interface CfsTable {
  year: number;
  prices: CfsPrice[];
  /** "bereits ausgebucht" range (arrival..departure) */
  bookedOut: { start: string; end: string } | null;
  /** "frei vom … bis …" exceptions inside it */
  free: Array<{ unit: string | null; start: string; end: string; text: string }>;
  notes: string[];
}

/** "27.03. - 01.04." / "29.04. – 03.05." (+ year) -> arrival..departure. */
function cfsRange(s: string, year: number): { start: string; end: string } | null {
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.?\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.?$/);
  return m ? { start: iso(year, +m[2], +m[1]), end: iso(year, +m[4], +m[3]) } : null;
}

/** "Kategorie 1 - A *" / "Kategorie 1 - A> *" -> "Kategorie 1-A"; "Typ: E" -> "Typ E". */
function cfsUnit(l: string): string | null {
  const k = l.match(/^Kategorie\s+(\d)\s*-\s*([AB])\b/);
  if (k) return `Kategorie ${k[1]}-${k[2]}`;
  const t = l.match(/^Typ:\s*([A-Z])$/);
  return t ? `Typ ${t[1]}` : null;
}

/** One price page: tiers, ranges, unit prices, booked-out range and exceptions, footnotes. */
export function parseCfsPrices(html: string): CfsTable | null {
  const l = cfsLines(html);
  const year = Number(l.find(x => /^Preise 20\d{2}$/.test(x))?.slice(-4) ?? NaN);
  if (!year) return null;
  const prices: CfsPrice[] = [];
  let unit: string | null = null;
  let persons: string | null = null;
  let tier: Tier | null = null;
  let ranges: Array<{ start: string; end: string }> = [];
  let bookedOut: CfsTable['bookedOut'] = null;
  const free: CfsTable['free'] = [];
  for (let k = 0; k < l.length; k++) {
    const x = l[k];
    if (/bereits ausgebucht sind:?$/.test(x)) {
      const m = (l[k + 1] ?? '').match(/^(\d{1,2})\.(\d{1,2})\.\s*bis\s*(\d{1,2})\.(\d{1,2})\.(20\d{2})$/);
      if (m) bookedOut = { start: iso(+m[5], +m[2], +m[1]), end: iso(+m[5], +m[4], +m[3]) };
      continue;
    }
    const f = x.match(/^T?Typ ([A-Z]),.*frei vom (\d{1,2})\.(\d{1,2})\.\s*bis\s*(\d{1,2})\.(\d{1,2})\.(20\d{2})/);
    if (f) { free.push({ unit: `Typ ${f[1]}`, start: iso(+f[6], +f[3], +f[2]), end: iso(+f[6], +f[5], +f[4]), text: x.replace(/^TTyp/, 'Typ') }); continue; }
    if (TIERS[x]) { tier = TIERS[x]; ranges = []; continue; }
    const r = cfsRange(x, year);
    if (r && tier) { ranges.push(r); continue; }
    const u = cfsUnit(x);
    if (u) { unit = u; persons = null; if (/^Typ /.test(u)) tier = null; continue; }
    const pers = x.match(/^\((\d\s*[–-]\s*\d) Pers\.\)$/) ?? (l[k - 1] === 'Pers.' ? x.match(/^(\d\s*[–-]\s*\d)$/) : null);
    if (pers) { persons = pers[1].replace(/\s/g, '').replace('–', '-'); continue; }
    const p = x.match(/^(\d+(?:,\d+)?)\s*€\s*\*?$/);
    if (p && unit && tier && ranges.length) prices.push({ unit, persons, tier, ranges: [...ranges], price: parseAmount(p[1])! });
  }
  const notes = l.filter(x => /^\* |^Mindestbuchungszeitraum|^Kurzreisezuschlag|^Energiepauschale|^Reinigung:|^Haustiere:/.test(x));
  return prices.length ? { year, prices, bookedOut, free, notes } : null;
}

export const CFS_UNIT_NAMES: Record<string, string> = {
  'Kategorie 1-A': 'Rental caravan category 1-A (Hobby Excellent 560 UL, first row)',
  'Kategorie 1-B': 'Rental caravan category 1-B (Hobby Excellent 560 UL, second row)',
  'Kategorie 2-A': 'Rental caravan category 2-A (Hobby 650 UMFe Prestige, first row)',
  'Kategorie 2-B': 'Rental caravan category 2-B (Hobby 650 UMFe Prestige, second row)',
  'Typ B': 'Holiday cottage type B (25 m²)',
  'Typ E': 'Holiday cottage type E (40 m²)',
};
const unitKey = (u: string): string => (/^Kategorie/.test(u) ? `caravan-${u.slice(10).toLowerCase()}` : `cottage-${u.slice(4).toLowerCase()}`);

export function buildCfsSlots(tables: CfsTable[], today: string): Slot[] {
  const out: Slot[] = [];
  for (const t of tables) {
    const units = [...new Set(t.prices.map(p => p.unit))];
    const cottage = units.every(u => /^Typ /.test(u));
    for (const unit of units) {
      type Night = { date: string; price: number; tier: Tier; band: string; state: 'open' | 'booked' | 'free'; text: string | null; min: number | null };
      const nights: Night[] = [];
      for (const p of t.prices.filter(x => x.unit === unit)) {
        for (const r of p.ranges) {
          // caravans: 7 nights only in the summer high season; cottages: every high-season range
          const summer = r.start <= iso(t.year, 7, 15) && iso(t.year, 7, 15) < r.end;
          const min = p.tier === 'high' && (cottage || summer) ? 7 : null;
          for (let d = r.start; d < r.end; d = addDays(d, 1)) {
            const exc = t.free.find(f => (f.unit === null || f.unit === unit) && f.start <= d && d < f.end) ?? null;
            const booked = !!t.bookedOut && t.bookedOut.start <= d && d < t.bookedOut.end;
            nights.push({ date: d, price: p.price, tier: p.tier, band: r.start, state: booked ? (exc ? 'free' : 'booked') : 'open', text: booked && exc ? exc.text : null, min });
          }
        }
      }
      nights.sort((a, b) => a.date.localeCompare(b.date));
      for (const run of runsOf(nights, n => `${n.band}|${n.price}|${n.state}|${n.text ?? ''}`)) {
        if (run.end < today) continue;
        const f = run.first;
        const availability: Availability = f.state === 'booked' ? 'sold_out' : f.state === 'free' ? 'limited' : 'on_request';
        out.push({
          key: `${unitKey(unit)}|${run.start}`,
          startDate: run.start,
          endDate: run.end,
          unit: CFS_UNIT_NAMES[unit] ?? unit,
          price: f.price,
          currency: 'EUR',
          priceUnit: 'per_night',
          priceBasis: 'room',
          occupancy: 4,
          availability,
          availabilityText: f.state === 'booked' ? 'bereits ausgebucht' : f.text,
          spotsLeft: null,
          minNights: f.min,
        });
      }
    }
  }
  return out;
}

/** Caravan category blocks of mietwohnwagen.html: "Kategorie 1 - A" … "M1 und M2". */
export function parseCfsCaravans(html: string): Array<{ cat: string; lines: string[] }> {
  const l = cfsLines(html);
  const out: Array<{ cat: string; lines: string[] }> = [];
  for (let k = 0; k < l.length; k++) {
    if (!/^Kategorie \d - [AB](?: und B)?$/.test(l[k])) continue;
    const lines: string[] = [];
    for (let j = k + 1; j < l.length && !/^Kategorie \d - [AB](?: und B)?$|^Preise Mietwohnwagen$|^Grundriss$/.test(l[j]); j++) lines.push(l[j]);
    out.push({ cat: l[k], lines });
  }
  return out;
}

/** Contao originals (files/bilder/…) of the rental and surf pages + the large figure images of the home page. */
export function cfsImages(html: string): string[] {
  const out: string[] = [];
  // the same photo appears as original (files/…/IMG_8686.jpg) and as resized copy (assets/images/6/IMG_8686-841c53b9.jpg)
  const base = (u: string) => decodeURIComponent(u.split('/').pop() ?? '').replace(/-[0-9a-f]{8}(?=\.[a-z]+$)/i, '').toLowerCase();
  const add = (u: string) => { if (!out.some(x => base(x) === base(u))) out.push(u); };
  for (const m of html.matchAll(/(?:href|src)="(files\/bilder\/(?:mietwohnwagen|ferienhaeuschen|freizeit-events|campingplatz)[^"]+\.jpe?g)"/gi)) add(`${SITE}/${m[1]}`);
  for (const m of html.matchAll(/<img src="(assets\/images\/[^"]+\.jpe?g)"[^>]*itemprop="image"/gi)) {
    if (/logo|adac|dcc|camping-paradies|camping-schleswig|kinderanimation|restaurant|ladestation|buergerbus|panorama/i.test(m[1])) continue;
    add(`${SITE}/${m[1]}`);
  }
  return out;
}

export interface CfsPages { home: string; surf: string; caravans: string; cottages: string; caravanPrices: string; cottagePrices: string }

export function parseFlueggerContent(p: CfsPages): OfferContent {
  const home = cfsLines(p.home);
  const surf = cfsLines(p.surf);
  const tables = [parseCfsPrices(p.caravanPrices), parseCfsPrices(p.cottagePrices)].filter((x): x is CfsTable => !!x);
  const season = home.find(l => /^Wir haben für Sie geöffnet vom/.test(l)) ?? null;
  const sm = season?.match(/vom (\d{1,2})\. (\S+) bis zum (\d{1,2})\. (\S+) (20\d{2})/);
  const EN = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const open = sm && monthOf(sm[2]) && monthOf(sm[4]) ? `${sm[1]} ${EN[monthOf(sm[2])!]} to ${sm[3]} ${EN[monthOf(sm[4])!]} ${sm[5]}` : null;
  const kiteEnd = surf.find(l => /Am Platzende können die Kiter/.test(l)) ?? null;
  const foil = surf.find(l => /Foil-Kurse und individuelle Trainingsformen/.test(l)) ?? null;
  const orth = surf.find(l => /Surfschulen und Kitesurfschulen/.test(l)) ?? null;
  const caravanBlocks = parseCfsCaravans(p.caravans);
  const priceRange = (unit: string) => {
    const xs = tables.flatMap(t => t.prices.filter(x => x.unit === unit).map(x => ({ y: t.year, tier: x.tier, price: x.price })));
    return xs.length ? `${xs[0].y}: EUR ${Math.min(...xs.map(x => x.price))}-${Math.max(...xs.map(x => x.price))} per night (low to high season, up to 4 persons)` : null;
  };
  const allPrices = tables.flatMap(t => t.prices.map(x => x.price));
  const year = tables[0]?.year ?? null;

  const caravanRooms: ContentRoom[] = ['Kategorie 1-A', 'Kategorie 1-B', 'Kategorie 2-A', 'Kategorie 2-B'].map(u => {
    const [n, letter] = u.slice(10).split('-');
    const lines = caravanBlocks.find(b => b.cat === `Kategorie ${n} - ${letter}` || b.cat === `Kategorie ${n} - A und B`)?.lines ?? [];
    const nos = lines.find(x => /^M\d/.test(x)) ?? lines.find(x => x.startsWith(`Kategorie ${n} - ${letter} steht`))?.match(/\((M[^)]+)\)/)?.[1] ?? null;
    return {
      name: CFS_UNIT_NAMES[u],
      description: /^Kategorie 1/.test(u) ? 'Caravan with fixed awning for 2 to 4 people: two single beds and a seating area that converts into a double bed.' : 'New, roomy caravan with a large awning for 2 to 5 people (4 adults and 1 child): French bed, convertible seating area and a single bed for a child.',
      features: [
        ...(nos ? [`Units ${nos.replace(/ und /g, ', ')}`] : []),
        ...(priceRange(u) ? [priceRange(u)!] : []),
        'Awning with kitchen and fridge, flushing WC, TV and radio, heating; beach chair (Strandkorb) and grill',
        '5th person +EUR 10 per night; under 7 nights +EUR 10 per night (mid and low season); final cleaning EUR 40-60',
      ],
    };
  });
  const cottageRooms: ContentRoom[] = ['Typ B', 'Typ E'].map(u => ({
    name: CFS_UNIT_NAMES[u],
    description: u === 'Typ B' ? 'Mobile home at the beach for 2 to 4 people (25 m²), units F495 and F495A.' : 'Mobile home at the beach for 2 to 5 people (40 m²), units F489-F494 and F496.',
    features: [
      ...(priceRange(u) ? [priceRange(u)!] : []),
      'Shower and WC, fully equipped kitchen with dishwasher, terrace with beach chair and grill, parking next to the cottage',
      `Energy flat rate EUR ${u === 'Typ B' ? '4-6' : '5-7'} per night; final cleaning EUR 45-65; under 7 nights +EUR 10 per night`,
    ],
  }));

  const imgs = [...cfsImages(p.caravans), ...cfsImages(p.cottages), ...cfsImages(p.home), ...cfsImages(p.surf)].filter((u, i, a) => a.indexOf(u) === i);

  const summary = [
    `Camping Flügger Strand is a four-star family campsite on the natural beach at Flügge on the south-west tip of Fehmarn, Germany${open ? ` (open ${open})` : ''}.`,
    `Besides pitches it rents seven caravans with awnings, some in the first row 40 m from the sea, and nine holiday cottages (mobile homes)${allPrices.length ? `; the ${year} price lists run from EUR ${Math.min(...allPrices)} to EUR ${Math.max(...allPrices)} per unit and night for up to four people` : ''}.`,
    'There is no kite school on the campsite: kiters launch at the end of the site (advanced riders only, with south-west or north-west wind, outside the buoyed bathing area), the Foil Academy gives foil courses for advanced wind- and kitesurfers at the campsite, and the nearest kite and surf schools are in Orth, about 3 km away.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Camping Flügger Strand',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Flügge, Fehmarn',
    spot: 'Flügge',
    spotCoords: CFS_COORDS,
    itinerarySpots: [],
    durationDays: null,
    // surfen.html: the spot at the campsite is "nur für Fortgeschrittene"; beginners go to Orth / Lemkenhafen
    skillLevels: ['advanced'],
    kiteLessons: null, // no kite school on the campsite; courses in Orth (3 km)
    equipmentRental: null,
    beginnerFriendly: false,
    includedServices: ['Electricity, gas, water and waste water in the caravan price', 'Wi-Fi on the whole campsite', 'Hot showers'],
    optionalServices: ['Foil courses for advanced wind- and kitesurfers (Foil Academy, at the campsite)', 'Kite courses in Orth (about 3 km)', 'Bed linen (EUR 12 per bed) and towels (EUR 10 per set)', 'Restaurant Dünenhus and shop on site', 'Tourist tax (Kurabgabe)'],
    accommodation: 'rental caravans and holiday cottages on a beach campsite',
    mealPlan: 'self_catering',
    languages: ['de'],
    rooms: [...caravanRooms, ...cottageRooms],
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: CFS_SURF_URL,
    bookingUrl: REQUEST_URL,
    sourceText: [
      `home: ${season ?? ''}`,
      `kite: ${kiteEnd ?? ''} | ${orth ?? ''} | ${foil ?? ''}`,
      ...tables.map(t => `prices ${t.year}: ${t.prices.map(x => `${x.unit} ${x.tier} ${x.ranges.map(r => `${r.start}..${r.end}`).join(',')} ${x.price}`).join('; ')} | booked out ${t.bookedOut ? `${t.bookedOut.start}..${t.bookedOut.end}` : '-'} | free ${t.free.map(f => f.text).join('; ') || '-'} | ${t.notes.join(' | ')}`),
    ].join('\n'),
  };
}

export async function fetchCfsSlots(today: string): Promise<Slot[]> {
  const tables = [parseCfsPrices(await page(CFS_CARAVAN_PRICES_URL)), parseCfsPrices(await page(CFS_COTTAGE_PRICES_URL))];
  if (tables.some(t => !t)) throw new Error('camping-fluegger-strand: "Preise YYYY" table not found on a price page (layout changed?)');
  return buildCfsSlots(tables as CfsTable[], today);
}

export const campingFlueggerStrandFehmarn: OfferAdapter = {
  key: 'camping-fluegger-strand-fehmarn',
  name: 'Camping Flügger Strand Fehmarn',
  kind: 'accommodation',
  operator: {
    name: 'Camping Flügger Strand',
    websiteUrl: SITE,
    rootDomain: 'fluegger-strand.de',
    contactEmail: 'info@fluegger-strand.de',
    phone: '+494372714',
  },
  url: CFS_SURF_URL,
  slotMethod: 'price_table',
  fetchBudget: 6,
  async fetchContent() {
    const home = await page(CFS_HOME_URL);
    const surf = await page(CFS_SURF_URL);
    const caravans = await page(CFS_CARAVANS_URL);
    const cottages = await page(CFS_COTTAGES_URL);
    const caravanPrices = await page(CFS_CARAVAN_PRICES_URL);
    const cottagePrices = await page(CFS_COTTAGE_PRICES_URL);
    if (!/Kiter/.test(surf)) throw new Error('camping-fluegger-strand: kite sentence missing on surfen.html (kite link gone?)');
    return parseFlueggerContent({ home, surf, caravans, cottages, caravanPrices, cottagePrices });
  },
  async fetchSlots() {
    return fetchCfsSlots(todayIso());
  },
};
