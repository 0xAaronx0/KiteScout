// ---------------------------------------------------------------------------
// LOGOS Beach Village, Theologos (Rhodes, Greece) - glamping-style kite/surf accommodation directly on the
// beach next to its own kite and windsurf center (Surf & Kite Theologos, VDWS): 13 XL/XXL safari lodges +
// 4 studios, pool, beach bar, breakfast buffet included.
//
// Data path (checked 2026-10-12): WordPress (Enfold theme), English pages under /en/.
//   slots    /en/prices/ - avia data table: heading rows "Season A/B/C (Prices p.p.)" + one cell of date
//            ranges per season ("01.04. – 20.05.26<br>09.10. – 31.10.26"), then one row per unit and
//            occupancy ("Beach Lodge XL – 3 PAX", EUR per person per night, "(only on request)" on some
//            cells). Below: children prices, occupancy limits, included services, and the high-season
//            rule "only booked by the week, arriving Thursdays or Saturdays (15.06. – 09.09.2026)".
//   content  /en/ (village, breakfast, kite center), /en/accommodation/<room>/ x3 (studio, lodge XL,
//            lodge XXL: text, capacity, equipment, masonry gallery), /en/sports/kite/ (station, wind,
//            rental and course prices, contact e-mail).
// Booking engine: the "book now" pages (/en/accommodation/<room>/booking/) redirect to a Leão Booking
//   self-service form (tag 14219, minDate 2026-04-01, maxDate 2026-10-31 on 2026-10-12). Its XHR
//   /api/product/availability/id/<tag>/start/<d>/end/<d>/<lang> answered HTTP 500 without the form's
//   session, so it is NOT used: slots carry no live inventory ('unknown').
// robots.txt (2026-10-12): Yoast default, nothing disallowed.
// Requests per run: content 6, slots 1.
// Parsed: slot = unit x occupancy x season date range ("beach-lodge-xl-3p|2026-04-01"), EUR per person
//   per night, real date limits as printed (inclusive), minNights 7 inside the weekly-booking high season,
//   availability 'on_request' where the cell says "(only on request)", else 'unknown'.
// Known limits: the table is dated 2026 (".26"); on 2026-10-12 only the Season A band 09.10.-31.10.2026
//   is still ahead. Children/teen prices (EUR 26 / 36 per night) are in the room features, not slots.
//   No map pin on the site (the OpenStreetMap embed is a consent placeholder) -> spot geocoded.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, iso, parse, parseAmount, type HTMLElement } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.logosbeachvillage.com';
export const LOGOS_PRICES_URL = `${SITE}/en/prices/`;
const HOME_URL = `${SITE}/en/`;
const KITE_URL = `${SITE}/en/sports/kite/`;
export const LOGOS_ROOM_URLS = ['beach-village-studio', 'beach-village-lodge-xl', 'beach-village-lodge-xxl']
  .map(s => `${SITE}/en/accommodation/${s}/`);

export interface LogosRange { start: string; end: string }
export interface LogosSeason { label: string; ranges: LogosRange[] }
export interface LogosRate { unit: string; persons: number; season: string; amount: number; onRequest: boolean }

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const cellText = (el: HTMLElement): string => collapse(el.text);
/** room page "Beach Village Lodge XL" <-> price row "Beach Lodge XL" / "Family Beach Lodge XXL" */
const sizeOf = (name: string): string => (/\bXXL\b/i.test(name) ? 'XXL' : /\bXL\b/i.test(name) ? 'XL' : /studio/i.test(name) ? 'Studio' : name);

/** "01.04. – 20.05.26" / "15.06. – 09.09.2026" -> ISO range (2-digit years are 20xx; a year only at the end applies to both). */
export function parseLogosRanges(text: string): LogosRange[] {
  const out: LogosRange[] = [];
  const re = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})?\s*[–—-]\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})/g;
  for (const m of text.replace(/&#8211;/g, '–').matchAll(re)) {
    const y4 = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
    const ey = y4(m[6]);
    let sy = m[3] ? y4(m[3]) : ey;
    if (!m[3] && (+m[2] > +m[5] || (+m[2] === +m[5] && +m[1] > +m[4]))) sy = ey - 1;
    out.push({ start: iso(sy, +m[2], +m[1]), end: iso(ey, +m[5], +m[4]) });
  }
  return out;
}

