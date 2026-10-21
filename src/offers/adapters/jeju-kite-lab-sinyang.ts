// ---------------------------------------------------------------------------
// Jeju Kite Lab beach guesthouse ("Jeju Kite Stay"), Sinyang Beach, Seongsan (Jeju, South Korea) - the kite school's
// own guesthouse on the 2nd floor of a house at Sinyang Beach (923 Hwanhaejangseong-ro, Seongsan-eup, Seogwipo-si):
// four private rooms with own bathroom (shared living room, kitchen, balcony, rooftop, garden with BBQ and pizza
// oven, free parking, free SUP), or the whole floor for 6 or 8 guests. The school teaches 1-on-1 IKO kitesurfing
// (4-day beginner course, 1-day lesson, coaching) and rents kite gear; wing foil, eFoil and other water sports on
// site. Kind 'accommodation' (rooms; lessons optional). The site prints no stay+course package (the 4-day course is
// a lesson package without a stay; "1 month living packages" have no price), so no separate 'camp' adapter.
// The Vietnam winter camp and the Seoul location on the same site are out of scope.
//
// Data path (checked 2026-10-21), WordPress + Elementor + MotoPress Hotel Booking Lite:
//   slots    the guesthouse page (/index.php/treat-yourself-on-our-beach-guesthouse-with-beautiful-views/, JSON-LD
//            dateModified 2026-08-16): Elementor price list "room per night 70,000₩", "whole apartment 6 people
//            300,000₩", "whole apartment 8 people 340,000₩" -> 3 undated slots, KRW as printed. Room: per night, per
//            room, occupancy 2 (every room page says "Adults: 2", inferred for the price). Whole floor: per night
//            (inferred: the list's first line says "per night", the floor lines do not), priceBasis 'room' (one rented unit; was 'group', which made the shared "from" price pick the floor over the 70,000 room),
//            occupancy 6 / 8. Availability 'on_request' (contact by phone, mail or DM; see FLAGS).
//   content  the guesthouse page + /index.php/kitesurfing/ (JSON-LD dateModified 2026-05-06: lesson, rental prices,
//            FAQ on season, payment, transport) + the MPHB room-type pages listed in /mphb_room_type-sitemap.xml
//            (title, adults / guests, amenities, view, bed type, gallery). The guesthouse page's own room cards
//            carry Elementor placeholder text ("A short description of the service ...") and are not used.
//   photos   guesthouse page, kitesurfing page, then the room galleries (full-size links); screenshots (.png), the
//            logo and the haenyeo cartoon are dropped.
// FLAGS: the room pages embed an MPHB availability calendar and booking form, but its data comes from
//   admin-ajax "mphb_get_room_type_availability_data" with a WordPress nonce -> not usable (no liveAvailability).
//   MPHB settings on the page: no payment gateways, "isDirectBooking": false; the guesthouse page asks guests to call,
//   mail or DM -> instantBooking false. Each room page prints data-first_available_check_in_date (kept in sourceText).
// robots.txt (2026-10-21): only /wp-admin/ disallowed (admin-ajax.php allowed, but nonce-gated, not used).
// Requests per run: content 2 + 1 (room sitemap) + 1 per room type (5 on 2026-10-21) = 8; slots 1.
// Known limits: no spotCoords on the site (address + a Google Maps embed by address only) -> spot left to the
//   geocoder. Card payments carry a 10% surcharge (FAQ). Languages: site in English; Korean inferred (Korean host).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://jejukitelab.com';
export const JKL_STAY_URL = `${SITE}/index.php/treat-yourself-on-our-beach-guesthouse-with-beautiful-views/`;
export const JKL_KITE_URL = `${SITE}/index.php/kitesurfing/`;
export const JKL_ROOMS_SITEMAP_URL = `${SITE}/mphb_room_type-sitemap.xml`;
const CONTACT_URL = `${SITE}/index.php/contact-us/`;

export interface JklPrice { title: string; amount: number; description: string }
export interface JklRoom {
  name: string; url: string; adults: number | null; guests: number | null; amenities: string[];
  view: string | null; bed: string | null; images: string[]; firstCheckIn: string | null;
}

const krw = (n: number): string => `KRW ${n.toLocaleString('en-US')}`;

