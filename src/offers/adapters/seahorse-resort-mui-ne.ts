// ---------------------------------------------------------------------------
// Seahorse Resort & Spa, Mui Ne (Ham Tien, Lam Dong - formerly Binh Thuan, Vietnam) - beachfront resort in Vietnamese
// village style (deluxe rooms and bungalows, infinity pool, spa, Hippocampe restaurant); the Surfpoint Kite & Wing
// School has its kite and wing station on the resort's beach.
//
// Kite link (the on-site kite school's own site, 2026-10-12): surfpoint-vietnam.com home "Stay at a luxury resort like
//   Sea Horse (where Surfpoint is located!)", /traveling-information "Sea Horse Resort and Spa - Home to our kite and
//   wing station ... right on the beach"; Surfpoint's address is 16 Nguyen Dinh Chieu = the resort's address. The resort's
//   own site lists only generic beach sports (/the-thao-bien), no kiting.
// Liveness (2026-10-12): resort site "SUMMER CASH VOUCHER 2026" packages ("có hiệu lực từ ngày 20/01/2026", stays
//   01/04/2026-31/10/2026), banner uploads with 2026 ids; Surfpoint footer "Copyright 2026". Verdict LIVE.
// Data path (checked 2026-10-12): www.seahorseresortvn.com (Vietnamese only; the English twin seahorsemuine.com does not
//   resolve):
//   content  / (welcome, address, phone, e-mail), /phong-deluxe + /phong-bungalow (room cards: h5 name, photo, booking
//            link /booking-vi?&be-room=<id>), /vi-tri ("Tọa độ: Vĩ độ 10.9426053 Kinh độ 108.1908569" -> spotCoords),
//            the summer voucher page (2026 evidence), + Surfpoint home and /traveling-information (kite facts).
//   slots    none. Room rates exist only in the Exely booking widget (ibe.hopenapi.com, script-driven) - not a public read
//            we use. The only printed prices are the "Summer Cash Voucher 2026" combos (2,250,000 VND for 1 night /
//            4,250,000 VND for 2 nights, Deluxe room for two with breakfast + lunch), which the page restricts to
//            Vietnamese guests and foreigners living and working in Vietnam and which end 31/10/2026 -> not a public rate,
//            kept in sourceText only. fetchSlots returns [] ("price on request").
// robots.txt (2026-10-12): none (the site answers /robots.txt with its 404 page) -> allow all; surfpoint-vietnam.com
//   (Wix) allows / except ?lightbox=.
// Requests per run: content 7, slots 0.
// Known limits: room sizes and bed types are only on the 11 room detail pages (not fetched); room names are translated
//   from the Vietnamese card titles.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.seahorseresortvn.com';
export const SH_HOME_URL = `${SITE}/`;
export const SH_DELUXE_URL = `${SITE}/phong-deluxe`;
export const SH_BUNGALOW_URL = `${SITE}/phong-bungalow`;
export const SH_LOCATION_URL = `${SITE}/vi-tri`;
export const SH_VOUCHER_URL = `${SITE}/summer-cash-voucher-2026-combo-02-ngay-01-dem-02-nights-01-day`;
const SP = 'https://www.surfpoint-vietnam.com';
export const SP_HOME_URL = `${SP}/`;
export const SP_TRAVEL_URL = `${SP}/traveling-information`;

/** lower-case, accents stripped (đ -> d), for matching Vietnamese text */
const fold = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();

/** Page text without script/style/svg bodies, whitespace collapsed. */
export function shText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg')) el.remove();
  return root.text.replace(/\s+/g, ' ');
}

