// ---------------------------------------------------------------------------
// Guesthouse Miyakojima + M-air kiteboard shop (Shimoji Yonaha 233, Miyakojima, Okinawa, Japan) - a renovated old
// Miyako house in a sugar-cane village with private rooms only (twin room A with bath and toilet, single room B with
// shared shower and toilet), shared living room and kitchen (room only), run by an owner couple who also run M-air,
// "the only kiteboard shop on Miyakojima" (school + rental) at the same address. Kind 'accommodation' (kite house:
// rooms per night, lessons and rental from the shop on site).
//
// Identity (checked 2026-10-21): g-miyakojima.com says "私たちオーナー夫婦は、ゲストハウスのほかにカイトボードショップ ...
//   をやっています" and links its kite page + the M-air Facebook page; m-air-kite.com prints the same address
//   (〒906-0305 沖縄県宮古島市下地与那覇233), links back to the guesthouse and stores guests' kite gear in "ゲストハウス宮古島の
//   倉庫". Liveness: the footer says (c)2024 and nothing on either site is dated 2026, but the guesthouse's booking
//   engine sells the rooms live (2026-10-21: daily prices with "1室" / "×" from 22 Oct 2026 into 2027, i.e. real
//   bookings), plan photos uploaded 2024-06-25 (image path gh-miyakojima_240625...). M-air's pages carry no date
//   (template folder il20180130); the guesthouse kite page (2024 site) still offers beginner tasters and step-up
//   school, so the shop is taken as operating (inferred, not dated).
//
// Data path:
//   slots    the guesthouse's own booking engine "あすなろプラン予約システム" on www.yado-sagashi.net (Liberty, the
//            agency that also built the site; linked as "ご予約はこちら"), plain server-rendered JSP, no cookie/token:
//              GET /yoyaku/plan/index2.jsp?yid=<yid>   plan list: <a name='<planId>'>title</a>, "最安価格", the
//                  room label "個室A(1名～2名) 2泊から予約可能" (room, max guests, min nights)
//              GET /yoyaku/plan/plcal.jsp?y=<yid>&p=<planId>&pe=<guests>&in=YYYY/MM/01&cmfrm=0   one month: per day
//                  "6,600円" + "2室" (rooms left) / "×" (full) / "--" (not offered); legend "日付 大人1名の単価
//                  (消費税込み)" = price per adult per night, tax included. `in` picks the month (GET works; the page's
//                  own month buttons POST the same fields).
//            The plans per room (2026-10-21): スタンダード (1+ nights, sold only ~1 month ahead), 連泊 (2+ nights, 5%
//            off, sold at least through Feb 2027) and 早割60 (2+ nights, book 60+ days ahead, 10% off, from +60 days into
//            2027). Rooms-left / full days are identical across plans (shared inventory). We read the 連泊 plan for
//            the near months and the 早割60 plan for the months after its horizon (so every bookable date of the
//            next 5 calendar months is covered once, at the price of a 2+ night stay), per room x guest count
//            (A: 1 and 2 guests, B: 1 guest - the engine sells B for 1 only). Slots = runs of equal (price, rooms
//            left) days (runsOf): JPY per_night, priceBasis 'person' (the legend), occupancy = guests, minNights 2,
//            "×" -> sold_out, 1 room left -> limited, else available; "--" days get no slot; past days dropped.
//            1-night stays (standard plan) cost ~5% more: in the slot note, not a slot.
//   content  g-miyakojima.com / (intro, map embed), facilities.html (rooms), kiteboard.html, price.html (printed
//            "from" table, "料金はすべて税込"), plus m-air-kite.com information.html (school courses, "（税別）" = tax
//            excluded) and schedule.html (rental, tax excluded); the summary uses the engine plan list (memoised).
//   coords   the Google Maps embed on the home page (place "ゲストハウス宮古島", !3d24.7476542 !2d125.2680948 = the
//            embed centre, which a place embed puts on the pin).
//   video    the home page hero video movie/top.mp4 (self-hosted; content not reviewed frame by frame).
// robots.txt (2026-10-21): g-miyakojima.com answers /robots.txt with the home page (no robots file, = allow all);
//   m-air-kite.com and www.yado-sagashi.net: 404 (= allow all).
// Requests per run: slots 1 + up to 3 x (5 months + 1) calendar pages (2026-10-21: 1 + 15, the early-bird plan was
//   not needed because the 連泊 plan covered Oct 2026 - Feb 2027), content 6 (+ the plan list, shared with slots in
//   one process); the recording run made 22.
// FLAGS: liveAvailability true (rooms left per day from the engine on every run). instantBooking true: the engine
//   takes the booking online without prepayment and "ご予約手続きが完了しますとご予約内容確認の自動送信メールが届きます"
//   (automatic confirmation on completion; the terms reserve a cancellation by the inn if a day turns out full).
// Known limits / doubts: the printed price table (A 1 guest 5,500 / 2 guests 4,400, B 4,400 / 3,300 for two with
//   an extra bed) is older than the engine (B sold for 1 guest only, standard A 6,600 for 1 guest), so slots use
//   the engine only. Lesson and rental prices are tax excluded (税別) as printed. The seasonal whole-house rental
//   (itto.html, JPY 33,000 tax excluded, 5 rooms / 10 guests) is not in the engine and not a slot.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, parseAmount, runsOf, todayIso } from '../parse.js';
import type { Availability, ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://g-miyakojima.com';
const SHOP = 'https://m-air-kite.com';
export const GHM_HOME_URL = `${SITE}/`;
export const GHM_FACILITIES_URL = `${SITE}/facilities.html`;
export const GHM_KITE_URL = `${SITE}/kiteboard.html`;
export const GHM_PRICE_URL = `${SITE}/price.html`;
export const MAIR_SCHOOL_URL = `${SHOP}/information.html`;
export const MAIR_RENTAL_URL = `${SHOP}/schedule.html`;
export const GHM_YID = '92728865459041';
const ENGINE = 'https://www.yado-sagashi.net/yoyaku/plan';
export const GHM_PLANS_URL = `${ENGINE}/index2.jsp?yid=${GHM_YID}`;
export const ghmCalendarUrl = (plan: number, guests: number, year: number, month: number): string =>
  `${ENGINE}/plcal.jsp?y=${GHM_YID}&p=${plan}&pe=${guests}&in=${year}/${String(month).padStart(2, '0')}/01&cmfrm=0`;
/** calendar months read per run (current month + 4) */
const HORIZON_MONTHS = 5;

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

const zen = (s: string) => s.replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/～/g, '~');
function textLines(html: string, sel?: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, iframe, header, footer, nav, .remodal')) el.remove();
  const main = (sel ? root.querySelector(sel) : null) ?? root.querySelector('main') ?? root.querySelector('#content') ?? root;
  return main.structuredText.split('\n').map(s => collapse(zen(s))).filter(Boolean);
}

