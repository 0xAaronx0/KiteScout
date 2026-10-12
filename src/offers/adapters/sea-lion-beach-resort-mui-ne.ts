// ---------------------------------------------------------------------------
// Sea Lion Beach Resort, Mui Ne (Ham Tien, Lam Dong - formerly Binh Thuan, Vietnam) - beach resort with 285 rooms and
// bungalows, two pools and two restaurants; the C2SKY Kite & Wing Center (IKO + IWO school, in Mui Ne since 2007) is
// based at the resort ("C2SKY Kite & Wing Center – Sea Lion, 12 Nguyen Dinh Chieu") and teaches on the beach in front.
//
// Kite link (the on-site kite school's own site, 2026-10-12): c2skykitecenter.com footer/contact "C2SKY Kite & Wing
//   Center – Sea Lion 12 Nguyen Dinh Chieu, Mui Ne Ward" (the resort's address); /about-c2sky/ "the kite beach in front of
//   the centre", rental + storage. The resort's own site does not mention kiting.
// Liveness (2026-10-12): resort home "Các Chương Trình Khuyến Mãi Đặc Biệt Năm 2026 Được Cập Nhật Liên Tục" (2026
//   promotions, a 2026 edit); the address block already uses the 2025 province merger ("Phường Mũi Né, Tỉnh Lâm Đồng");
//   C2SKY footer "© 2026". The room posts themselves are dated 2022 and the tea offer ran "đến hết 31/12/2025".
//   Verdict LIVE (operating resort, 2026 site edit), price freshness uncertain -> confidence 'low'.
// Data path (checked 2026-10-12): sealionresort.com/hamtien/ (Vietnamese CMS by Nina.vn, no English content):
//   content  / (welcome), /ve-chung-toi (about: 285 rooms, 6.5 ha, 2 restaurants, 3 bars, 2 pools), 8 room pages
//            (p.title-pro-detail, .info .name/.desc pairs: area, view, balcony, beds, breakfast, ...; .slick_1 photos),
//            + c2skykitecenter.com/about-c2sky/ (kite facts).
//   slots    the 8 room pages: "Giá: Từ 2.300.000 vnđ/đêm" = from-price per room and night in VND, breakfast for two
//            included; no dates, no season, no inventory -> one undated slot per room type, availability on_request
//            (booking by phone, e-mail or the site's request form; the /dat-phong page has no engine).
// robots.txt (2026-10-12): none (404 page) -> allow all; c2skykitecenter.com allows / (cart/checkout/author/tag only).
// Requests per run: content 11, slots 8.
// Known limits: no coordinates on the site; the from-prices carry no year (pages posted 2022); room counts per type
//   are not stated; the C2SKY wingfoil centre at Rainbow Beach (98 Huynh Thuc Khang) is a different place.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse, parseAmount } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://sealionresort.com/hamtien';
export const SL_HOME_URL = `${SITE}/`;
export const SL_ABOUT_URL = `${SITE}/ve-chung-toi`;
export const SL_ROOM_URLS = [
  'standard-room', 'superior', 'deluxe-garden-view', 'deluxe-ocean-view', 'deluxe-beach-front',
  'family-garden-view', 'family-ocean-view', 'bungalow-garden-view',
].map(s => `${SITE}/${s}`);
export const C2SKY_ABOUT_URL = 'https://c2skykitecenter.com/about-c2sky/';

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const titleCase = (s: string): string => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
/** lower-case, accents stripped (đ -> d), for matching Vietnamese labels */
const fold = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').trim();