/** Visible text blocks in document order, de-duplicated. */
export function shLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg')) el.remove();
  const out: string[] = [];
  for (const el of root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, td, span')) {
    const t = collapse(el.text);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface ShRoom { nameVi: string; name: string; family: boolean; view: string | null; image: string | null; bookingRoomId: string | null }

/** English room name from the Vietnamese card title ("PHÒNG DELUXE GIA ĐÌNH HƯỚNG BIỂN" -> "Deluxe Family Room, sea view"). */
export function shRoomName(vi: string): { name: string; family: boolean; view: string | null } {
  const f = fold(vi);
  const view = /truoc bien/.test(f) ? 'beachfront' : /huong bien/.test(f) ? 'sea view' : /huong vuon/.test(f) ? 'garden view'
    : /huong ho boi/.test(f) ? 'pool view' : /khong canh quan/.test(f) ? 'no view' : null;
  const family = /gia dinh/.test(f);
  if (/bungalow/.test(f)) return { name: view === 'beachfront' ? 'Beachfront Bungalow' : `Bungalow${view ? `, ${view}` : ''}`, family, view };
  if (/cao cap/.test(f)) return { name: `Premium Room${view ? `, ${view}` : ''}`, family, view };
  return { name: `Deluxe ${family ? 'Family Room' : 'Room'}${view ? `, ${view}` : ''}`, family, view };
}

/** Room cards of /phong-deluxe and /phong-bungalow. */
export function parseShRooms(html: string): ShRoom[] {
  const out: ShRoom[] = [];
  for (const card of parse(html).querySelectorAll('.card')) {
    const nameVi = collapse(card.querySelector('h5.card-title')?.text ?? '');
    if (!nameVi || out.some(r => r.nameVi === nameVi)) continue;
    const img = card.querySelector('img.card-img-top')?.getAttribute('src') ?? null;
    const book = card.querySelectorAll('a').map(a => a.getAttribute('href') ?? '').find(h => /be-room=\d+/.test(h)) ?? null;
    out.push({ nameVi, ...shRoomName(nameVi), image: img && /\/uploads\/images\//.test(img) ? img : null, bookingRoomId: book?.match(/be-room=(\d+)/)?.[1] ?? null });
  }
  return out;
}

/** "Tọa độ : Vĩ độ: 10.9426053 Kinh độ: 108.1908569" on /vi-tri. */
export function parseShCoords(html: string): { lat: number; lng: number } | null {
  const t = shText(html);
  const m = t.match(/Vĩ độ:\s*(-?\d+\.\d+)\s*Kinh độ:\s*(-?\d+\.\d+)/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

export interface ShVoucher { title: string | null; price: string | null; validity: string | null; residentsOnly: boolean }

/** The 2026 summer voucher page: title, package price, stay window and the residents-only condition. */
export function parseShVoucher(html: string): ShVoucher {
  const t = shText(html);
  return {
    title: t.match(/SUMMER CASH VOUCHER 20\d\d - COMBO [^()]+\([^)]*\)/)?.[0]?.trim() ?? null,
    price: t.match(/([\d.]+)\s*VND\/\s*VOUCHER/)?.[1] ?? null,
    validity: t.match(/kể từ ngày (\d{2}\/ ?\d{2}\/ ?\d{4}) đến hết ngày (\d{2}\/ ?\d{2}\/ ?\d{4})/)?.slice(1, 3).map(s => s.replace(/ /g, '')).join(' - ') ?? null,
    residentsOnly: /Khách là người Việt Nam và Khách người nước ngoài đang sống và làm việc tại Việt Nam/.test(t),
  };
}

/** Surfpoint statements that tie the kite station to the resort, plus the school facts. */
export function parseSurfpoint(home: string, travel: string): { atSeahorse: boolean; facts: string[] } {
  const h = shText(home);
  const tr = shText(travel);
  const at = /Sea Horse \(where Surfpoint is located!\)/.test(h) || /Home to our kite and wing station, Sea Horse Resort and Spa/.test(tr);
  const pick = (s: string, re: RegExp): string | null => s.match(re)?.[0]?.trim() ?? null;
  const facts = [
    pick(tr, /Home to our kite and wing station, Sea Horse Resort and Spa is right on the beach[^.]*\./),
    pick(tr, /You’ll find the kite station right on the beach, in front of Sea Horse Resort and Spa\./),
    pick(h, /The Surfpoint clubhouse is in a premier location right on the beach in Mui Ne\.[^]{0,400}?secure lockers\./),
    pick(h, /The winter high season runs from October to April, and the summer low season from May to September\./),
    pick(h, /Mui Ne has two main spots—main beach and Malibu, and two seasons\./),
  ].filter((x): x is string => !!x);
  return { atSeahorse: at, facts };
}

export interface ShPages { home: string; deluxe: string; bungalow: string; location: string; voucher: string; spHome: string; spTravel: string }

export function parseSeahorseContent(p: ShPages): OfferContent {
  const rooms = [...parseShRooms(p.deluxe), ...parseShRooms(p.bungalow)];
  const coords = parseShCoords(p.location);
  const voucher = parseShVoucher(p.voucher);
  const sp = parseSurfpoint(p.spHome, p.spTravel);
  const homeText = shText(p.home);
  const welcome = homeText.match(/Seahorse Resort & Spa là khu nghỉ bên biển[^.]*\.[^.]*\./)?.[0] ?? null;
  const deluxeN = rooms.filter(r => !/bungalow/i.test(r.name)).length;
  const bungalowN = rooms.filter(r => /bungalow/i.test(r.name)).length;

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: null,
    features: [r.view && r.view !== 'no view' ? r.view.charAt(0).toUpperCase() + r.view.slice(1) : null, r.family ? 'Family room' : null, 'Balcony']
      .filter((x): x is string => !!x),
  }));

  const imgs: string[] = [];
  const homeImgs = [...p.home.matchAll(/https:\/\/www\.seahorseresortvn\.com\/uploads\/images\/(?:banners|2025\/banner)\/[^"'\s)]+\.(?:webp|jpe?g)/g)].map(m => m[0]);
  for (const u of [...rooms.map(r => r.image ? new URL(r.image, SITE).toString() : null), ...homeImgs]) {
    if (!u || /voucher|fb-post|no-image|banner_default|logo|favicon/i.test(u) || imgs.includes(u)) continue;
    imgs.push(u);
  }

  const summary = [
    'Seahorse Resort & Spa is a beachfront resort in Vietnamese village style on the main beach of Mui Ne (Ham Tien) in southern Vietnam, with coconut gardens, an infinity pool by the beach, a spa, a gym and the Hippocampe restaurant.',
    `${sp.atSeahorse ? 'The Surfpoint Kite & Wing School has its kite and wing station on the resort\'s beach, with a clubhouse, gear storage, lockers and showers, and teaches kite, wing foil and surf lessons; ' : ''}the main kite season runs from October to April, strongest in December and January.`,
    `Rooms are ${deluxeN || 'several'} deluxe and premium room types (some family rooms) and ${bungalowN || 'several'} bungalow types with garden, pool, sea or beachfront views, all with balconies; rates are only shown in the booking widget, so prices are on request.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Seahorse Resort & Spa',
    summary,
    continent: 'Asia',
    country: 'Vietnam',
    region: 'Lam Dong (Binh Thuan)',
    spot: 'Mui Ne',
    spotCoords: coords, // the resort's own /vi-tri page
    itinerarySpots: [],
    durationDays: null,
    // Surfpoint: lessons for beginners to advanced riders, rental for independent kiters
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: sp.atSeahorse,
    equipmentRental: sp.atSeahorse,
    beginnerFriendly: true,
    includedServices: ['Infinity pool', 'Gym', 'Jacuzzi', 'Wi-Fi'], // "Miễn phí sử dụng hồ bơi vô cực, phòng gym, jacuzzi, wifi" (voucher page)
    optionalServices: [
      'Surfpoint kite, wing foil and surf lessons and rental (station on the resort beach)',
      'Kite gear storage and lockers at the Surfpoint clubhouse',
      'Seahorse Spa', 'Airport transfer (paid)', 'Laundry (paid)',
    ],
    accommodation: 'beach resort deluxe rooms and bungalows',
    mealPlan: null, // the room detail pages (not fetched) list free breakfast; the list pages do not
    languages: ['vi', 'en'],
    rooms: contentRooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: SH_HOME_URL,
    bookingUrl: `${SITE}/booking-vi`,
    sourceText: [
      `home: ${welcome ?? ''}`,
      `rooms: ${rooms.map(r => `${r.nameVi} = ${r.name}${r.bookingRoomId ? ` (be-room ${r.bookingRoomId})` : ''}`).join('; ')}`,
      `location: ${coords ? `${coords.lat},${coords.lng}` : '-'}`,
      `voucher (not a public rate): ${voucher.title ?? ''} ${voucher.price ?? ''} VND, stays ${voucher.validity ?? '?'}, residents only: ${voucher.residentsOnly}`,
      `Surfpoint (${SP_TRAVEL_URL}): at Seahorse: ${sp.atSeahorse}; ${sp.facts.join(' ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const seahorseResortMuiNe: OfferAdapter = {
  key: 'seahorse-resort-mui-ne',
  name: 'Seahorse Resort & Spa (Mui Ne)',
  kind: 'accommodation',
  operator: {
    name: 'Seahorse Resort & Spa',
    websiteUrl: SITE,
    rootDomain: 'seahorseresortvn.com',
    contactEmail: 'info@seahorseresortvn.com', // site footer, 2026-10-12
    phone: '+842523847507',
  },
  url: SH_HOME_URL,
  slotMethod: 'booking_engine',
  fetchBudget: 7,
  confidence: 'low', // no public rates; kite link from the school's site only
  async fetchContent() {
    const home = await fetchText(SH_HOME_URL, { accept: 'text/html' });
    const deluxe = await fetchText(SH_DELUXE_URL, { accept: 'text/html' });
    const bungalow = await fetchText(SH_BUNGALOW_URL, { accept: 'text/html' });
    const location = await fetchText(SH_LOCATION_URL, { accept: 'text/html' });
    const voucher = await fetchText(SH_VOUCHER_URL, { accept: 'text/html' });
    const spHome = await fetchText(SP_HOME_URL, { accept: 'text/html' });
    const spTravel = await fetchText(SP_TRAVEL_URL, { accept: 'text/html' });
    return parseSeahorseContent({ home, deluxe, bungalow, location, voucher, spHome, spTravel });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    ctx.note('rates only in the Exely booking widget; the printed 2026 summer vouchers are for residents of Vietnam only: price on request');
    return [];
  },
};
