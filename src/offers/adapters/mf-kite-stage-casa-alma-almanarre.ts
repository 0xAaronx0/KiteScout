// ---------------------------------------------------------------------------
// MF Kite "Stage de kitesurf avec hébergement", L'Almanarre (Giens peninsula, Hyères, Var, France) - the school's
// week course (Stage Semaine: 5 group lessons of 3h30, Monday to Friday, max 4 per instructor, full gear) combined
// with a room in Casa Alma, the house next door to the school (private bathroom, shared living areas, two floors with
// terraces). Kind 'camp': one place, lodging + lessons, sold on one page.
//
// Data path (checked 2026-10-19): WordPress (Uncode), French, ONE page /sejour-kitesurf-hebergement/
// (dateModified 2026-07-07). The page prices the two parts SEPARATELY:
//   - "Tarifs de la Casa Alma": "Une chambre ... Hors saison : 50€/nuit ou 320€/semaine | Mi-Saison : 70€/nuit ou
//     450€/semaine | Saison : selon disponibilité", the two villa floors (3 rooms each) per week, and the season key
//     "Hors saison = octobre à mars | Mi-saison = avril, mai, juin, septembre | Saison = juillet, août et ponts".
//   - "Tarifs des stages": format groupe "Stage Semaine (5c) ... H.S 500€ SAISON 600€" with "Saison : du 04/04 au
//     11/11 | Hors Saison tout le reste de l'année" (semi-private and private formats follow in the same tabs).
// Slots: one band per stretch where room season and lesson season stay the same, price = room week (one guest) +
//   Stage Semaine group format = EUR per person for 7 nights + 5 lessons; the SUM is ours (availabilityText shows
//   both printed parts). The tables carry no year: like the other year-less tables (docs/offer-adapters.md) the
//   seasons are anchored on the page's own dateModified - one 12-month cycle from the first of the anchor's month
//   (2026-07-01 .. 2027-06-30 for the 2026-07-07 edit), bands that ended before today dropped. Summer (Saison) room
//   price is "selon disponibilité" -> price null (on request) for those bands. priceUnit 'package', packageNights 7,
//   priceBasis 'person', occupancy 1, availability 'on_request' (lessons are bookable on Bloowatch, the room
//   through Casa Alma; no combined booking).
// robots.txt www.mfkite.com (2026-10-19): WooCommerce / wp-admin / wp-json / search disallowed; pages allowed.
// Requests per run: 1 (content + slots share one memoised fetch).
// Known limits: bank-holiday "ponts" count as high season but are not dated; cleaning fee extra, linen optional
//   (no amounts); the "Avantage Groupe" price for 4 friends booking together is text only.
// Flags: instantBooking unset (the lessons alone are bookable on mfkite.bloowatch.com, the package is not);
//   liveAvailability false.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { imageCandidates, iso, jsonLd, parseAmount, runsOf } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';
import { blockLines } from './jaguaribe-lodge-fortim.js';

const SITE = 'https://www.mfkite.com';
export const MFK_URL = `${SITE}/sejour-kitesurf-hebergement/`;
const STAGE_BOOKING_URL = 'https://mfkite.bloowatch.com/booking/products/278213';
const NIGHTS = 7;

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

const MOIS: Record<string, number> = {
  janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, août: 8,
  septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12,
};
type RoomSeason = 'hors' | 'mi' | 'saison';

export interface MfkTables {
  /** "Une chambre" week price per room season (null = "selon disponibilité") */
  room: Record<RoomSeason, number | null>;
  /** month -> room season */
  roomMonths: Record<number, RoomSeason>;
  /** Stage Semaine group format: low / high lesson season */
  stage: { hs: number; saison: number } | null;
  /** lesson high season, month/day pairs ("du 04/04 au 11/11") */
  stageSeason: { from: [number, number]; to: [number, number] } | null;
  villas: string[];
  modified: string | null;
}

function seasonOf(label: string): RoomSeason | null {
  const l = label.toLowerCase().replace(/\s+/g, '');
  if (l.startsWith('hors')) return 'hors';
  if (l.startsWith('mi')) return 'mi';
  if (l.startsWith('saison')) return 'saison';
  return null;
}

/** Month range "octobre à mars" or a list "avril, mai, juin, septembre" -> months. */
function monthsOf(text: string): number[] {
  const t = text.toLowerCase();
  const range = t.match(/([a-zéû]+)\s+à\s+([a-zéû]+)/);
  if (range && MOIS[range[1]] && MOIS[range[2]]) {
    const out: number[] = [];
    for (let m = MOIS[range[1]]; ; m = (m % 12) + 1) { out.push(m); if (m === MOIS[range[2]]) break; }
    return out;
  }
  return [...t.matchAll(/[a-zéû]+/g)].map(m => MOIS[m[0]]).filter((x): x is number => !!x);
}

