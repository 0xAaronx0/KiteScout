// ---------------------------------------------------------------------------
// FUNBASE Uruma (Yonashiro, Uruma, Okinawa, Japan) - "a small concept hotel" for marine sports (kitesurfing, windsurfing,
// wing foil, SUP, diving) opened June 2021, two minutes by car from the Kaichu-doro marine sports area; the hotel's own
// spot guide (/spot/) leads with "海中道路カイトビーチ（オアシス浜）" (Kaichu-doro kite beach, Oasis beach: shallow sand
// beach, flat water inside, beginner to advanced, NW-E winds). Nine rooms on two floors, outdoor hot showers and toilet
// usable in a wetsuit, gear wash area, a lockable marine locker (drying space) per room, paid board storage. The hotel
// runs its own WING FOIL ACADEMY and lists local shops on its home page (KITECLUB Okinawa = 沖縄カイトクラブ, SUPERFLY).
// Kind 'accommodation' (rooms per night; no kite lessons of its own).
//
// Data path (checked 2026-10-21): WordPress (theme "funbase"), server-rendered, UTF-8, Japanese.
//   slots    /fee/ "ルームチャージ 1泊1室あたり(消費税込)" = per room per night, consumption tax INCLUDED. Two tables, each
//            announced by a <p class="feelist"> header:
//              "2026/12/30～適用 改定後のご宿泊料金 （　）内は一般料金で全日共通" - the revised rates (notice /info/1601/ of
//                2026-09-26): per room type and guest count "（10,450）6,270円 | 7,920円 | 9,240円" = general rate in
//                brackets, the SAME on all days, then the member rate normal / night before a holiday / year end
//                (inferred from the header + the arithmetic: member = 60% of general, as in the current table);
//              "現/通常プラン）料金表 2024/10/1～2026/12/29迄" - the current rates: per guest count a general row
//                (normal / night before a holiday / year end) and a "会員価格" (member) row.
//            -> one slot per band x room type x guest count: the GENERAL rate as JPY per_night, priceBasis 'room',
//            occupancy = guests; member and pre-holiday rates go into availabilityText. Members = anyone who stayed once,
//            referrals by members/shops, shop staff (no fee). Current band from max(today, band start) to 2026-12-29
//            (dropped once past); revised band from 2026-12-30 to the end of the booking window ("ご予約受付開始は
//            ご宿泊希望日の6ヵ月前（月初）から" = bookable from the 1st of the month 6 months ahead -> last day of
//            today's month + 6; on 2026-10-21 that is 2027-04-30, matching "/yoyaku/: 2027年4月チェックイン迄受付中").
//            Availability 'on_request': /yoyaku/ is a request form (Contact Form 7 + reCAPTCHA), "staff confirm by
//            e-mail after checking availability". The /yoyaku/ room schedule is an embedded Google Calendar (not read).
//            A RESERVA engine button exists only inside HTML comments (retired) -> no engine.
//   content  / (concept, opening, facilities, partner shops), /roomguide/ (room types, beds, en-suite or shared bath),
//            /floorguide/ (outdoor showers, lockers, breakfast JPY 1,000 / dinner JPY 1,500, parking 12),
//            /spot/ (kite beach photos and wind directions), /fee/ (discounts, storage, pets).
// robots.txt (2026-10-21): only /wp/wp-admin/ disallowed (admin-ajax allowed); pages allowed.
// Requests per run: content 5 (home, /roomguide/, /floorguide/, /spot/, /fee/), slots 1 (/fee/, memoised).
// Known limits / doubts: the /roomguide/ copy of the revised table prints room 203 for 2 guests as "（15,400）9,240円"
//   (same as 1 guest) while /fee/ says "（20,900）12,540円" -> /fee/ is used. Pet fee differs (/fee/ JPY 3,000, roomguide
//   JPY 1,000 per pet per night) -> /fee/ is used. Okinawa accommodation tax (2%) is added from 2027-02-01 on top of
//   the printed rates (noted per slot, not added). No spotCoords on the site; spot "Kaichu-doro" for the geocoder.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, iso, parse, parseAmount, todayIso, type HTMLElement } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://funbase.jp';
export const FB_HOME_URL = `${SITE}/`;
export const FB_FEE_URL = `${SITE}/fee/`;
export const FB_ROOMS_URL = `${SITE}/roomguide/`;
export const FB_FLOOR_URL = `${SITE}/floorguide/`;
export const FB_SPOT_URL = `${SITE}/spot/`;
export const FB_BOOKING_URL = `${SITE}/yoyaku/`;

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