/** The season price table: heading rows (labels, date ranges) + "Unit – N PAX" rows. */
export function parseLogosTable(html: string): { seasons: LogosSeason[]; rates: LogosRate[] } {
  const table = parse(html).querySelectorAll('table').find(t => /Season A/i.test(t.text) && /PAX/.test(t.text));
  if (!table) return { seasons: [], rates: [] };
  const rows = table.querySelectorAll('tr');
  const heads = rows.filter(r => r.querySelectorAll('th').length > 0).map(r => r.querySelectorAll('th').slice(1));
  const labels = (heads.find(h => h.some(c => /Season/i.test(c.text))) ?? []).map(c => cellText(c).match(/Season\s+\w+/i)?.[0] ?? cellText(c));
  const dateRow = heads.find(h => h.some(c => parseLogosRanges(c.text).length > 0)) ?? [];
  const seasons: LogosSeason[] = labels.map((label, i) => ({ label, ranges: dateRow[i] ? parseLogosRanges(dateRow[i].text) : [] }));
  const rates: LogosRate[] = [];
  for (const r of rows) {
    const tds = r.querySelectorAll('td');
    if (tds.length < 2) continue;
    const m = cellText(tds[0]).match(/^(.+?)\s*[–—-]\s*(\d+)\s*PAX$/i);
    if (!m) continue;
    tds.slice(1).forEach((td, i) => {
      const t = cellText(td);
      const amount = parseAmount(t);
      if (!amount || !seasons[i]) return;
      rates.push({ unit: m[1].trim(), persons: Number(m[2]), season: seasons[i].label, amount, onRequest: /on request|auf anfrage/i.test(t) });
    });
  }
  return { seasons, rates };
}

/** "During the high season (15.06. – 09.09.2026) ... can only be booked by the week" -> that range. */
export function parseLogosWeeklyRange(html: string): LogosRange | null {
  const t = collapse(parse(html).text);
  const m = t.match(/high season \(([^)]+)\)[^.]*?only be booked by the week/i);
  return m ? parseLogosRanges(m[1])[0] ?? null : null;
}

export function buildLogosSlots(seasons: LogosSeason[], rates: LogosRate[], weekly: LogosRange | null): Slot[] {
  const out: Slot[] = [];
  for (const r of rates) {
    const season = seasons.find(s => s.label === r.season);
    for (const range of season?.ranges ?? []) {
      const inWeekly = !!weekly && range.start >= weekly.start && range.end <= weekly.end;
      out.push({
        key: `${keyPart(r.unit)}-${r.persons}p|${range.start}`,
        startDate: range.start,
        endDate: range.end,
        unit: r.unit,
        price: r.amount,
        currency: 'EUR',
        priceUnit: 'per_night',
        priceBasis: 'person',
        occupancy: r.persons,
        availability: r.onRequest ? 'on_request' : 'unknown',
        availabilityText: [r.onRequest ? 'only on request' : null, inWeekly ? 'weekly bookings only, arrival Thursday or Saturday' : null].filter(Boolean).join('; ') || null,
        spotsLeft: null,
        minNights: inWeekly ? 7 : null,
      });
    }
  }
  return out.sort((a, b) => (a.startDate! < b.startDate! ? -1 : a.startDate! > b.startDate! ? 1 : a.key < b.key ? -1 : 1));
}

