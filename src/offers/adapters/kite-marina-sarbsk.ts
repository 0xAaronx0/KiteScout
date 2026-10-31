// ---------------------------------------------------------------------------
// Kite Marina, Sarbsk (Łeba area, Pomerania, Poland) - guesthouse "w standardzie hotelowym" with 37 rooms + 6 Premium
// rooms directly on Lake Sarbsko, 1900 m from the Baltic Sea. Kite link: the house runs a water sports school
// ("Szkoła sportów wodnych": Surfing, Kite Surfing, SUP; kite and windsurf lessons with an instructor) and sells
// "Wczasy kite nad jeziorem" (kite holidays on the lake); the lake is shallow (average depth under 1 m).
//
// Data path (checked 2026-10-12): MiroArt CMS, Polish pages (the /de and /en sites are separate hosts, not used).
//   content  / (kite school, lake, 1900 m to the sea), /pokoje/ (room cards: name, "max N os.", m², "od" price,
//            "37 pokoi i 6 pokoi Premium"), /kontakt/ (Google Maps embed of the place -> spotCoords).
//   slots    8 room pages /pokoje/<slug>/: per room one price table (Premium rooms: one table per occupancy,
//            "Ceny dla 2/3/4 os."), header cells "30.04.26 04.05.26 Majówka", "04.05.26 04.07.26", "04.06.26
//            07.06.26 Boże Ciało", "04.07.26 22.08.26", "22.08.26 27.09.26", price row "480 zł", "760 zł *" (* =
//            "OBIADOKOLACJA W OKRESIE 4.07-22.08.2026", dinner included). Pages say "zł / noc" -> per room per night.
//            The second date of a header is the departure day (bands meet on it: 04.05 ends one and starts the next),
//            so a band's last night is the day before. Holiday bands (Majówka, Boże Ciało) lie inside or next to the
//            base bands; per night the shortest band wins, then runsOf() groups equal nights into bands.
// Booking engine: the home page embeds a KWHotel/GuestSage booking bar (hotelGuid 3b16e01a-...), but GuestSage's
//   public configuration says "enabled": false / "active": false (checked once 2026-10-12) and every "Rezerwacja" /
//   "Rezerwuj Online" button links to /kontakt/; the rooms page says "PYTANIA I REZERWACJE pod numerem telefonu".
//   -> no engine read, availability 'on_request'.
// robots.txt (2026-10-12): disallows /admin, /cache, /captcha, /lib, /modules etc., not the pages we read. NOTE:
//   fetching robots.txt itself through fetchText trips the bot-challenge check (it contains "/captcha" and is short);
//   http.ts reads robots.txt with its own fetch, so pages are not affected.
// Requests per run: 11 (home, rooms, contact, 8 room pages; memoised, slots reuse the room pages).
// Parsed: slot = room x occupancy x band ("pokoj-2-os-z-balkonem-2p|2026-07-04"), PLN per room per night, 'on_request'.
// Known limits: the 2026 season ended 27.09.2026 and the 2027 tables are not published yet (2026-10-12), so every
//   band is in the past and the offer shows "price on request" until the house publishes 2027 prices. The "od"
//   prices on the room cards (e.g. od 390 zł) do not match the 2026 tables and carry no dates: not used. From
//   1 October to 30 April the house hosts events and conferences only.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, parse, parseAmount, runsOf } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kitemarina.pl';
export const KM_HOME_URL = `${SITE}/`;
export const KM_ROOMS_URL = `${SITE}/pokoje/`;
export const KM_CONTACT_URL = `${SITE}/kontakt/`;

// --- local helpers (shared with fly-house-leba: same MiroArt CMS) ----------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes (content and slots share the room pages) */
function get(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const addDays = (isoDate: string, n: number): string => new Date(Date.parse(isoDate) + n * 86400000).toISOString().slice(0, 10);

/** Visible text lines of a MiroArt page (scripts, styles, SVGs dropped), split at block tags. */
export function miroLines(html: string): string[] {
  const out: string[] = [];
  for (const raw of html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|a|button|figure)\b[^>]*>/i)) {
    const t = clean(raw.replace(/<[^>]+>/g, ' '));
    if (t && out[out.length - 1] !== t) out.push(t);
  }
  return out;
}

