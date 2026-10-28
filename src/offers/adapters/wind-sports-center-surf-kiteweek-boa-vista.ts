// ---------------------------------------------------------------------------
// Wind Sports Center "SURF + KITEHOUSE - SURF + KITEWEEK", Boa Vista (Cape Verde) - the centre's combined surf and
// kite camp week at Praia de Estoril, Sal Rei: 7 nights in apartments near the centre (Vilas na Areia aparthotel),
// 3 days of surf course (7.5 hours) and 2 days of kite course (6 hours), board/leash and kite gear during the lessons,
// radio headsets, breakfasts and dinners, daily cleaning and transport to the beach. A different product from the
// kite-only Kiteweek (wind-sports-center-kiteweek-boa-vista.ts) on the same page; listed separately (Aaron
// 2026-10-14: one operator may have several camp listings).
//
// Data path (checked 2026-10-28): the same WordPress page https://windsportscenter.com/camps-boavista/ (dateModified
//   2026-09-16), heading "SURF + KITEHOUSE - SURF + KITEWEEK" with its bullet list, then two accordions
//   h5.qodef-accordion-title "BEGGINER SURF + KITE CAMP" (surf: 3 group lessons, kite: 2 couple lessons) and
//   "INTERMEDIATE SURF + KITE CAMP" (3 semi-private surf + 2 semi-private kite lessons), each with three season tabs
//   ("June to September", "October, November, April & May", "December to March") and four rows: 1 pax, 2 pax in a
//   double bed, 2 pax in two single beds, 4 pax in a double room. Season placement shares the Kiteweek rule
//   (seasonGroups / bandFor / wscModified: each band at its first occurrence ending on or after the page's
//   dateModified, i.e. the yearless table is read as valid for twelve months after its last edit). Confidence medium.
// Row labels (inferred): the surf + kite tables carry typos ("win Room ( 2 pax)", "Double Room (min 2 pax)" in the
//   beginner June-September tab, two "double Bed" rows in the intermediate June-September tab). Every tab prints the
//   2-pax rows in the same order, cheaper first, and the beginner wind camp on the same page has the identical
//   June-September numbers (1 925 / 2 010 EUR) under the correct labels, so rows are mapped by position: 1st 2-pax
//   row = double bed, 2nd = two single beds; the printed label is kept in availabilityText.
// Booking: contact form / WhatsApp (/book-now/ is a request form) -> 'on_request', instantBooking unset.
// robots.txt windsportscenter.com (2026-10-19): empty file (200) -> allowed.
// Requests per run: 1 per call (content and slots each fetch the page; 2 per ingest).
// Slots: level x room x season band; printed price = total for the room's guests, normalised per person (priceTotal
//   keeps the printed total), EUR, priceUnit 'package', packageNights 7.
// Known limits: surf-heavy (3 of 5 lesson days are surf), the summary says so; no year on the table.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, parseAmount, type HTMLElement } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';
import { bandFor, seasonGroups, WSC_URL, wscModified } from './wind-sports-center-kiteweek-boa-vista.js';

const NIGHTS = 7;
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');

export type WsckRoom = 'single' | 'double-bed' | 'twin' | 'double-room';
export interface WsckRow { room: WsckRoom; label: string; pax: number; total: number }
export interface WsckSeason { label: string; groups: Array<[number, number]>; rows: WsckRow[] }
export interface WsckLevel { level: 'beginner' | 'intermediate'; title: string; note: string | null; seasons: WsckSeason[] }

const ROOM_NAME: Record<WsckRoom, string> = {
  single: 'single room, 1 guest',
  'double-bed': 'room with a double bed, 2 guests',
  twin: 'room with two single beds, 2 guests',
  'double-room': 'double room, 4 guests',
};

