// ---------------------------------------------------------------------------
// Wind Sports Center "KITEHOUSE - KITEWEEK", Boa Vista (Cape Verde) - the centre's kite camp week at Praia de Estoril,
// Sal Rei: 7 nights in apartments 300-500 m from the centre (Vilas na Areia aparthotel), a 5-day kite course
// (15 hours: beginner = 2 couple + 3 semi-private lessons, intermediate = 5 semi-private lessons), gear during the
// lessons, radio headsets, breakfasts and meals, daily cleaning and transport to the beach.
//
// Data path (checked 2026-10-19): WordPress (WPBakery + Qode theme), ONE page https://windsportscenter.com/camps-boavista/
//   (dateModified 2026-09-16). Under the "KITEHOUSE - KITEWEEK" heading an accordion per level (h5.qodef-accordion-title
//   "BEGGINER KITE CAMP" / "INTERMEDIATE KITE CAMP"; the "SURF + KITE" camps that follow are a different product and
//   are skipped), each with three season tabs ("June to September", "October, November, April & May", "December to
//   March") holding a table "Single Room 1 pax | 1 195 €", "Single Room ( double Bed) 2 pax | 2 100 €",
//   "Single Room ( two single beds) 2 pax | 2 180 €", "Double Room ( 4 pax) | 3 995 €".
//   The table has no year. /our_prices/ links "Prices-Boavista-2027.pdf" (uploaded 2026/10), but that PDF lists
//   courses, rental and storage only, no camps. Rule here: each season band is placed at its first occurrence that
//   ends on or after the page's dateModified (2026-09-16 -> Oct-Nov 2026, Dec 2026-Mar 2027, Apr-May 2027; Jun-Sep
//   2026 is already past), i.e. the table is read as valid for twelve months after its last edit. Confidence medium.
//   Booking: contact form / WhatsApp (/book-now/ is a request form; the online store sells courses and rental, camps
//   not confirmed there) -> availability 'on_request', instantBooking left unset.
// robots.txt windsportscenter.com (2026-10-19): empty file (200) -> allowed.
// Requests per run: 1 (content + slots share one memoised page fetch).
// Slots: level x room x season band; the printed price is the total for the room's guests ("2 pax", "4 pax"),
//   normalised per person (priceTotal keeps the printed total; the per-room reading is inferred from 1 pax 1,195 vs
//   2 pax 2,100), EUR, priceUnit 'package', packageNights 7.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, monthOf, parse, parseAmount, type HTMLElement } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

export const WSC_URL = 'https://windsportscenter.com/camps-boavista/';
const NIGHTS = 7;

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

// --- price tables -------------------------------------------------------------------------------
export interface WscRow { label: string; pax: number; total: number }
export interface WscSeason { label: string; groups: Array<[number, number]>; rows: WscRow[] }
export interface WscLevel { level: 'beginner' | 'intermediate'; title: string; note: string | null; seasons: WscSeason[] }

/** "June to September" -> [[6,9]]; "October, November, April & May" -> [[10,11],[4,5]]; "December to March" -> [[12,3]] */
export function seasonGroups(label: string): Array<[number, number]> {
  const t = label.replace(/&amp;/g, '&');
  const to = t.match(/([A-Za-z]+)\s+to\s+([A-Za-z]+)/i);
  if (to && monthOf(to[1]) && monthOf(to[2])) return [[monthOf(to[1])!, monthOf(to[2])!]];
  const months = t.split(/,|&|\band\b/).map(s => monthOf(s.trim())).filter((m): m is number => m !== null);
  const groups: Array<[number, number]> = [];
  for (const m of months) {
    const last = groups[groups.length - 1];
    if (last && (last[1] % 12) + 1 === m) last[1] = m;
    else groups.push([m, m]);
  }
  return groups;
}

