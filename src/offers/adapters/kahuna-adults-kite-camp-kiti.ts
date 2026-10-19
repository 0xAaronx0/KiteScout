// ---------------------------------------------------------------------------
// Kahuna Surfhouse - The Kahuna Adults Kitesurf & Surf Camp, Kiti (Larnaca, Cyprus): a 3-day / 2-night weekend camp
// for adults (25+, groups of 6) at the Kahuna Surfhouse station on the Mazotos-Pervolia coast road: beginner kitesurf
// course (about 10 hours), a surf lesson, SUP, workouts, all meals, all equipment and accommodation.
//
// Data path (checked 2026-10-19): ONE Statamic page, https://kahunasurfhouse.eu/camps/the-kahuna-summer-surf-camp
//   (the URL, og:title and og:description still describe the older teen summer camp; the visible H1 and text are the
//   adults camp). Header: H1 + price box ".lessons-price" ("EUR 540"). "Details": "DATES" paragraph with one line per
//   camp ("11-13.06.2026<br>08-10.07.2026"), "INFO" ("3 Days | 2 Nights", "Age group: 25+", "Group size: 6
//   participants"), "INCLUDED" list.
//   The price box does not say "per person"; we read it as the per-person camp price (inferred from the group-camp
//   format: 6 participants, one price).
// Booking: "Enquire and book" form (Statamic form with arrival / departure date) -> availability 'on_request'; flags unset.
// Location: the contact page prints "Mazotos to Pervolia Road, GPS: 34.817133, 33.54686" (checked 2026-10-19, not fetched
//   per run) -> spotCoords.
// robots.txt kahunasurfhouse.eu (2026-10-19): "Disallow:" (everything allowed).
// Requests per run: 1 (memoised page).
// State 2026-10-19: both 2026 camps (June, July) are past -> 0 slots ("price on request") until new dates are printed.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, iso, parse, parseAmount, todayIso, type HTMLElement } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

export const KAHUNA_URL = 'https://kahunasurfhouse.eu/camps/the-kahuna-summer-surf-camp';
const KAHUNA_SITE = 'https://kahunasurfhouse.eu';

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');

/** The "Details" paragraphs: label in <strong> ("DATES", "INFO", "INCLUDED", "LOCATION"), lines split by <br>. */
export function parseKahunaDetails(html: string): Record<string, string[]> {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, form')) el.remove();
  const out: Record<string, string[]> = {};
  const ps = root.querySelectorAll('p');
  for (let i = 0; i < ps.length; i++) {
    const strong = txt(ps[i].querySelector('strong'));
    if (!/^(DATES|LOCATION|INFO|INCLUDED)$/i.test(strong)) continue;
    let inner = ps[i].innerHTML.replace(/<strong>[\s\S]*?<\/strong>/i, '');
    // DATES keeps its lines in the next paragraph
    if (!collapse(parse(`<p>${inner}</p>`).text) && ps[i + 1]) inner = ps[i + 1].innerHTML;
    out[strong.toUpperCase()] = inner.split(/<br\s*\/?>/i).map(s => collapse(parse(`<p>${s}</p>`).text)).filter(s => s && s !== '---');
  }
  return out;
}

export interface KahunaCamp { start: string; end: string; raw: string }

/** "11-13.06.2026", "30.06-02.07.2026", "11.06.2026 - 13.06.2026". */
export function parseKahunaDates(lines: string[]): KahunaCamp[] {
  const out: KahunaCamp[] = [];
  for (const raw of lines) {
    const t = raw.replace(/[–—]/g, '-');
    const m = t.match(/(\d{1,2})(?:\.(\d{1,2}))?(?:\.(20\d{2}))?\.?\s*-\s*(\d{1,2})\.(\d{1,2})\.(20\d{2})/);
    if (!m) continue;
    const y2 = +m[6], m2 = +m[5];
    const m1 = m[2] ? +m[2] : m2;
    const y1 = m[3] ? +m[3] : (m1 > m2 ? y2 - 1 : y2);
    const c = { start: iso(y1, m1, +m[1]), end: iso(y2, m2, +m[4]), raw };
    if (c.end >= c.start && !out.some(o => o.start === c.start)) out.push(c);
  }
  return out;
}

export function parseKahunaPrice(html: string): { amount: number; currency: string } | null {
  const t = txt(parse(html).querySelector('.lessons-price'));
  const m = t.match(/€\s*([\d.,]+)/);
  return m && parseAmount(m[1]) ? { amount: parseAmount(m[1])!, currency: 'EUR' } : null;
}

export function buildKahunaSlots(camps: KahunaCamp[], price: { amount: number; currency: string } | null, info: string[], today: string): Slot[] {
  const size = info.join(' ').match(/Group size:\s*(\d+)/i)?.[1];
  return camps.filter(c => c.start >= today).map(c => ({
    key: c.start,
    startDate: c.start,
    endDate: c.end,
    unit: 'Weekend camp (2 nights, all meals, course and gear)',
    price: price?.amount ?? null,
    currency: price ? price.currency : null,
    priceUnit: price ? 'package' : null,
    priceBasis: price ? 'person' : null,
    occupancy: null,
    availability: 'on_request',
    availabilityText: `Enquire and book (form)${size ? `; group size ${size} participants` : ''}`,
    spotsLeft: null,
  }));
}