/** Two-column tables under the price table (children prices, occupancy options) and the h5 sections. */
export function parseLogosNotes(html: string): { children: string[]; occupancy: string[]; included: string[]; sections: Record<string, string> } {
  const root = parse(html);
  const pairs = (re: RegExp) => {
    const t = root.querySelectorAll('table').find(x => re.test(x.text) && !/PAX/.test(x.text));
    return t ? t.querySelectorAll('tr').map(r => r.querySelectorAll('td').map(cellText).filter(Boolean).join(': ')).filter(Boolean) : [];
  };
  const sections: Record<string, string> = {};
  const included: string[] = [];
  for (const h of root.querySelectorAll('h5')) {
    const title = cellText(h);
    const wrap = h.parentNode;
    const sec = wrap?.nextElementSibling;
    if (!sec) continue;
    if (/^Included services$/i.test(title)) included.push(...sec.querySelectorAll('li').map(cellText).filter(Boolean));
    else sections[title] = cellText(sec);
  }
  return { children: pairs(/Babies|Children/i), occupancy: pairs(/max\.\s*\d+\s*adults/i), included, sections };
}

interface LogosRoomPage { name: string; description: string; features: string[]; images: string[] }

/** Room detail page: h1, description paragraphs, area/capacity lines and the equipment list. */
export function parseLogosRoom(html: string): LogosRoomPage | null {
  const entries = parse(html).querySelectorAll('.post-entry');
  const h1 = entries.map(e => e.querySelector('h1')).find(Boolean);
  if (!h1) return null;
  const name = cellText(h1);
  const desc: string[] = [];
  const features: string[] = [];
  let capacity: string[] | null = null;
  for (const el of entries.flatMap(e => e.querySelectorAll('p, li'))) {
    const t = cellText(el);
    if (!t) continue;
    if (/^Max\. .*capacity$/i.test(t)) { capacity = []; continue; }
    if (el.tagName === 'P' && capacity === null && features.length === 0 && /[.!]$/.test(t) && !/^(Total area|Living space|Terrace)\b/i.test(t)) { desc.push(t); continue; }
    if (capacity !== null && el.tagName === 'P') { capacity.push(t); continue; }
    if (capacity && capacity.length) { features.push(`Max. capacity: ${capacity.join('; ')}`); capacity = []; }
    features.push(t);
  }
  if (capacity && capacity.length) features.push(`Max. capacity: ${capacity.join('; ')}`);
  return { name, description: desc.join(' '), features, images: logosImages(html) };
}