export function parseWscLevels(html: string): WscLevel[] {
  const root = parse(html);
  const out: WscLevel[] = [];
  for (const h of root.querySelectorAll('h5.qodef-accordion-title')) {
    const title = txt(h.querySelector('.qodef-tab-title') ?? h);
    if (!/KITE CAMP/i.test(title) || /SURF/i.test(title)) continue;
    const level = /INTERMEDIATE/i.test(title) ? 'intermediate' : /BEG+IN+ER/i.test(title) ? 'beginner' : null;
    if (!level || out.some(l => l.level === level)) continue;
    const body = h.nextElementSibling;
    if (!body) continue;
    const seasons: WscSeason[] = [];
    for (const panel of body.querySelectorAll('.vc_tta-panel')) {
      const label = txt(panel.querySelector('.vc_tta-title-text'));
      const rows: WscRow[] = [];
      for (const tr of panel.querySelectorAll('tr')) {
        const tds = tr.querySelectorAll('td').map(td => txt(td));
        if (tds.length < 2) continue;
        const pax = Number(tds[0].match(/(\d+)\s*pax/i)?.[1]);
        const total = parseAmount(tds[1]);
        if (pax > 0 && total) rows.push({ label: tds[0].replace(/\(\s+/g, '(').replace(/\s+\)/g, ')'), pax, total });
      }
      if (label && rows.length) seasons.push({ label, groups: seasonGroups(label), rows });
    }
    out.push({ level, title, note: txt(body.querySelector('.wpb_text_column p')) || null, seasons });
  }
  return out;
}

const lastDay = (y: number, m: number): string => iso(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());

/** First occurrence of a month group that ends on or after `anchor` (YYYY-MM-DD). */
export function bandFor([sm, em]: [number, number], anchor: string): { start: string; end: string } {
  for (let y = Number(anchor.slice(0, 4)) - 1; ; y++) {
    const start = iso(y, sm, 1);
    const end = lastDay(em < sm ? y + 1 : y, em);
    if (end >= anchor) return { start, end };
  }
}

