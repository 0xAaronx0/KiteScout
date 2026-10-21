// ---------------------------------------------------------------------------
// KITECLUB Okinawa Kumejima Tour (Okinawa, Japan) - the Naha kite school's yearly spring trip to Kumejima: return
// flights Naha - Kumejima, 2 nights hotel with breakfast, transfers + rental car and a boat charter on all three days
// to the uninhabited Hatenohama sandbar for riding. Riders only ("only those who can go upwind", safety / rescue).
// Kind 'tour' (flight + island + daily boat trips; itinerarySpots Naha -> Kumejima -> Hatenohama).
// This file also holds the shared KITECLUB tour-post parser and trip-report photo helper used by
// kiteclub-okinawa-kohama-kite-tour.ts.
//
// Data path (checked 2026-10-19): WordPress, server-rendered, Japanese only.
//   index    /category/info/tours/ - the "ツアー" (tours) blog category. Page 1 prints the newest ~18 posts IN FULL
//            (<article class="clearfix">: <h2><a href=post>title</a></h2>, <p class="postcat">YYYY年M月D日│...,
//            <div class="entry">), so one request gives the newest announcement AND the previous edition.
//            A tour's announcement = newest post whose title names the place ("久米島") and whose body has the
//            "＜日程＞" (schedule) block; trip reports ("漫喫してきました", "DAY1") have none. When the 2028
//            edition is announced it appears on page 1 and is picked up automatically.
//   slots    the announcement's schedule line "・4月2(金)-3(日) 2泊3日" + year from the title "久米島ツアー2027/4/2(金)-4(日)"
//            (the 2027 post's schedule line says "-3(日)" but "2泊3日" and the title say 2-4 Apr; we compute the
//            end as start + nights). Room-type price lines "・3-4名1室(スタンダードルーム)：￥00000-" -> one slot per
//            date x room type, JPY, priceUnit 'package', priceBasis 'person' (inferred: Japanese tour convention,
//            "3-4 persons per room" pricing; the post does not say "per person"). "￥00000-" is the site's
//            placeholder ("料金決まり次第更新いたします" = prices follow) -> price null; the previous edition's prices
//            go into availabilityText as "last edition". Availability 'on_request' (apply by replying with full
//            name and age; "参加人数に限りあり" = limited places is generic, no count). Past dates are dropped.
//   content  the same announcement (inclusions, hotel, rules) + the previous edition (prices) from the index.
//   photos   (2026-10-21) the 2021+ Kumejima posts are text / YouTube only, so photos come from the operator's own
//            older Kumejima posts via the WordPress REST search /wp-json/wp/v2/posts?search=久米島 (per_page 50: all
//            56 matches back to 2013 minus the oldest, small ones): trip reports 2017-2019 (Hatenohama sandbar,
//            kiting, charter boat, groups) and the 2016-2020 announcements, which here carry real photos of the
//            previous trip (group at the Eef Beach Hotel, sandbar kiting), not screenshots. General event-plan posts
//            ("予定" / "情報") are skipped, max 3 photos per post, duplicates re-uploaded under the same file name
//            (IMG_8519, P4080354) or as "...-コピー" (copy) are dropped, newest 14 kept (2013-2015 photos are small or
//            hotel / dinner shots). Shared helper parseKcoReportImages.
// robots.txt (2026-10-19): only /wp-admin/ disallowed.
// Requests per run: 1 for slots (the index page, memoised across content + slots and shared with the Kohama
//   adapter), +1 for content (the REST search for the photos).
// Known limits / doubts: the photos are 2016-2020 editions (same sandbar, older hotel in some years). No
//   spotCoords (none on the site). The 2027 hotel is "Eef Beach Hotel" (changed from 2026).
// ---------------------------------------------------------------------------
import { fetchJson, fetchText } from '../http.js';
import { collapse, iso, parse, parseAmount, todayIso, type HTMLElement } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';

export const KCO_SITE = 'https://kiteclub-okinawa.biz';
export const KCO_TOURS_URL = `${KCO_SITE}/category/info/tours/`;
export const KCO_CONTACT_URL = `${KCO_SITE}/contact/`;

