// ---------------------------------------------------------------------------
// Kitesurf Adventure (KSA) - Cumbuco Classic: the school's yearly kite week in Cumbuco (Ceará, Brazil), 15th season
// in 2026. 7 days / 6 nights at a beachfront pousada with pool and breakfast, guided sessions, group lesson,
// downwinders, transfers, one group dinner, photos and sport insurance ("Pacote Velejador"); "Pacote Iniciante" adds
// 10 hours of private beginner lessons with gear. Kind 'camp'. Also home of the shared KSA helpers (the Ilha
// Experience page uses the same Wix layout and imports them).
//
// Data path (checked 2026-10-19), Wix site (robots.txt: "User-agent: * Allow: /", only "?lightbox=" disallowed):
//   dates    "DATAS | Turma I- 20 a 26 /Julho | Turma II- 10 a 16 /Agosto"; no year in the rows, the year is the page
//            title's ("CUMBUCO CLASSIC 2026"). Only the page's own DATAS block is read (the "DESTINOS" teasers below
//            list the school's other trips).
//   prices   "Investimento | Pacote Velejador | Quarto Duplo: R$ 5.544,00 ( 1 Lote) | Quarto Single: R$ 6.544,00 |
//            Pacote Iniciante | Quarto Duplo: R$8.044,00 | Quarto Single: R$ 9.044,00"; BRL, the first price lot
//            ("1 Lote", prices rise with later lots). Per person is INFERRED (Brazilian kitetrip convention, the
//            page does not say "por pessoa"; occupancy = beds in the room type). "Sem hospedagem" (R$ 3.944, no
//            accommodation) is a different product and only mentioned in the summary.
//   booking  WhatsApp / e-mail ("Fale conosco", "Confirma agora sua vaga") -> on_request, instantBooking false.
// Slots: turma x package x room type, key `<package>-<room>|<start>`, BRL per person (package). Past turmas are dropped.
// State 2026-10-19: both 2026 turmas (20-26 Jul, 10-16 Aug) are past -> 0 slots ("price on request") until the page
//   shows the 2027 dates; the parser reads whatever turmas and year the page prints.
// Requests per run: 1 (memoised across content + slots).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { imageCandidates, iso, monthOf, parseAmount, todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';
import { wixLines } from './kite-buen-hombre-eco-lodge.js';

export const KSA_SITE = 'https://www.kitesurfadventure.com.br';
export const KSA_CLASSIC_URL = `${KSA_SITE}/cumbucoclassic`;

export const KSA_OPERATOR: OperatorRef = {
  name: 'Kitesurf Adventure',
  websiteUrl: KSA_SITE,
  rootDomain: 'kitesurfadventure.com.br',
  contactEmail: 'contato@kitesurfadventure.com.br',
  whatsapp: '+5585936180532',
};