export function parseMfkTables(html: string): MfkTables {
  const lines = blockLines(html);
  const room: Record<RoomSeason, number | null> = { hors: null, mi: null, saison: null };
  const roomMonths: Record<number, RoomSeason> = {};
  const villas: string[] = [];
  const iRoom = lines.findIndex(l => /^Une chambre/i.test(l));
  if (iRoom >= 0) {
    for (const l of lines.slice(iRoom + 1, iRoom + 4)) {
      const m = l.match(/^(Hors saison|Mi-Saison|Saison)\s*:\s*(.*)$/i);
      if (!m) break;
      const s = seasonOf(m[1])!;
      const week = m[2].match(/([\d.,]+)\s*€\s*\/\s*semaine/i);
      room[s] = week ? parseAmount(week[1]) : null;
    }
  }
  for (const label of ['Bas de villa', 'Haut de Villa']) {
    const i = lines.findIndex(l => l.toLowerCase().startsWith(label.toLowerCase()));
    if (i < 0) continue;
    const weeks = lines.slice(i + 1, i + 4).map(l => l.match(/^(Hors saison|Mi-Saison|Saison)\s*:.*?([\d.,]+)\s*€\s*\/\s*semaine/i))
      .filter((m): m is RegExpMatchArray => !!m).map(m => `${m[1].replace(/Hors saison/i, 'low').replace(/Mi-Saison/i, 'mid').replace(/^Saison$/i, 'high')} EUR ${parseAmount(m[2])}`);
    if (weeks.length) villas.push(`${label.replace(/villa/i, 'villa')} (whole floor: 3 bedrooms, 3 bathrooms, living room, kitchen, terrace, garden): ${weeks.join(', ')} per week`);
  }
  const key = lines.find(l => /Hors saison\s*=/.test(l)) ?? '';
  for (const part of key.split('|')) {
    const m = part.match(/^\s*(Hors saison|Mi-saison|Saison)\s*=\s*(.*)$/i);
    if (!m) continue;
    for (const mo of monthsOf(m[2])) roomMonths[mo] = seasonOf(m[1])!;
  }
  let stage: MfkTables['stage'] = null;
  const iStage = lines.findIndex(l => /^Stage Semaine\b/i.test(l));
  if (iStage >= 0) {
    const win = lines.slice(iStage + 1, iStage + 5).join(' ');
    const hs = win.match(/H\.S\s*([\d.,]+)\s*€/i);
    const sa = win.match(/SAISON\s*([\d.,]+)\s*€/i);
    if (hs && sa) stage = { hs: parseAmount(hs[1])!, saison: parseAmount(sa[1])! };
  }
  const ss = lines.join(' ').match(/Saison\s*:\s*du\s*(\d{1,2})\/(\d{1,2})\s*au\s*(\d{1,2})\/(\d{1,2})/i);
  const stageSeason = ss ? { from: [+ss[2], +ss[1]] as [number, number], to: [+ss[4], +ss[3]] as [number, number] } : null;
  const modified = jsonLd(html).map(o => o.dateModified).find((d): d is string => typeof d === 'string')?.slice(0, 10) ?? null;
  return { room, roomMonths, stage, stageSeason, villas, modified };
}

export interface MfkBand { start: string; end: string; roomSeason: RoomSeason; stageHigh: boolean }

/** One 12-month cycle from the first of the anchor's month, split where the room or lesson season changes. */
export function mfkBands(t: MfkTables, anchor: string): MfkBand[] {
  if (!t.stageSeason) return [];
  const y0 = Number(anchor.slice(0, 4));
  const m0 = Number(anchor.slice(5, 7));
  const days: Array<{ date: string; room: RoomSeason; high: boolean }> = [];
  const start = Date.UTC(y0, m0 - 1, 1);
  const end = Date.UTC(y0 + 1, m0 - 1, 1);
  const md = (m: number, d: number) => m * 100 + d;
  const from = md(...t.stageSeason.from);
  const to = md(...t.stageSeason.to);
  for (let ms = start; ms < end; ms += 86400000) {
    const d = new Date(ms);
    const m = d.getUTCMonth() + 1;
    const room = t.roomMonths[m];
    if (!room) continue;
    const x = md(m, d.getUTCDate());
    days.push({ date: iso(d.getUTCFullYear(), m, d.getUTCDate()), room, high: x >= from && x <= to });
  }
  return runsOf(days, d => `${d.room}|${d.high}`).map(r => ({ start: r.start, end: r.end, roomSeason: r.first.room, stageHigh: r.first.high }));
}

const ROOM_EN: Record<RoomSeason, string> = { hors: 'low season', mi: 'mid season', saison: 'high season' };

