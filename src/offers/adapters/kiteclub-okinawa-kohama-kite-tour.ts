// ---------------------------------------------------------------------------
// KITECLUB Okinawa Kohama Island Kite Tour (Yaeyama Islands, Okinawa, Japan) - the Naha kite school's yearly autumn
// trip to Kohama Island for the first north winds ("Mi-nishi"): 3 or 4 nights at the guesthouse Kohama no Yado
// panapana with breakfast, return ferry Ishigaki - Kohama, rental car incl. fuel and the school's guiding at the flat
// water spots (foil and wing possible at the right tide). Meet on site, flights self-arranged. Kind 'camp' (one island,
// stay + guiding as a package; the operator calls it a "tour").
//
// Data path (checked 2026-10-19): the shared KITECLUB tours index (parser in kiteclub-okinawa-kumejima-tour.ts):
//   /category/info/tours/ page 1 prints the newest ~18 tour posts in full. The newest post whose title names
//   "小浜島" (Kohama) and whose body has the "＜日程＞" schedule block is this year's announcement
//   (2026: /info/blog/13191/ "2026年10月小浜島ツアー開催のお知らせ"; 2025: /info/blog/12592/). When the 2027 edition is
//   announced it lands on page 1 of the index and is picked up automatically (newest post id wins).
//   slots    the schedule lines "・10月16日(金)~10月20日(火) 4泊5日 ￥63,000-" / "・10月16日(金)~10月19日(月) 3泊4日
//            ￥53,000-" -> one slot per departure x length, JPY, priceUnit 'package', packageNights 3/4, priceBasis
//            'person' (inferred: Japanese tour convention, the post does not say "per person"); availability
//            'on_request' (booking by message / phone, no inventory). Year from the title ("2026年10月"), else the
//            posting date. Departures that have already started are dropped.
//   content  the announcement (inclusions, guesthouse, notes) + earlier Kohama announcements (dates for the
//            "runs every year" summary).
//   photos   (2026-10-19, Aaron: the stored images were tide-table screenshots) the operator's own Kohama trip reports
//            via the WordPress REST search /wp-json/wp/v2/posts?search=小浜島ツアー: reports 2015-2020 carry real
//            photos (kiting on the reef, the sandbar, beach groups, sunset); 2021+ reports are YouTube-only. Max 3 per
//            report so the 10-image vision pool spans several editions. Photos show the summer "Kachibai" editions
//            on the same island, not the autumn trip specifically.
// robots.txt (2026-10-19): only /wp-admin/ disallowed.
// Requests per run: 1 for slots (the index page, memoised; shared with the Kumejima adapter in the same process),
//   +1 for content (the REST search for the trip-report photos).
// State 2026-10-19: the 2026 edition (16-20 Oct) is running now, so 0 future slots -> price on request until the
//   2027 post appears. Known limits: no spotCoords on the site.
// ---------------------------------------------------------------------------
import { fetchJson } from '../http.js';
import { todayIso } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import {
  KCO_CONTACT_URL, KCO_OPERATOR, KCO_SITE, KCO_TOURS_URL, buildKcoSlots, kcoAnnouncements, kcoIncluded,
  kcoPage, kcoPriceText, parseKcoPosts, parseKcoTour,
} from './kiteclub-okinawa-kumejima-tour.js';

const PLACE = /小浜島/;

/** WordPress REST search over the operator's own posts (robots.txt only disallows /wp-admin/). */
export const KOHAMA_REPORTS_URL = `${KCO_SITE}/wp-json/wp/v2/posts?search=${encodeURIComponent('小浜島ツアー')}&per_page=30&_fields=id,title,content`;
/** Photos per trip report: the vision QC only sees the 10 largest candidates, so a cap keeps that pool mixed across
 *  editions (kiting, sandbar, beach groups) instead of one report's dinner and fishing shots. */
const PHOTOS_PER_REPORT = 3;

interface WpPost { id: number; title?: { rendered?: string }; content?: { rendered?: string } }

/** Announcement / event-plan titles ("開催のお知らせ", "開催決定", "イベント予定", "イベント情報"); everything else naming
 *  Kohama is a trip report. (A body test for "日程" would drop the 2018 report, which mentions its schedule.) */
const ANNOUNCEMENT_TITLE = /お知らせ|開催決定|予定|情報/;

/** Photos from the operator's own Kohama trip reports, newest first, original uploads. The 2025/2026 announcements
 *  only carry tide-table and flight screenshots, so announcement images are not used. */
export function parseKohamaReportImages(posts: WpPost[]): string[] {
  const out: string[] = [];
  for (const p of [...posts].sort((a, b) => b.id - a.id)) {
    const html = p.content?.rendered ?? '';
    const title = p.title?.rendered ?? '';
    if (!PLACE.test(title) || ANNOUNCEMENT_TITLE.test(title)) continue;
    const imgs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(m => m[1])
      .filter(s => /\/wp-content\/uploads\//.test(s) && !/btn_|logo/i.test(s))
      .map(s => s.replace(/-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp)$)/i, ''));
    let n = 0;
    for (const u of imgs) if (n < PHOTOS_PER_REPORT && !out.includes(u)) { out.push(u); n++; }
  }
  return out;
}

