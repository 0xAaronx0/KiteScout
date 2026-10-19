// ---------------------------------------------------------------------------
// LakeUnited Snowkitecamp Norway, Vøringsfoss (Hardangervidda) - a 7-night SNOWKITE camp (kiting on snow, not water)
// by the Austrian kite school LakeUnited (Lake Neusiedl). The group shares the school's own cabin in Vøringsfoss
// (Eidfjord, Vestland; five double rooms, sauna, fireplace), drives up to the plateau every day and kites with
// supervision, guiding and a GPS tracker - no classic lessons. Meals are cooked together from a group fund (EUR 150 per
// person, not included); gear rental (Flysurfer soft kites) is extra. A separate product from LakeUnited's Djerba camp
// (lakeunited-djerba.ts, whose page helpers this adapter reuses) and from its "Snowkite Outdoor Camp Norway".
//
// Data path (checked 2026-10-19): ONE page, /en/portfolio/snowkitecamp-norway (WordPress + Elementor, server-rendered).
//   slots    the dated weeks are Elementor feature-list items ("20.02. - 27.02.2027 / Beginners and advanced kiters";
//            four weeks Feb 20 - Mar 20, 2027, none hidden on all devices), the price is the "Bestseller" box
//            ("€ 1.730,-" / "Including overnight stay in a double room, supervision, guiding and GPS tracker,
//            excluding travel, meals and equipment rental").
//   content  the same page (service tab "7 nights in a cozy mountain hut (double room ...)", Including / Excluding,
//            FAQ, Elementor gallery).
// Booking: "Send request" -> /en/portfolio/snowkitecamps-request/?snowkitecamp=no, then a non-binding booking link by
//   mail -> availability 'on_request', instantBooking false.
// robots.txt www.lakeunited.com (2026-10-19): only /wp-admin/ and one plugin JSON disallowed.
// Requests per run: 1 (content + slots share one memoised page fetch).
// Price basis: "per person" is not printed next to EUR 1,730; inferred (camp package, "double room"), as on Djerba.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, daysInclusive, detectCurrency, imageCandidates, parse, parseAmount, todayIso, type HTMLElement } from '../parse.js';
import { upscaleCdnUrl } from '../../lib/images.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import { campWeeks, visibleRoot, type CampWeek } from './lakeunited-djerba.js';

export const LUN_URL = 'https://www.lakeunited.com/en/portfolio/snowkitecamp-norway';

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');

// --- pure parsers -----------------------------------------------------------------------------
export interface LunPrice { amount: number; currency: string; note: string }

/** The "Bestseller" box: "€ 1.730,-" and the sentence under it. */
export function parseLunPrice(text: string): LunPrice | null {
  // "Bestseller Snowkite package in a double room € 1.730,- Including overnight stay in a double room, ..."
  const m = text.match(/Bestseller\s*([^€]{0,80}?)\s*((?:€|EUR)\s*[\d.,]+)[,-]*\s*(Including[^.]*?(?:rental|meals|travel))?(?=\s+After|\.|$)/i);
  if (!m) return null;
  const amount = parseAmount(m[2]);
  const currency = detectCurrency(m[2]);
  return amount && currency ? { amount, currency, note: collapse(`${m[1]} ${m[3] ?? ''}`) } : null;
}

/** Service tab: "7 nights in a cozy mountain hut (...)" + the Including / Excluding list items. */
export function parseLunService(root: HTMLElement): { nights: number | null; stay: string | null; including: string[]; excluding: string[] } {
  const out = { nights: null as number | null, stay: null as string | null, including: [] as string[], excluding: [] as string[] };
  for (const p of root.querySelectorAll('p')) {
    const t = txt(p);
    const m = t.match(/^(\d+)\s+nights?\s+in\s+(.+)$/i);
    if (m) { out.nights = Number(m[1]); out.stay = t; break; }
  }
  for (const li of root.querySelectorAll('li')) {
    const label = txt(li.querySelector('strong')).toLowerCase();
    if (label !== 'including' && label !== 'excluding') continue;
    const body = txt(li).replace(/^(including|excluding)\s*/i, '');
    const items = body.split(/,\s*(?:and\s+)?(?![^(]*\))|\s+and\s+(?![^(]*\))/i).map(s => collapse(s)).filter(Boolean)
      .map(s => s.charAt(0).toUpperCase() + s.slice(1));
    if (label === 'including' && !out.including.length) out.including = items;
    if (label === 'excluding' && !out.excluding.length) out.excluding = items;
  }
  return out;
}

export function buildLunSlots(weeks: CampWeek[], price: LunPrice | null, cta: string, today: string): Slot[] {
  const out: Slot[] = [];
  const seen = new Set<string>();
  for (const w of weeks) {
    if (seen.has(w.start) || w.start < today) continue;
    seen.add(w.start);
    const priced = price && daysInclusive(w.start, w.end) === 8;
    out.push({
      key: w.start,
      startDate: w.start,
      endDate: w.end,
      unit: 'Double room',
      price: priced ? price!.amount : null,
      currency: priced ? price!.currency : null,
      priceUnit: 'package',
      priceBasis: 'person', // inferred, see header
      occupancy: 2,
      availability: 'on_request',
      availabilityText: `${cta} (non-binding inquiry)${w.label ? `; ${w.label}` : ''}`,
      spotsLeft: null,
    });
  }
  return out;
}

