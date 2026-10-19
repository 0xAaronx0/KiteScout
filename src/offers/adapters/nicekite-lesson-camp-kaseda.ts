// ---------------------------------------------------------------------------
// NICEKITE Kitesurfing Lesson Camp Plan at The Beach House, Kaseda (Minamisatsuma, Kagoshima, Japan) - the Kagoshima
// kite shop's "合宿レッスン" (residential lesson camp): stay at The Beach House ("Hotel & Water Sports", a beachfront
// villa at the school's Kaseda spot, at a heavily discounted rate for students) and take consecutive days of lessons,
// typically the Master course (JPY 55,000, gear rental and insurance included, about 3-5 days). Kind 'camp'.
//
// Data path (checked 2026-10-19): WordPress, server-rendered, Japanese.
//   /lesson-camp/   the plan: "お得な、宿泊＋レッスンプランもございます。お気軽にお尋ねくださいませ。" (a good-value stay +
//                   lesson plan, ask us) and the plan picture captioned "The Beach House 宿泊＆レッスン プラン" (the image
//                   text: beachfront villa, accommodation heavily discounted, many students from Kanto / Kansai).
//                   NO package price is printed anywhere -> fetchSlots returns [] (price on request); it only checks
//                   that the plan is still on the page (throws when the Beach House plan disappears).
//   /master/        "★マスターコース ￥55,000(税込)" (3 days x ~3 h in good conditions, 3+ days / ~5 days otherwise,
//                   gear except wetsuit + insurance included; wetsuit rental ￥1,500) -> includedServices text.
//   Location: the lesson-camp page does not name the place. The operator's blog post of 2025-12-09
//   (/blog/kitesurfing/20251209-2/, "鹿児島加世田はカイトサーフィンパラダイス") says Master-course students from Kanto
//   stay at The Beach House for consecutive lesson days at Kaseda; the shop's own address is in Kagoshima city.
//   region/spot are constants from that post (not fetched per run).
//   durationDays 3 = the Master course's shortest schedule (inferred: the plan is not sold as fixed nights).
// robots.txt (2026-10-19): /wp-admin/ and one plugin JSON disallowed; pages allowed.
// Requests per run: content 2 (/lesson-camp/, /master/), slots 1 (/lesson-camp/, memoised).
// Known limits: accommodation price and room types are not published; booking by phone / contact form.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, parseAmount, type HTMLElement } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://nicekite.jp';
export const NICEKITE_CAMP_URL = `${SITE}/lesson-camp/`;
export const NICEKITE_MASTER_URL = `${SITE}/master/`;
export const NICEKITE_CONTACT_URL = `${SITE}/contact/`;

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

function content(html: string): HTMLElement {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, iframe')) el.remove();
  return root.querySelector('#contentstxt') ?? root.querySelector('main') ?? root;
}
function lines(html: string): string[] {
  return content(html).structuredText.split('\n').map(s => collapse(s)).filter(Boolean);
}

// --- pure parsers ------------------------------------------------------------------------------
export interface NicekitePlan {
  /** the Beach House stay + lesson plan is still offered on /lesson-camp/ */
  beachHousePlan: boolean;
  /** the page offers a stay + lesson plan on request ("宿泊＋レッスンプラン ... お尋ね") */
  onRequest: boolean;
}

export function parseNicekitePlan(html: string): NicekitePlan {
  const t = lines(html).join('\n');
  return {
    beachHousePlan: /The Beach House/i.test(t) && /宿泊/.test(t),
    onRequest: /宿泊\s*[＋+]\s*レッスンプラン/.test(t),
  };
}

export interface NicekiteMaster { price: number | null; wetsuit: number | null }

/** "★マスターコース ￥55,000(税込)" + "ウェットスーツが必要な方は ￥1,500(税込)にてレンタル". */
export function parseNicekiteMaster(html: string): NicekiteMaster {
  const t = lines(html).join('\n');
  const m = t.match(/マスターコース\s*[￥¥]\s*([\d,]+)/);
  const w = t.match(/ウェットスーツ[^\n]*?[￥¥]\s*([\d,]+)/);
  return { price: m ? parseAmount(m[1]) : null, wetsuit: w ? parseAmount(w[1]) : null };
}

