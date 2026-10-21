// ---------------------------------------------------------------------------
// Vela Baja at Hotel Playa del Sol (+ Palmas de Cortez), Los Barriles (Baja California Sur, Mexico) -
// watersports center (kiteboarding, windsurfing, wing foiling; since 1988) located at the boutique
// Hotel Playa del Sol on the beach of Los Barriles. Vela Baja books rooms at Playa del Sol (26 rooms,
// right behind the center) and at Hotel Palmas de Cortez (beachfront resort, 10 minutes' walk along the
// beach) at its own published nightly rates; guests with 3+ days accommodation booked via Vela can add
// the Sports Package (USD 40/day: SUPs, kayaks, bikes, snorkel gear).
//
// Data path (checked 2026-10-14): WordPress (Enfold) site velabaja.com, English only.
//   slots    /accommodation/: per hotel an <h2> name followed by Enfold pricing tables
//            (<div class="pricing-table-wrap">: heading row "Garden Room (2 double beds)" + <li> rows
//            "double: $150", "triple: $210", "each additional person: $20", "1 king size bed : $210",
//            "King Ocean: $240", condo lines "Two Bedroom Condo $520 per night for 1-5 people"), then the
//            notes "*NOTE: With effect from January 1st 2027 all above room rates will increase by $20 USD
//            per night" and "A 16% sales tax and 4% bed tax will be added to the room rates."
//            Season: home page "Open 7 days a week each winter from November 15 to March 15" (also in the
//            FAQ). Bands: Nov 15 - Dec 31 at the printed rate, Jan 1 - Mar 15 at rate + the announced
//            increase; the season year comes from the increase note ("January 1st 2027" -> 2026/27).
//   content  /accommodation/ (hotels, services, room options), / (season, location), the kiteboarding
//            page (conditions, lessons, Cabrinha/Slingshot rental), /sports-package/.
// Booking: "Book Here" links to /contact-us/ ("booking enquiries please email us"); a 20% deposit goes
//   to Vela Baja (FAQ) -> availability 'on_request', no booking engine.
// Currency: rates are printed with "$"; the same page states "$20 USD", the FAQ "Cash $USD" -> USD.
// robots.txt velabaja.com (Yoast, 2026-10-14): "User-agent: * / Disallow:" (everything allowed).
// Requests per run: content 4, slots 2 (memoised: 4 in total when both run).
// Slots: one per hotel x room x occupancy x season band ("palmas-de-cortez-ocean-view-room-3p|2027-01-01"),
//   USD per room per night, taxes (16% sales + 4% bed tax) not included -> room features.
// Known limits: the Cabana table repeats "King Garden : $240" from the Garden Room table; king rows
//   that name their own room ("King Garden") are kept once per hotel and priced to that room (vbRoom). Extended-stay rates (14+ nights)
//   and the airport transfer price sheet (an image) are not parsed. No map pin on the site.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, iso, monthOf, parse, parseAmount, todayIso } from '../parse.js';
import { upscaleCdnUrl } from '../../lib/images.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://velabaja.com';
export const VB_ACCOMMODATION_URL = `${SITE}/accommodation/`;
export const VB_HOME_URL = `${SITE}/`;
export const VB_KITE_URL = `${SITE}/kiteboarding-rentals-lessons-in-los-barriles/`;
export const VB_PACKAGE_URL = `${SITE}/sports-package/`;
const BOOKING_URL = `${SITE}/contact-us/`;