const yen = (n: number): string => `JPY ${n.toLocaleString('en-US')}`;
/** "9,500円" / "19800円" / "（10,450）" -> number. */
const amount = (s: string): number | null => { const m = s.match(/\d[\d,]*/); return m ? parseAmount(m[0]) : null; };

// --- room types -----------------------------------------------------------------------------------
/** The five room types, identified by their room numbers in the fee table (the names are the site's). */
export const FB_ROOMS: Array<{ key: string; numbers: number[]; names: string[]; room: ContentRoom }> = [
  {
    key: 'twin-1f', numbers: [103, 104], names: ['月桃', 'ユウナ'],
    room: {
      name: '1F Twin (Gettou 103 / Yuuna 104)',
      description: 'Budget twin on the hostel-style ground floor, 1-2 guests, two beds; shared showers, toilets and washroom.',
      features: ['2 beds', '1-2 guests', 'shared bathroom', 'TV', 'fridge', 'hair dryer', 'air conditioning'],
    },
  },
  {
    key: 'double-1f', numbers: [101, 102], names: ['プルメリア', 'ブーゲンビリア'],
    room: {
      name: '1F Double (Plumeria 101 / Bougainvillea 102)',
      description: 'Double room for 1-2 guests with its own shower and toilet unit.',
      features: ['1 double bed', '1-2 guests', 'private shower and toilet', 'TV', 'fridge', 'hair dryer', 'air conditioning'],
    },
  },
  {
    key: 'large-1f', numbers: [105, 106], names: ['ハイビスカス', 'サンダンカ'],
    room: {
      name: '1F Large room (Hibiscus 105 / Sandanka 106)',
      description: 'Group room for 3-5 guests with bunk beds and a sofa bed (5 guests); shared showers, toilets and washroom.',
      features: ['bunk beds', 'sofa bed', '3-5 guests', 'shared bathroom', 'TV', 'fridge', 'air conditioning'],
    },
  },
  {
    key: 'twin-2f-miinishi', numbers: [203], names: ['新北風'],
    room: {
      name: '2F Twin Miinishi 203 (pets allowed)',
      description: 'Upper-floor twin reached by the outside stairs, own shower and toilet, shared terrace; the only room where pets may stay.',
      features: ['2 beds', '1-2 guests', 'private shower and toilet', 'pets allowed', 'shared terrace', 'TV', 'fridge', 'air conditioning'],
    },
  },
  {
    key: 'twin-2f', numbers: [201, 202], names: ['夏至風', '南風'],
    room: {
      name: '2F Twin (Kaachibee 202 / Paikaji 201)',
      description: 'Upper-floor twin for 1-3 guests (sofa bed for the third), own shower and toilet, separate vanity and kettle, shared terrace.',
      features: ['2 beds', 'sofa bed', '1-3 guests', 'private shower and toilet', 'vanity unit', 'kettle', 'shared terrace', 'TV', 'fridge', 'air conditioning'],
    },
  },
];

function roomFor(cellText: string): (typeof FB_ROOMS)[number] | null {
  const nums = [...cellText.matchAll(/(\d{3})/g)].map(m => Number(m[1]));
  return FB_ROOMS.find(r => r.numbers.some(n => nums.includes(n))) ?? null;
}

// --- fee tables ------------------------------------------------------------------------------------
export interface FbRate {
  roomKey: string;
  guests: number;
  /** general (non-member) rate per room per night: normal / night before a holiday / year end */
  general: { normal: number; preHoliday: number | null; yearEnd: number | null };
  member: { normal: number | null; preHoliday: number | null; yearEnd: number | null };
}
export interface FbBand {
  start: string;
  end: string | null;
  /** revised table: one general rate for all days */
  flatGeneral: boolean;
  header: string;
  rates: FbRate[];
}
export interface FbFee {
  bands: FbBand[];
  taxIncluded: boolean;
  /** "2027/2/1より沖縄県の宿泊税（2％）が別途加算" */
  lodgingTax: { from: string; percent: number } | null;
  /** booking opens N months ahead (1st of the month) */
  bookingMonthsAhead: number | null;
  discounts: string[];
  storage: string[];
  petFee: number | null;
}