/** "16-20 Oct 2026, 4 nights, JPY 63,000" per departure. */
function departuresText(t: ReturnType<typeof parseKcoTour>, deps = t.departures): string {
  const d = (s: string) => Number(s.slice(8, 10));
  const mon = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  return deps.map(x => `${d(x.start)}${mon(x.start) !== mon(x.end) ? ` ${mon(x.start)}` : ''}-${d(x.end)} ${mon(x.end)} ${x.end.slice(0, 4)}, ${x.nights} nights${x.price !== null ? `, JPY ${x.price.toLocaleString('en-US')}` : ''}`).join('; ');
}

export function parseKohamaContent(indexHtml: string, today: string, reportImages: string[] = []): OfferContent {
  const posts = parseKcoPosts(indexHtml);
  const ann = kcoAnnouncements(posts, PLACE);
  const cur = ann[0];
  if (!cur) throw new Error('kiteclub-kohama: no Kohama announcement on the tours index (layout changed?)');
  const t = parseKcoTour(cur);
  const editions = ann.map(p => parseKcoTour(p)).filter(x => x.departures.length);
  const future = t.departures.filter(d => d.start >= today);
  const prices = kcoPriceText(t);
  const longest = Math.max(...t.departures.map(d => d.nights), 4);
  const years = [...new Set(editions.map(e => e.year).filter(Boolean))].sort();
  const nextYear = (t.year ?? Number(today.slice(0, 4))) + 1;

  const summary = [
    `KITECLUB Okinawa, the kite school in Tomigusuku near Naha, runs a yearly autumn kite trip to Kohama Island in the Yaeyama Islands for the first north winds of the season, riding flat-water spots that also suit foil and wing at the right tide.`,
    `The package includes ${t.departures.map(d => d.nights).sort().join(' or ') || '3 or 4'} nights at the guesthouse Kohama no Yado panapana with breakfast, the return ferry Ishigaki - Kohama, a rental car with fuel and the school's guiding at the spots; flights are arranged by each guest and the group meets on the island.`,
    future.length
      ? `Next trip: ${departuresText(t, future)}${prices ? ' (per person)' : ''}.`
      : `Runs every year in autumn${years.length > 1 ? ` (${years.join(', ')})` : ''}; ${nextYear} dates not yet published (${t.year ?? 'last'} edition: ${departuresText(t)}${prices ? ', per person' : ''}).`,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'KITECLUB Okinawa Kohama Island Kite Tour',
    summary,
    continent: 'Asia',
    country: 'Japan',
    region: 'Yaeyama Islands, Okinawa',
    spot: 'Kohama Island',
    itinerarySpots: [],
    durationDays: longest + 1,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: false,
    equipmentRental: null,
    beginnerFriendly: false,
    includedServices: kcoIncluded(t),
    optionalServices: ['Room requests on demand (ask the school)'],
    accommodation: 'guesthouse Kohama no Yado panapana',
    mealPlan: 'breakfast',
    languages: ['ja'],
    rooms: [],
    imageUrls: reportImages.slice(0, 20),
    heroVideoUrl: null, // YouTube embeds only
    sourceUrl: cur.url,
    bookingUrl: KCO_CONTACT_URL,
    sourceText: [
      `announcement ${cur.url} (${cur.title}, posted ${cur.posted}):`,
      ...cur.lines,
      `earlier editions: ${ann.slice(1).map(p => `${p.url} ${p.title}`).join(' | ')}`,
      `parsed: year ${t.year}; departures ${t.departures.map(d => `${d.start}..${d.end} JPY ${d.price ?? 'TBA'}`).join(', ')}`,
    ].join('\n'),
  };
}

export async function fetchKohamaSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const posts = parseKcoPosts(await kcoPage(KCO_TOURS_URL));
  if (posts.length === 0) throw new Error('kiteclub-kohama: no posts on the tours index (layout changed?)');
  const ann = kcoAnnouncements(posts, PLACE);
  if (!ann[0]) throw new Error('kiteclub-kohama: no Kohama announcement on the tours index page 1');
  const t = parseKcoTour(ann[0]);
  if (t.departures.length === 0) throw new Error(`kiteclub-kohama: no schedule line parsed in ${ann[0].url}`);
  const slots = buildKcoSlots(t, today, null, 'Kohama Island');
  if (slots.length === 0) ctx?.note(`newest Kohama announcement (${ann[0].url}) only has started/past dates (${t.departures.map(d => d.start).join(', ')}); next edition not announced yet`);
  return slots;
}

export const kiteclubOkinawaKohamaKiteTour: OfferAdapter = {
  key: 'kiteclub-okinawa-kohama-kite-tour',
  name: 'KITECLUB Okinawa Kohama Island Kite Tour',
  kind: 'camp',
  operator: KCO_OPERATOR,
  url: 'https://kiteclub-okinawa.biz/info/blog/13191/',
  slotMethod: 'html_dates',
  instantBooking: false, // request only (e-mail / phone / message), no online checkout
  fetchBudget: 3,
  confidence: 'medium',
  async fetchContent() {
    const reports = await fetchJson<WpPost[]>(KOHAMA_REPORTS_URL);
    return parseKohamaContent(await kcoPage(KCO_TOURS_URL), todayIso(), parseKohamaReportImages(reports));
  },
  fetchSlots: ctx => fetchKohamaSlots(todayIso(), ctx),
};