export const KCO_OPERATOR: OperatorRef = {
  name: 'KITECLUB Okinawa',
  websiteUrl: `${KCO_SITE}/`,
  rootDomain: 'kiteclub-okinawa.biz',
  phone: '+81988510180',
};

const memo = new Map<string, { at: number; p: Promise<string> }>();
export function kcoPage(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

// --- shared KITECLUB tour-post parser -------------------------------------------------------------
export interface KcoPost {
  id: number;
  url: string;
  title: string;
  /** posting date (YYYY-MM-DD) from "2026年10月15日│" */
  posted: string | null;
  lines: string[];
  images: string[];
}

function zen2han(s: string): string {
  return s.replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
}

/** All full posts printed on a KITECLUB category page. */
export function parseKcoPosts(html: string): KcoPost[] {
  const root = parse(html);
  const out: KcoPost[] = [];
  for (const a of root.querySelectorAll('article')) {
    const link = a.querySelector('h2 a[href*="/info/blog/"]');
    const href = link?.getAttribute('href');
    const id = href?.match(/\/info\/blog\/(\d+)\//);
    if (!link || !href || !id) continue;
    const cat = collapse(a.querySelector('.postcat')?.text ?? '');
    const pd = cat.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/);
    const entry: HTMLElement = a.querySelector('.entry') ?? a;
    for (const el of entry.querySelectorAll('script, style, noscript, iframe, .addtoany_share_save_container')) el.remove();
    const images = entry.querySelectorAll('img')
      .map(i => i.getAttribute('src') ?? '')
      .filter(s => /\/wp-content\/uploads\//.test(s) && !/btn_|logo/i.test(s))
      // WordPress size suffix -> original upload
      .map(s => s.replace(/-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp)$)/i, ''));
    out.push({
      id: Number(id[1]),
      url: href,
      title: collapse(link.text),
      posted: pd ? iso(+pd[1], +pd[2], +pd[3]) : null,
      lines: entry.structuredText.split('\n').map(s => collapse(zen2han(s))).filter(Boolean),
      images: [...new Set(images)],
    });
  }
  return out;
}

/** Announcement posts for a place (title names it, body has the "＜日程＞" schedule block), newest first. */
export function kcoAnnouncements(posts: KcoPost[], place: RegExp): KcoPost[] {
  return posts
    .filter(p => place.test(p.title) && p.lines.some(l => /日程/.test(l)))
    .sort((a, b) => b.id - a.id);
}

export interface KcoDeparture {
  start: string;
  end: string;
  nights: number;
  /** price printed on the schedule line itself ("4泊5日 ￥63,000-") */
  price: number | null;
  label: string;
}
export interface KcoRoomPrice { key: string; unit: string; persons: string; price: number | null }
export interface KcoTour {
  year: number | null;
  departures: KcoDeparture[];
  rooms: KcoRoomPrice[];
  /** lines under "料金には下記が含まれます" (what the price includes), as printed */
  inclusions: string[];
  /** the "※" notes */
  notes: string[];
}

function addDays(isoDate: string, n: number): string {
  return new Date(Date.parse(isoDate) + n * 86400000).toISOString().slice(0, 10);
}

/** Year of the tour: "久米島ツアー2027/4/2", "2026年10月小浜島ツアー"; else the posting year (rolled when the month is earlier). */
export function kcoTourYear(p: KcoPost, firstMonth: number | null): number | null {
  const t = zen2han(p.title);
  const m = t.match(/(20\d{2})\s*[/年]/) ?? t.match(/(20\d{2})/);
  if (m) return Number(m[1]);
  if (!p.posted) return null;
  const y = Number(p.posted.slice(0, 4));
  const pm = Number(p.posted.slice(5, 7));
  return firstMonth !== null && firstMonth < pm ? y + 1 : y;
}

const ROOM_NAMES: Array<[RegExp, string, string]> = [
  [/スタンダード/, 'standard', 'Standard room'],
  [/ツイン/, 'twin', 'Twin room'],
  [/シングル/, 'single', 'Single use'],
  [/ダブル/, 'double', 'Double room'],
  [/トリプル/, 'triple', 'Triple room'],
];