function roomKey(label: string): string {
  if (/two single beds/i.test(label)) return 'twin';
  if (/double bed/i.test(label)) return 'double-bed';
  if (/^double room/i.test(label)) return 'double-room';
  if (/^single room/i.test(label)) return 'single';
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function buildWscSlots(levels: WscLevel[], anchor: string, today: string): Slot[] {
  const slots: Slot[] = [];
  for (const l of levels) {
    for (const s of l.seasons) {
      for (const g of s.groups) {
        const band = bandFor(g, anchor);
        if (band.end < today) continue;
        for (const r of s.rows) {
          const pp = Math.round((r.total / r.pax) * 100) / 100;
          slots.push({
            key: `${l.level}|${roomKey(r.label)}-${r.pax}|${band.start}`,
            startDate: band.start,
            endDate: band.end,
            unit: `${l.level === 'beginner' ? 'Beginner' : 'Intermediate'} kite camp, ${r.label}`,
            price: pp,
            currency: 'EUR',
            priceUnit: 'package',
            priceBasis: 'person',
            occupancy: r.pax,
            availability: 'on_request',
            availabilityText: `${s.label}: EUR ${r.total} for ${r.pax} ${r.pax === 1 ? 'person' : 'persons'} (7 nights); booking by request`,
            spotsLeft: null,
            priceTotal: r.pax > 1 ? r.total : null,
            packageNights: NIGHTS,
          });
        }
      }
    }
  }
  return slots;
}

export function wscModified(html: string): string | null {
  return html.match(/"dateModified":"(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

// --- content ------------------------------------------------------------------------------------
/** Photo candidates for the camps page (also used by the surf + kite listing): beach and centre photos (2023/05
 *  "bahia*": the centre on Praia de Estoril, the bay with kites) first, then the apartments (IMG_10xx), then the
 *  rest (meal photos IMG_01xx). The page lists them in the opposite order, and with a cut at 30 the vision pick saw
 *  only meals and buildings (2026-10-28: 8 of 10 stored photos were food). */
export function wscImages(html: string, max = 40): string[] {
  const rank = (u: string) => (/\/bahia/i.test(u) ? 0 : /IMG_10\d\d/i.test(u) ? 1 : 2);
  return imageCandidates(html, WSC_URL, null, 80)
    .filter(u => !/logo|favicon|banner|livro|h4-img|boavista_Capoverde|csm_Matze/i.test(u))
    .map((u, i) => ({ u, i })).sort((a, b) => rank(a.u) - rank(b.u) || a.i - b.i).map(x => x.u)
    .slice(0, max);
}

export function parseWscContent(html: string, _today: string): OfferContent {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript')) el.remove();
  const text = collapse(root.structuredText);
  const head = root.querySelectorAll('h2.qodef-st-title').find(h => /KITEHOUSE\s*-\s*KITEWEEK/i.test(txt(h)) && !/SURF/i.test(txt(h)));
  const listP = head?.closest('.qodef-section-title-holder')?.nextElementSibling?.nextElementSibling?.querySelector('p');
  const included = (listP?.innerHTML ?? '').split(/<br\s*\/?>/i).map(s => collapse(parse(s).text).replace(/^\*\s*/, '')).filter(Boolean);
  const levels = parseWscLevels(html);
  // the "from" prices quote the page's whole table (every season), not only the bands still ahead: the
  // summer band is dated past by the anchor rule, but the page prints it as the current price list
  const table = levels.flatMap(l => l.seasons.flatMap(s => s.rows.map(r => ({ ...r, season: s.label, pp: r.total / r.pax }))));
  const cheapest = table.filter(r => r.pax === 1).sort((a, b) => a.total - b.total)[0];
  const minAll = table.slice().sort((a, b) => a.pp - b.pp)[0];
  const hours = included.join(' ').match(/\((\d+)\s*hours\)/i)?.[1];

  const summary = [
    `Wind Sports Center's kite camp week (Kitehouse - Kiteweek) at Praia de Estoril in Sal Rei, Boa Vista (Cape Verde): 7 nights in apartments 300-500 m from the centre, a 5-day kite course${hours ? ` (${hours} hours)` : ''} with gear and radio headsets during the lessons, breakfasts and meals in Sal Rei restaurants, daily cleaning and transport to the beach.`,
    `Beginners get 2 couple and 3 semi-private lessons, intermediate riders who handle their own kite 5 semi-private lessons.`,
    cheapest ? `Prices depend on season (June-September, October/November/April/May, December-March) and room: from EUR ${cheapest.total.toLocaleString('en-US')} for one person in a single room (${cheapest.season})${minAll && minAll.pp < cheapest.total && minAll.pax > 1 ? ` or EUR ${minAll.total.toLocaleString('en-US')} for ${minAll.pax} sharing a room (${minAll.season})` : ''}; the price table carries no year, booking by request.` : 'Prices on request.',
  ].join(' ');

  const imgs = wscImages(html);

  return {
    kind: 'camp',
    title: 'Wind Sports Center Kitehouse Kiteweek, Boa Vista',
    summary,
    continent: 'Africa',
    country: 'Cape Verde',
    region: 'Boa Vista',
    spot: 'Sal Rei, Boa Vista',
    itinerarySpots: [],
    durationDays: NIGHTS + 1,
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: included,
    optionalServices: ['Surf + kite camp week (separate package)', 'Equipment rental and storage after the course'],
    accommodation: 'apartments near Praia de Estoril (Vilas na Areia aparthotel), single or shared rooms',
    mealPlan: /Six breakfasts and six dinners/i.test(text) ? 'half_board' : 'breakfast',
    languages: ['en', 'pt', 'de'],
    rooms: [],
    imageUrls: imgs,
    heroVideoUrl: null,
    sourceUrl: WSC_URL,
    bookingUrl: 'https://windsportscenter.com/book-now/',
    sourceText: text,
  };
}

export async function fetchWscSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const html = await page(WSC_URL);
  const levels = parseWscLevels(html);
  if (levels.length === 0 || levels.every(l => l.seasons.length === 0)) throw new Error('wind-sports-center: KITE CAMP price tables not found (layout changed?)');
  const anchor = wscModified(html);
  if (!anchor) ctx?.note('dateModified missing; season bands anchored on today');
  return buildWscSlots(levels, anchor ?? today, today);
}

export const windSportsCenterKiteweekBoaVista: OfferAdapter = {
  key: 'wind-sports-center-kiteweek-boa-vista',
  name: 'Wind Sports Center Kitehouse Kiteweek, Boa Vista',
  kind: 'camp',
  operator: {
    name: 'Wind Sports Center',
    websiteUrl: 'https://windsportscenter.com/',
    rootDomain: 'windsportscenter.com',
    phone: '+2389720107',
    whatsapp: '+2389720107',
  },
  url: WSC_URL,
  slotMethod: 'price_table',
  liveAvailability: false,
  fetchBudget: 2,
  confidence: 'medium',
  async fetchContent() {
    return parseWscContent(await page(WSC_URL), new Date().toISOString().slice(0, 10));
  },
  fetchSlots: ctx => fetchWscSlots(new Date().toISOString().slice(0, 10), ctx),
};