const memo = new Map<string, Promise<string>>();
function page(url: string): Promise<string> {
  let p = memo.get(url);
  if (!p) { p = fetchText(url, { accept: 'text/html' }); memo.set(url, p); p.catch(() => memo.delete(url)); }
  return p;
}
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Text blocks (headings, paragraphs, list items) in document order, script/style dropped. */
function blocks(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav')) el.remove();
  const main = root.querySelector('#main') ?? root.querySelector('main') ?? root;
  return main.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li').map(e => collapse(e.text)).filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
export interface VbRate { unit: string; occupancy: number | null; price: number }
export interface VbTable { room: string; beds: string | null; rates: VbRate[]; extraPerson: number | null }
export interface VbHotel { name: string; tables: VbTable[]; facts: string[] }
export interface VbNotes { increase: number | null; increaseFrom: string | null; taxes: string | null }

/** Hotels (<h2>) with their pricing tables in document order. */
export function parseVbHotels(html: string): VbHotel[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript')) el.remove();
  const hotels: VbHotel[] = [];
  for (const el of root.querySelectorAll('h2, .pricing-table-wrap, .iconlist_content, .avia_textblock')) {
    if (el.tagName === 'H2') {
      const name = collapse(el.text).replace(/^Boutique Hotel\s+/i, '');
      hotels.push({ name, tables: [], facts: [] });
      continue;
    }
    const hotel = hotels[hotels.length - 1];
    if (!hotel) continue;
    if (el.classList.contains('pricing-table-wrap')) {
      const head = el.querySelector('.first-table-item');
      if (!head) continue;
      const [room, ...bedParts] = head.innerHTML.split(/<br\s*\/?>/i).map(x => collapse(parse(x).text));
      const t: VbTable = { room, beds: bedParts.join(' ').replace(/^\(|\)$/g, '') || null, rates: [], extraPerson: null };
      for (const li of el.querySelectorAll('li')) {
        if (li.classList.contains('avia-heading-row')) continue;
        const line = collapse(li.text);
        let m = line.match(/^(double|triple|quad)\s*:\s*\$\s*([\d,]+)/i);
        if (m) { t.rates.push({ unit: room, occupancy: { double: 2, triple: 3, quad: 4 }[m[1].toLowerCase() as 'double'], price: parseAmount(m[2])! }); continue; }
        m = line.match(/each additional person\s*:\s*\$\s*([\d,]+)/i);
        if (m) { t.extraPerson = parseAmount(m[1]); continue; }
        m = line.match(/^1 king size bed\s*[–-]?\s*:\s*\$\s*([\d,]+)/i);
        if (m) { t.rates.push({ unit: `${room}, 1 king bed`, occupancy: 2, price: parseAmount(m[1])! }); continue; }
        m = line.match(/^(King [A-Za-z ]+?)\s*:\s*\$\s*([\d,]+)/);
        if (m) { t.rates.push({ unit: m[1], occupancy: 2, price: parseAmount(m[2])! }); continue; }
        m = line.match(/^(.+?)\s+\$\s*([\d,]+)\s+per night for (?:up to |1-)?(\d+)/i);
        if (m) { t.rates.push({ unit: m[1], occupancy: Number(m[3]), price: parseAmount(m[2])! }); continue; }
      }
      if (t.rates.length) hotel.tables.push(t);
    } else if (hotel.tables.length === 0) {
      // the "Location / Room Sizes / Services" icon list and intro text before the tables
      for (const li of el.querySelectorAll('li')) hotel.facts.push(collapse(li.text));
      for (const p of el.querySelectorAll('p')) if (!/virtual tour|360º/i.test(p.text)) hotel.facts.push(collapse(p.text));
    }
  }
  return hotels.filter(h => h.tables.length);
}

export function parseVbNotes(html: string): VbNotes {
  const t = blocks(html).join('\n');
  const inc = t.match(/January 1st (20\d{2}) all (?:the )?above room rates will increase by \$\s*(\d+)/i);
  const tax = t.match(/A \d+% sales tax and \d+% bed tax will be added to the room rates\.?/i);
  return { increase: inc ? Number(inc[2]) : null, increaseFrom: inc ? `${inc[1]}-01-01` : null, taxes: tax ? tax[0] : null };
}

/** "Open 7 days a week each winter from November 15 to March 15" -> month/day pairs. */
export function parseVbSeason(homeHtml: string): { from: [number, number]; to: [number, number] } | null {
  const m = blocks(homeHtml).join('\n').match(/from ([A-Z][a-z]+)\.? (\d{1,2})(?:th)? to ([A-Z][a-z]+)\.? (\d{1,2})/);
  if (!m || !monthOf(m[1]) || !monthOf(m[3])) return null;
  return { from: [monthOf(m[1])!, Number(m[2])], to: [monthOf(m[3])!, Number(m[4])] };
}

/** Season bands: before / from the announced rate increase. */
export function vbBands(season: { from: [number, number]; to: [number, number] }, notes: VbNotes, today = todayIso()): Array<{ start: string; end: string; add: number }> {
  const startYear = notes.increaseFrom ? Number(notes.increaseFrom.slice(0, 4)) - 1
    : (Number(today.slice(5, 7)) > season.to[0] ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1);
  const start = iso(startYear, season.from[0], season.from[1]);
  const end = iso(season.to[0] < season.from[0] ? startYear + 1 : startYear, season.to[0], season.to[1]);
  if (!notes.increaseFrom || notes.increaseFrom <= start || notes.increaseFrom > end) return [{ start, end, add: 0 }];
  const dayBefore = new Date(Date.parse(notes.increaseFrom) - 86400000).toISOString().slice(0, 10);
  return [{ start, end: dayBefore, add: 0 }, { start: notes.increaseFrom, end, add: notes.increase ?? 0 }];
}

/**
 * The content room (`<hotel> - <table>`, as parseVbContent names it) a rate prices: its own table, except the
 * "King Garden / King Poolside / King Ocean" rows, which are the king-bed variant of the hotel's Garden / Poolside /
 * Ocean View room ("King Garden" is also printed under the Cabana table). Condo, suite and penthouse rates price
 * the "Condo / Suite / Penthouse" room. null = no table of that name (left to slotRoom's name match).
 */
export function vbRoom(h: VbHotel, t: VbTable, r: VbRate): string | null {
  const king = r.unit.match(/^King (\w+)/)?.[1];
  if (!king) return `${h.name} - ${t.room}`;
  const own = h.tables.find(x => x.room.toLowerCase().startsWith(king.toLowerCase()));
  return own ? `${h.name} - ${own.room}` : null;
}

export function buildVbSlots(hotels: VbHotel[], bands: Array<{ start: string; end: string; add: number }>, today = todayIso()): Slot[] {
  const out: Slot[] = [];
  for (const h of hotels) {
    const seen = new Set<string>();
    for (const t of h.tables) {
      for (const r of t.rates) {
        const unit = `${h.name} - ${r.unit}`;
        const room = vbRoom(h, t, r);
        const id = `${slug(unit)}${r.occupancy ? `-${r.occupancy}p` : ''}`;
        if (seen.has(id)) continue;                      // "King Garden" printed under two tables
        seen.add(id);
        for (const b of bands) {
          if (b.end < today) continue;
          out.push({
            key: `${id}|${b.start}`,
            startDate: b.start,
            endDate: b.end,
            unit,
            ...(room ? { room } : {}),
            price: r.price + b.add,
            currency: 'USD',
            priceUnit: 'per_night',
            priceBasis: 'room',
            occupancy: r.occupancy,
            availability: 'on_request',
            availabilityText: null,
            spotsLeft: null,
          });
        }
      }
    }
  }
  return out;
}

/** WordPress uploads of a page (originals via upscaleCdnUrl), logos / price sheets / social thumbs dropped. */
export function vbImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<img[^>]+src=['"](https:\/\/velabaja\.com\/wp-content\/uploads\/[^'"]+\.(?:jpe?g|png|webp))['"]/gi)) {
    if (/logo|favicon|socialThumbnail|\/thumbnail-|velatransfer|\.png$/i.test(m[1])) continue;
    const u = upscaleCdnUrl(m[1]);
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export interface VbPages { accommodation: string; home: string; kite: string; sportsPackage: string }

export function parseVbContent(p: VbPages): OfferContent {
  const hotels = parseVbHotels(p.accommodation);
  const notes = parseVbNotes(p.accommodation);
  const homeLines = blocks(p.home);
  const kiteLines = blocks(p.kite);
  const pkgLines = blocks(p.sportsPackage);
  const accLines = blocks(p.accommodation);
  const seasonLine = homeLines.find(l => /Open 7 days a week/i.test(l)) ?? null;
  const pkgLine = pkgLines.find(l => /\$\d+\/day/.test(l)) ?? '';
  const pkgM = pkgLine.match(/\$(\d+)\/day\s*\(min (\d+) days\)\s*(?:Unlimited use of )?([^.]*)/i);
  const pkgPrice = pkgM ? `USD ${pkgM[1]}/day, min ${pkgM[2]} days${pkgM[3] ? `: ${pkgM[3].trim()}` : ''}` : null;
  const usd = (n: number) => `USD ${n.toLocaleString('en-US')}`;

  const rooms: ContentRoom[] = [];
  for (const h of hotels) {
    for (const t of h.tables) {
      rooms.push({
        name: `${h.name} - ${t.room}`,
        description: t.beds,
        features: [
          ...t.rates.map(r => `${r.unit}${r.occupancy ? ` (${r.occupancy} guests)` : ''}: ${usd(r.price)} per night`),
          ...(t.extraPerson ? [`each additional person ${usd(t.extraPerson)} per night`] : []),
          ...(notes.increaseFrom && notes.increase ? [`from ${notes.increaseFrom}: all rates + ${usd(notes.increase)} per night`] : []),
          ...(notes.taxes ? [notes.taxes] : []),
        ],
      });
    }
  }
  const all = hotels.flatMap(h => h.tables.flatMap(t => t.rates.map(r => r.price)));
  const pds = hotels.find(h => /Playa del Sol/i.test(h.name));
  const pdc = hotels.find(h => /Palmas/i.test(h.name));

  const summary = [
    'Vela Baja is a kiteboarding, windsurfing and wing foiling center in Los Barriles on the East Cape of Baja California Sur, about an hour from San José del Cabo airport, located at the boutique Hotel Playa del Sol and open daily from November 15 to March 15.',
    `It books rooms directly at Playa del Sol (26 rooms right behind the center) and at the beachfront Hotel Palmas de Cortez, a 10-minute walk along the beach${all.length ? `, from ${usd(Math.min(...all))} per room per night plus 16% sales and 4% bed tax` : ''}${notes.increase ? ` (+${usd(notes.increase)} from ${notes.increaseFrom})` : ''}.`,
    'The center rents Cabrinha and Slingshot kites, boards and hydrofoils and teaches kiteboarding mostly one-on-one from first lessons to independent riding; side-shore winds typically blow 18 to 23 knots from mid-morning.',
    pkgPrice ? `Guests with 3 or more days of accommodation booked via Vela Baja can add the Sports Package (${pkgPrice}).` : null,
  ].filter(Boolean).join(' ');

  const imageUrls = [...new Set([...vbImages(p.accommodation), ...vbImages(p.kite), ...vbImages(p.home)])];

  return {
    kind: 'accommodation',
    title: 'Vela Baja at Hotel Playa del Sol & Palmas de Cortez',
    summary,
    continent: 'North America',
    country: 'Mexico',
    region: 'Los Barriles, Baja California Sur',
    spot: 'Los Barriles',
    spotCoords: null, // the site publishes no map / coordinates
    itinerarySpots: [],
    durationDays: null,
    // kite page: courses "for complete beginners as well as more advanced riders" (2026-10-14)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: kiteLines.some(l => /Kite Lessons?/i.test(l)),
    equipmentRental: kiteLines.some(l => /rent from our wide range/i.test(l)),
    beginnerFriendly: kiteLines.some(l => /complete beginners/i.test(l)),
    includedServices: [
      'Free Wi-Fi in public areas',
      'Hotel swimming pool',
      ...(pds ? pds.facts.filter(f => /Palapa bar|restaurant|Pickle-ball/i.test(f)).map(f => `Playa del Sol: ${f}`) : []),
    ],
    optionalServices: [
      'Kiteboarding lessons (mostly one-on-one) and rental of Cabrinha and Slingshot kites, boards and hydrofoils',
      'Windsurfing, wing foiling, SUP, kayak and bike rentals and lessons',
      ...(pkgPrice ? [`Sports Package for guests booked via Vela Baja: ${pkgPrice}`] : []),
      'Airport transfer on request',
      ...(pdc ? pdc.facts.filter(f => /^(Spa|Tennis|9-hole)/i.test(f)).map(f => `Palmas de Cortez: ${f}`) : []),
    ],
    accommodation: 'hotel rooms at the boutique Hotel Playa del Sol (at the center) and the Hotel Palmas de Cortez beach resort',
    mealPlan: null,
    languages: ['en'],
    rooms,
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: VB_ACCOMMODATION_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${homeLines.filter(l => /Open 7 days|You’ll find us|Watersports in Mexico|lessons, rentals/i.test(l)).join(' | ')}`,
      `accommodation: ${accLines.filter(l => !/^(Previous|Next|\d+)$/.test(l)).join(' | ')}`,
      `kiteboarding: ${kiteLines.slice(0, 40).join(' | ')}`,
      `sports package: ${pkgLines.filter(l => /Package|\$|Exclusive/i.test(l)).join(' | ')}`,
      seasonLine ? `season: ${seasonLine}` : '',
    ].filter(Boolean).join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const velaBajaLosBarriles: OfferAdapter = {
  key: 'vela-baja-los-barriles',
  name: 'Vela Baja at Hotel Playa del Sol & Palmas de Cortez',
  kind: 'accommodation',
  operator: {
    name: 'Vela Baja',
    websiteUrl: VB_HOME_URL,
    rootDomain: 'velabaja.com',
    contactEmail: 'velabaja@gmail.com', // footer + contact page, 2026-10-14
  },
  url: VB_ACCOMMODATION_URL,
  slotMethod: 'price_table',
  fetchBudget: 6,
  confidence: 'medium',
  async fetchContent() {
    const [accommodation, home, kite, sportsPackage] = [await page(VB_ACCOMMODATION_URL), await page(VB_HOME_URL), await page(VB_KITE_URL), await page(VB_PACKAGE_URL)];
    return parseVbContent({ accommodation, home, kite, sportsPackage });
  },
  async fetchSlots(ctx: FetchContext) {
    const acc = await page(VB_ACCOMMODATION_URL);
    const hotels = parseVbHotels(acc);
    if (hotels.length === 0) throw new Error('vela-baja: no pricing tables on /accommodation/ (layout changed?)');
    const season = parseVbSeason(await page(VB_HOME_URL));
    if (!season) throw new Error('vela-baja: season line ("from November 15 to March 15") not found on the home page');
    const notes = parseVbNotes(acc);
    if (!notes.increaseFrom) ctx.note('no "January 1st <year>" rate increase note: season year taken from today');
    const slots = buildVbSlots(hotels, vbBands(season, notes));
    if (slots.length === 0) ctx.note('the season of the printed rates is over; price on request until new rates appear');
    return slots;
  },
};
