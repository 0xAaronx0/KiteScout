// ---------------------------------------------------------------------------
// AIRJUNK kite stay at Sakai Beach, Tokoname (Aichi, Japan) - the Tokai kiteboarding pro shop (open since 2000, "the first
// in the Chubu region") teaches at two shallow Ise Bay kite beaches: Sakai Beach in Tokoname ("行政公認の常滑市坂井ビーチ",
// the city backs kiteboarding) and the Kawagoe kite beach (Mie). At Sakai Beach "当店施設もビーチフロントにあります": a
// beachfront facility with indoor hot showers, changing / rest space, gear wash and drying area, 50+ parking spaces,
// and "宿泊も特別なカイトボーダー割引価格で泊っていただけます" - kiteboarders can stay overnight at a discount:
// "素泊まり４０００円（税別）" / "朝食付き４５００円（税別）". Kind 'accommodation' (the stay; the school's courses are
// optional services). No stay + course package is printed, so no separate 'camp' adapter.
//
// Data path (checked 2026-10-21): a JustSystems Homepage Builder site, http only (https serves a *.sakura.ne.jp
// certificate that does not match airjunk.jp -> TLS fails). Only /kiteschool.html is used:
//   - it is UTF-8 (meta charset UTF-8) and carries everything: closure notice, beaches, facility, stay prices,
//     course menu, contact. The home page and /access.html are Shift_JIS; fetchText decodes as UTF-8, so their
//     Japanese text is unreadable through the shared fetch layer -> not used (the home page repeats the closure
//     notice; /access.html only has Google My Maps viewport centres, not pins).
//   slots    two undated slots from the stay lines: room only / with breakfast, JPY as printed, TAX EXCLUDED (税別),
//            priceUnit 'per_night'; priceBasis 'person' is INFERRED (Japanese lodging convention; the page does not say
//            per person or per room); availability 'on_request' (phone / e-mail / LINE, no engine).
//   content  the same page, NFKC-normalised (full-width digits): course menu (■プライベートコース 69,000円（税込）,
//            ■１日コース 25,000円, ■３日間コース 69,000円, ■7日間完全マスターコース 145,000円, all 税込, gear included),
//            wetsuit rental, view bath / parking fees at Sakai, the closure notice "２０２６年スクール予約は受付中止しました。
//            ２０２７年２月より受付再開します" -> optional services and summary say school bookings are closed until
//            February 2027. The stay itself is NOT said to be closed (the notice names the school only).
//   photos   <img> on the page before the customer-voice section ("お客様の声": customer portraits), jpg only, minus
//            flyers, buttons, staff / LINE QR images and brand stock (Liquid Force / Tona wallpapers). Photos are small
//            (about 610 px wide as displayed).
// robots.txt (2026-10-21): http://airjunk.jp/robots.txt is a 404 -> everything allowed.
// Requests per run: 1 (/kiteschool.html, memoised for content + slots).
// Known limits / doubts: the facility looks like a beachfront building with a 5th-floor view bath (JPY 500) whose name
//   the page does not give (shop-owned or a partner lodging is unclear); "per person" is inferred; the page lists the
//   private lesson twice with different prices (69,000 in the menu, 66,000 lower down) -> the menu value is used; no
//   coordinates on the site -> spot "Sakai Beach" + spotCoords from OSM (the coast of the Sakai quarter, set by the lead).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse, parseAmount, todayIso } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'http://airjunk.jp';
export const AJ_SCHOOL_URL = `${SITE}/kiteschool.html`;

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

/** Page text as NFKC-normalised lines (full-width digits and brackets become ASCII). */
export function ajLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript')) el.remove();
  return (root.querySelector('body') ?? root).structuredText.normalize('NFKC').split('\n').map(s => collapse(s)).filter(Boolean);
}

export interface AjStay { price: number; tax: 'excluded' | 'included' | null }
export interface AjCourse { key: string; name: string; price: number; days: number | null }
export interface AjSchool {
  roomOnly: AjStay | null;
  breakfast: AjStay | null;
  /** "2026年スクール予約は受付中止" -> 2026 */
  closedYear: number | null;
  /** "2027年2月より受付再開" -> "2027-02" */
  reopens: string | null;
  courses: AjCourse[];
  wetsuit: number | null;
  viewBath: number | null;
  parking: number | null;
  beachfront: boolean;
  kawagoe: boolean;
}

const COURSES: Array<{ key: string; re: RegExp; name: string; days: number | null }> = [
  { key: 'private', re: /■\s*プライベートコース/, name: 'Private lesson (2 h, one-on-one)', days: null },
  { key: '1-day', re: /■\s*1日コース/, name: '1-day course (13:00-16:00, max 3 per instructor)', days: 1 },
  { key: '3-day', re: /■\s*3日間コース/, name: '3-day course (3 h x 3 days, valid 2 years)', days: 3 },
  { key: '7-day', re: /■\s*7日間完全マスターコース/, name: '7-day master course (3 h x 7 days, free extension until the curriculum level is reached)', days: 7 },
];