/** Elementor price list items (title, price, description) of the guesthouse page. */
export function parseJklPrices(html: string): JklPrice[] {
  const out: JklPrice[] = [];
  for (const li of parse(html).querySelectorAll('.elementor-price-list-item')) {
    const title = collapse(li.querySelector('.elementor-price-list-title')?.text ?? '');
    const price = collapse(li.querySelector('.elementor-price-list-price')?.text ?? '');
    const amount = /₩|KRW|원/.test(price) ? parseAmount(price) : null;
    if (!title || !amount) continue;
    out.push({ title, amount, description: collapse(li.querySelector('.elementor-price-list-description')?.text ?? '') });
  }
  return out;
}

export function buildJklSlots(prices: JklPrice[]): Slot[] {
  const out: Slot[] = [];
  for (const p of prices) {
    const whole = p.title.match(/whole (?:apartment|floor|house)\D*(\d+)\s*people/i);
    if (whole) {
      const n = Number(whole[1]);
      out.push({
        key: `whole-floor-${n}p|night`, startDate: null, endDate: null, unit: `Whole 2nd floor, ${n} guests`,
        price: p.amount, currency: 'KRW', priceUnit: 'per_night', priceBasis: 'room', occupancy: n, // the floor is one rented unit; 'room' keeps the "from" price on the room rate
        availability: 'on_request', availabilityText: null, spotsLeft: null,
      });
    } else if (/^room per night$/i.test(p.title)) {
      out.push({
        key: 'room|night', startDate: null, endDate: null, unit: 'Private room (own bathroom)',
        price: p.amount, currency: 'KRW', priceUnit: 'per_night', priceBasis: 'room', occupancy: 2,
        availability: 'on_request', availabilityText: null, spotsLeft: null,
      });
    }
  }
  return out;
}

/** Room-type URLs from the MPHB sitemap (Yoast/AIOSEO CDATA or plain <loc>). */
export function parseJklRoomUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc>(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?<\/loc>/g)].map(m => m[1]).filter(u => /\/accommodation\//.test(u));
}

const SKIP_IMG = /\.png(\?|$)|logo|haenyeo|cartoon|illustration|icon/i;
const imgKey = (u: string): string => u.split('?')[0].replace(/-scaled(?=[.-])/, '').replace(/-e\d{10,}(?=\.)/, '').replace(/\.(jpe?g|webp)$/i, '');

function pushImages(out: string[], urls: string[]): void {
  for (const u of urls) {
    if (SKIP_IMG.test(decodeURIComponent(u)) || !/\/wp-content\/uploads\//.test(u)) continue;
    if (!out.some(x => imgKey(x) === imgKey(u))) out.push(u);
  }
}

export function parseJklRoom(html: string, url: string): JklRoom {
  const root = parse(html);
  const attr = (cls: string): string | null => {
    const v = root.querySelector(`.mphb-single-room-type-attributes .${cls} .mphb-attribute-value`);
    return v ? collapse(v.text) || null : null;
  };
  const images: string[] = [];
  pushImages(images, root.querySelectorAll('.mphb-room-type-gallery-wrapper a').map(a => a.getAttribute('href') ?? '').filter(Boolean));
  const n = (s: string | null): number | null => (s && /^\d+$/.test(s) ? Number(s) : null);
  return {
    name: collapse(root.querySelector('h1.entry-title, h1')?.text ?? ''),
    url,
    adults: n(attr('mphb-room-type-adults-capacity')),
    guests: n(attr('mphb-room-type-total-capacity')),
    amenities: (attr('mphb-room-type-facilities') ?? '').split(/\s*,\s*/).filter(Boolean),
    view: attr('mphb-room-type-view')?.replace(/,\s*$/, '') ?? null,
    bed: attr('mphb-room-type-bed-type'),
    images,
    firstCheckIn: html.match(/data-first_available_check_in_date="(\d{4}-\d{2}-\d{2})"/)?.[1] ?? null,
  };
}

export interface JklKite {
  course4: number | null; oneDay: number | null; coachingHour: number | null; rentalHour: number | null; rentalDay: number | null;
}

/** Lesson and rental prices of /kitesurfing/ (plain text). */
export function parseJklKite(text: string): JklKite {
  const amt = (re: RegExp): number | null => { const m = text.match(re); return m ? parseAmount(m[1]) : null; };
  return {
    course4: amt(/4-day beginner[\s\S]{0,80}?Price:\s*([\d,]+)\s*KRW/i),
    oneDay: amt(/One Day Lesson[\s\S]{0,200}?Price:\s*([\d,]+)\s*KRW/i),
    coachingHour: amt(/Price:\s*([\d,]+)\s*KRW per hour/i),
    rentalHour: amt(/Hourly Rental:\s*([\d,]+)\s*KRW/i),
    rentalDay: amt(/Full-Day Rental:\s*([\d,]+)\s*KRW/i),
  };
}

function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('.elementor') ?? root.querySelector('body') ?? root).text);
}