const ymd = (s: string): string | null => {
  const m = s.match(/(20\d{2})\/(\d{1,2})\/(\d{1,2})/);
  return m ? iso(+m[1], +m[2], +m[3]) : null;
};

function cells(tr: HTMLElement): string[] {
  return tr.querySelectorAll('td').map(td => collapse(td.text));
}

/** One fee table (a room type): rows "N人 | normal | pre-holiday | year end" (+ "会員価格" rows in the current table). */
function parseTable(table: HTMLElement, flat: boolean): FbRate[] {
  const out: FbRate[] = [];
  let room: (typeof FB_ROOMS)[number] | null = null;
  let last: FbRate | null = null;
  for (const tr of table.querySelectorAll('tr')) {
    const roomCell = tr.querySelector('td.tdtxt');
    if (roomCell) room = roomFor(roomCell.text);
    const c = cells(tr).filter((_, i) => !(roomCell && i === 0));
    if (c.length < 2) continue;
    const g = c[0].match(/^(\d)\s*人/);
    if (g) {
      if (!room) throw new Error(`funbase: fee table row without a known room type (${collapse(table.text).slice(0, 80)})`);
      const [n, pre, ye] = [c[1], c[2] ?? '', c[3] ?? ''];
      if (flat) {
        // "（10,450）6,270円": bracket = general (all days), then member normal; pre-holiday / year end are member rates
        const m = n.match(/[（(]\s*([\d,]+)\s*[）)]\s*([\d,]+)/);
        if (!m) throw new Error(`funbase: revised rate cell not "（general）member" (${n})`);
        last = {
          roomKey: room.key, guests: Number(g[1]),
          general: { normal: amount(m[1])!, preHoliday: null, yearEnd: null },
          member: { normal: amount(m[2]), preHoliday: amount(pre), yearEnd: amount(ye) },
        };
      } else {
        const normal = amount(n);
        if (!normal) throw new Error(`funbase: current rate cell without amount (${n})`);
        last = {
          roomKey: room.key, guests: Number(g[1]),
          general: { normal, preHoliday: amount(pre), yearEnd: amount(ye) },
          member: { normal: null, preHoliday: null, yearEnd: null },
        };
      }
      out.push(last);
    } else if (/会員価格/.test(c[0]) && last) {
      last.member = { normal: amount(c[1]), preHoliday: amount(c[2] ?? ''), yearEnd: amount(c[3] ?? '') };
    }
  }
  return out;
}