const stay = (t: string, label: RegExp): AjStay | null => {
  const m = t.match(new RegExp(`${label.source}\\s*([\\d,]+)\\s*円\\s*\\(?\\s*(税別|税抜|税込)?`));
  if (!m) return null;
  const price = parseAmount(m[1]);
  return price ? { price, tax: m[2] === '税込' ? 'included' : m[2] ? 'excluded' : null } : null;
};

export function parseAjSchool(html: string): AjSchool {
  const t = ajLines(html).join('\n');
  const courses: AjCourse[] = [];
  for (const c of COURSES) {
    const i = t.search(c.re);
    if (i < 0) continue;
    const m = t.slice(i, i + 220).match(/([\d,]{4,})\s*円\s*\(税込\)/);
    const price = m ? parseAmount(m[1]) : null;
    if (price) courses.push({ key: c.key, name: c.name, price, days: c.days });
  }
  const closed = t.match(/(20\d{2})年\s*スクール予約は\s*受付中止/);
  const reopen = t.match(/(20\d{2})年\s*(\d{1,2})月より\s*受付再開/);
  const wet = t.match(/ウエットスーツをお持ちでない方に\s*([\d,]+)円/);
  const bath = t.match(/展望風呂\s*([\d,]+)円/);
  const park = t.match(/駐車代金\s*\(一日\)\s*([\d,]+)円/);
  return {
    roomOnly: stay(t, /素泊まり/),
    breakfast: stay(t, /朝食付き/),
    closedYear: closed ? Number(closed[1]) : null,
    reopens: reopen ? `${reopen[1]}-${reopen[2].padStart(2, '0')}` : null,
    courses,
    wetsuit: wet ? parseAmount(wet[1]) : null,
    viewBath: bath ? parseAmount(bath[1]) : null,
    parking: park ? parseAmount(park[1]) : null,
    beachfront: /坂井ビーチ/.test(t) && /ビーチフロント/.test(t),
    kawagoe: /川越\s*カイトビーチ/.test(t),
  };
}

/** True while the page's closure notice still applies (today before the reopening month). */
export function ajSchoolClosed(s: AjSchool, today: string): boolean {
  return !!s.closedYear && (s.reopens ? today.slice(0, 7) < s.reopens : true);
}
const monthName = (ym: string): string => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function buildAjSlots(s: AjSchool, today: string): Slot[] {
  const closedNote = ajSchoolClosed(s, today)
    ? `; the school's ${s.closedYear} bookings are closed${s.reopens ? ` until ${monthName(s.reopens)}` : ''} (the stay is not said to be closed)`
    : '';
  const out: Slot[] = [];
  for (const [key, st, unit, jp] of [
    ['room-only', s.roomOnly, 'Kiteboarder stay, room only', '素泊まり'],
    ['breakfast', s.breakfast, 'Kiteboarder stay with breakfast', '朝食付き'],
  ] as const) {
    if (!st) continue;
    out.push({
      key: `stay|${key}`,
      startDate: null,
      endDate: null,
      unit,
      price: st.price,
      currency: 'JPY',
      priceUnit: 'per_night',
      priceBasis: 'person', // inferred: the page does not say per person or per room
      occupancy: null,
      availability: 'on_request',
      availabilityText: `"${jp} ${st.price}円${st.tax === 'excluded' ? '(税別)' : st.tax === 'included' ? '(税込)' : ''}" = ${yen(st.price)}${st.tax === 'excluded' ? ' plus tax (tax excluded)' : st.tax === 'included' ? ' incl. tax' : ''}, kiteboarder discount rate at the beachfront facility on Sakai Beach; booking by phone, e-mail or LINE${closedNote}`,
      spotsLeft: null,
    });
  }
  return out;
}

export async function fetchAjSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const s = parseAjSchool(await page(AJ_SCHOOL_URL));
  if (!s.beachfront) throw new Error('airjunk: Sakai Beach beachfront facility no longer on /kiteschool.html (layout changed?)');
  const slots = buildAjSlots(s, today);
  if (slots.length === 0) ctx?.note('no stay price (素泊まり / 朝食付き) on /kiteschool.html; price on request');
  return slots;
}