/**
 * Gallery photos of a MiroArt CMS page: slider backgrounds (data-source="-q80-p1/files/gallery/<id>/<file>") and
 * photoswipe / thumbnail links (/img2/<size>/files/gallery/<id>/<file>), rebuilt as `<site>/img2/<size>/files/...`.
 * Deduplicated by file name (the CMS stores the same upload under several gallery ids); floor plans, sketches,
 * logos and icons are dropped.
 */
export function miroArtImages(html: string, site: string, size: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /(?:data-source="[^"]*?|(?:href|src)="\/img2\/[^"]*?)\/?(files\/gallery\/\d+\/([^"/]+\.(?:jpe?g|png|webp)))"/gi;
  for (const m of html.matchAll(re)) {
    const file = m[2];
    if (/logo|icon|favicon|rzut|szkic|\.svg/i.test(file)) continue;
    const k = file.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(`${site}/img2/${size}/${m[1]}`);
  }
  return out;
}

// --- rooms list ----------------------------------------------------------------------------------
export interface KmRoomCard { slug: string; url: string; name: string; nameEn: string; maxPersons: number | null; sizeM2: number | null; fromPrice: number | null; teaser: string | null }

/** Polish room names -> English ("Pokój 2 os. z balkonem i widokiem na jezioro" -> "Double room with balcony and lake view"). */
export function kmRoomNameEn(name: string): string {
  const n = name.replace(/\s+/g, ' ').trim();
  const persons = n.match(/^Pok[óo]j\s+(\d)\s*(?:os\.?|-?osobowy)/i)?.[1];
  const base = persons ? ({ '2': 'Double room', '3': 'Triple room', '4': 'Quadruple room' } as Record<string, string>)[persons]
    : /^Pok[óo]j rodzinny/i.test(n) ? 'Family room'
      : /^Pok[óo]j Premium/i.test(n) ? 'Premium room'
        : /^Apartament/i.test(n) ? 'Apartment' : null;
  if (!base) return n;
  const parts: string[] = [];
  if (/balkon/i.test(n)) parts.push('balcony');
  if (/taras/i.test(n)) parts.push('terrace');
  if (/widokiem na jezioro/i.test(n)) parts.push('lake view');
  return parts.length ? `${base} with ${parts.join(' and ')}` : base;
}

export function parseKmRoomCards(html: string): KmRoomCard[] {
  const out: KmRoomCard[] = [];
  for (const a of parse(html).querySelectorAll('a.booklet--slider')) {
    const href = a.getAttribute('href') ?? '';
    const slug = href.match(/^\/pokoje\/([^/]+)\/$/)?.[1];
    if (!slug || out.some(r => r.slug === slug)) continue;
    const name = clean(a.querySelector('.booklet__title strong')?.text);
    if (!name) continue;
    const title = clean(a.querySelector('.booklet__title')?.text);
    const price = a.querySelector('.booklet__price-hld--initial strong')?.text;
    out.push({
      slug,
      url: `${SITE}${href}`,
      name,
      nameEn: kmRoomNameEn(name),
      maxPersons: Number(title.match(/max\.?\s*(\d+)\s*os/i)?.[1]) || null,
      sizeM2: Number(title.match(/(\d+)\s*m\s*2/)?.[1]) || null,
      fromPrice: price ? parseAmount(price) : null,
      teaser: clean(a.querySelector('.booklet__price-hld--hover p')?.text) || null,
    });
  }
  return out;
}

// --- price tables ------------------------------------------------------------------------------
export interface KmBand { start: string; endExclusive: string; label: string | null; price: number; dinner: boolean }
export interface KmTable { occupancy: number | null; bands: KmBand[] }

const LABEL_EN: Record<string, string> = { 'majówka': 'May Day holidays', 'boże ciało': 'Corpus Christi' };
const dmy = (d: string, m: string, y: string): string => iso(y.length === 2 ? 2000 + Number(y) : Number(y), Number(m), Number(d));

/** Every price table of a room page; "Ceny dla N os." before a table sets its occupancy. */
export function parseKmTables(html: string): KmTable[] {
  const out: KmTable[] = [];
  const re = /Ceny dla\s*(\d)\s*os|<table\b[\s\S]*?<\/table>/gi;
  let occupancy: number | null = null;
  for (const m of html.matchAll(re)) {
    if (m[1]) { occupancy = Number(m[1]); continue; }
    const rows = parse(m[0]).querySelectorAll('tr').map(tr => tr.querySelectorAll('td').map(td => clean(td.text)));
    if (rows.length < 2) continue;
    const [head, prices] = rows;
    const bands: KmBand[] = [];
    head.forEach((cell, i) => {
      const dates = [...cell.matchAll(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/g)];
      if (dates.length < 2) return;
      const priceCell = prices[i] ?? '';
      const price = parseAmount(priceCell);
      if (!price || !/zł|pln/i.test(priceCell)) return;
      const label = clean(cell.replace(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/g, ' ').replace(/[.\s]+$/, '')) || null;
      bands.push({
        start: dmy(dates[0][1], dates[0][2], dates[0][3]),
        endExclusive: dmy(dates[1][1], dates[1][2], dates[1][3]),
        label: label ? (LABEL_EN[label.toLowerCase()] ?? label) : null,
        price,
        dinner: /\*/.test(priceCell),
      });
    });
    if (bands.length) out.push({ occupancy, bands });
    occupancy = null;
  }
  return out;
}

/** Nights -> bands: per night the shortest printed band wins (holidays inside a base band), equal nights are grouped. */
export function kmNightBands(bands: KmBand[]): Array<{ start: string; end: string; band: KmBand }> {
  const byNight = new Map<string, KmBand>();
  const longestFirst = [...bands].sort((a, b) => (Date.parse(b.endExclusive) - Date.parse(b.start)) - (Date.parse(a.endExclusive) - Date.parse(a.start)));
  for (const b of longestFirst) {
    for (let d = b.start; d < b.endExclusive; d = addDays(d, 1)) byNight.set(d, b);
  }
  const days = [...byNight.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, band]) => ({ date, band }));
  return runsOf(days, d => `${d.band.price}|${d.band.dinner}|${d.band.label ?? ''}`).map(r => ({ start: r.start, end: r.end, band: r.first.band }));
}