export function parseFbFee(html: string): FbFee {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript')) el.remove();
  const body = root.querySelector('body') ?? root;
  const text = collapse(body.text);
  const bands: FbBand[] = [];
  const headers = body.querySelectorAll('p.feelist');
  for (const p of headers) {
    const header = collapse(p.text);
    const start = ymd(header);
    if (!start) continue;
    const endM = header.match(/～\s*(20\d{2}\/\d{1,2}\/\d{1,2})/);
    const end = endM ? ymd(endM[1]) : null;
    const flat = /（\s*）内は一般料金/.test(header) || /一般料金で全日共通/.test(header);
    // the tables of this band sit in the next sibling <div class="slidelist">
    let el = p.nextElementSibling;
    while (el && !el.classList.contains('slidelist')) el = el.nextElementSibling;
    if (!el) throw new Error(`funbase: no table block after "${header}"`);
    const rates = el.querySelectorAll('table').flatMap(t => parseTable(t, flat));
    bands.push({ start, end, flatGeneral: flat, header, rates });
  }
  const tax = text.match(/(20\d{2}\/\d{1,2}\/\d{1,2})より沖縄県の宿泊税（\s*(\d+(?:\.\d+)?)\s*[％%]\s*）が別途加算/);
  const ahead = text.match(/ご宿泊希望日の\s*(\d+)\s*ヵ?か?ヶ?月前/);
  const discounts: string[] = [];
  const d3 = text.match(/(\d+)泊以上は、\s*(\d+)%割引/g) ?? [];
  for (const d of d3) { const m = d.match(/(\d+)泊以上は、\s*(\d+)%/)!; discounts.push(`${m[2]}% off for ${m[1]}+ nights`); }
  if (/おかえり割引\s*5％/.test(text)) discounts.push('5% repeat-guest discount within 3 months of the last stay');
  const storage: string[] = [];
  for (const m of text.matchAll(/(カゴ台車（俺カゴ）[ML]|ロードバイク|サップover7)\s*([\d,]+)円\s*([\d,]+)円\s*([\d,]+)円\s*([\d,]+)円/g)) {
    const name = m[1].replace('カゴ台車（俺カゴ）', 'gear cage cart ').replace('ロードバイク', 'road bike').replace('サップover7', 'SUP over 7 ft');
    storage.push(`${name}: ${yen(amount(m[2])!)} / month, ${yen(amount(m[5])!)} / year`);
  }
  const pet = text.match(/ペット宿泊料は、?\s*1ペット1泊あたり\s*([\d,]+)円/);
  return {
    bands,
    taxIncluded: /1泊1室あたり\s*\(消費税込\)/.test(text) || /消費税込/.test(text),
    lodgingTax: tax ? { from: ymd(tax[1])!, percent: Number(tax[2]) } : null,
    bookingMonthsAhead: ahead ? Number(ahead[1]) : null,
    discounts,
    storage,
    petFee: pet ? amount(pet[1]) : null,
  };
}

const lastDayOfMonthAhead = (today: string, months: number): string => {
  const y = +today.slice(0, 4);
  const m = +today.slice(5, 7) + months; // month after the target, day 0 = last day of the target month
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
/** true when a night between 30 Dec and 3 Jan (the site's year-end period) falls into start..end (open end = yes). */
const spansYearEnd = (start: string, end: string | null): boolean => {
  if (!end) return true;
  for (let y = +start.slice(0, 4) - 1; y <= +end.slice(0, 4); y++) if (start <= `${y + 1}-01-03` && end >= `${y}-12-30`) return true;
  return false;
};
const dmy = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function buildFbSlots(fee: FbFee, today: string): Slot[] {
  const windowEnd = fee.bookingMonthsAhead ? lastDayOfMonthAhead(today, fee.bookingMonthsAhead) : null;
  const out: Slot[] = [];
  for (const b of fee.bands) {
    let end = b.end;
    if (end && end < today) continue;
    if (windowEnd && (!end || end > windowEnd)) end = windowEnd;
    const start = b.start > today ? b.start : today;
    if (end && end < start) continue; // the band lies beyond the booking window
    for (const r of b.rates) {
      const room = FB_ROOMS.find(x => x.key === r.roomKey)!;
      const parts: string[] = [];
      if (b.flatGeneral) parts.push(`general rate, same on all days incl. year end`);
      else {
        parts.push(`general rate on normal nights`);
        if (r.general.preHoliday) parts.push(`${yen(r.general.preHoliday)} the night before a holiday`);
        if (r.general.yearEnd && spansYearEnd(start, end)) parts.push(`${yen(r.general.yearEnd)} 30 Dec - 3 Jan`);
      }
      const mem = [r.member.normal, r.member.preHoliday].filter((x): x is number => !!x);
      if (mem.length) parts.push(`member rate ${yen(mem[0])}${mem[1] ? ` (${yen(mem[1])} before a holiday)` : ''}`);
      parts.push(fee.taxIncluded ? 'consumption tax included' : 'consumption tax not stated');
      if (fee.lodgingTax && (!end || end >= fee.lodgingTax.from)) parts.push(`plus Okinawa accommodation tax ${fee.lodgingTax.percent}% from ${dmy(fee.lodgingTax.from)}`);
      parts.push('booking by request form, confirmed by e-mail');
      out.push({
        key: `${r.roomKey}|${r.guests}p|${b.start}`,
        startDate: start,
        endDate: end,
        unit: `${room.room.name}, ${r.guests} guest${r.guests > 1 ? 's' : ''}`,
        room: room.room.name,
        price: r.general.normal,
        currency: 'JPY',
        priceUnit: 'per_night',
        priceBasis: 'room',
        occupancy: r.guests,
        availability: 'on_request',
        availabilityText: parts.join('; '),
        spotsLeft: null,
      });
    }
  }
  return out;
}

export async function fetchFbSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const fee = parseFbFee(await page(FB_FEE_URL));
  if (fee.bands.length === 0 || fee.bands.every(b => b.rates.length === 0)) throw new Error('funbase: no rate table on /fee/ (layout changed?)');
  for (const b of fee.bands) {
    const missing = FB_ROOMS.filter(r => !b.rates.some(x => x.roomKey === r.key));
    if (missing.length) ctx?.note(`band ${b.start}: no rates for ${missing.map(m => m.key).join(', ')}`);
  }
  if (!fee.bookingMonthsAhead) ctx?.note('booking-window rule ("6ヵ月前") not found; revised band left open-ended');
  return buildFbSlots(fee, today);
}