/** Page photos before the customer-voice section, jpg only, without flyers, buttons, staff / LINE images, brand stock. */
export function ajImages(html: string): string[] {
  const cut = html.indexOf('お客様の声');
  const part = cut > 0 ? html.slice(0, cut) : html;
  const out: string[] = [];
  for (const m of part.matchAll(/<img[^>]+src="([^"]+)"/gi)) {
    const src = m[1].trim();
    if (!/\.jpe?g$/i.test(src)) continue;
    if (/mori|line|e-mail|button|dvd|album|大会|ふちなし|キャプチャ|イベント|tona-kiteboarding|liquid-force|wallpaper|desktop|^S__/i.test(src)) continue;
    const u = new URL(src, AJ_SCHOOL_URL).toString();
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export function parseAirjunkContent(html: string, today: string): OfferContent {
  const s = parseAjSchool(html);
  if (!s.beachfront) throw new Error('airjunk: Sakai Beach beachfront facility no longer on /kiteschool.html (layout changed?)');
  const closed = ajSchoolClosed(s, today);
  const closedText = closed ? ` (school bookings for ${s.closedYear} closed${s.reopens ? `, reopening ${monthName(s.reopens)}` : ''})` : '';
  const c = (k: string) => s.courses.find(x => x.key === k);
  const courseLine = ['1-day', '3-day', '7-day'].map(k => c(k)).filter((x): x is AjCourse => !!x)
    .map(x => `${x.days === 1 ? '1 day' : `${x.days} days`} ${yen(x.price)}`).join(', ');
  const stays = [s.roomOnly && `${yen(s.roomOnly.price)} room only`, s.breakfast && `${yen(s.breakfast.price)} with breakfast`].filter(Boolean).join(' or ');
  const taxWord = s.roomOnly?.tax === 'excluded' ? ' (tax excluded)' : '';

  const summary = [
    `AIRJUNK, a kiteboarding pro shop and school in Tokai (Aichi) in its 25th year, teaches on the shallow, wave-free beaches of Ise Bay: Sakai Beach in Tokoname${s.kawagoe ? ' and the Kawagoe kite beach in Mie' : ''}.`,
    `At Sakai Beach the shop's beachfront facility has indoor hot showers, space to change and rest and a gear wash and drying area, and kiteboarders can stay overnight at a discounted rate${stays ? `: ${stays} per night${taxWord}` : ''}.`,
    courseLine ? `Kite courses cost ${courseLine} (tax included, gear included).` : '',
    closed
      ? `The school says its ${s.closedYear} bookings are closed and reopen in ${s.reopens ? monthName(s.reopens) : 'the next season'}; the stay is not mentioned as closed. Booking by phone, e-mail or LINE.`
      : 'Booking by phone, e-mail or LINE.',
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'AIRJUNK Kiteboarder Stay at Sakai Beach, Tokoname',
    summary,
    continent: 'Asia',
    country: 'Japan',
    region: 'Tokoname, Aichi',
    spot: 'Sakai Beach',
    // the Ise Bay shore of the Sakai quarter, Tokoname (OSM coastline nearest to the quarter, 2026-10-21); the geocoder
    // finds no beach of that name and would risk Sakai, Osaka
    spotCoords: { lat: 34.8186, lng: 136.864 },
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      'Indoor hot showers at the beachfront facility',
      'Changing and rest space',
      'Gear wash and drying area',
    ],
    optionalServices: [
      ...(s.breakfast ? [`Breakfast (stay with breakfast ${yen(s.breakfast.price)} per night${s.breakfast.tax === 'excluded' ? ', tax excluded' : ''})`] : []),
      ...s.courses.map(x => `${x.name}: ${yen(x.price)} incl. tax, gear included${closedText}`),
      ...(s.wetsuit ? [`Wetsuit rental ${yen(s.wetsuit)} per day`] : []),
      ...(s.viewBath ? [`View bath on the 5th floor ${yen(s.viewBath)}`] : []),
      ...(s.parking ? [`Parking at Sakai Beach ${yen(s.parking)} per day`] : []),
    ],
    accommodation: 'beachfront kiteboarder lodging at the shop\'s Sakai Beach facility',
    mealPlan: 'breakfast optional',
    languages: ['ja'],
    rooms: [],
    imageUrls: ajImages(html).slice(0, 24),
    heroVideoUrl: null,
    sourceUrl: AJ_SCHOOL_URL,
    bookingUrl: AJ_SCHOOL_URL,
    sourceText: [
      `kiteschool: ${ajLines(html).join('\n')}`,
      `parsed: stay ${JSON.stringify(s.roomOnly)} / ${JSON.stringify(s.breakfast)}; closed ${s.closedYear} reopens ${s.reopens}; courses ${s.courses.map(x => `${x.key} ${x.price}`).join(', ')}`,
    ].join('\n'),
  };
}

export const airjunkTokoname: OfferAdapter = {
  key: 'airjunk-tokoname',
  name: 'AIRJUNK Kiteboarder Stay at Sakai Beach, Tokoname',
  kind: 'accommodation',
  operator: {
    name: 'AIRJUNK (Kiteboarding Pro Shop)',
    websiteUrl: `${SITE}/`,
    rootDomain: 'airjunk.jp',
    contactEmail: 'info@airjunk.jp', // printed on the site
    phone: '+819091294334', // the shop manager's mobile, printed as the booking line (13:00-19:00)
  },
  url: AJ_SCHOOL_URL,
  slotMethod: 'price_table',
  instantBooking: false, // phone / e-mail / LINE / form request, no online checkout
  fetchBudget: 2,
  confidence: 'medium', // per-person basis inferred, facility not named
  async fetchContent() {
    return parseAirjunkContent(await page(AJ_SCHOOL_URL), todayIso());
  },
  fetchSlots: ctx => fetchAjSlots(todayIso(), ctx),
};