/** Rows of one season tab, mapped by guest count and position (see header). */
export function mapWsckRows(raw: Array<{ label: string; pax: number; total: number }>): WsckRow[] {
  const out: WsckRow[] = [];
  let twoPax = 0;
  for (const r of raw) {
    let room: WsckRoom | null = null;
    if (r.pax === 1) room = 'single';
    else if (r.pax === 4) room = 'double-room';
    else if (r.pax === 2) room = twoPax++ === 0 ? 'double-bed' : 'twin';
    if (room && !out.some(o => o.room === room)) out.push({ ...r, room });
  }
  return out;
}

export function parseWsckLevels(html: string): WsckLevel[] {
  const root = parse(html);
  const out: WsckLevel[] = [];
  for (const h of root.querySelectorAll('h5.qodef-accordion-title')) {
    const title = txt(h.querySelector('.qodef-tab-title') ?? h);
    if (!/SURF\s*\+\s*KITE CAMP/i.test(title)) continue;
    const level = /INTERMEDIATE/i.test(title) ? 'intermediate' : /BEG+IN+ER/i.test(title) ? 'beginner' : null;
    if (!level || out.some(l => l.level === level)) continue;
    const body = h.nextElementSibling;
    if (!body) continue;
    const seasons: WsckSeason[] = [];
    for (const panel of body.querySelectorAll('.vc_tta-panel')) {
      const label = txt(panel.querySelector('.vc_tta-title-text'));
      const raw: Array<{ label: string; pax: number; total: number }> = [];
      for (const tr of panel.querySelectorAll('tr')) {
        const tds = tr.querySelectorAll('td').map(td => txt(td));
        if (tds.length < 2) continue;
        const pax = Number(tds[0].match(/(\d+)\s*pax/i)?.[1]);
        const total = parseAmount(tds[1]);
        if (pax > 0 && total) raw.push({ label: tds[0].replace(/\(\s+/g, '(').replace(/\s+\)/g, ')'), pax, total });
      }
      const rows = mapWsckRows(raw);
      if (label && rows.length) seasons.push({ label, groups: seasonGroups(label), rows });
    }
    out.push({ level, title, note: txt(body.querySelector('.wpb_text_column p')) || null, seasons });
  }
  return out;
}