// --- engine: plan list ---------------------------------------------------------------------
export type GhmPlanKind = 'standard' | 'multi' | 'early';
export interface GhmPlan {
  id: number;
  title: string;
  kind: GhmPlanKind | null;
  /** "A" / "B" from "個室A" */
  room: string | null;
  maxGuests: number;
  minNights: number;
  /** "最安価格 4,000円 (税込 4,400円)" -> tax-included lowest price per person per night */
  fromPrice: number | null;
}

export function parseGhmPlans(html: string): GhmPlan[] {
  const out: GhmPlan[] = [];
  for (const chunk of html.split(/<div class='planlisttitle'>/).slice(1)) {
    const head = chunk.match(/<a name='(\d+)'>([^<]+)<\/a>/);
    if (!head) continue;
    const title = collapse(head[2]);
    const label = zen(chunk).match(/個室\s*([A-Z])\s*\((\d+)名~(\d+)名\)\s*(\d+)泊から予約可能/);
    const from = zen(chunk).match(/最安価格\s*[\d,]+円\s*\(税込\s*([\d,]+)円\)/);
    out.push({
      id: Number(head[1]),
      title,
      kind: /^スタンダード/.test(title) ? 'standard' : /^連泊/.test(title) ? 'multi' : /^早割/.test(title) ? 'early' : null,
      room: label?.[1] ?? title.match(/個室\s*([A-Z])/)?.[1] ?? null,
      maxGuests: label ? Number(label[3]) : 1,
      // the B consecutive-night plan is labelled "1泊から" although its title and text say 2+ nights: take the stricter
      minNights: Math.max(label ? Number(label[4]) : 1, /^(連泊|早割)/.test(title) ? 2 : 1),
      fromPrice: from ? parseAmount(from[1]) : null,
    });
  }
  return out;
}