export interface JklPages { stay: string; kite: string; rooms: Array<{ url: string; html: string }> }

export function parseJklContent(p: JklPages): OfferContent {
  const prices = parseJklPrices(p.stay);
  const room = prices.find(x => /^room per night$/i.test(x.title));
  if (!room) throw new Error('jeju-kite-lab: no "room per night" price on the guesthouse page (layout changed?)');
  const wholes = prices.filter(x => /whole/i.test(x.title));
  const stayText = pageText(p.stay);
  const kiteText = pageText(p.kite);
  const k = parseJklKite(kiteText);
  const rooms = p.rooms.map(r => parseJklRoom(r.html, r.url)).filter(r => r.name);

  const contentRooms: ContentRoom[] = rooms.map(r => {
    const whole = r.guests !== null || /whole/i.test(r.name);
    return {
      name: r.name,
      description: whole
        ? `The whole 2nd floor of the guesthouse for one group${r.guests ? ` (up to ${r.guests} guests)` : ''}.`
        : 'Private room with its own bathroom and shower; living room, kitchen and balcony are shared.',
      features: [
        ...(r.adults ? [`Adults: ${r.adults}`] : []),
        ...(r.guests ? [`Guests: ${r.guests}`] : []),
        ...(r.bed ? [`Bed: ${r.bed}`] : []),
        ...(r.view ? [`View: ${r.view}`] : []),
        ...r.amenities,
        ...(whole ? wholes.map(w => `${w.title.replace(/^whole apartment/i, 'Whole floor,')}: ${krw(w.amount)} per night`) : [`${krw(room.amount)} per night`]),
      ],
    };
  });

  const imgs: string[] = [];
  pushImages(imgs, imageCandidates(p.stay, JKL_STAY_URL, null, 60));
  pushImages(imgs, imageCandidates(p.kite, JKL_KITE_URL, null, 60));
  for (const r of rooms) pushImages(imgs, r.images);

  const nRooms = rooms.filter(r => r.guests === null && !/whole/i.test(r.name)).length;
  const lessons = [
    k.course4 && `a 4-day beginner course for ${krw(k.course4)} (gear and IKO certificate included)`,
    k.oneDay && `a 1-day lesson for ${krw(k.oneDay)}`,
    k.coachingHour && `coaching at ${krw(k.coachingHour)} per hour`,
  ].filter(Boolean) as string[];
  const summary = [
    `Jeju Kite Lab runs a small beach guesthouse at Sinyang Beach in Seongsan on the east coast of Jeju, with ${nRooms || 'four'} private rooms with their own bathroom for ${krw(room.amount)} per night and a shared living room, kitchen, balcony, rooftop and garden with BBQ and pizza oven${wholes.length ? `; the whole 2nd floor costs ${wholes.map(w => `${krw(w.amount)} for ${w.title.match(/(\d+)\s*people/)?.[1] ?? '?'}`).join(' or ')} guests` : ''}, and 1-month stays are offered on request.`,
    `The school gives 1-on-1 IKO kitesurfing lessons${lessons.length ? `, including ${lessons.join(', ')}` : ''}, rents kite gear to riders at IKO level 3, and offers wing foil, eFoil and SUP; spring and autumn bring the most wind, summer lighter wind for foiling.`,
    'Booking is by phone, e-mail or message; card payments carry a 10% surcharge.',
  ].join(' ');

  const firstCheckIns = rooms.filter(r => r.firstCheckIn).map(r => `${r.name}: ${r.firstCheckIn}`);
  return {
    kind: 'accommodation',
    title: 'Jeju Kite Lab Beach Guesthouse, Sinyang Beach',
    summary,
    continent: 'Asia',
    country: 'South Korea',
    region: 'Seongsan, Jeju',
    spot: 'Sinyang Beach',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: null,
    // /kitesurfing/: beginner course, "Already riding but want to improve?" coaching, rental for IKO level 3
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /IKO/i.test(kiteText) && k.course4 !== null,
    equipmentRental: k.rentalDay !== null || /Rental Gear/i.test(kiteText),
    // FAQ: "Are The Beaches In Jeju Beginner Friendly? Yes!"
    beginnerFriendly: /beginner friendly\?\s*Yes/i.test(kiteText),
    includedServices: ['Shared living room, kitchen, balcony and rooftop', 'Garden with BBQ and pizza oven', 'Free SUP', 'Free parking', 'Wi-Fi'],
    optionalServices: [
      ...(k.course4 ? [`4-day beginner kitesurf course (private, gear + IKO certificate) ${krw(k.course4)}`] : []),
      ...(k.oneDay ? [`1-day kitesurf lesson (gear included) ${krw(k.oneDay)}`] : []),
      ...(k.coachingHour ? [`Advanced coaching ${krw(k.coachingHour)} per hour`] : []),
      ...(k.rentalHour ? [`Kite rental, full set ${krw(k.rentalHour)} per hour`] : []),
      ...(k.rentalDay ? [`Kite rental, full day ${krw(k.rentalDay)}`] : []),
      'Wing foil, eFoil, jetsurf, surfboards and snorkeling',
      'Kite gear repair and gear sales',
      '1-month living packages (on request)',
    ],
    accommodation: 'beach guesthouse (private rooms or the whole floor)',
    mealPlan: null,
    languages: ['en', 'ko'],
    rooms: contentRooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: JKL_STAY_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `guesthouse: ${stayText}`,
      `kitesurfing: ${kiteText}`,
      ...rooms.map(r => `room ${r.url}: ${r.name}; adults ${r.adults ?? '-'}; guests ${r.guests ?? '-'}; bed ${r.bed ?? '-'}; view ${r.view ?? '-'}; amenities ${r.amenities.join(', ')}`),
      firstCheckIns.length ? `first available check-in per the room calendars: ${firstCheckIns.join('; ')}` : '',
    ].filter(Boolean).join('\n'),
  };
}