// --- shared helpers -----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
export function ksaPage(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

export interface KsaTurma { name: string; start: string; end: string; label: string }
export interface KsaPrice { pkg: 'velejador' | 'iniciante'; room: 'triplo' | 'duplo' | 'single'; price: number; lot: string | null }
export interface KsaTrip {
  year: number | null;
  turmas: KsaTurma[];
  prices: KsaPrice[];
  days: number | null;
  nights: number | null;
  noStay: number | null;      // "Sem hospedagem" price
}

/** The page's own sections, from the title down to "DESTINOS" (the teasers of the other trips follow). */
export function ksaText(html: string): string {
  const t = wixLines(html).join(' | ');
  const cut = t.search(/\|\s*DESTINOS\s*\|/);
  return cut > 0 ? t.slice(0, cut) : t;
}

/** `titleRe` matches the page title with the year, e.g. /CLASSIC\s*\|?\s*(20\d{2})/i. */
export function parseKsaTrip(html: string, titleRe: RegExp): KsaTrip {
  const t = ksaText(html).replace(/[–—]/g, '-');
  const ym = t.match(titleRe);
  const year = ym ? Number(ym[1]) : null;
  const datas = t.slice(Math.max(0, t.search(/\|\s*DATAS\s*\|/)), t.search(/Investimento/) > 0 ? t.search(/Investimento/) : undefined);
  const turmas: KsaTurma[] = [];
  if (year) {
    // "Turma I- 20 a 26 /Julho", "Turma 1: | 22 a 28 de junho", "Turma 3: 28 de julho a 3 de agosto"
    const re = /Turma\s*([IVX\d]+)\s*[-:]?\s*\|?\s*(\d{1,2})(?:\s*(?:de\s+)?([A-Za-zçÇ]+))?\s*a\s*(\d{1,2})\s*(?:\/|de)?\s*([A-Za-zçÇ]+)/g;
    for (const m of datas.matchAll(re)) {
      const m2 = monthOf(m[5].toLowerCase());
      const m1 = m[3] ? monthOf(m[3].toLowerCase()) : m2;
      if (!m1 || !m2) continue;
      const start = iso(year, m1, +m[2]);
      const end = iso(m2 < m1 ? year + 1 : year, m2, +m[4]);
      turmas.push({ name: `Turma ${m[1]}`, start, end, label: m[0].replace(/\s*\|\s*/g, ' ').trim() });
    }
  }
  const inv = t.slice(Math.max(0, t.search(/Investimento/)));
  const prices: KsaPrice[] = [];
  for (const block of inv.split(/Pacote (?=Velejador|Iniciante)/).slice(1)) {
    const pkg = /^Iniciante/.test(block) ? 'iniciante' : 'velejador';
    const body = block.split(/Sem hospedagem|Formas de pagamento/)[0];
    for (const m of body.matchAll(/Quarto (Triplo|Duplo|Single)\s*:\s*\|?\s*R\$\s?([\d.,]+)\s*\|?\s*(\(\s*(?:\d+\s*Lote|lote\s*\d+)\s*\))?/gi)) {
      const price = parseAmount(m[2]);
      if (!price) continue;
      const room = m[1].toLowerCase() as KsaPrice['room'];
      if (prices.some(p => p.pkg === pkg && p.room === room)) continue;
      prices.push({ pkg, room, price, lot: m[3] ? m[3].replace(/[()\s]+/g, ' ').trim().toLowerCase() : null });
    }
  }
  const dn = t.match(/0?(\d{1,2})\s*dias\s*\/\s*0?(\d{1,2})\s*noites/i);
  const ns = inv.match(/Sem hospedagem.*?R\$\s?([\d.,]+)/i);
  return {
    year, turmas, prices,
    days: dn ? Number(dn[1]) : null,
    nights: dn ? Number(dn[2]) : null,
    noStay: ns ? parseAmount(ns[1]) : null,
  };
}

const ROOM = { triplo: { label: 'triple room', occ: 3 }, duplo: { label: 'double room', occ: 2 }, single: { label: 'single room', occ: 1 } } as const;
const PKG = { velejador: 'Rider package (Pacote Velejador)', iniciante: 'Beginner package (Pacote Iniciante, +10 h private lessons)' } as const;

export function buildKsaSlots(trip: KsaTrip, today: string): Slot[] {
  const out: Slot[] = [];
  for (const tu of trip.turmas.filter(x => x.start >= today)) {
    for (const p of trip.prices) {
      out.push({
        key: `${p.pkg}-${p.room}|${tu.start}`,
        startDate: tu.start,
        endDate: tu.end,
        unit: `${PKG[p.pkg]}, ${ROOM[p.room].label}`,
        price: p.price,
        currency: 'BRL',
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: ROOM[p.room].occ,
        availability: 'on_request',
        availabilityText: `${tu.label}${p.lot ? ` · price ${p.lot}` : ''}`,
        spotsLeft: null,
      });
    }
  }
  return out;
}

const human = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/** Dates sentence for the summary: next turmas, or "not published yet" with last year's dates. */
export function ksaDatesLine(trip: KsaTrip, today: string, yearly: boolean): string {
  const next = trip.turmas.filter(x => x.start >= today);
  if (next.length) return `Dates ${trip.year}: ${next.map(x => `${human(x.start)} to ${human(x.end)}`).join(' and ')}.`;
  const nextYear = trip.year ? trip.year + 1 : null;
  return `${yearly ? 'Runs every year; ' : ''}${nextYear ?? 'the next'} dates are not published yet${trip.turmas.length ? ` (${trip.year}: ${trip.turmas.map(x => `${human(x.start)} to ${human(x.end)}`).join(' and ')})` : ''}.`;
}

export function ksaPriceLine(trip: KsaTrip): string {
  if (!trip.prices.length) return '';
  const min = Math.min(...trip.prices.map(p => p.price));
  const max = Math.max(...trip.prices.map(p => p.price));
  const fmt = (n: number) => n.toLocaleString('en-US');
  return ` Last published prices: BRL ${fmt(min)} to ${fmt(max)} per person depending on package and room (first price lot).`;
}

export async function fetchKsaSlots(url: string, titleRe: RegExp, today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const trip = parseKsaTrip(await ksaPage(url), titleRe);
  if (!trip.year || trip.turmas.length === 0) throw new Error(`kitesurf-adventure: no "<year>" title or "Turma" dates found on ${url} (layout changed?)`);
  if (trip.prices.length === 0) throw new Error(`kitesurf-adventure: no "Quarto ...: R$" prices found on ${url} (layout changed?)`);
  const slots = buildKsaSlots(trip, today);
  if (slots.length === 0) ctx?.note(`all ${trip.year} turmas are past (${trip.turmas.map(x => x.start).join(', ')}); next dates not published yet`);
  return slots;
}

// --- Cumbuco Classic ---------------------------------------------------------------------------------
export const KSA_CLASSIC_TITLE = /CLASSIC\s*\|?\s*(20\d{2})/i;

export function parseKsaClassicContent(html: string, today = todayIso()): OfferContent {
  const trip = parseKsaTrip(html, KSA_CLASSIC_TITLE);
  const nights = trip.nights ?? 6;
  const season = ksaText(html).match(/(\d{1,2})\s*[ª°]\s*temporad/i)?.[1] ?? null;
  const imgs = imageCandidates(html, KSA_CLASSIC_URL, null, 40).filter(u => !/logo|whatsapp|icon/i.test(u));
  return {
    kind: 'camp',
    title: 'Kitesurf Adventure Cumbuco Classic',
    summary: [
      `Kitesurf Adventure's yearly kite week in Cumbuco (Ceará, Brazil)${season && trip.year ? `, in its ${season}th season in ${trip.year}` : ''}: ${nights + 1} days / ${nights} nights at a beachfront pousada with pool and breakfast, guided sessions on the lagoons and the sea around Cumbuco, a group lesson, downwinders, transfers, one group dinner, photos and sport insurance.`,
      'The beginner package adds 10 hours of private lessons with equipment; all levels and non-kiting companions welcome.',
      `${ksaDatesLine(trip, today, true)}${ksaPriceLine(trip)}${trip.noStay ? ` Joining without accommodation: BRL ${trip.noStay.toLocaleString('en-US')}.` : ''}`,
    ].join(' '),
    continent: 'South America',
    country: 'Brazil',
    region: 'Ceará',
    spot: 'Cumbuco',
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      `${nights} nights at a beachfront pousada in Cumbuco with pool and breakfast`,
      'Guided kite sessions and a group lesson by the Kitesurf Adventure instructors, downwinders',
      'Transfer in/out and transport to the spots (buggy / 4x4)',
      'Water and fruit on the water, one group dinner, professional photos, sport insurance',
      'Beginner package: 10 hours of private lessons with equipment',
    ],
    optionalServices: ['Equipment rental', 'Private advanced lessons', 'Flights', 'Non-kiting companion (price on request)'],
    accommodation: 'beachfront pousada with pool (double, triple or single room)',
    mealPlan: 'breakfast',
    languages: ['pt'],
    rooms: [],
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KSA_CLASSIC_URL,
    bookingUrl: KSA_CLASSIC_URL,
    sourceText: [
      `page: ${ksaText(html)}`,
      `parsed: year ${trip.year}; turmas ${trip.turmas.map(x => `${x.start}..${x.end}`).join(', ')}; prices ${trip.prices.map(p => `${p.pkg}/${p.room} BRL ${p.price}`).join(', ')}; no stay ${trip.noStay}`,
    ].join('\n'),
  };
}

export const kitesurfAdventureCumbucoClassic: OfferAdapter = {
  key: 'kitesurf-adventure-cumbuco-classic',
  name: 'Kitesurf Adventure Cumbuco Classic',
  kind: 'camp',
  operator: KSA_OPERATOR,
  url: KSA_CLASSIC_URL,
  slotMethod: 'html_dates',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() { return parseKsaClassicContent(await ksaPage(KSA_CLASSIC_URL)); },
  fetchSlots: ctx => fetchKsaSlots(KSA_CLASSIC_URL, KSA_CLASSIC_TITLE, todayIso(), ctx),
};
