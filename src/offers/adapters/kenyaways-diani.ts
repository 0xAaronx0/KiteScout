// ---------------------------------------------------------------------------
// Kenyaways Beach B&B, Galu Kinondo / Diani Beach (Kenya) - rustic beachfront guest house in the former
// Kennaway family home, founded by a kite instructor; kite storage at the rooms, H2O Extreme kite school
// next door, The Salty Squid beach bar/restaurant on site. Replaces the bstoked listing 7154
// "Kenyaways Beach Accommodation and Restaurant".
//
// Data path (checked 2026-10-12): Squarespace site www.thekenyaway.com.
//   content  /bedandbreakfast-rooms-rates (9 named B&B rooms: <h3> name + type / description / "Sleeps
//            maximum ..." paragraphs, room galleries), /facilities (breakfast, restaurant, kite storage,
//            H2O Extreme), /rates-and-booking-terms (minimum nights, seasons, closing period).
//   slots    the rates are NOT on the page: the rooms page links three rate sheets, a PDF / JPG each:
//              /s/2026-Kusi-rates.jpg     "1 Jun 2026 to 30 Nov 2026"
//              /s/2027-Kaskazi-rates.pdf  labelled "1 Dec 2025 to 31 May 2026" on the page, but the sheet
//                                         itself reads "1 DEC 2026 - 31 MAY 2027 (KASKAZI)"
//              /s/2027-Peak-rates.pdf     "18 DEC 2026 - 17 JAN 2027 (PEAK)"
//            We cannot parse a PDF/JPG through fetchText, so the prices below are constants read by hand
//            (built-in browser, 2026-10-12). They are released only while the rooms page still links the
//            same sheet and still lists the rooms of a category (liveness, like theriderexperience-los-
//            roques); a new rate link on the page is reported via ctx.note for a manual re-read.
// Booking engine: freetobook (portal.freetobook.com/reservations?w_id=11210) - its robots.txt disallows
//   everything for us, so there is no live availability (slots stay 'unknown').
// robots.txt www.thekenyaway.com (2026-10-12): Squarespace defaults (/config, /search, /api/, /static/,
//   ?format=json ...) - the pages above are allowed.
// Requests per run: content 3, slots 1 (the rooms page is memoised for 10 minutes).
// Parsed: slot = rate category x persons sharing x season band x named room of the category (Slot.room), with
//   the sheet's real date limits ("super-sea-view-2p|2026-12-18|Rebel"), USD per person per night incl. breakfast (sheet: "All rates are in
//   US Dollars ($) per Person sharing in a Room, including breakfast"), minNights from the sheet; bands that
//   ended before today are dropped.
// Known limits:
//   - Prices are indicative per the operator ("subject to change any time"); a silent re-upload under the
//     same file name would not be noticed (Squarespace /s/ links keep their name).
//   - The booking-terms page gives slightly different season limits (peak "11 Dec26 - 12 Jan27", high
//     season "12 Jan27 - 28 Feb27") than the rate sheets; the bands follow the sheets that carry the prices.
//   - Easter 2027 ("min. nights apply") has no own price column; it stays inside the low-season band.
//     The terms say the house is "usually closed after Easter until early June", while the sheet prices
//     April and May 2027 - kept, with that sentence as availabilityText.
//   - Children (2-11 years) sharing with adults: USD 15 (Kusi sheet) / 20 (Kaskazi, Peak) per night - in the
//     room features only. The two self-catering units are not part of these rates.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, todayIso, type HTMLElement } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.thekenyaway.com';
export const KW_ROOMS_URL = `${SITE}/bedandbreakfast-rooms-rates`;
const KW_FACILITIES_URL = `${SITE}/facilities`;
const KW_TERMS_URL = `${SITE}/rates-and-booking-terms`;

// --- rate sheets (constants, read by hand 2026-10-12) ---------------------------------
export type KwCategory = 'super-sea-view' | 'aircon' | 'small-sea-view' | 'pool-garden-budget' | 'pool-apartment';
export const KW_CATEGORIES: Array<{ id: KwCategory; name: string; rooms: string[] }> = [
  { id: 'super-sea-view', name: 'Super Sea View room', rooms: ['Rebel', 'Tribal'] },
  { id: 'aircon', name: 'Aircon room', rooms: ['Bolt', 'Park', 'Crossbow'] },
  { id: 'small-sea-view', name: 'Small Sea View room', rooms: ['Raven', 'Fuel'] },
  { id: 'pool-garden-budget', name: 'Pool Garden Budget room', rooms: ['Cult'] },
  { id: 'pool-apartment', name: 'Pool Apartment', rooms: ['Bandit'] },
];
/** USD per person per night for 1, 2, 3, 4 adults sharing (null = not offered). */
type Rates = Record<KwCategory, Array<number | null>>;
interface Band { start: string; end: string; season: string; minNights: number; note?: string }
export interface KwSheet { href: string; title: string; childRate: number; seasons: Record<string, Rates>; bands: Band[] }