/** Visible text blocks in document order, de-duplicated. */
export function slLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  const out: string[] = [];
  for (const el of root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, td')) {
    const t = collapse(el.text);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface SlRoom {
  name: string;
  url: string;
  price: number | null;      // VND per room and night ("Từ ..." = from)
  priceText: string | null;
  areaM2: number | null;
  view: string | null;       // English
  balcony: boolean;
  beds: string | null;
  breakfast: string | null;  // English
  attrs: Array<[string, string]>; // raw Vietnamese label/value pairs
  images: string[];
}

const VIEW_EN: Array<[RegExp, string]> = [
  [/truc dien bien/, 'beachfront'], [/huong bien\s*\/\s*san vuon/, 'sea or garden'], [/vuon\s*\/\s*ho boi/, 'garden or pool'],
  [/dai duong|huong bien/, 'ocean'], [/vuon/, 'garden'],
];
function viewEn(v: string): string | null {
  const f = fold(v);
  for (const [re, en] of VIEW_EN) if (re.test(f)) return en;
  return null;
}
function breakfastEn(v: string): string | null {
  const f = fold(v);
  if (/mien phi cho 0?2 khach/.test(f)) return 'breakfast for two included';
  if (/buffet sang/.test(f)) return 'buffet breakfast included';
  return null;
}

/** One room page: title, from-price, attribute pairs, slider photos. */
export function parseSlRoom(html: string, url: string): SlRoom {
  const root = parse(html);
  const name = titleCase(collapse(root.querySelector('p.title-pro-detail')?.text ?? ''));
  const priceText = collapse(root.querySelector('.price-new-pro-detail')?.text ?? '') || null;
  const price = priceText && /vn[dđ]/i.test(priceText) ? parseAmount(priceText) : null;
  const attrs: Array<[string, string]> = root.querySelectorAll('.info_detail .info').map(i => [
    collapse(i.querySelector('.name')?.text ?? ''), collapse(i.querySelector('.desc')?.text ?? ''),
  ] as [string, string]).filter(([k, v]) => k && v);
  const get = (label: string): string | null => attrs.find(([k]) => fold(k) === label)?.[1] ?? null;
  const area = get('dien tich');
  const beds = get('giuong');
  const images = root.querySelectorAll('.slick_1 img').map(i => i.getAttribute('src') ?? '')
    .filter(u => /\/upload\/product\//.test(u) && !/noimage/.test(u));
  return {
    name,
    url,
    price,
    priceText,
    areaM2: area ? Number(area.match(/(\d+)\s*m/i)?.[1]) || null : null,
    view: get('tam nhin') ? viewEn(get('tam nhin')!) : null,
    balcony: /co ban cong/.test(fold(get('ban cong') ?? '')),
    beds: beds ? beds.replace(/^Giường\s*/i, '').replace(/\s*và\s*/i, ' and ').replace(/\s*\/\s*/g, ' / ') : null,
    breakfast: get('an sang') ? breakfastEn(get('an sang')!) : null,
    attrs,
    images: [...new Set(images)],
  };
}

export function slRoomFeatures(r: SlRoom): string[] {
  return [
    r.areaM2 ? `${r.areaM2} m²` : null,
    r.view ? `${r.view} view` : null,
    r.balcony ? 'Balcony' : null,
    r.beds ? `Beds: ${r.beds}` : null,
    r.breakfast ? r.breakfast.charAt(0).toUpperCase() + r.breakfast.slice(1) : null,
    'Air conditioning', 'Cable TV', 'Free Wi-Fi', 'Hair dryer',
    r.price ? `From VND ${r.price.toLocaleString('en-US')} per night` : null,
  ].filter((x): x is string => !!x);
}

/** One undated from-price slot per room type (VND per room and night, breakfast included). */
export function buildSlSlots(rooms: SlRoom[]): Slot[] {
  return rooms.filter(r => r.price !== null && r.name).map(r => ({
    key: keyPart(r.name),
    startDate: null,
    endDate: null,
    unit: r.name,
    price: r.price,
    currency: 'VND',
    priceUnit: 'per_night' as const,
    priceBasis: 'room' as const,
    occupancy: 2,
    availability: 'on_request' as const,
    availabilityText: r.priceText,
    spotsLeft: null,
  }));
}

export interface SlPages { home: string; about: string; c2sky: string; rooms: Array<{ url: string; html: string }> }

export function parseSeaLionContent(p: SlPages): OfferContent {
  const home = slLines(p.home);
  const about = slLines(p.about).join(' ');
  const c2 = slLines(p.c2sky);
  const c2raw = parse(p.c2sky).text.replace(/\s+/g, ' ');
  const rooms = p.rooms.map(r => parseSlRoom(r.html, r.url));
  const nRooms = about.match(/là (\d+) phòng nghỉ/)?.[1] ?? null;
  const hectares = about.match(/khoảng ([\d,]+) hecta/)?.[1]?.replace(',', '.') ?? null;
  const homeRaw = parse(p.home).text.replace(/\s+/g, ' ');
  const promo = homeRaw.match(/Các Chương Trình Khuyến Mãi Đặc Biệt Năm 20\d\d[^.]*?Website/i)?.[0] ?? null;
  const c2Since = c2.find(t => /^C2SKY was founded by/.test(t)) ?? null;
  const c2Gear = c2.find(t => /^Complete sets by the hour/.test(t)) ?? null;
  const c2Beaches = c2.find(t => /the kite beach in front of the centre/.test(t)) ?? null;
  const c2AtSeaLion = /C2SKY Kite (?:&|&amp;) Wing Center\s*[–-]\s*Sea Lion\s*12 Nguyen Dinh Chieu/.test(c2raw);
  const c2Iko = /IKO \+ IWO CERTIFIED SCHOOL/i.test(c2raw);
  const storage = c2Gear?.match(/storage on the same beach from (€\s?\d+) a day/)?.[1]?.replace('€', 'EUR ') ?? null;
  const priced = rooms.filter(r => r.price !== null);
  const min = priced.length ? Math.min(...priced.map(r => r.price!)) : null;
  const areas = rooms.map(r => r.areaM2).filter((x): x is number => !!x);

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: [
      r.areaM2 ? `${r.areaM2} m²` : null,
      /family/i.test(r.name) ? 'two bedrooms' : /bungalow/i.test(r.name) ? 'garden bungalow' : 'room',
      r.view ? `with ${r.view} view` : null,
      r.balcony ? 'and balcony' : null,
    ].filter(Boolean).join(' ').replace(/^(\d+ m²) /, '$1 ') + (r.breakfast ? `; ${r.breakfast}.` : '.'),
    features: slRoomFeatures(r),
  }));

  const imgs = [...new Set(rooms.flatMap(r => r.images))].slice(0, 30);

  const summary = [
    `Sea Lion Beach Resort is a beach resort on the main road of Mui Ne (Ham Tien) in southern Vietnam, with ${nRooms ?? '285'} rooms and bungalows in a ${hectares ?? '6.5'}-hectare coconut garden, two restaurants, three bars and two large pools.`,
    `The C2SKY Kite & Wing Center, ${c2Iko ? 'an IKO and IWO certified school' : 'a kite and wing school'} in Mui Ne since 2007, ${c2AtSeaLion ? 'is based at the resort and ' : ''}teaches private kite and wing lessons on the kite beach in front of the centre and rents complete sets${storage ? `, with gear storage from ${storage} a day` : ''}; kiting follows the north-east trade-wind season.`,
    areas.length ? `Room types run from ${Math.min(...areas)} m² standard rooms to ${Math.max(...areas)} m² two-bedroom family rooms and garden bungalows${min ? `, with published rates from VND ${min.toLocaleString('en-US')} per room and night including breakfast` : ''}.` : '',
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Sea Lion Beach Resort',
    summary,
    continent: 'Asia',
    country: 'Vietnam',
    region: 'Lam Dong (Binh Thuan)',
    spot: 'Mui Ne',
    itinerarySpots: [],
    durationDays: null,
    // C2SKY: private 1:1 courses, "Most people are riding on their own inside 12 hours" + rental for independent riders
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: c2.some(t => /Private tuition on the beach/.test(t)),
    equipmentRental: !!c2Gear,
    beginnerFriendly: true,
    includedServices: ['Breakfast', 'Free Wi-Fi', 'Outdoor pools', 'Private beach with loungers and umbrellas', 'Indoor and outdoor kids play areas', 'Gym'],
    optionalServices: [
      'C2SKY private kite and wing lessons (1:1, or 2:1 for two)',
      'C2SKY kite rental by the hour, day or week',
      storage ? `Kite storage on the beach from ${storage} a day` : 'Kite storage on the beach',
      'Spa', 'Car rental and jeep tours', 'Laundry',
    ],
    accommodation: 'beach resort rooms, family rooms and garden bungalows',
    mealPlan: 'breakfast',
    languages: ['vi', 'en'],
    rooms: contentRooms,
    imageUrls: imgs,
    heroVideoUrl: null,
    sourceUrl: SL_HOME_URL,
    bookingUrl: `${SITE}/lien-he`,
    sourceText: [
      `home: ${home.find(t => /^Tọa lạc tại 12 Nguyễn Đình Chiểu/.test(t)) ?? ''} | ${promo ?? ''}`,
      `about: ${about.match(/Tọa lạc tại[\s\S]*?hồ bơi lớn\./)?.[0] ?? ''}`,
      ...rooms.map(r => `room ${r.name}: ${r.priceText ?? '-'} | ${r.attrs.map(([k, v]) => `${k}: ${v}`).join('; ')}`),
      `C2SKY (${C2SKY_ABOUT_URL}): ${c2AtSeaLion ? 'address "C2SKY Kite & Wing Center – Sea Lion 12 Nguyen Dinh Chieu"' : 'address not found'} | ${[c2Since, c2Gear, c2Beaches].filter(Boolean).join(' ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
async function fetchRooms(): Promise<Array<{ url: string; html: string }>> {
  const out: Array<{ url: string; html: string }> = [];
  for (const url of SL_ROOM_URLS) out.push({ url, html: await fetchText(url, { accept: 'text/html' }) });
  return out;
}

export const seaLionBeachResortMuiNe: OfferAdapter = {
  key: 'sea-lion-beach-resort-mui-ne',
  name: 'Sea Lion Beach Resort (Mui Ne)',
  kind: 'accommodation',
  operator: {
    name: 'Sea Lion Beach Resort Mui Ne',
    websiteUrl: SITE,
    rootDomain: 'sealionresort.com',
    contactEmail: 'info@sealionresort.com', // /lien-he, 2026-10-12
    phone: '+842523743387',
  },
  url: SL_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 12,
  confidence: 'low', // from-prices without year on 2022 room posts; kite link from the school's site only
  async fetchContent() {
    const home = await fetchText(SL_HOME_URL, { accept: 'text/html' });
    const about = await fetchText(SL_ABOUT_URL, { accept: 'text/html' });
    const rooms = await fetchRooms();
    const c2sky = await fetchText(C2SKY_ABOUT_URL, { accept: 'text/html' });
    return parseSeaLionContent({ home, about, c2sky, rooms });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    const rooms = (await fetchRooms()).map(r => parseSlRoom(r.html, r.url));
    const slots = buildSlSlots(rooms);
    if (slots.length < rooms.length) ctx.note(`from-price missing on ${rooms.length - slots.length} of ${rooms.length} room pages`);
    if (slots.length === 0) throw new Error('sea-lion: no "Giá: Từ ... vnđ/đêm" on any room page (layout changed?)');
    return slots;
  },
};
