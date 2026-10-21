// ---------------------------------------------------------------------------
// Penghu Kitesurf & Wing Foil Center + Sunrise BnB (果葉觀日樓民宿), Guoye village, Huxi, Penghu (Taiwan) - the kite
// school of Jan Hou and his daughter Karen Hou and their own B&B, about 1 km from Longmen Beach (the site: "only 1
// minute ride from Sunrise BnB"). Five room types with nightly, weekly and monthly rates, shared lounge and fully
// equipped kitchen, scooters + a kite trailer to the beaches, airport pick-up; kite, kite foil and wing foil lessons
// (TWD 5,000 per 2 hours, 10% off for B&B guests) and rental. Kind 'accommodation' (rooms; lessons optional).
//
// Data path (checked 2026-10-21), Squarespace site jan-hou.squarespace.com (EN pages + ZH + an older JA page):
//   slots    /about ("Sunrise BnB", EN): per room a text block <h2>room name</h2> + "Room rate (for 3-4 people):
//            3600 TWD/day, 18,000 TWD/week, 54,000 TWD/month" lines -> one slot per room x guest count x {day, week},
//            TWD as printed, priceBasis 'room'; "TWD/day" read as per night (B&B room rate, inferred), "TWD/week" as
//            per week. Monthly rates go into the room features only (no per-month SlotPriceUnit). "for 3-4 people" ->
//            occupancy 4; rate lines without a guest count -> occupancy null (Economy Single: 1). Undated slots
//            (startDate/endDate null), availability 'on_request' (Squarespace reservation form or phone, the B&B
//            replies; cash on arrival; no inventory).
//   content  /about (rooms, payment, pick-up, scooters, map block with the pin), /index (EN kite center page: team,
//            spots Longmen / Qinglou / Linto, hydrofoil), /services (rental, lessons, scooter / trailer, garage prices).
//   pin      spotCoords from the site's own Squarespace map block on /about ("Penghu Kitesurfing Center", plus code
//            HMGJ+R2 Huxi Township = 23.5770625, 119.6800625).
//   photos   /about room + house photos, then the /index intro, hydrofoil and spot sections (team portraits, the
//            Cape Town XR5 event and the FireShot wind-forecast screenshots are skipped), QR codes dropped.
// Doubt: prices as published on the site, undated (no 2024-27 year on any page). The Squarespace sitemap (not read per
//   run) lists /about and /services with lastmod 2025-12-25, /index 2024-04-12. Older page copies disagree: the JA
//   page has the economy single at TWD 1,200, the ZH page the VIP month at 48,000 (EN: 54,000), /index a hydrofoil
//   lesson at 6,000 NT / 2 h (EN /services: 5,000) - we read the EN /about and /services pages only.
// robots.txt (2026-10-21): Squarespace defaults (disallows /api/, /static/, ?format=json etc.); the pages we read
//   are allowed. No booking engine; /reservation is a Squarespace form (request) -> instantBooking false.
// Requests per run: content 3, slots 1.
// Known limits: no breakfast mentioned (kitchen for guests) -> mealPlan null; contact by phone (+886 956 065 509),
//   no e-mail on the site.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://jan-hou.squarespace.com';
export const PENGHU_ABOUT_URL = `${SITE}/about`;
export const PENGHU_HOME_URL = `${SITE}/index`;
export const PENGHU_SERVICES_URL = `${SITE}/services`;
const RESERVATION_URL = `${SITE}/reservation`;

export interface PenghuRate { persons: string | null; occupancy: number | null; night: number | null; week: number | null; month: number | null }
export interface PenghuRoom { name: string; description: string; rates: PenghuRate[] }

const keyPart = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const num = (s: string): number => Number(s.replace(/,/g, ''));
const twd = (n: number): string => `TWD ${n.toLocaleString('en-US')}`;

/** Squarespace text blocks split at every heading: heading + the paragraphs after it (text), in page order
 *  (one block can hold two rooms: "Standard One-Queen Bed Room" and "Economy Single Room" share one on /about). */