export function parseNicekiteContent(p: { camp: string; master: string }): OfferContent {
  const plan = parseNicekitePlan(p.camp);
  const master = parseNicekiteMaster(p.master);
  const masterText = master.price
    ? `the Master course (JPY ${master.price.toLocaleString('en-US')} incl. tax, gear except wetsuit and insurance included, about 3 to 5 lesson days, valid one year)`
    : 'the Master course (about 3 to 5 lesson days)';
  const summary = [
    `NICEKITE, the kitesurf shop and school in Kagoshima, offers a residential lesson camp at Kaseda on the west coast of the Satsuma Peninsula: students stay at The Beach House, a beachfront villa with water sports, at a heavily discounted rate and take lessons on consecutive days.`,
    `Lessons are usually ${masterText}; the goal is planing on the board, and the school recommends leaving spare days for days without wind.`,
    `The stay + lesson package has no published price: rates on request by phone or contact form.`,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'NICEKITE Kitesurf Lesson Camp at The Beach House, Kaseda',
    summary,
    continent: 'Asia',
    country: 'Japan',
    region: 'Minamisatsuma, Kagoshima',
    spot: 'Kaseda',
    itinerarySpots: [],
    durationDays: 3,
    skillLevels: ['beginner'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      'Stay at The Beach House (beachfront villa, discounted rate for lesson students)',
      master.price
        ? `Kitesurf lessons: Master course JPY ${master.price.toLocaleString('en-US')} (about 3-5 days, gear except wetsuit and insurance included)`
        : 'Kitesurf lessons (Master course, about 3-5 days)',
    ],
    optionalServices: [
      ...(master.wetsuit ? [`Wetsuit rental (JPY ${master.wetsuit.toLocaleString('en-US')})`] : []),
      'Shorter trial lessons (30 min ground, 1 h, 2 h)',
    ],
    accommodation: plan.beachHousePlan ? 'The Beach House, beachfront villa (Hotel & Water Sports)' : 'partner accommodation',
    mealPlan: null,
    languages: ['ja'],
    rooms: [],
    imageUrls: imageCandidates(p.camp, NICEKITE_CAMP_URL).filter(u => !/\/themes\//.test(u)).slice(0, 20),
    heroVideoUrl: null,
    sourceUrl: NICEKITE_CAMP_URL,
    bookingUrl: NICEKITE_CONTACT_URL,
    sourceText: [
      `lesson-camp: ${lines(p.camp).join('\n')}`,
      `master: ${lines(p.master).join('\n')}`,
      `parsed: beachHousePlan ${plan.beachHousePlan}; onRequest ${plan.onRequest}; master JPY ${master.price}; wetsuit JPY ${master.wetsuit}`,
    ].join('\n'),
  };
}

export async function fetchNicekiteSlots(ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const plan = parseNicekitePlan(await page(NICEKITE_CAMP_URL));
  if (!plan.beachHousePlan) throw new Error('nicekite: The Beach House stay + lesson plan no longer on /lesson-camp/ (withdrawn or layout changed?)');
  ctx?.note('no package price published (stay + lesson plan on request)');
  return [];
}

export const nicekiteLessonCampKaseda: OfferAdapter = {
  key: 'nicekite-lesson-camp-kaseda',
  name: 'NICEKITE Kitesurf Lesson Camp at The Beach House, Kaseda',
  kind: 'camp',
  operator: {
    name: 'NICEKITE',
    websiteUrl: `${SITE}/`,
    rootDomain: 'nicekite.jp',
    contactEmail: 'info@nicekite.jp', // the site's JSON-LD Organization e-mail
    phone: '+81992603600',
  },
  url: NICEKITE_CAMP_URL,
  slotMethod: 'price_table',
  instantBooking: false, // request only (e-mail / phone / message), no online checkout
  fetchBudget: 3,
  confidence: 'low',
  async fetchContent() {
    const [camp, master] = await Promise.all([page(NICEKITE_CAMP_URL), page(NICEKITE_MASTER_URL)]);
    return parseNicekiteContent({ camp, master });
  },
  fetchSlots: ctx => fetchNicekiteSlots(ctx),
};