export function parseLunSlots(html: string, today: string): { slots: Slot[]; weeks: CampWeek[]; hiddenWeeks: string[] } {
  const { root, hidden } = visibleRoot(html);
  const weeks = campWeeks(root);
  const price = parseLunPrice(txt(root));
  const ctas = root.querySelectorAll('a[href*="snowkitecamps-request"]').map(a => txt(a)).filter(Boolean);
  const cta = ctas.find(c => /send request/i.test(c)) ?? ctas[0] ?? 'Send request';
  return { slots: buildLunSlots(weeks, price, cta, today), weeks, hiddenWeeks: hidden.flatMap(h => campWeeks(h).map(w => w.raw)) };
}

export function parseLunContent(html: string, today = todayIso()): OfferContent {
  const { root } = visibleRoot(html);
  const post = root.querySelector('[data-elementor-type="wp-post"]') ?? root;
  const text = txt(post);
  const weeks = campWeeks(root);
  const price = parseLunPrice(text);
  const service = parseLunService(post);
  const nights = service.nights ?? 7;
  const future = weeks.filter(w => w.start >= today);
  const day = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const food = text.match(/€\s*(\d+)\.?-?\s*budget per person for food/i)?.[1];

  const gallery = root.querySelectorAll('[data-thumbnail]').map(e => upscaleCdnUrl(new URL(e.getAttribute('data-thumbnail')!, LUN_URL).toString()));
  const imageUrls = [...new Set([...imageCandidates(html, LUN_URL, null, 40), ...gallery])]
    .filter(u => /\/wp-content\/uploads\//.test(u) && !/[-_]Team[-_.]|borlabs|recaptcha|logo|icon|oesterreich|Podcast/i.test(u))
    .slice(0, 30);

  const summary = [
    `LakeUnited, an Austrian kite school, runs ${nights}-night snowkiting weeks - kiting on snow with skis or a snowboard, not on water - on the Hardangervidda plateau in Norway, based in the school's own cabin in Vøringsfoss near Eidfjord.`,
    'The group drives up to the plateau every day and kites with supervision, guiding and a GPS tracker rather than classic lessons; skiers or snowboarders who have flown a kite before can join, and the cabin has five double rooms, a sauna and a fireplace.',
    `${price ? `A week costs ${price.currency} ${price.amount.toLocaleString('en-US')} in a double room; ` : ''}meals are cooked together from a group fund${food ? ` (about EUR ${food} per person)` : ''}, and travel and gear rental are extra.`,
    future.length
      ? `Weeks ${future[0].start.slice(0, 4)}: ${future.map(w => `${day(w.start)} to ${day(w.end)}`).join(', ')}; booking is by non-binding request.`
      : weeks.length ? `The published weeks (${weeks[0].start.slice(0, 4)}) are over; the next dates are not published yet.` : 'Booking is by non-binding request.',
  ].join(' ');

  return {
    kind: 'camp',
    title: 'LakeUnited Snowkitecamp Norway',
    summary,
    continent: 'Europe',
    country: 'Norway',
    region: 'Hardangervidda',
    spot: 'Vøringsfoss, Hardangervidda',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: false, // "there will be no traditional kitesurfing lessons or coaching"
    equipmentRental: /rent it from us|equipment rental/i.test(text),
    beginnerFriendly: /beginner/i.test(text),
    includedServices: [
      ...(service.stay ? [service.stay] : []),
      ...service.including,
    ],
    optionalServices: [
      'Kite rental (Flysurfer Peak, Hybrid and Soul soft kites) and snowkite harness rental',
      ...(food ? [`Group food fund, about EUR ${food} per person (cooked together)`] : []),
      'Skiing day in Geilo, fjord excursion to Vøringsfossen and Eidfjord, farewell dinner',
    ],
    accommodation: 'LakeUnited\'s own cabin in Vøringsfoss: five double rooms, two bathrooms, sauna and fireplace',
    mealPlan: 'self_catering',
    languages: ['de', 'en'],
    rooms: [],
    imageUrls,
    heroVideoUrl: null, // YouTube embed only (behind a consent placeholder)
    sourceUrl: LUN_URL,
    bookingUrl: root.querySelector('a[href*="snowkitecamps-request"]')?.getAttribute('href') ?? LUN_URL,
    sourceText: [
      `weeks: ${weeks.map(w => `${w.raw} ${w.label}`).join(' | ')}`,
      `price: ${price ? `${price.currency} ${price.amount} ${price.note}` : '?'}`,
      `excluding: ${service.excluding.join('; ')}`,
      `page: ${text}`,
    ].join('\n'),
  };
}

export async function fetchLunSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const { slots, weeks, hiddenWeeks } = parseLunSlots(await page(LUN_URL), today);
  if (!weeks.length) throw new Error('lakeunited-snowkitecamp-norway: no dated camp weeks found (page layout changed?)');
  if (hiddenWeeks.length) ctx?.note(`weeks hidden on the page (not emitted): ${hiddenWeeks.join('; ')}`);
  if (!slots.length) ctx?.note(`all published weeks are past (${weeks.map(w => w.start).join(', ')}); next dates not published yet`);
  return slots;
}

// --- adapter ----------------------------------------------------------------------------------
export const lakeunitedSnowkitecampNorwayVoringsfoss: OfferAdapter = {
  key: 'lakeunited-snowkitecamp-norway-voringsfoss',
  name: 'LakeUnited - Snowkitecamp Norway (Vøringsfoss, Hardangervidda)',
  kind: 'camp',
  operator: {
    name: 'LakeUnited',
    websiteUrl: 'https://www.lakeunited.com/',
    rootDomain: 'lakeunited.com',
  },
  url: LUN_URL,
  slotMethod: 'html_dates',
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() {
    return parseLunContent(await page(LUN_URL));
  },
  fetchSlots: ctx => fetchLunSlots(todayIso(), ctx),
};