export const jejuKiteLabSinyang: OfferAdapter = {
  key: 'jeju-kite-lab-sinyang',
  name: 'Jeju Kite Lab Beach Guesthouse, Sinyang Beach',
  kind: 'accommodation',
  operator: {
    name: 'Jeju Kite Lab',
    websiteUrl: SITE,
    rootDomain: 'jejukitelab.com',
    contactEmail: 'jacobyoon12@gmail.com', // printed on the guesthouse page ("Email Us"), 2026-10-21
    phone: '+821025866109',               // "call us 010 2586 6109"
  },
  url: JKL_STAY_URL,
  slotMethod: 'price_table',
  instantBooking: false, // call / mail / DM; the MPHB form has no payment gateway and the calendar is nonce-gated
  fetchBudget: 10,
  confidence: 'medium', // undated price list, per-night basis of the whole-floor prices inferred
  async fetchContent() {
    const stay = await fetchText(JKL_STAY_URL, { accept: 'text/html' });
    const kite = await fetchText(JKL_KITE_URL, { accept: 'text/html' });
    const urls = parseJklRoomUrls(await fetchText(JKL_ROOMS_SITEMAP_URL, { accept: 'application/xml,text/xml' }));
    const rooms: Array<{ url: string; html: string }> = [];
    for (const url of urls.slice(0, 7)) rooms.push({ url, html: await fetchText(url, { accept: 'text/html' }) });
    return parseJklContent({ stay, kite, rooms });
  },
  async fetchSlots() {
    const slots = buildJklSlots(parseJklPrices(await fetchText(JKL_STAY_URL, { accept: 'text/html' })));
    if (!slots.some(s => s.key === 'room|night')) throw new Error('jeju-kite-lab: no "room per night" price on the guesthouse page (layout changed?)');
    return slots;
  },
};