export interface KmRoom { card: KmRoomCard; tables: KmTable[] }

export function buildKmSlots(rooms: KmRoom[]): Slot[] {
  const out: Slot[] = [];
  for (const { card, tables } of rooms) {
    for (const t of tables) {
      const occ = t.occupancy ?? card.maxPersons;
      for (const n of kmNightBands(t.bands)) {
        out.push({
          key: `${keyPart(card.slug)}-${occ ?? 'x'}p|${n.start}`,
          startDate: n.start,
          endDate: n.end,
          unit: card.nameEn,
          price: n.band.price,
          currency: 'PLN',
          priceUnit: 'per_night',
          priceBasis: 'room',
          occupancy: occ,
          availability: 'on_request',
          availabilityText: null,
          spotsLeft: null,
        });
      }
    }
  }
  return out;
}

// --- content -------------------------------------------------------------------------------------
const EQUIPMENT_EN: Record<string, string> = {
  'internet w pokoju': 'Internet in the room', 'telewizor z płaskim ekranem': 'Flat-screen TV', 'klimatyzacja': 'Air conditioning',
  'lodówka hotelowa': 'Fridge', 'czajnik': 'Kettle', 'biurko': 'Desk', 'szafa': 'Wardrobe', 'łazienka z prysznicem': 'Bathroom with shower',
  'suszarka do włosów': 'Hair dryer', 'ręczniki': 'Towels',
};

/** Room page facts: equipment list, notes in the intro line. */
export function parseKmRoomPage(html: string): { equipment: string[]; notes: string[] } {
  const root = parse(html);
  const equipment = root.querySelectorAll('li')
    .map(li => clean(li.text))
    .filter(t => t && EQUIPMENT_EN[t.toLowerCase()] !== undefined)
    .map(t => EQUIPMENT_EN[t.toLowerCase()]);
  const intro = clean(root.querySelector('h1')?.parentNode?.querySelector('p strong')?.text);
  const notes: string[] = [];
  if (/na piętrze/i.test(intro)) notes.push('Upper floor');
  if (/Brak możliwości dostawki/i.test(intro)) notes.push('No extra bed possible');
  if (/dwie osoby dorosłe i dzieci do lat 10/i.test(intro)) notes.push('Max. 4 persons: 2 adults and children up to 10');
  if (/łoże małżeńskie i kanapa rozkładana/i.test(intro)) notes.push('Double bed and sofa bed');
  return { equipment, notes };
}