// --- engine: one month calendar --------------------------------------------------------------
export interface GhmDay { date: string; price: number | null; roomsLeft: number | null; full: boolean }
export interface GhmMonth { year: number; month: number; perAdult: boolean; days: GhmDay[] }

export function parseGhmCalendar(html: string): GhmMonth {
  const ym = html.match(/<h3>(\d{4})年(\d{1,2})月<\/h3>/);
  if (!ym) throw new Error('guesthouse-miyakojima: calendar month header not found (layout changed?)');
  const year = Number(ym[1]); const month = Number(ym[2]);
  const days: GhmDay[] = [];
  const re = /cal_p_day">(\d{1,2})<\/div>\s*<div class="cal_p_all"><b>([^<]*)<\/b><\/div>\s*<div class="cal_bg">([^<]*)<\/div>/g;
  for (const m of html.matchAll(re)) {
    const price = /円/.test(m[2]) ? parseAmount(m[2]) : null;
    const bg = collapse(zen(m[3]));
    const left = bg.match(/^(\d+)室$/);
    days.push({
      date: `${year}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`,
      price,
      roomsLeft: left ? Number(left[1]) : null,
      full: bg === '×',
    });
  }
  return { year, month, perAdult: /大人1名の単価/.test(zen(html)), days };
}

/** days we can sell: priced and either rooms left or full; "--" (not offered) days are dropped */
const offered = (d: GhmDay) => d.price !== null && (d.full || d.roomsLeft !== null);

// --- slots -------------------------------------------------------------------------------------
export interface GhmUnit { room: string; guests: number }
export const GHM_ROOM_NAMES: Record<string, string> = {
  A: 'Private room A (twin, bath and toilet)',
  B: 'Private room B (single, shared shower and toilet)',
};
const PLAN_EN: Record<GhmPlanKind, string> = {
  standard: 'standard plan',
  multi: 'consecutive-night plan (2+ nights, 5% off the standard plan)',
  early: 'early-bird plan (book 60+ days ahead, 2+ nights, 10% off the standard plan)',
};

export interface GhmPlanDays { plan: GhmPlan; guests: number; days: GhmDay[] }