// --- content ----------------------------------------------------------------------------------------
export function fbLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, form')) el.remove();
  return (root.querySelector('main') ?? root.querySelector('body') ?? root).structuredText.split('\n').map(s => collapse(s)).filter(Boolean);
}

/** Real photos of a page in page order (WordPress uploads, originals): no theme art, logos, banners, icons, flyers, QR codes. */
export function fbImages(html: string): string[] {
  const out: string[] = [];
  const raw = [
    ...[...html.matchAll(/url\((https:\/\/funbase\.jp\/wp\/wp-content\/uploads\/[^)'"]+)\)/g)].map(m => m[1]),
    ...[...html.matchAll(/<img[^>]+src="(https:\/\/funbase\.jp\/wp\/wp-content\/uploads\/[^"]+)"/g)].map(m => m[1]),
  ];
  for (const u0 of raw) {
    if (!/\.jpe?g$/i.test(u0)) continue;
    if (/logo|bnr_|topbox|chirashi|qrcode|mark_|servicepoint|icon/i.test(u0)) continue;
    const u = u0.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export interface FbPages { home: string; fee: string; rooms: string; floor: string; spot: string }

export function parseFunbaseContent(p: FbPages, today: string): OfferContent {
  const home = fbLines(p.home).join('\n');
  const floor = fbLines(p.floor).join('\n');
  const spot = fbLines(p.spot).join('\n');
  const roomsText = fbLines(p.rooms).join('\n');
  const fee = parseFbFee(p.fee);
  const slots = buildFbSlots(fee, today);
  if (!/カイト/.test(home) || !/カイトビーチ/.test(spot)) throw new Error('funbase: kite mention or kite beach missing (site changed?)');

  const breakfast = floor.match(/朝食\s*([\d,]+)円/);
  const dinner = floor.match(/夕食\s*([\d,]+)円/);
  const parking = floor.match(/駐車場[\s\S]{0,20}?無料です。?\s*(\d+)台/);
  const opened = home.match(/(20\d{2})年(\d{1,2})月オープン/);
  const kiteBeach = /海中道路カイトビーチ（オアシス浜）/.test(spot);
  const cheapest = [...slots].sort((a, b) => (a.price ?? 1e12) - (b.price ?? 1e12))[0] ?? null;
  const current = fee.bands.find(b => !b.flatGeneral);
  const revised = fee.bands.find(b => b.flatGeneral);
  const missingRooms = FB_ROOMS.filter(r => !r.names.every(n => roomsText.includes(n)));

  const summary = [
    `FUNBASE Uruma is a small concept hotel for marine sports in Yonashiro, Uruma, central Okinawa Island${opened ? `, open since ${new Date(Date.UTC(+opened[1], +opened[2] - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}` : ''}, two minutes by car from the Kaichu-doro marine sports area${kiteBeach ? ', whose kite beach (Oasis beach) the hotel describes as a shallow sand beach with flat water inside, for beginners to advanced riders in north-west to east winds' : ''}.`,
    `It has nine rooms (twins, doubles and 3-5 person rooms, some with private shower and toilet) plus outdoor hot showers and a toilet usable in a wetsuit, a gear wash area and a lockable marine locker per room; board storage is extra.`,
    cheapest
      ? `Rooms from ${yen(cheapest.price!)} per room per night incl. consumption tax (general rate${current?.end ? ` until ${dmy(current.end)}` : ''}${revised ? `, revised rates from ${dmy(revised.start)}` : ''}${fee.lodgingTax ? `; Okinawa accommodation tax ${fee.lodgingTax.percent}% extra from ${dmy(fee.lodgingTax.from)}` : ''}), member rates for returning guests; booking by request form.`
      : 'Rates on request; booking by request form.',
    `The hotel runs its own wing foil school (WING FOIL ACADEMY); for kite lessons it lists local shops such as KITECLUB Okinawa.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'FUNBASE Uruma',
    summary,
    continent: 'Asia',
    country: 'Japan',
    region: 'Uruma, Okinawa',
    spot: 'Kaichu-doro',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: false,
    equipmentRental: null,
    beginnerFriendly: true,
    includedServices: [
      'Outdoor hot showers (2) and outdoor toilet, usable straight from the water',
      'Gear wash area and outdoor washing machine',
      'Lockable marine locker (drying space) per room',
      'Bath towels, free Wi-Fi, community space, bike maintenance room',
      parking ? `Free parking (${parking[1]} cars)` : 'Free parking',
    ],
    optionalServices: [
      ...(breakfast ? [`Breakfast ${yen(amount(breakfast[1])!)} (Japanese style)`] : []),
      ...(dinner ? [`Dinner ${yen(amount(dinner[1])!)} (not Thursday / Sunday, book the day before)`] : []),
      ...fee.discounts,
      'Member rates (about 40% below the general rate) after a first stay or with a referral',
      ...fee.storage.map(s => `Board storage, ${s}`),
      ...(fee.petFee ? [`Pet in room 203: ${yen(fee.petFee)} per pet per night`] : []),
      'Wing foil courses at the hotel\'s WING FOIL ACADEMY',
    ],
    accommodation: 'concept hotel, 9 rooms (twin, double, group rooms)',
    mealPlan: 'breakfast optional',
    languages: ['ja'],
    rooms: FB_ROOMS.map(r => r.room),
    imageUrls: [...new Set([...fbImages(p.spot).slice(0, 3), ...fbImages(p.home), ...fbImages(p.rooms), ...fbImages(p.floor)])].slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: FB_HOME_URL,
    bookingUrl: FB_BOOKING_URL,
    sourceText: [
      `home: ${home}`,
      `fee: ${fbLines(p.fee).join('\n')}`,
      `floorguide: ${floor}`,
      `spot (kite beach): ${spot.split('\n').slice(0, 20).join('\n')}`,
      `parsed: bands ${fee.bands.map(b => `${b.start}..${b.end ?? 'open'} (${b.rates.length} rates${b.flatGeneral ? ', flat general' : ''})`).join(', ')}; tax ${JSON.stringify(fee.lodgingTax)}; booking ${fee.bookingMonthsAhead} months ahead${missingRooms.length ? `; rooms not found on /roomguide/: ${missingRooms.map(m => m.key).join(', ')}` : ''}`,
    ].join('\n'),
  };
}

export const funbaseUruma: OfferAdapter = {
  key: 'funbase-uruma',
  name: 'FUNBASE Uruma',
  kind: 'accommodation',
  operator: {
    name: 'FUNBASE Co., Ltd. (FUNBASE Uruma)',
    websiteUrl: FB_HOME_URL,
    rootDomain: 'funbase.jp',
    contactEmail: null, // the company page prints "Mail:" without an address; bookings via the form
    phone: '+81989885328',
  },
  url: FB_HOME_URL,
  slotMethod: 'price_table',
  instantBooking: false, // request form, staff confirm by e-mail; the RESERVA engine button is commented out
  fetchBudget: 6,
  async fetchContent() {
    const [home, fee, rooms, floor, spot] = await Promise.all([
      page(FB_HOME_URL), page(FB_FEE_URL), page(FB_ROOMS_URL), page(FB_FLOOR_URL), page(FB_SPOT_URL),
    ]);
    return parseFunbaseContent({ home, fee, rooms, floor, spot }, todayIso());
  },
  fetchSlots: ctx => fetchFbSlots(todayIso(), ctx),
};