export function sqsBlocks(html: string): Array<{ heading: string | null; paras: string[] }> {
  const out: Array<{ heading: string | null; paras: string[] }> = [];
  for (const el of parse(html).querySelectorAll('.sqs-html-content')) {
    let cur: { heading: string | null; paras: string[] } | null = null;
    for (const child of el.childNodes) {
      const tag = (child as { rawTagName?: string }).rawTagName?.toLowerCase() ?? '';
      const text = collapse(child.text);
      if (/^h[1-4]$/.test(tag)) { cur = { heading: text, paras: [] }; out.push(cur); continue; }
      if (!text) continue;
      if (!cur) { cur = { heading: null, paras: [] }; out.push(cur); }
      cur.paras.push(text);
    }
  }
  return out;
}

/** "Room rate (for 3-4 people): 3600 TWD/day, 18,000 TWD/week, 54,000 TWD/month" (also "2000 NT/day"). */
export function parsePenghuRate(line: string): PenghuRate | null {
  const m = line.match(/Room rate\s*(?:\(\s*for\s*([\d\s-]+?)\s*(?:people|persons?)\s*\))?\s*:\s*(.*)$/i);
  if (!m) return null;
  const rate: PenghuRate = { persons: m[1]?.replace(/\s/g, '') ?? null, occupancy: null, night: null, week: null, month: null };
  if (rate.persons) rate.occupancy = Math.max(...rate.persons.split('-').map(Number));
  for (const p of m[2].matchAll(/(\d[\d,]*)\s*(?:TWD|NT\$?|NTD)\s*\/\s*(day|week|month)/gi)) {
    const unit = p[2].toLowerCase();
    if (unit === 'day') rate.night = num(p[1]);
    else if (unit === 'week') rate.week = num(p[1]);
    else rate.month = num(p[1]);
  }
  return rate.night || rate.week ? rate : null;
}

/** Room cards of the EN /about page: every text block whose paragraphs carry "Room rate" lines. */
export function parsePenghuRooms(aboutHtml: string): PenghuRoom[] {
  const out: PenghuRoom[] = [];
  for (const b of sqsBlocks(aboutHtml)) {
    if (!b.heading) continue;
    const rates = b.paras.map(parsePenghuRate).filter((r): r is PenghuRate => r !== null);
    if (rates.length === 0) continue;
    if (/single/i.test(b.heading)) for (const r of rates) r.occupancy ??= 1;
    const description = b.paras.filter(p => !/^Room rate/i.test(p)).join(' ');
    out.push({ name: b.heading, description, rates });
  }
  return out;
}

export function buildPenghuSlots(rooms: PenghuRoom[]): Slot[] {
  const out: Slot[] = [];
  for (const r of rooms) {
    for (const rate of r.rates) {
      const tag = rate.persons ? `${keyPart(r.name)}-${rate.persons}p` : keyPart(r.name);
      const unit = rate.persons ? `${r.name}, ${rate.persons} ${rate.persons === '1' ? 'guest' : 'guests'}` : r.name;
      for (const [period, price] of [['night', rate.night], ['week', rate.week]] as const) {
        if (!price) continue;
        out.push({
          key: `${tag}|${period}`,
          startDate: null,
          endDate: null,
          unit,
          room: unit === r.name ? null : r.name,
          price,
          currency: 'TWD',
          priceUnit: period === 'night' ? 'per_night' : 'per_week',
          priceBasis: 'room',
          occupancy: rate.occupancy,
          availability: 'on_request',
          availabilityText: null,
          spotsLeft: null,
        });
      }
    }
  }
  return out;
}