export function buildWsckSlots(levels: WsckLevel[], anchor: string, today: string): Slot[] {
  const slots: Slot[] = [];
  for (const l of levels) {
    for (const s of l.seasons) {
      for (const g of s.groups) {
        const band = bandFor(g, anchor);
        if (band.end < today) continue;
        for (const r of s.rows) {
          slots.push({
            key: `${l.level}|${r.room}-${r.pax}|${band.start}`,
            startDate: band.start,
            endDate: band.end,
            unit: `${l.level === 'beginner' ? 'Beginner' : 'Intermediate'} surf + kite camp, ${ROOM_NAME[r.room]}`,
            price: Math.round((r.total / r.pax) * 100) / 100,
            currency: 'EUR',
            priceUnit: 'package',
            priceBasis: 'person',
            occupancy: r.pax,
            availability: 'on_request',
            availabilityText: `${s.label}: "${r.label}" EUR ${r.total} for ${r.pax} ${r.pax === 1 ? 'person' : 'persons'} (7 nights); booking by request`,
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

// --- content ------------------------------------------------------------------------------------
export function parseWsckContent(html: string): OfferContent {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript')) el.remove();
  const head = root.querySelectorAll('h2.qodef-st-title').find(h => /SURF\s*\+\s*KITEHOUSE/i.test(txt(h)));
  const listP = head?.closest('.qodef-section-title-holder')?.nextElementSibling?.nextElementSibling?.querySelector('p');
  const included = (listP?.innerHTML ?? '').split(/<br\s*\/?>/i).map(s => collapse(parse(s).text).replace(/^\*\s*/, '')).filter(Boolean);
  const levels = parseWsckLevels(html);
  const notes = levels.map(l => l.note).filter(Boolean);
  // "from" prices quote the page's whole table (every season), like the Kiteweek listing
  const table = levels.flatMap(l => l.seasons.flatMap(s => s.rows.map(r => ({ ...r, season: s.label, pp: r.total / r.pax }))));
  const cheapest = table.filter(r => r.pax === 1).sort((a, b) => a.total - b.total)[0];
  const minAll = table.slice().sort((a, b) => a.pp - b.pp)[0];
  const surfH = included.join(' ').match(/surf course \(\s*([\d,.]+)\s*hours\)/i)?.[1]?.replace(',', '.');
  const kiteH = included.join(' ').match(/kitesurf course \(\s*([\d,.]+)\s*hours\)/i)?.[1];

  const summary = [
    `Wind Sports Center's surf and kite camp week (Surf + Kitehouse) at Praia de Estoril in Sal Rei, Boa Vista (Cape Verde): 7 nights in apartments near the centre, 3 days of surf lessons${surfH ? ` (${surfH} hours)` : ''} and 2 days of kitesurf lessons${kiteH ? ` (${kiteH} hours)` : ''} with board and kite gear and radio headsets during the lessons, breakfasts and dinners, daily cleaning and transport to the beach.`,
    `Most of the coaching is surfing: beginners get 3 group surf lessons and 2 couple kite lessons, intermediate riders 3 semi-private surf and 2 semi-private kite lessons.`,
    cheapest ? `Prices depend on season (June-September, October/November/April/May, December-March) and room: from EUR ${cheapest.total.toLocaleString('en-US')} for one person in a single room (${cheapest.season})${minAll && minAll.pax > 1 && minAll.pp < cheapest.total ? ` or EUR ${minAll.total.toLocaleString('en-US')} for ${minAll.pax} sharing a room (${minAll.season})` : ''}; the price table carries no year, booking by request.` : 'Prices on request.',
  ].join(' ');

  const imgs = imageCandidates(html, WSC_URL, null, 40)
    .filter(u => !/logo|favicon|banner|livro|h4-img|boavista_Capoverde|csm_Matze/i.test(u));

  return {
    kind: 'camp',
    title: 'Wind Sports Center Surf + Kite Week, Boa Vista',
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
    optionalServices: ['Kite-only camp week (separate package)', 'Equipment rental and storage after the course'],
    accommodation: 'apartments near Praia de Estoril (Vilas na Areia aparthotel), single or shared rooms',
    mealPlan: /breakfasts/i.test(included.join(' ')) && /dinners/i.test(included.join(' ')) ? 'half_board' : 'breakfast',
    languages: ['en', 'pt', 'de'],
    rooms: [],
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: WSC_URL,
    bookingUrl: 'https://windsportscenter.com/book-now/',
    sourceText: [`included: ${included.join('; ')}`, ...notes.map(n => `level: ${n}`),
      ...levels.flatMap(l => l.seasons.map(s => `${l.level} ${s.label}: ${s.rows.map(r => `${r.label} ${r.total} EUR`).join(' | ')}`))].join('\n'),
  };
}

export async function fetchWsckSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const html = await fetchText(WSC_URL);
  const levels = parseWsckLevels(html);
  if (levels.length === 0 || levels.every(l => l.seasons.length === 0)) throw new Error('wind-sports-center surf+kite: SURF + KITE CAMP price tables not found (layout changed?)');
  const anchor = wscModified(html);
  if (!anchor) ctx?.note('dateModified missing; season bands anchored on today');
  return buildWsckSlots(levels, anchor ?? today, today);
}

export const windSportsCenterSurfKiteweekBoaVista: OfferAdapter = {
  key: 'wind-sports-center-surf-kiteweek-boa-vista',
  name: 'Wind Sports Center Surf + Kite Week, Boa Vista',
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
    return parseWsckContent(await fetchText(WSC_URL));
  },
  fetchSlots: ctx => fetchWsckSlots(new Date().toISOString().slice(0, 10), ctx),
};