export function buildMfkSlots(t: MfkTables, anchor: string, today: string): Slot[] {
  if (!t.stage) return [];
  return mfkBands(t, anchor).filter(b => b.end >= today).map(b => {
    const roomWeek = t.room[b.roomSeason];
    const stage = b.stageHigh ? t.stage!.saison : t.stage!.hs;
    const price = roomWeek !== null ? roomWeek + stage : null;
    return {
      key: `room-stage|${b.start}`,
      startDate: b.start,
      endDate: b.end,
      unit: 'Casa Alma room (private bathroom) + Stage Semaine (5 group lessons)',
      price,
      currency: price !== null ? 'EUR' : null,
      priceUnit: price !== null ? 'package' : null,
      priceBasis: price !== null ? 'person' : null,
      occupancy: 1,
      availability: 'on_request',
      availabilityText: `Casa Alma room ${ROOM_EN[b.roomSeason]}: ${roomWeek !== null ? `EUR ${roomWeek} per week` : 'price on request (subject to availability)'} + Stage Semaine group ${b.stageHigh ? 'high' : 'low'} season EUR ${stage} per person; lessons booked online, room with Casa Alma`,
      spotsLeft: null,
      packageNights: NIGHTS,
    };
  });
}

export function parseMfkContent(html: string): OfferContent {
  const t = parseMfkTables(html);
  const anchor = t.modified;
  const slots = anchor ? buildMfkSlots(t, anchor, '0000-00-00') : [];
  const priced = slots.filter(s => s.price !== null).map(s => s.price!);
  const summary = [
    'MF Kite, the kite school on the Almanarre beach at Hyères (Giens peninsula, south of France), combines its Stage Semaine (5 group lessons of 3h30 from Monday to Friday, max 4 riders per instructor, full gear) with a week in Casa Alma, the house next door to the school, so guests walk to the spot as soon as the wind picks up.',
    `A room with private bathroom costs ${t.room.hors ? `EUR ${t.room.hors}` : '?'} (October to March) or ${t.room.mi ? `EUR ${t.room.mi}` : '?'} (April to June, September) per week, on request in July and August; the week course costs ${t.stage ? `EUR ${t.stage.hs} (low season) or EUR ${t.stage.saison} (4 April to 11 November)` : 'extra'}${priced.length ? `, so a week with lessons starts at EUR ${Math.min(...priced)} per person` : ''}.`,
    'Lessons are booked online, the room with Casa Alma; cleaning fee extra, linen optional.',
  ].join(' ');
  const imageUrls = imageCandidates(html, MFK_URL).filter(u => !/minots|logo/i.test(u));

  return {
    kind: 'camp',
    title: 'MF Kite Week Course with Casa Alma Stay, Almanarre',
    summary,
    continent: 'Europe',
    country: 'France',
    region: "Provence-Alpes-Côte d'Azur",
    spot: "L'Almanarre, Giens (Hyères)",
    itinerarySpots: [],
    durationDays: NIGHTS + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      '7 nights in a Casa Alma room with private bathroom, next door to the school (shared living areas, terrace, parking)',
      'Stage Semaine: 5 group lessons of 3h30, Monday to Friday, max 4 per instructor',
      'Full kite gear during the lessons',
    ],
    optionalServices: [
      ...t.villas,
      'Semi-private (2 riders) or private week course instead of the group format',
      'Linen; cleaning fee extra',
    ],
    accommodation: 'room with private bathroom in a shared house next to the kite school',
    mealPlan: 'self_catering',
    languages: ['fr'],
    rooms: [],
    imageUrls: imageUrls.slice(0, 20),
    heroVideoUrl: null,
    sourceUrl: MFK_URL,
    bookingUrl: STAGE_BOOKING_URL,
    sourceText: [
      blockLines(html).slice(0, 70).join('\n'),
      `parsed: room ${JSON.stringify(t.room)}; months ${JSON.stringify(t.roomMonths)}; stage ${JSON.stringify(t.stage)}; season ${JSON.stringify(t.stageSeason)}; modified ${t.modified}`,
    ].join('\n'),
  };
}

export async function fetchMfkSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const t = parseMfkTables(await page(MFK_URL));
  if (!t.stage || t.room.hors === null || Object.keys(t.roomMonths).length < 12 || !t.stageSeason) {
    throw new Error('mf-kite: Casa Alma room table, season key or Stage Semaine prices not found (layout changed?)');
  }
  if (!t.modified) { ctx?.note('no dateModified: the year-less tables cannot be dated, price on request'); return []; }
  const slots = buildMfkSlots(t, t.modified, today);
  if (!slots.length) ctx?.note(`the season cycle anchored on ${t.modified} has passed - price on request until the page is edited`);
  return slots;
}

export const mfKiteStageCasaAlmaAlmanarre: OfferAdapter = {
  key: 'mf-kite-stage-casa-alma-almanarre',
  name: 'MF Kite Week Course with Casa Alma Stay, Almanarre',
  kind: 'camp',
  operator: {
    name: 'MF Kite',
    websiteUrl: SITE,
    rootDomain: 'mfkite.com',
    phone: '+33 6 07 02 76 13',
  },
  url: MFK_URL,
  slotMethod: 'price_table',
  liveAvailability: false,
  fetchBudget: 2,
  confidence: 'medium', // year-less tables (year from the page edit), package price = sum of two printed parts
  async fetchContent() { return parseMfkContent(await page(MFK_URL)); },
  fetchSlots: ctx => fetchMfkSlots(new Date().toISOString().slice(0, 10), ctx),
};