export function parseKcoTour(p: KcoPost): KcoTour {
  const depRe = /(\d{1,2})月(\d{1,2})日?\s*(?:\([^)]*\))?\s*[-~〜～－ー]\s*(?:(\d{1,2})月)?(\d{1,2})日?\s*(?:\([^)]*\))?\s*(\d{1,2})泊(\d{1,2})日(?:\s*[￥¥]\s*([\d,]+))?/;
  const raw: Array<{ m: number; d: number; nights: number; price: number | null; label: string }> = [];
  const rooms: KcoRoomPrice[] = [];
  const inclusions: string[] = [];
  const notes: string[] = [];
  let inIncl = false;
  for (const l of p.lines) {
    const dm = l.match(depRe);
    if (dm) {
      raw.push({ m: +dm[1], d: +dm[2], nights: +dm[5], price: dm[7] ? parseAmount(dm[7]) : null, label: l.replace(/^・/, '') });
      continue;
    }
    const rm = l.match(/^・?\s*(\d(?:\s*[-~]\s*\d)?)名1室\s*[(（]([^)）]+)[)）]\s*[:：]\s*[￥¥]\s*([\d,]+)/);
    if (rm) {
      const name = ROOM_NAMES.find(([re]) => re.test(rm[2]));
      const key = name?.[1] ?? `room${rooms.length + 1}`;
      if (!rooms.some(r => r.key === key)) {
        rooms.push({ key, unit: name?.[2] ?? rm[2], persons: rm[1].replace(/\s/g, ''), price: parseAmount(rm[3]) });
      }
      continue;
    }
    if (/料金には下記が含まれ/.test(l)) { inIncl = true; continue; }
    if (inIncl && /^[①②③④⑤⑥⑦⑧⑨]/.test(l)) { inclusions.push(l.replace(/^[①②③④⑤⑥⑦⑧⑨]\s*/, '')); continue; }
    if (/^※/.test(l)) notes.push(l.replace(/^※\s*/, ''));
  }
  const year = raw.length ? kcoTourYear(p, raw[0].m) : kcoTourYear(p, null);
  const departures: KcoDeparture[] = [];
  if (year) {
    for (const r of raw) {
      const start = iso(year, r.m, r.d);
      departures.push({ start, end: addDays(start, r.nights), nights: r.nights, price: r.price, label: r.label });
    }
  }
  return { year, departures, rooms, inclusions, notes };
}

/** "JPY 58,000 standard room (3-4 per room) / 68,000 twin / 78,000 single use" for a priced edition. */
export function kcoPriceText(t: KcoTour): string | null {
  const priced = t.rooms.filter(r => r.price !== null);
  if (priced.length) return `JPY ${priced.map(r => `${r.price!.toLocaleString('en-US')} ${r.unit.toLowerCase()} (${r.persons} per room)`).join(' / ')} per person`;
  const deps = t.departures.filter(d => d.price !== null);
  if (deps.length) return `JPY ${deps.map(d => `${d.price!.toLocaleString('en-US')} for ${d.nights} nights`).join(' / ')} per person`;
  return null;
}

const INCLUDED: Array<[RegExp, (l: string) => string]> = [
  [/飛行機/, () => 'Return flights Naha - Kumejima'],
  [/乗船券|フェリー|船/, () => 'Return ferry Ishigaki - Kohama'],
  [/イーフビーチホテル/, () => 'Hotel nights at Eef Beach Hotel, breakfast included'],
  [/ウォーターマーク/, () => 'Hotel nights at Watermark Hotel Okinawa Kume Island, breakfast included'],
  [/パナパナ|panapana/i, () => 'Nights at the guesthouse Kohama no Yado panapana, breakfast included'],
  [/宿泊/, () => 'Accommodation with breakfast'],
  [/ボートチャーター/, l => `Boat charter${/(\d)日間/.test(l) ? ` (${l.match(/(\d)日間/)![1]} days)` : ''}`],
  [/送迎.*レンタカー|レンタカー.*送迎/, () => 'Transfers and rental car'],
  [/レンタカー/, l => `Rental car${/ガソリン/.test(l) ? ' (fuel included)' : ''}`],
  [/アテンド/, () => 'Guiding at the kite spots (spot attendance by the school)'],
];