export async function fetchKahunaSlots(ctx: FetchContext, today = todayIso()): Promise<Slot[]> {
  const html = await page(KAHUNA_URL);
  const d = parseKahunaDetails(html);
  const camps = parseKahunaDates(d.DATES ?? []);
  if (!d.DATES) throw new Error('kahuna: "DATES" detail not found (layout changed?)');
  const past = camps.filter(c => c.start < today);
  if (past.length) ctx.note(`past camp date(s) dropped: ${past.map(c => c.raw).join('; ')}`);
  const slots = buildKahunaSlots(camps, parseKahunaPrice(html), d.INFO ?? [], today);
  if (slots.length === 0) ctx.note('no future camp date printed yet');
  return slots;
}

/** og:image + the photos between the camp's H1 and its "Details" block (the sidebar lists other events' photos). */
export function kahunaImages(html: string): string[] {
  const out: string[] = [];
  const og = parse(html).querySelector('meta[property="og:image"]')?.getAttribute('content');
  const i = html.search(/<h1[^>]*>/i);
  const j = html.indexOf('>Details<', i);
  const seg = i >= 0 ? html.slice(i, j > i ? j : undefined) : '';
  const imgs = [...seg.matchAll(/<img[^>]+src="([^"]+)"/gi)].map(m => m[1]);
  for (const u of [og, ...imgs]) {
    if (!u || /logo|icon|redbull/i.test(u)) continue;
    const abs = new URL(u, KAHUNA_SITE).toString();
    if (!out.includes(abs)) out.push(abs);
  }
  return out;
}

export function parseKahunaContent(html: string, today = todayIso()): OfferContent {
  const d = parseKahunaDetails(html);
  const camps = parseKahunaDates(d.DATES ?? []);
  const price = parseKahunaPrice(html);
  const info = (d.INFO ?? []).join(' ');
  const nights = Number(info.match(/(\d+)\s*Nights?/i)?.[1]) || 2;
  const age = info.match(/Age group:\s*([\d+]+)/i)?.[1];
  const size = info.match(/Group size:\s*(\d+)/i)?.[1];
  const future = camps.filter(c => c.start >= today);
  const fmt = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const datesLine = future.length
    ? `Camp dates: ${future.map(c => `${fmt(c.start)} - ${fmt(c.end)} ${c.end.slice(0, 4)}`).join(', ')}.`
    : `Runs every summer; the next dates are not published yet${camps.length ? ` (${[...new Set(camps.map(c => c.start.slice(0, 4)))].join('/')}: ${camps.map(c => `${fmt(c.start)} - ${fmt(c.end)}`).join(', ')})` : ''}.`;
  const summary = [
    `Kahuna Surfhouse, a kite and surf school on the coast west of Larnaca in Cyprus, runs a ${nights + 1}-day / ${nights}-night beginner camp for adults${age ? ` (${age})` : ''} in small groups${size ? ` of ${size}` : ''}.`,
    `It includes a beginner kitesurf course of about 10 hours, a surf lesson with board, stand up paddle, workouts and team games, all meals, all equipment and accommodation; no sports experience is needed, only basic swimming.`,
    `${price ? `EUR ${price.amount} per camp; ` : ''}booking by enquiry. ${datesLine}`,
  ].join(' ');
  return {
    kind: 'camp',
    title: 'Kahuna Adults Kitesurf & Surf Camp, Kiti (Larnaca)',
    summary,
    continent: 'Europe',
    country: 'Cyprus',
    region: 'Kiti, Larnaca',
    spot: 'Kiti',
    spotCoords: { lat: 34.8171, lng: 33.5469 }, // Kahuna Surfhouse, "GPS: 34.817133, 33.54686" on kahunasurfhouse.eu/contact (2026-10-19)
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: d.INCLUDED ?? [],
    optionalServices: [],
    accommodation: 'accommodation included (the page does not describe it)',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: [],
    imageUrls: kahunaImages(html),
    heroVideoUrl: null,
    sourceUrl: KAHUNA_URL,
    bookingUrl: KAHUNA_URL,
    sourceText: [
      `title: ${txt(parse(html).querySelector('h1'))}; price: ${price ? `${price.currency} ${price.amount}` : '-'}`,
      ...Object.entries(d).map(([k, v]) => `${k}: ${v.join(' | ')}`),
    ].join('\n'),
  };
}

export const kahunaAdultsKiteCampKiti: OfferAdapter = {
  key: 'kahuna-adults-kite-camp-kiti',
  name: 'Kahuna Adults Kitesurf & Surf Camp, Kiti (Larnaca)',
  kind: 'camp',
  operator: {
    name: 'Kahuna Surfhouse',
    websiteUrl: KAHUNA_SITE,
    rootDomain: 'kahunasurfhouse.eu',
  },
  url: KAHUNA_URL,
  slotMethod: 'html_dates',
  fetchBudget: 2,
  async fetchContent() {
    return parseKahunaContent(await page(KAHUNA_URL));
  },
  fetchSlots: ctx => fetchKahunaSlots(ctx),
};