export const KW_SHEETS: KwSheet[] = [
  {
    href: '/s/2026-Kusi-rates.jpg',
    title: 'Kusi 1 Jun - 30 Nov 2026',
    childRate: 15,
    seasons: {
      regular: { 'super-sea-view': [145, 90, 72, 63], aircon: [125, 80, 65, 58], 'small-sea-view': [110, 68], 'pool-garden-budget': [64, 45], 'pool-apartment': [180, 90, 68, 58] },
      low: { 'super-sea-view': [120, 78, 63, 56], aircon: [105, 70, 58, 53], 'small-sea-view': [100, 63], 'pool-garden-budget': [60, 43], 'pool-apartment': [156, 78, 60, 52] },
    },
    // sheet: Regular JUL, AUG, OCT (min. 3 nights); Low JUN, SEP, NOV (min. 3 nights; "2 nights allowed at reg season rates",
    // a stay condition without a field - kept in the room features)
    bands: [
      { start: '2026-06-01', end: '2026-06-30', season: 'low', minNights: 3 },
      { start: '2026-07-01', end: '2026-08-31', season: 'regular', minNights: 3 },
      { start: '2026-09-01', end: '2026-09-30', season: 'low', minNights: 3 },
      { start: '2026-10-01', end: '2026-10-31', season: 'regular', minNights: 3 },
      { start: '2026-11-01', end: '2026-11-30', season: 'low', minNights: 3 },
    ],
  },
  {
    href: '/s/2027-Kaskazi-rates.pdf',
    title: 'Kaskazi 1 Dec 2026 - 31 May 2027',
    childRate: 20,
    seasons: {
      regular: { 'super-sea-view': [157, 99, 79, 69], aircon: [135, 88, 72, 64], 'small-sea-view': [119, 80], 'pool-garden-budget': [70, 55], 'pool-apartment': [194, 97, 78, 69] },
      low: { 'super-sea-view': [130, 85, 70, 63], aircon: [113, 77, 64, 58], 'small-sea-view': [108, 74], 'pool-garden-budget': [65, 53], 'pool-apartment': [168, 84, 69, 62] },
    },
    // sheet: Regular JAN27, FEB27 (min. 3 nights) except peak; Low DEC26, MAR27, APR27, MAY27 (min. 3 nights) except peak and Easter
    bands: [
      { start: '2026-12-01', end: '2026-12-17', season: 'low', minNights: 3 },
      { start: '2027-01-18', end: '2027-02-28', season: 'regular', minNights: 3 },
      { start: '2027-03-01', end: '2027-05-31', season: 'low', minNights: 3, note: 'Easter: minimum nights apply; booking terms: usually closed after Easter until early June (rainy season), please enquire' },
    ],
  },
  {
    href: '/s/2027-Peak-rates.pdf',
    title: 'Peak 18 Dec 2026 - 17 Jan 2027',
    childRate: 20,
    seasons: {
      peak: { 'super-sea-view': [162, 101, 81, 71], aircon: [146, 93, 75, 67], 'small-sea-view': [130, 85], 'pool-garden-budget': [71, 56], 'pool-apartment': [null, 100, 80, 70] },
    },
    bands: [{ start: '2026-12-18', end: '2027-01-17', season: 'peak', minNights: 7 }],
  },
];

// --- local helpers ----------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
function visible(html: string): HTMLElement {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, template')) el.remove();
  return root;
}
/** Main content text without header, footer and navigation. */
function mainText(html: string): string {
  const root = visible(html);
  for (const el of root.querySelectorAll('header, footer, nav')) el.remove();
  return txt(root.querySelector('main') ?? root.querySelector('article') ?? root);
}

// --- pure parsers -------------------------------------------------------------------
export interface KwRoom { name: string; type: string | null; description: string | null; sleeps: string | null }

/** Room blocks: one Squarespace text block per room (<h3> name, then type / description / sleeps). */
export function parseKwRooms(html: string): KwRoom[] {
  const out: KwRoom[] = [];
  for (const b of visible(html).querySelectorAll('.sqs-html-content')) {
    const name = txt(b.querySelector('h3'));
    const ps = b.querySelectorAll('p').map(p => txt(p)).filter(Boolean);
    const sleeps = ps.find(p => /^sleeps/i.test(p)) ?? null;
    if (!name || !sleeps) continue;
    const rest = ps.filter(p => p !== sleeps);
    out.push({ name, type: rest[0] ?? null, description: rest.slice(1).join(' ') || null, sleeps });
  }
  return out;
}