/** English inclusion list from the printed "①..." lines (unknown lines are kept as printed). */
export function kcoIncluded(t: KcoTour): string[] {
  return t.inclusions.map(l => {
    const hit = INCLUDED.find(([re]) => re.test(l));
    return hit ? hit[1](l) : l;
  });
}

// --- shared KITECLUB trip-report photos (WordPress REST search) --------------------------------------------------
export interface KcoWpPost { id: number; title?: { rendered?: string }; content?: { rendered?: string } }

/** WordPress REST search over the operator's own posts (robots.txt only disallows /wp-admin/). */
export function kcoSearchUrl(term: string, perPage = 30): string {
  return `${KCO_SITE}/wp-json/wp/v2/posts?search=${encodeURIComponent(term)}&per_page=${perPage}&_fields=id,title,content`;
}

/** Announcement / event-plan titles ("開催のお知らせ", "開催決定", "イベント予定", "イベント情報"); everything else naming
 *  the place is a trip report. (A body test for "日程" would drop the 2018 Kohama report, which mentions its schedule.) */
const KCO_ANNOUNCEMENT_TITLE = /お知らせ|開催決定|予定|情報/;
/** General yearly event plans: skipped even when announcements are allowed (their photos can show other events). */
const KCO_EVENT_PLAN_TITLE = /予定|情報/;

export interface KcoReportImageOpts {
  /** photos per post: the vision QC only sees the 10 largest candidates, so a cap keeps that pool mixed across
   *  editions instead of one report's dinner shots (default 3) */
  perPost?: number;
  /** also use tour announcements (not event plans): right where they carry trip photos, wrong where they carry
   *  tide-table / flight screenshots (Kohama 2025/2026) (default false) */
  announcements?: boolean;
  /** drop re-uploads of the same photo: same file name in another month folder, or a "-コピー" (copy) file (default false) */
  dedupe?: boolean;
}

/** Photos from the operator's own posts whose title names the place, newest post first, original uploads. */
export function parseKcoReportImages(posts: KcoWpPost[], place: RegExp, opts: KcoReportImageOpts = {}): string[] {
  const perPost = opts.perPost ?? 3;
  const out: string[] = [];
  const names = new Set<string>();
  for (const p of [...posts].sort((a, b) => b.id - a.id)) {
    const html = p.content?.rendered ?? '';
    const title = p.title?.rendered ?? '';
    if (!place.test(title) || (opts.announcements ? KCO_EVENT_PLAN_TITLE : KCO_ANNOUNCEMENT_TITLE).test(title)) continue;
    const imgs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(m => m[1])
      .filter(s => /\/wp-content\/uploads\//.test(s) && !/btn_|logo/i.test(s))
      .map(s => s.replace(/-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp)$)/i, ''));
    let n = 0;
    for (const u of imgs) {
      if (n >= perPost || out.includes(u)) continue;
      if (opts.dedupe) {
        const name = decodeURIComponent(u.split('/').pop() ?? '').toLowerCase();
        if (/コピー|[-_ ]copy\b/i.test(name) || names.has(name)) continue;
        names.add(name);
      }
      out.push(u);
      n++;
    }
  }
  return out;
}

export function kcoImages(posts: KcoPost[]): string[] {
  const out: string[] = [];
  for (const p of posts) for (const u of p.images) if (!out.includes(u)) out.push(u);
  return out;
}