const IMG_SKIP = /logosbeachvillage-logo|favicon|\/google|\/facebook|\/tripadvisor|\/close\.|brlbs|borlabs|lageplan|grundriss|theologos-beach-village-(?:rhodos-08|lodge-xx?l)\.jpg/i;
/** Content photos (full-size uploads in <img src> and masonry background-image), page order. */
export function logosImages(html: string): string[] {
  const out: string[] = [];
  const re = /(?:src=["']|url\()\s*((?:https:\/\/www\.logosbeachvillage\.com)?\/wp-content\/uploads\/[^"')\s]+?\.(?:jpe?g|webp))/gi;
  for (const m of html.matchAll(re)) {
    const u = new URL(m[1], SITE).toString();
    if (IMG_SKIP.test(u) || /-\d+x\d+\.(?:jpe?g|webp)$/i.test(u) || out.includes(u)) continue;
    out.push(u);
  }
  return out;
}

export interface LogosPriceRow { name: string; teaser: string; price: number | null }
/** Leão price list rows on the sport pages (".price-table-row": product name, teaser, price). */
export function parseLogosPriceRows(html: string): LogosPriceRow[] {
  return parse(html).querySelectorAll('.price-table-row').map(r => ({
    name: cellText(r.querySelector('.product-name') ?? r),
    teaser: cellText(r.querySelector('.product-teaser') ?? parse('')),
    price: parseAmount(cellText(r.querySelector('.price-table-product-price') ?? parse(''))),
  })).filter(r => r.name);
}

function pageBlocks(html: string): string[] {
  const root = parse(html);
  const entries = root.querySelectorAll('.post-entry');
  const scope = entries.length ? entries : [root];
  return scope.flatMap(e => e.querySelectorAll('p, h1, h2, h3, h4, h5, li')).map(cellText).filter(Boolean);
}

export interface LogosPages { home: string; rooms: string[]; kite: string; prices: string }

export function parseLogosContent(p: LogosPages): OfferContent {
  const home = pageBlocks(p.home);
  const kite = pageBlocks(p.kite);
  const rooms = p.rooms.map(parseLogosRoom).filter((r): r is LogosRoomPage => !!r);
  const notes = parseLogosNotes(p.prices);
  const { seasons, rates } = parseLogosTable(p.prices);
  const intro = home.find(b => /Glamping/i.test(b)) ?? '';
  const nLodges = intro.match(/only (\d+) XL and XXL lodges/i)?.[1] ?? '13';
  const nStudios = intro.match(/(\d+) studios/i)?.[1] ?? '4';
  const station = kite.find(b => /over (\d+) kites/i.test(b)) ?? '';
  const storage = kite.find(b => /lockable storage boxes/i.test(b)) ?? '';
  const email = p.kite.match(/mailto:([\w.+-]+@[\w.-]+\.[a-z]{2,})/i)?.[1] ?? null;
  const pp = rates.map(r => r.amount);
  const priceRows = parseLogosPriceRows(p.kite);
  const courses = priceRows.filter(r => /course/i.test(r.name));
  const allRanges = seasons.flatMap(s => s.ranges);
  const seasonStart = allRanges.map(r => r.start).sort()[0] ?? null;
  const seasonEnd = allRanges.map(r => r.end).sort().reverse()[0] ?? null;
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  const contentRooms: ContentRoom[] = rooms.map(r => {
    const unitRates = rates.filter(x => !/shared/i.test(x.unit) && sizeOf(x.unit) === sizeOf(r.name));
    return {
      name: r.name,
      description: r.description || null,
      features: [
        ...r.features,
        ...unitRates.map(x => `${x.unit}, ${x.persons} person${x.persons > 1 ? 's' : ''}, ${x.season}: EUR ${x.amount} per person per night${x.onRequest ? ' (only on request)' : ''}`),
      ],
    };
  });
  const shared = rates.filter(r => /shared/i.test(r.unit));
  if (shared.length) {
    contentRooms.push({
      name: 'Shared Beach Lodge',
      description: 'An XXL lodge booked as a shared lodge with two separate sleeping and bathroom areas (per room, max. 2 adults with private bathroom).',
      features: shared.map(x => `${x.persons} person${x.persons > 1 ? 's' : ''}, ${x.season}: EUR ${x.amount} per person per night${x.onRequest ? ' (only on request)' : ''}`),
    });
  }
  for (const r of contentRooms) r.features.push(...notes.children.map(c => `Children price - ${c}`));

  const imgs = [...new Set([...rooms.flatMap(r => r.images), ...logosImages(p.kite), ...logosImages(p.home)])];

  const summary = [
    `LOGOS Beach Village is a glamping-style kite and surf accommodation directly on the beach at Theologos, Rhodes, with ${nLodges} XL and XXL safari lodges and ${nStudios} studios on a plot of about 10,000 sqm, a pool, a beach bar and a breakfast buffet included.`,
    `Its own kite and windsurf center on the beach, Surf & Kite Theologos, teaches VDWS-certified courses and rents ${station.match(/over (\d+ kites and \d+ boards)/i)?.[1] ?? 'kites and boards'} (Core and Carved)${storage ? ', with lockable storage boxes for own gear' : ''}; Beach Village guests get 5% off sports services.`,
    pp.length ? `Rates run from EUR ${Math.min(...pp)} to ${Math.max(...pp)} per person per night by season${seasonStart && seasonEnd ? ` (season ${fmt(seasonStart)} to ${fmt(seasonEnd)})` : ''}, with weekly bookings only in the high season.` : '',
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'LOGOS Beach Village',
    summary,
    continent: 'Europe',
    country: 'Greece',
    region: 'Dodecanese',
    spot: 'Theologos, Rhodes',
    spotCoords: { lat: 36.3739, lng: 28.036 }, // Theologos, Rhodes; "Theologos, Rhodes, Dodecanese" does not geocode (2026-10-12)
    itinerarySpots: [],
    durationDays: null,
    // kite page: "For the rental as well as the training of all skill levels" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: courses.length > 0,
    equipmentRental: priceRows.some(r => /rental/i.test(r.name)),
    beginnerFriendly: courses.some(c => /beginners/i.test(c.teaser)),
    includedServices: [...notes.included, 'Wi-Fi', 'Linens, towels and pool towels'],
    optionalServices: [
      'Kite courses and private lessons (Surf & Kite Theologos, VDWS)',
      'Kite, surf and wingfoil equipment rental',
      'Equipment storage at the station (extra cost; private gear may not be kept at the lodges)',
      'Surf, windsurf, wingfoil, SUP and jet ski at the center',
    ],
    accommodation: 'beachfront safari lodges (glamping) and studios',
    mealPlan: 'breakfast',
    languages: ['en', 'de'],
    rooms: contentRooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: LOGOS_PRICES_URL,
    bookingUrl: `${SITE}/en/accommodation/`,
    sourceText: [
      `home: ${home.filter(b => b.length > 60).slice(0, 4).join(' | ')}`,
      `rooms: ${rooms.map(r => `${r.name}: ${r.description} [${r.features.join('; ')}]`).join(' || ')}`,
      `prices: ${seasons.map(s => `${s.label} ${s.ranges.map(r => `${r.start}..${r.end}`).join(', ')}`).join('; ')} | ${rates.map(r => `${r.unit} ${r.persons}p ${r.season} ${r.amount}${r.onRequest ? ' on request' : ''}`).join('; ')}`,
      `children: ${notes.children.join('; ')}`,
      `occupancy: ${notes.occupancy.join('; ')}`,
      `included: ${notes.included.join('; ')}`,
      ...Object.entries(notes.sections).map(([k, v]) => `${k}: ${v}`),
      `kite center: ${kite.filter(b => b.length > 80).slice(0, 6).join(' | ')}`,
      `kite price list: ${priceRows.map(r => `${r.name} (${r.teaser}) ${r.price ?? '-'} EUR`).join('; ')}`,
      email ? `contact: ${email}` : '',
    ].filter(Boolean).join('\n'),
  };
}

export const logosBeachVillageTheologos: OfferAdapter = {
  key: 'logos-beach-village-theologos',
  name: 'LOGOS Beach Village Theologos',
  kind: 'accommodation',
  operator: {
    name: 'LOGOS Theologos',
    websiteUrl: SITE,
    rootDomain: 'logosbeachvillage.com',
    contactEmail: 'info@logos-rhodos.com',
  },
  url: HOME_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 8,
  async fetchContent() {
    const home = await fetchText(HOME_URL, { accept: 'text/html' });
    const rooms: string[] = [];
    for (const u of LOGOS_ROOM_URLS) rooms.push(await fetchText(u, { accept: 'text/html' }));
    const kite = await fetchText(KITE_URL, { accept: 'text/html' });
    const prices = await fetchText(LOGOS_PRICES_URL, { accept: 'text/html' });
    return parseLogosContent({ home, rooms, kite, prices });
  },
  async fetchSlots() {
    const html = await fetchText(LOGOS_PRICES_URL, { accept: 'text/html' });
    const { seasons, rates } = parseLogosTable(html);
    if (seasons.length === 0 || rates.length < 5) throw new Error(`logos-beach-village: season price table not found or changed (${seasons.length} seasons, ${rates.length} rates)`);
    if (seasons.some(s => s.ranges.length === 0)) throw new Error('logos-beach-village: a season column has no parsable date range');
    return buildLogosSlots(seasons, rates, parseLogosWeeklyRange(html));
  },
};