const fmt = (d: string): string => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;

/** Google Maps embed of the place on /kontakt/ ("!2d<lng>!3d<lat>"). */
export function kmCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/maps\/embed\?pb=[^"']*?!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/);
  if (!m) return null;
  return { lat: Math.round(Number(m[2]) * 1e6) / 1e6, lng: Math.round(Number(m[1]) * 1e6) / 1e6 };
}

export interface KmPages { home: string; rooms: string; contact: string; roomPages: Record<string, string> }

export function parseKiteMarinaContent(p: KmPages): OfferContent {
  const home = miroLines(p.home);
  const roomsText = miroLines(p.rooms);
  const homeText = home.join('\n');
  const cards = parseKmRoomCards(p.rooms);
  const nRooms = roomsText.join(' ').match(/(\d+)\s*pokoi i (\d+) pokoi Premium/i);
  const toSea = homeText.match(/(\d[\d\s]*)\s*metrów do morza/i)?.[1]?.replace(/\s/g, '') ?? null;
  const depth = /głębokość jeziora nie przekracza 1\s?m/i.test(homeText);
  const kiteSchool = /Kite Surfing/i.test(homeText) && /nauki sportów wodnych \(kite i windsurfing\)/i.test(homeText);

  const rooms: ContentRoom[] = cards.map(card => {
    const html = p.roomPages[card.slug] ?? '';
    const { equipment, notes } = parseKmRoomPage(html);
    const tables = parseKmTables(html);
    const rates = tables.map(t => {
      const occ = t.occupancy ?? card.maxPersons;
      return `2026 rates${occ ? ` for ${occ} person${occ > 1 ? 's' : ''}` : ''} (PLN per room and night, breakfast incl.): `
        + t.bands.map(b => `${fmt(b.start)}-${fmt(addDays(b.endExclusive, -1))}${b.label ? ` ${b.label}` : ''} ${b.price}${b.dinner ? ' incl. dinner' : ''}`).join(' / ');
    });
    return {
      name: card.nameEn,
      description: [
        card.maxPersons ? `Up to ${card.maxPersons} persons` : null,
        card.sizeM2 ? `${card.sizeM2} m²` : null,
      ].filter(Boolean).join(', ') || null,
      features: [...notes, ...equipment, ...rates],
    };
  });

  const imageUrls: string[] = [];
  for (const u of [
    ...miroArtImages(p.home, SITE, 'w1140-h900'),
    ...Object.values(p.roomPages).flatMap(h => miroArtImages(h, SITE, 'w1140-h900')),
    ...miroArtImages(p.rooms, SITE, 'w1140-h900'),
  ]) {
    const f = u.split('/').pop()!.toLowerCase();
    if (!imageUrls.some(x => x.split('/').pop()!.toLowerCase() === f)) imageUrls.push(u);
  }

  const allTables = Object.values(p.roomPages).flatMap(h => parseKmTables(h));
  const prices = allTables.flatMap(t => t.bands.map(b => b.price));
  const starts = allTables.flatMap(t => t.bands.map(b => b.start)).sort();
  const ends = allTables.flatMap(t => t.bands.map(b => b.endExclusive)).sort();
  const dinner = allTables.flatMap(t => t.bands).find(b => b.dinner);
  const season = starts.length ? `${fmt(starts[0])}${starts[0].slice(0, 4)} to ${fmt(ends[ends.length - 1])}${ends[ends.length - 1].slice(0, 4)}` : null;

  const summary = [
    `Kite Marina is a guesthouse of hotel standard in Sarbsk near Łeba on the Polish Baltic coast, directly on Lake Sarbsko and ${toSea ?? '1900'} m from the sea, with ${nRooms ? `${nRooms[1]} rooms and ${nRooms[2]} Premium rooms` : 'double, triple, family and Premium rooms'} with balcony or terrace.`,
    `Its water sports school offers kitesurfing, windsurfing, surfing and SUP with an instructor${depth ? ', and the lake is shallow (average depth under 1 m)' : ''}; a boat takes guests across the lake to the beach.`,
    `Rates include breakfast, the spa (sauna, jacuzzi), pedal boats, kayaks and SUPs${prices.length ? `; in 2026 rooms cost PLN ${Math.min(...prices)} to ${Math.max(...prices)} per night` : ''}${season ? ` (season ${season}${dinner ? ', with dinner included in high summer' : ''})` : ''}.`,
    'From October to April the house hosts events and conferences; reservations go by phone or the contact form.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Kite Marina Sarbsk',
    summary,
    continent: 'Europe',
    country: 'Poland',
    region: 'Sarbsk, Pomerania',
    spot: 'Lake Sarbsko, Sarbsk',
    spotCoords: kmCoords(p.contact),
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: kiteSchool ? true : null,
    equipmentRental: null,
    // shallow lake (under 1 m) + lessons with an instructor; "bardzo bezpiecznym akwenem" (inferred for beginners)
    beginnerFriendly: depth ? true : null,
    includedServices: [
      'Breakfast',
      'Parking on site',
      'Spa zone: sauna and jacuzzi (children from 12)',
      'Water sports gear: pedal boats, kayaks, SUP',
      'Boat transfer across Lake Sarbsko to the beach',
      ...(dinner ? ['Dinner in high summer (4 July - 22 August 2026)'] : []),
    ],
    optionalServices: [
      'Kite and windsurf lessons with an instructor (water sports school on site)',
      'Restaurant "Woda i Wiatr" (regional cuisine)',
      'Picnic baskets',
      'Small pets outside the summer holidays in Premium rooms (PLN 100 per night)',
    ],
    accommodation: 'lakeside guesthouse rooms with balcony or terrace',
    mealPlan: 'breakfast',
    languages: ['pl', 'de', 'en'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KM_HOME_URL,
    bookingUrl: KM_CONTACT_URL,
    sourceText: [
      `home: ${homeText}`,
      `rooms: ${roomsText.join(' | ')}`,
      `rates: ${cards.map(c => `${c.slug}: ${parseKmTables(p.roomPages[c.slug] ?? '').map(t => `${t.occupancy ?? c.maxPersons}p ${t.bands.map(b => `${b.start}..${b.endExclusive} ${b.price}${b.dinner ? '*' : ''}`).join(', ')}`).join(' ; ')}`).join(' || ')}`,
    ].join('\n'),
  };
}

async function roomPages(cards: KmRoomCard[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const c of cards) out[c.slug] = await get(c.url);
  return out;
}

// --- adapter ---------------------------------------------------------------------------------------
export const kiteMarinaSarbsk: OfferAdapter = {
  key: 'kite-marina-sarbsk',
  name: 'Kite Marina Sarbsk',
  kind: 'accommodation',
  operator: {
    name: 'Kite Marina Sarbsk s.c.',
    websiteUrl: SITE,
    rootDomain: 'kitemarina.pl',
    contactEmail: 'recepcja@kitemarina.pl',
    phone: '+48 511 317 311',
  },
  url: KM_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 12,
  async fetchContent() {
    const home = await get(KM_HOME_URL);
    const rooms = await get(KM_ROOMS_URL);
    const contact = await get(KM_CONTACT_URL);
    const cards = parseKmRoomCards(rooms);
    if (cards.length < 4) throw new Error(`kite-marina-sarbsk: room cards not found on /pokoje/ (${cards.length})`);
    return parseKiteMarinaContent({ home, rooms, contact, roomPages: await roomPages(cards) });
  },
  async fetchSlots(ctx: FetchContext) {
    const cards = parseKmRoomCards(await get(KM_ROOMS_URL));
    if (cards.length < 4) throw new Error(`kite-marina-sarbsk: room cards not found on /pokoje/ (${cards.length})`);
    const pages = await roomPages(cards);
    const rooms: KmRoom[] = cards.map(card => ({ card, tables: parseKmTables(pages[card.slug]) }));
    const missing = rooms.filter(r => r.tables.length === 0).map(r => r.card.slug);
    if (missing.length === rooms.length) throw new Error('kite-marina-sarbsk: no price table on any room page (layout changed?)');
    if (missing.length) ctx.note(`no price table on ${missing.join(', ')}`);
    const slots = buildKmSlots(rooms);
    const today = new Date().toISOString().slice(0, 10);
    if (!slots.some(s => (s.endDate ?? '') >= today)) ctx.note('all printed bands are in the past (next season not published yet): price on request');
    return slots;
  },
};