/** Dated slots: date x room type (or x schedule-line variant); price null where the site prints a placeholder. */
export function buildKcoSlots(t: KcoTour, today: string, lastEdition: { year: number | null; text: string | null } | null, place: string): Slot[] {
  const last = lastEdition?.text ? `; last edition${lastEdition.year ? ` (${lastEdition.year})` : ''}: ${lastEdition.text}` : '';
  const out: Slot[] = [];
  for (const d of t.departures.filter(x => x.start >= today)) {
    const base = {
      startDate: d.start,
      endDate: d.end,
      spotsLeft: null,
      availability: 'on_request' as const,
    };
    if (t.rooms.length) {
      for (const r of t.rooms) {
        out.push({
          ...base,
          key: `${d.start}|${r.key}`,
          unit: `${r.unit} (${r.persons} per room)`,
          price: r.price,
          currency: r.price !== null ? 'JPY' : null,
          priceUnit: r.price !== null ? 'package' : null,
          priceBasis: r.price !== null ? 'person' : null,
          occupancy: /^\d$/.test(r.persons) ? Number(r.persons) : null,
          availabilityText: r.price !== null
            ? `JPY ${r.price.toLocaleString('en-US')} per person, ${place} ${d.nights} nights (${d.start} to ${d.end}); apply by message with full name and age, limited places`
            : `Price not yet published ("prices follow"); ${place} ${d.nights} nights (${d.start} to ${d.end}); apply by message with full name and age, limited places${last}`,
        });
      }
    } else {
      out.push({
        ...base,
        key: `${d.start}|${d.nights}n`,
        unit: `${d.nights} nights / ${d.nights + 1} days`,
        price: d.price,
        currency: d.price !== null ? 'JPY' : null,
        priceUnit: d.price !== null ? 'package' : null,
        priceBasis: d.price !== null ? 'person' : null,
        occupancy: null,
        packageNights: d.nights,
        availabilityText: `${d.price !== null ? `JPY ${d.price.toLocaleString('en-US')} per person` : 'Price not yet published'}, ${place} ${d.nights} nights (${d.start} to ${d.end}); booking by message or phone${d.price === null ? last : ''}`,
      });
    }
  }
  return out;
}

export function kcoDateText(t: KcoTour): string {
  const fmt = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return t.departures.map(d => `${fmt(d.start)} - ${fmt(d.end)} ${d.start.slice(0, 4)} (${d.nights} nights)`).join(', ');
}

// --- Kumejima ----------------------------------------------------------------------------------------
const PLACE = /久米島/;

/** The REST search behind the Kumejima photos (per_page 50 so the 2016-2020 posts stay in the window for years). */
export const KUMEJIMA_REPORTS_URL = kcoSearchUrl('久米島', 50);

/** Newest 14 photos (the 2016-2020 editions today): the 2013-2015 day reports are small or hotel / dinner shots
 *  and, being larger than the 2018 sandbar photos, would crowd the kiting out of the 10-image vision pool. */
export function parseKumejimaReportImages(posts: KcoWpPost[]): string[] {
  return parseKcoReportImages(posts, PLACE, { announcements: true, dedupe: true }).slice(0, 14);
}