/** The pin of the site's own Squarespace map block (data-context JSON). */
export function parsePenghuPin(html: string): { lat: number; lng: number } | null {
  const m = html.replace(/&quot;/g, '"').match(/"markerLat"\s*:\s*(-?\d+\.\d+)\s*,\s*"markerLng"\s*:\s*(-?\d+\.\d+)/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

/** Price lines of /services: "COMPLETE SET RENTAL IS 3000 TWD/day", "Beginner Lesson: 5000 TWD/2 hours", ... */
export function parsePenghuServices(html: string): { rentals: string[]; lessons: string[]; extras: string[] } {
  const rentals: string[] = [];
  const lessons: string[] = [];
  const extras: string[] = [];
  let group = '';
  for (const b of sqsBlocks(html)) {
    const h = b.heading ?? '';
    if (/^(kite rental|wing and foil rental|lessons|getting around|spacious garage)$/i.test(h)) group = h.toLowerCase();
    const r = h.match(/^(.+?)\s+RENTAL IS\s+(\d[\d,]*)\s*T(?:W)?D\s*\/\s*day$/i);
    if (r) {
      const what = r[1].toLowerCase().replace(/\bonly\b/, '').replace(/\s+/g, ' ').trim();
      const label = group.startsWith('wing') ? (/complete set/.test(what) ? 'wing foil complete set' : what) : (/complete set/.test(what) ? 'kite complete set (kite, bar, board, harness)' : what);
      rentals.push(`${label.charAt(0).toUpperCase()}${label.slice(1)} rental ${twd(num(r[2]))} per day`);
      continue;
    }
    const l = h.match(/^(.+?Lesson):\s*(\d[\d,]*)\s*TWD\s*\/\s*(\d+)\s*hours?$/i);
    if (l) { lessons.push(`${l[1]} ${twd(num(l[2]))} per ${l[3]} hours`); continue; }
    for (const p of b.paras) {
      const s = p.match(/^(Scooter rental|Custom-made trailer rental)[^\d]*(\d[\d,]*)\s*TWD\/day or (\d[\d,]*)\s*TWD\/week/i);
      if (s) extras.push(`${s[1].replace(/^Custom-made t/, 'T')} ${twd(num(s[2]))} per day or ${twd(num(s[3]))} per week`);
      const g = p.match(/store your equipment and take a shower at our facility for (\d[\d,]*) TWD per day/i);
      if (g) extras.push(`Gear storage and shower in the garage ${twd(num(g[1]))} per day`);
    }
  }
  return { rentals: [...new Set(rentals)], lessons, extras };
}

const SKIP_IMG = /FireShot|qrcode|Wind\+Statistics|screenshot|logo|\.png(\?|$)/i;

/** /index sections worth showing: intro, hydrofoil, spots (not the team portraits or the XR5 event in South Africa). */
export function penghuHomeImages(html: string): string[] {
  const out: string[] = [];
  for (const sec of html.split(/(?=<section\b)/).slice(1)) {
    const h1 = collapse(parse(sec.match(/<h1[^>]*>[\s\S]*?<\/h1>/)?.[0] ?? '').text);
    if (/team|xr5|getting here|about taiwan/i.test(h1)) continue;
    for (const u of imageCandidates(sec, PENGHU_HOME_URL, null, 20)) if (!SKIP_IMG.test(decodeURIComponent(u)) && !out.includes(u)) out.push(u);
  }
  return out;
}

function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}

export interface PenghuPages { about: string; home: string; services: string }

export function parsePenghuContent(p: PenghuPages): OfferContent {
  const rooms = parsePenghuRooms(p.about);
  if (rooms.length === 0) throw new Error('penghu: no "Room rate" blocks on /about (layout changed?)');
  const svc = parsePenghuServices(p.services);
  const about = pageText(p.about);
  const home = pageText(p.home);
  const nightly = rooms.flatMap(r => r.rates.map(x => x.night).filter((n): n is number => !!n));
  const weekly = rooms.flatMap(r => r.rates.map(x => x.week).filter((n): n is number => !!n));
  const pickup = about.match(/additional fee \((\d[\d,]*) TWD per trip\)/i);
  const lesson = svc.lessons[0]?.match(/TWD [\d,]+ per \d+ hours/)?.[0] ?? null;

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: r.description || null,
    features: r.rates.map(x => [
      x.persons ? `${x.persons} ${x.persons === '1' ? 'guest' : 'guests'}:` : 'Room:',
      [x.night && `${twd(x.night)} per night`, x.week && `${twd(x.week)} per week`, x.month && `${twd(x.month)} per month`].filter(Boolean).join(', '),
    ].join(' ')),
  }));

  const imgs: string[] = [];
  for (const u of [...imageCandidates(p.about, PENGHU_ABOUT_URL, null, 40), ...penghuHomeImages(p.home)]) {
    if (!/squarespace-cdn\.com/.test(u) || SKIP_IMG.test(decodeURIComponent(u))) continue;
    if (!imgs.some(x => x.split('?')[0] === u.split('?')[0])) imgs.push(u);
  }

  const summary = [
    `Sunrise BnB (果葉觀日樓民宿) in Guoye village, Huxi, on Penghu island in the Taiwan Strait is the guesthouse of the Penghu Kitesurf & Wing Foil Center, run by Jan Hou and his daughter Karen Hou, a minute's ride from Longmen Beach, with flat-water Qinglou and the summer foil spot Linto nearby.`,
    `${rooms.length} room types from a single room to a VIP room for up to 4 guests cost ${twd(Math.min(...nightly))} to ${twd(Math.max(...nightly))} per night or ${twd(Math.min(...weekly))} to ${twd(Math.max(...weekly))} per week (monthly rates too; prices as published on the site, undated), with a shared lounge and fully equipped kitchen; payment in cash on arrival.`,
    `The center teaches kitesurfing, kite foiling and wing foiling${lesson ? ` (${lesson}, 10% off for B&B guests)` : ''} and rents kite and wing gear; scooters, a kite trailer and airport pick-up${pickup ? ` (TWD ${pickup[1]} per trip)` : ''} are offered; the site reports a prevailing wind of 20 to 40 knots on most days, strongest in winter.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Sunrise BnB at Penghu Kitesurf & Wing Foil Center',
    summary,
    continent: 'Asia',
    country: 'Taiwan',
    region: 'Huxi, Penghu',
    spot: 'Guoye',
    spotCoords: parsePenghuPin(p.about),
    itinerarySpots: [],
    durationDays: null,
    // /services: beginner lessons, advanced one-on-one coaching (wave riding, freestyle), kite / wing foiling
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: svc.lessons.some(l => /beginner/i.test(l)),
    equipmentRental: svc.rentals.length > 0,
    // beginner lessons offered, Longmen "more friendly to the new comers" at light wind / low tide; the site warns of strong wind
    beginnerFriendly: true,
    includedServices: ['Shared lounge and fully equipped kitchen', 'Open deck with BBQ', 'Garage for kite gear'],
    optionalServices: [
      ...svc.lessons.map(l => `${l} (10% off for Sunrise BnB guests)`),
      ...svc.rentals,
      ...svc.extras,
      ...(pickup ? [`Airport pick-up TWD ${pickup[1]} per trip`] : []),
    ],
    accommodation: `family-run B&B (${rooms.length} room types, private bathrooms)`,
    mealPlan: null,
    languages: ['en', 'zh'],
    rooms: contentRooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: PENGHU_ABOUT_URL,
    bookingUrl: RESERVATION_URL,
    sourceText: [`about: ${about}`, `kite center: ${home}`, `services: ${pageText(p.services)}`].join('\n'),
  };
}

export const penghuKitesurfSunriseBnbGuoye: OfferAdapter = {
  key: 'penghu-kitesurf-sunrise-bnb-guoye',
  name: 'Sunrise BnB at Penghu Kitesurf & Wing Foil Center',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Penghu Kitesurf & Wing Foil Center',
    websiteUrl: SITE,
    rootDomain: 'jan-hou.squarespace.com',
    phone: '+886956065509', // /about + /index, 2026-10-21
  },
  url: PENGHU_ABOUT_URL,
  slotMethod: 'price_table',
  instantBooking: false, // Squarespace reservation form + phone, the B&B confirms; cash on arrival
  fetchBudget: 4,
  confidence: 'medium', // undated price table
  async fetchContent() {
    const about = await fetchText(PENGHU_ABOUT_URL, { accept: 'text/html' });
    const home = await fetchText(PENGHU_HOME_URL, { accept: 'text/html' });
    const services = await fetchText(PENGHU_SERVICES_URL, { accept: 'text/html' });
    return parsePenghuContent({ about, home, services });
  },
  async fetchSlots() {
    const rooms = parsePenghuRooms(await fetchText(PENGHU_ABOUT_URL, { accept: 'text/html' }));
    if (rooms.length === 0) throw new Error('penghu: no "Room rate" blocks on /about (layout changed?)');
    return buildPenghuSlots(rooms);
  },
};