/** Runs of equal (price, rooms left) days for one room x guest count; the plan with priority wins a day. */
export function buildGhmSlots(sets: GhmPlanDays[], today: string): Slot[] {
  const out: Slot[] = [];
  const groups = new Map<string, GhmPlanDays[]>();
  for (const s of sets) {
    const k = `${s.plan.room}|${s.guests}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  for (const [, list] of groups) {
    const byDate = new Map<string, { d: GhmDay; plan: GhmPlan }>();
    for (const s of list) {
      for (const d of s.days) if (d.date >= today && offered(d) && !byDate.has(d.date)) byDate.set(d.date, { d, plan: s.plan });
    }
    const days = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v }));
    const { room, guests } = { room: list[0].plan.room ?? '?', guests: list[0].guests };
    const roomName = GHM_ROOM_NAMES[room] ?? `Private room ${room}`;
    for (const r of runsOf(days, x => `${x.plan.id}|${x.d.price}|${x.d.full ? 'x' : x.d.roomsLeft}`)) {
      const { d, plan } = r.first;
      const a: Availability = d.full ? 'sold_out' : d.roomsLeft === 1 ? 'limited' : 'available';
      out.push({
        key: `room-${room.toLowerCase()}-${guests}p|${plan.kind ?? plan.id}|${r.start}`,
        startDate: r.start,
        endDate: r.end,
        unit: `${roomName}, ${guests} guest${guests > 1 ? 's' : ''}`,
        room: roomName,
        price: d.price,
        currency: 'JPY',
        priceUnit: 'per_night',
        priceBasis: 'person',
        occupancy: guests,
        availability: a,
        availabilityText: [
          `booking engine: ${d.full ? 'full (×)' : `${d.roomsLeft} room${d.roomsLeft === 1 ? '' : 's'} left`}`,
          `JPY per adult per night, tax included, room only, ${PLAN_EN[plan.kind ?? 'standard']}`,
          plan.kind !== 'standard' ? '1-night stays (standard plan) cost about 5% more' : null,
        ].filter(Boolean).join('; '),
        spotsLeft: d.full ? 0 : d.roomsLeft,
        minNights: plan.minNights > 1 ? plan.minNights : null,
      });
    }
  }
  return out;
}

const monthsFrom = (today: string, n: number): Array<[number, number]> => {
  const y = Number(today.slice(0, 4)); const m = Number(today.slice(5, 7));
  return Array.from({ length: n }, (_, i) => { const k = m - 1 + i; return [y + Math.floor(k / 12), (k % 12) + 1]; });
};

export async function fetchGhmSlots(today: string, ctx?: Pick<FetchContext, 'note' | 'incomplete'>): Promise<Slot[]> {
  const plans = parseGhmPlans(await page(GHM_PLANS_URL));
  if (plans.length === 0) throw new Error('guesthouse-miyakojima: no plans in the engine plan list (layout changed?)');
  const months = monthsFrom(today, HORIZON_MONTHS);
  const sets: GhmPlanDays[] = [];
  for (const room of [...new Set(plans.map(p => p.room).filter((r): r is string => !!r))].sort()) {
    const multi = plans.find(p => p.room === room && p.kind === 'multi') ?? plans.find(p => p.room === room && p.kind === 'standard');
    const early = plans.find(p => p.room === room && p.kind === 'early');
    if (!multi) { ctx?.note(`room ${room}: no standard / consecutive-night plan`); continue; }
    for (let guests = 1; guests <= multi.maxGuests; guests++) {
      // near months from the consecutive-night plan until a month without offered days, then the early-bird plan
      let plan: GhmPlan | undefined = multi;
      for (const [y, m] of months) {
        if (!plan) break;
        let cal = parseGhmCalendar(await page(ghmCalendarUrl(plan.id, guests, y, m)));
        if (cal.year !== y || cal.month !== m) throw new Error(`guesthouse-miyakojima: asked ${y}-${m}, engine showed ${cal.year}-${cal.month}`);
        if (!cal.perAdult) ctx?.note(`plan ${plan.id} ${y}-${m}: legend "大人1名の単価" missing (price basis unchecked)`);
        if (!cal.days.some(offered) && plan === multi && early) {
          plan = early;
          cal = parseGhmCalendar(await page(ghmCalendarUrl(plan.id, guests, y, m)));
        }
        if (!cal.days.some(offered)) {
          if (plan === early || !early) break;
        }
        sets.push({ plan, guests, days: cal.days });
      }
    }
  }
  const slots = buildGhmSlots(sets, today);
  if (slots.length === 0) ctx?.note('booking engine offers no dates in the next months (price on request)');
  return slots;
}

// --- content -----------------------------------------------------------------------------------
const FEATURE_EN: Array<[RegExp, string]> = [
  [/トイレ|ウォシュレット/, 'private toilet (washlet)'], [/バス/, 'private bathroom with bathtub'], [/エアコン/, 'air conditioning'],
  [/テレビ/, 'TV'], [/冷蔵庫/, 'fridge'], [/扇風機/, 'fan'], [/ケトル/, 'kettle'],
];
function roomFeatures(dd: string): string[] {
  return dd.split(/[・、]/).map(s => s.trim()).filter(Boolean)
    .map(s => FEATURE_EN.find(([re]) => re.test(s))?.[1] ?? s)
    .filter((v, i, a) => a.indexOf(v) === i);
}

export function parseGhmRooms(html: string): ContentRoom[] {
  const out: ContentRoom[] = [];
  for (const el of parse(html).querySelectorAll('.room01')) {
    const h = collapse(zen(el.querySelector('h4')?.text ?? ''));
    const letter = h.match(/個室\s*([A-Z])/)?.[1];
    if (!letter) continue;
    const dts = el.querySelectorAll('dt').map(x => collapse(x.text));
    const dds = el.querySelectorAll('dd').map(x => collapse(zen(x.text)));
    const field = (re: RegExp) => dds[dts.findIndex(t => re.test(t))] ?? '';
    const guests = field(/受入人数/).replace(/名/g, '').replace(/~/g, '-');
    const shared = /共用|別/.test(h);
    out.push({
      name: GHM_ROOM_NAMES[letter] ?? `Private room ${letter}`,
      description: letter === 'A'
        ? `Twin room of about 8 tatami (14 m2) with its own bath and toilet, ${guests || '1-2'} guests; two single beds, non-smoking, dogs allowed.`
        : `Single room with shared shower room and toilet${/エキストラベッド/.test(el.text) ? ' (an extra bed for a second guest on request)' : ''}, non-smoking.`,
      features: [
        ...(shared ? ['shared shower and toilet (outdoor shower for coming back from the sea)'] : []),
        ...roomFeatures(field(/設備/)).filter(f => !(shared && /toilet|bath/.test(f))),
        field(/アメニティ/) ? 'towels and amenities' : null,
      ].filter((x): x is string => !!x),
    });
  }
  return out;
}

export interface MairPrices { taster: number | null; master: number | null; masterDays: number | null; private: number | null; kiteDay: number | null; boardDay: number | null; taxExcluded: boolean }

export function parseMairPrices(schoolHtml: string, rentalHtml: string): MairPrices {
  const s = textLines(schoolHtml).join('\n');
  const r = textLines(rentalHtml).join('\n');
  const after = (t: string, re: RegExp) => { const m = t.match(re); return m ? parseAmount(m[1]) : null; };
  return {
    taster: after(s, /カイト操作体験コース[\s\S]{0,120}?[￥¥\\]\s*([\d,]+)/),
    master: after(s, /マスターコース\s*\n[\s\S]{0,120}?[￥¥\\]\s*([\d,]+)/),
    masterDays: (() => { const m = s.match(/マスターコース[\s\S]{0,40}?(\d+)日間/); return m ? Number(m[1]) : null; })(),
    private: after(s, /プライベートレッスン[\s\S]{0,80}?[￥¥\\]\s*([\d,]+)/),
    kiteDay: after(r, /カイト\s*\n\s*1日\s*([\d,]+)円/),
    boardDay: after(r, /ボード\s*\n\s*1日\s*([\d,]+)円/),
    taxExcluded: /税別/.test(schoolHtml) && /税別/.test(rentalHtml),
  };
}

const yen = (n: number | null) => (n === null ? null : `JPY ${n.toLocaleString('en-US')}`);

export interface GhmPages { home: string; facilities: string; kite: string; price: string; school: string; rental: string; plans: string }

export function parseGhmContent(p: GhmPages): OfferContent {
  const home = textLines(p.home);
  if (!/カイトボードショップ/.test(home.join(' ')) || !/カイトボード/.test(textLines(p.kite).join(' '))) {
    throw new Error('guesthouse-miyakojima: kite shop / kiteboard text missing on the guesthouse site (site changed?)');
  }
  const rooms = parseGhmRooms(p.facilities);
  const plans = parseGhmPlans(p.plans);
  const mair = parseMairPrices(p.school, p.rental);
  const std = plans.filter(x => x.kind === 'standard' && x.fromPrice !== null);
  const from = std.length ? Math.min(...std.map(x => x.fromPrice!)) : null;
  const priceTaxIncl = /税込/.test(textLines(p.price).join(' '));
  const embed = p.home.match(/!2d(\d+\.\d+)!3d(\d+\.\d+)/);
  const coords = embed ? { lat: Number(embed[2]), lng: Number(embed[1]) } : null;
  const video = p.home.match(/<source src="([^"]+\.mp4)"/)?.[1];
  const tax = mair.taxExcluded ? ', excluding tax' : '';

  const lessonBits = [
    mair.taster ? `a kite-control taster (${yen(mair.taster)}, 1-2 hours)` : null,
    mair.master ? `a ${mair.masterDays ?? 4}-day master course up to the water start (${yen(mair.master)} with gear and wetsuit)` : null,
    mair.private ? `private lessons (${yen(mair.private)} per day)` : null,
  ].filter(Boolean);
  const summary = [
    `Guesthouse Miyakojima is a small guesthouse in a renovated old Miyako house in the sugar-cane village of Yonaha in Shimoji, Miyakojima, run by an owner couple who also run M-air, the island's kiteboard shop at the same address.`,
    `It has private rooms only (a twin room with its own bath and a single room with shared shower), a shared living room and kitchen for self-catering and an outdoor shower for coming back from the sea${from ? `; rooms from ${yen(from)} per person per night, tax included, in its online booking system` : ''}.`,
    `M-air offers ${lessonBits.length ? lessonBits.join(', ') : 'beginner to advanced kite lessons'}${mair.kiteDay ? ` and rents kites (${yen(mair.kiteDay)} per day) and boards${mair.boardDay ? ` (${yen(mair.boardDay)})` : ''} to experienced riders` : ''}${tax}; the spots are 5 to 20 minutes from the shop and the wind blows mainly in autumn and winter.`,
  ].join(' ');

  const imgs = [
    ...imageCandidates(p.home, GHM_HOME_URL),
    ...imageCandidates(p.kite, GHM_KITE_URL),
    ...imageCandidates(p.facilities, GHM_FACILITIES_URL),
    ...imageCandidates(p.school, MAIR_SCHOOL_URL),
    ...imageCandidates(p.price, GHM_PRICE_URL),
  ].filter(u => /\.(jpe?g|png|webp)(\?|$)/i.test(u))
    .filter(u => !/logo|bana|planbana|icon|backto|yadosagashi|topai|cho01|\/il\d+\//i.test(u))
    .filter(u => /^https:\/\/(g-miyakojima|m-air-kite)\.com\//.test(u)); // own sites only (the plan-list RSS embeds engine images)

  return {
    kind: 'accommodation',
    title: 'Guesthouse Miyakojima + M-air Kiteboard Shop',
    summary,
    continent: 'Asia',
    country: 'Japan',
    region: 'Miyako Islands, Okinawa',
    spot: 'Shimoji Yonaha, Miyakojima',
    spotCoords: coords,
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: ['Private room (room only)', 'Shared kitchen and living room', 'Free tea and coffee', 'Wi-Fi'],
    optionalServices: [
      mair.taster ? `M-air kite-control taster (${yen(mair.taster)}${tax})` : null,
      mair.master ? `M-air ${mair.masterDays ?? 4}-day master course (${yen(mair.master)}${tax}, gear included)` : null,
      mair.private ? `M-air private lesson (${yen(mair.private)} per day${tax})` : null,
      mair.kiteDay ? `Kite rental for experienced riders (${yen(mair.kiteDay)} per day${tax})` : null,
      mair.boardDay ? `Board rental (${yen(mair.boardDay)} per day${tax})` : null,
      'Spot guide for visiting riders (M-air)',
      'Kite gear storage between trips (M-air)',
      'Bicycle, scooter and rental car arranged by the guesthouse',
      'Airport transfer from Miyako Airport (paid)',
      'Laundry (coin)',
    ].filter((x): x is string => !!x),
    accommodation: 'renovated old Miyako house, private rooms only',
    mealPlan: 'self_catering',
    languages: ['ja', 'en'], // site, engine plans and M-air partly bilingual; spoken English inferred
    rooms,
    imageUrls: [...new Set(imgs)].slice(0, 25),
    heroVideoUrl: video ? new URL(video, GHM_HOME_URL).toString() : null,
    sourceUrl: GHM_HOME_URL,
    bookingUrl: GHM_PLANS_URL,
    sourceText: [
      home.join('\n'),
      `--- price.html (tax included: ${priceTaxIncl})`, textLines(p.price).slice(0, 40).join('\n'),
      '--- M-air school', textLines(p.school).join('\n'),
      '--- M-air rental', textLines(p.rental).join('\n'),
      `--- engine plans: ${plans.map(x => `#${x.id} ${x.kind} room ${x.room} max ${x.maxGuests} min ${x.minNights}n from JPY ${x.fromPrice}`).join(' | ')}`,
    ].join('\n'),
  };
}

export const guesthouseMiyakojimaMAirKite: OfferAdapter = {
  key: 'guesthouse-miyakojima-m-air-kite',
  name: 'Guesthouse Miyakojima + M-air Kiteboard Shop',
  kind: 'accommodation',
  operator: {
    name: 'Guesthouse Miyakojima / M-air',
    websiteUrl: GHM_HOME_URL,
    rootDomain: 'g-miyakojima.com',
    contactEmail: 'yonaha233mair@yahoo.co.jp', // business address printed in the site footer
    phone: '+81980762330',
  },
  url: GHM_HOME_URL,
  slotMethod: 'booking_engine',
  liveAvailability: true,
  instantBooking: true,
  fetchBudget: 24,
  async fetchContent() {
    const [home, facilities, kite, price, school, rental, plans] = await Promise.all(
      [GHM_HOME_URL, GHM_FACILITIES_URL, GHM_KITE_URL, GHM_PRICE_URL, MAIR_SCHOOL_URL, MAIR_RENTAL_URL, GHM_PLANS_URL].map(page),
    );
    return parseGhmContent({ home, facilities, kite, price, school, rental, plans });
  },
  fetchSlots: ctx => fetchGhmSlots(todayIso(), ctx),
};