/** Rate-sheet links ("/s/...rates...") on the rooms page. */
export function rateLinks(html: string): string[] {
  const out: string[] = [];
  for (const a of parse(html).querySelectorAll('a')) {
    const href = a.getAttribute('href') ?? '';
    const path = href.startsWith('http') ? new URL(href).pathname : href;
    if (/^\/s\/.*rate/i.test(path) && !out.includes(path)) out.push(path);
  }
  return out;
}

/** Site map pin (footer Google Maps link: "...!3d-4.3508756!4d39.5635778"). */
export function mapPin(html: string): { lat: number; lng: number } | null {
  const m = html.match(/google\.com\/maps\/place\/[^"']*?!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

/** Released slots: sheets still linked, categories whose rooms are still listed, bands not yet over. */
export function buildKwSlots(links: string[], roomNames: string[], today = todayIso()): Slot[] {
  const slots: Slot[] = [];
  for (const sheet of KW_SHEETS) {
    if (!links.includes(sheet.href)) continue;
    for (const band of sheet.bands) {
      if (band.end < today) continue;
      for (const cat of KW_CATEGORIES) {
        // one slot per listed room of the category: every room of a category has the same per-person rate
        const listed = cat.rooms.filter(r => roomNames.includes(r));
        if (!listed.length) continue;
        sheet.seasons[band.season][cat.id].forEach((price, i) => {
          if (price === null) return;
          const n = i + 1;
          for (const room of listed) slots.push({
            key: `${cat.id}-${n}p|${band.start}|${room}`,
            startDate: band.start,
            endDate: band.end,
            unit: `${cat.name} (${cat.rooms.join(', ')})`,
            room,
            price,
            currency: 'USD',
            priceUnit: 'per_night',
            priceBasis: 'person',
            occupancy: n,
            availability: 'unknown',
            availabilityText: band.note ?? null,
            spotsLeft: null,
            minNights: band.minNights,
          });
        });
      }
    }
  }
  return slots.sort((a, b) => (a.startDate! < b.startDate! ? -1 : a.startDate! > b.startDate! ? 1 : 0));
}

// --- content ----------------------------------------------------------------------
export interface KwPages { rooms: string; facilities: string; terms: string }

export function parseKenyawaysContent(p: KwPages, today = todayIso()): OfferContent {
  const rooms = parseKwRooms(p.rooms);
  if (rooms.length < 5) throw new Error(`kenyaways: room blocks not found (${rooms.length} parsed)`);
  const roomsText = mainText(p.rooms);
  const fac = mainText(p.facilities);
  const terms = mainText(p.terms);
  const seaView = rooms.filter(r => /sea view/i.test(r.type ?? '')).length;
  const links = rateLinks(p.rooms);
  const slots = buildKwSlots(links, rooms.map(r => r.name), today);
  const min = slots.length ? Math.min(...slots.map(s => s.price!)) : null;
  const max = slots.length ? Math.max(...slots.map(s => s.price!)) : null;
  const h2o = /H2o Extreme/i.test(fac);
  const closed = terms.match(/Usually we are closed after Easter until Early June[^.]*/i)?.[0] ?? null;

  const contentRooms: ContentRoom[] = rooms.map(r => {
    const cat = KW_CATEGORIES.find(c => c.rooms.includes(r.name));
    const current = KW_SHEETS.filter(s => links.includes(s.href) && s.bands.some(b => b.end >= today));
    const rates = cat ? current.flatMap(s =>
      Object.entries(s.seasons).map(([season, rt]) => `${s.title}, ${season}: USD ${rt[cat.id].map((v, i) => (v === null ? null : `${v} (${i + 1} sharing)`)).filter(Boolean).join(' / ')} per person per night`)) : [];
    return {
      name: r.name,
      description: [r.type, r.description].filter(Boolean).join(': ') || null,
      features: [
        ...(r.sleeps ? [r.sleeps] : []),
        ...(cat ? [`Rate category: ${cat.name}`] : []),
        ...rates,
        ...(cat && current.some(s => s.href.includes('Kusi')) ? ['Kusi low season (Jun, Sep, Nov): 2-night stays allowed at regular season rates'] : []),
        ...(cat ? [`Children 2-11 sharing with adults: ${current.map(s => `USD ${s.childRate} (${s.title.split(' ')[0]})`).join(', ')} per night`] : []),
      ],
    };
  });

  const imageUrls = imageCandidates(p.rooms, KW_ROOMS_URL, null, 80)
    .filter(u => !/logo|favicon|\.svg|website\)?\.png/i.test(u));

  const summary = [
    `Kenyaways is a rustic beachfront guest house on Galu Beach in Diani, on Kenya's south coast, set in a renovated 1960s family home; it was turned into a guest house for kitesurfers by Linzi Kennaway, who started teaching kitesurfing in 2004.`,
    `It has ${rooms.length} B&B rooms, ${seaView} with sea view and the others around the pool garden; breakfast comes from The Salty Squid beach bar and restaurant on site.`,
    `${/kite storage/i.test(fac) ? 'Rooms have kite storage' : 'Kiters are welcome'}${h2o ? ', and the H2O Extreme kite school (IKO lessons, rental, rescue) is next door' : ''}.`,
    `${min !== null ? `Rates run from USD ${min} to ${max} per person per night depending on room, persons sharing and season, with minimum stays of 3 to 7 nights` : 'Rates on request'}${closed ? '; the house usually closes after Easter until early June' : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Kenyaways Beach B&B',
    summary,
    continent: 'Africa',
    country: 'Kenya',
    region: 'Kwale County (South Coast)',
    spot: 'Galu Beach, Diani',
    spotCoords: mapPin(p.rooms), // the site's own Google Maps place link (footer), 2026-10-12
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: h2o ? true : null,     // H2O Extreme next door, not Kenyaways itself
    equipmentRental: h2o ? true : null,
    beginnerFriendly: null,
    includedServices: [
      'Breakfast (tea or coffee, fruit, juice and one item from the breakfast menu)',
      'Towels and linen',
      ...(/kite storage/i.test(fac) ? ['Kite storage (outside the sea view rooms; near the beachfront for pool garden rooms)'] : []),
      ...(/beach beds exclusively/i.test(fac) ? ['Beach beds for guests'] : []),
    ],
    optionalServices: [
      ...(h2o ? ['Kite lessons, rental, rescue and repair at H2O Extreme kite school next door (www.h2o-extreme.com)'] : []),
      'Lunch and dinner at The Salty Squid beach bar and restaurant',
      ...(/massage/i.test(fac) ? ['Massages and beauty treatments'] : []),
    ],
    accommodation: 'Rustic beachfront guest house: sea view rooms, pool garden rooms and a pool garden apartment',
    mealPlan: 'breakfast',
    languages: ['en'],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 40),
    heroVideoUrl: null,
    sourceUrl: KW_ROOMS_URL,
    bookingUrl: visible(p.rooms).querySelector('a[href*="freetobook.com/reservations"]')?.getAttribute('href') ?? `${SITE}/book-a-room`,
    sourceText: [
      `rooms: ${roomsText}`,
      `facilities: ${fac}`,
      `terms: ${terms}`,
      `rate sheets linked: ${links.join(', ')}; constants read by hand 2026-10-12: ${KW_SHEETS.map(s => s.title).join('; ')}`,
    ].join('\n'),
  };
}

export const kenyawaysDiani: OfferAdapter = {
  key: 'kenyaways-diani',
  name: 'Kenyaways Beach B&B (Galu Beach, Diani)',
  kind: 'accommodation',
  operator: {
    name: 'Kenyaways',
    websiteUrl: `${SITE}/`,
    rootDomain: 'thekenyaway.com',
    contactEmail: 'bookings@thekenyaway.com', // footer "RESERVATIONS Bookings@thekenyaway.com", 2026-10-12
    phone: '+254797616491',                  // footer, 2026-10-12
  },
  url: KW_ROOMS_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 4,
  confidence: 'medium', // prices are hand-read constants from PDF/JPG rate sheets
  async fetchContent() {
    return parseKenyawaysContent({
      rooms: await page(KW_ROOMS_URL),
      facilities: await page(KW_FACILITIES_URL),
      terms: await page(KW_TERMS_URL),
    });
  },
  async fetchSlots(ctx: FetchContext) {
    const html = await page(KW_ROOMS_URL);
    const links = rateLinks(html);
    const known = KW_SHEETS.map(s => s.href);
    const released = known.filter(h => links.includes(h));
    if (released.length === 0) {
      throw new Error(`kenyaways: none of the hand-read rate sheets is linked any more (page links: ${links.join(', ') || 'none'}) - re-read the new sheets by hand`);
    }
    for (const h of known.filter(k => !links.includes(k))) ctx.note(`rate sheet ${h} no longer linked: its prices are not released`);
    for (const h of links.filter(l => !known.includes(l))) ctx.note(`new rate sheet linked: ${h} - read it by hand and add it to KW_SHEETS`);
    if (!/per Person sharing in a Room/i.test(mainText(html))) ctx.note('rooms page no longer says "per Person sharing in a Room": check the price basis');
    ctx.note('prices are constants read by hand from the PDF/JPG rate sheets on 2026-10-12');
    const rooms = parseKwRooms(html).map(r => r.name);
    return buildKwSlots(links, rooms);
  },
};