export function parseKumejimaContent(indexHtml: string, today: string, reportImages: string[] = []): OfferContent {
  const posts = parseKcoPosts(indexHtml);
  const ann = kcoAnnouncements(posts, PLACE);
  const cur = ann[0];
  if (!cur) throw new Error('kiteclub-kumejima: no Kumejima announcement on the tours index (layout changed?)');
  const t = parseKcoTour(cur);
  const prev = ann.slice(1).map(p => ({ p, t: parseKcoTour(p) })).find(x => kcoPriceText(x.t));
  const prices = kcoPriceText(t);
  const future = t.departures.filter(d => d.start >= today);
  const nights = t.departures[0]?.nights ?? 2;
  const lastText = prev ? `${prev.t.year} edition: ${kcoPriceText(prev.t)}` : null;

  const summary = [
    `KITECLUB Okinawa, the kite school in Tomigusuku near Naha, runs a yearly spring kite trip to Kumejima, west of Okinawa Island: riders fly from Naha in the morning, stay at a beach hotel and go out by charter boat each day to Hatenohama, an uninhabited sandbar off Kumejima.`,
    `The price includes return flights Naha - Kumejima, ${nights} nights with breakfast, transfers and rental car, and the boat charter; only riders who can go upwind can join (safety and rescue).`,
    future.length
      ? `Next trip: ${kcoDateText({ ...t, departures: future })}; ${prices ? `${prices}.` : `prices not yet published${lastText ? ` (${lastText})` : ''}.`}`
      : `Runs every year in spring; next dates not yet published${t.departures.length ? ` (last trip: ${kcoDateText(t)})` : ''}${prices ? `, last prices ${prices}` : lastText ? `; ${lastText}` : ''}.`,
  ].join(' ');

  return {
    kind: 'tour',
    title: 'KITECLUB Okinawa Kumejima Kite Tour (Hatenohama)',
    summary,
    continent: 'Asia',
    country: 'Japan',
    region: 'Kumejima, Okinawa',
    spot: 'Kumejima',
    itinerarySpots: [
      { name: 'Naha', country: 'Japan', region: 'Okinawa Island, Okinawa', order: 1 },
      { name: 'Kumejima', country: 'Japan', region: 'Kumejima, Okinawa', order: 2 },
      { name: 'Hatenohama', country: 'Japan', region: 'Kumejima, Okinawa', order: 3 },
    ],
    durationDays: nights + 1,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: false,
    equipmentRental: true,
    beginnerFriendly: false,
    includedServices: kcoIncluded(t),
    optionalServices: ['Rental gear plan (limited, on request)'],
    accommodation: t.inclusions.some(l => /イーフビーチホテル/.test(l)) ? 'Eef Beach Hotel, Kumejima' : 'beach hotel on Kumejima',
    mealPlan: 'breakfast',
    languages: ['ja'],
    rooms: [],
    imageUrls: [...new Set([...kcoImages(posts.filter(p => PLACE.test(p.title))), ...reportImages])].slice(0, 20),
    heroVideoUrl: null, // YouTube embeds only
    sourceUrl: cur.url,
    bookingUrl: KCO_CONTACT_URL,
    sourceText: [
      `announcement ${cur.url} (${cur.title}, posted ${cur.posted}):`,
      ...cur.lines,
      prev ? `previous edition ${prev.p.url} (${prev.p.title}): ${prev.p.lines.filter(l => /名1室|泊\d日/.test(l)).join(' | ')}` : '',
      `parsed: year ${t.year}; departures ${t.departures.map(d => `${d.start}..${d.end}`).join(', ')}; rooms ${t.rooms.map(r => `${r.key}=${r.price ?? 'TBA'}`).join(', ')}`,
    ].join('\n'),
  };
}

export async function fetchKumejimaSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const posts = parseKcoPosts(await kcoPage(KCO_TOURS_URL));
  if (posts.length === 0) throw new Error('kiteclub-kumejima: no posts on the tours index (layout changed?)');
  const ann = kcoAnnouncements(posts, PLACE);
  if (!ann[0]) throw new Error('kiteclub-kumejima: no Kumejima announcement on the tours index page 1');
  const t = parseKcoTour(ann[0]);
  if (t.departures.length === 0) throw new Error(`kiteclub-kumejima: no schedule line parsed in ${ann[0].url}`);
  const prev = ann.slice(1).map(p => parseKcoTour(p)).find(x => kcoPriceText(x));
  const slots = buildKcoSlots(t, today, prev ? { year: prev.year, text: kcoPriceText(prev) } : null, 'Kumejima tour');
  if (slots.length === 0) ctx?.note(`newest Kumejima announcement (${ann[0].url}) only has past dates; next edition not announced yet`);
  else if (slots.every(s => s.price === null)) ctx?.note('Kumejima dates announced, prices not yet published (placeholder ￥00000-)');
  return slots;
}

export const kiteclubOkinawaKumejimaTour: OfferAdapter = {
  key: 'kiteclub-okinawa-kumejima-tour',
  name: 'KITECLUB Okinawa Kumejima Kite Tour',
  kind: 'tour',
  operator: KCO_OPERATOR,
  url: `${KCO_SITE}/info/blog/13988/`,
  slotMethod: 'html_dates',
  instantBooking: false, // request only (e-mail / phone / message), no online checkout
  fetchBudget: 3,
  confidence: 'medium',
  async fetchContent() {
    const reports = await fetchJson<KcoWpPost[]>(KUMEJIMA_REPORTS_URL);
    return parseKumejimaContent(await kcoPage(KCO_TOURS_URL), todayIso(), parseKumejimaReportImages(reports));
  },
  fetchSlots: ctx => fetchKumejimaSlots(todayIso(), ctx),
};
