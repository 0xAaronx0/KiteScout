// ---------------------------------------------------------------------------
// Kitesurf Adventure (KSA) - Cumbuco Classic: the school's yearly kite week in Cumbuco (Ceará, Brazil), 15th season
// in 2026. 7 days / 6 nights at a beachfront pousada with pool and breakfast, guided sessions, group lesson,
// downwinders, transfers, one group dinner, photos and sport insurance ("Pacote Velejador"); "Pacote Iniciante" adds
// 10 hours of private beginner lessons with gear. Kind 'camp'. Also home of the shared KSA helpers (the Ilha
// Experience page uses the same Wix layout and imports them).
//
// Data path (relaunch seen 2026-11-11; robots.txt: "User-agent: * Allow: /", only "?lightbox=" disallowed):
//   The site moved from Wix pages to a static site on Wix Headless: /cumbucoclassic and /ilhaexperience are an empty
//   shell (title + one sentence), every trip lives in one static script /trips.js (`var TRIPS={classic:{...},
//   ilha:{...}}`, rendered in the browser). It is READ AS TEXT, never executed: the fields are T3("pt","en","fr")
//   strings and plain arrays, picked out by parseKsaTripsJs.
//   dates    the trip's `status`, e.g. Ilha "27/09 a 02/10/2027 · vagas abertas"; Classic "Edição 2027 · lista de
//            prioridade" (no dates yet). Each "dd/mm[/yyyy] a dd/mm/yyyy" is one turma.
//   prices   `prices: {cols: [Triplo, Duplo, Single], rows: [[Velejador, [6734, 7574, 9674]], [Iniciante ...], [Sem
//            hospedagem, [3944, null]], [Acompanhante, ...]], note: "Valores da edição 2026 (1º lote), por pessoa. ...
//            Valores 2027 sob consulta."}`: BRL per person (now printed), first lot. The note's edition year is the
//            year the prices belong to: turmas of a later year get no price (price on request, the note says so) and
//            the prices go out as last published, dated with that edition's turmas (KSA_EDITIONS, from the old pages).
//            "Sem hospedagem" (no accommodation) is a different product and only mentioned in the summary.
//   booking  WhatsApp / e-mail ("Reservar", "Quero minha vaga") -> on_request, instantBooking false.
//   Before the relaunch (checked 2026-10-19) the same facts sat in the Wix page text ("DATAS | Turma I- 20 a 26
//   /Julho ...", "Investimento | Pacote Velejador | Quarto Duplo: R$ 5.544,00 ( 1 Lote)", year in the page title).
// Slots: turma x package x room type, key `<package>-<room>|<start>`, BRL per person (package). Past turmas are dropped.
// Requests per run: 1 (/trips.js, memoised across content + slots and across both KSA adapters).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { iso, todayIso } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';
import { ALL_DATES } from '../types.js';

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
export const KSA_TRIPS_JS = `${KSA_SITE}/trips.js`;
const memo = new Map<string, { at: number; p: Promise<string> }>();
export function ksaPage(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: url.endsWith('.js') ? 'application/javascript' : 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

export interface KsaTurma { name: string; start: string; end: string; label: string }
export interface KsaPrice { pkg: 'velejador' | 'iniciante'; room: 'triplo' | 'duplo' | 'single'; price: number; lot: string | null }
export interface KsaTrip {
  year: number | null;        // the edition the page advertises (status / turmas)
  priceYear: number | null;   // the edition the printed prices belong to ("Valores da edição 2026")
  turmas: KsaTurma[];
  prices: KsaPrice[];
  days: number | null;
  nights: number | null;
  noStay: number | null;      // "Sem hospedagem" price
  status: string;             // EN status line, e.g. "27 Sep - 2 Oct 2027 · spots open"
  priceNote: string;          // EN price note
  sub: string;                // EN intro
  included: string[];         // EN
  excluded: string[];         // EN
  route: string[];            // EN "Place: text"
  images: string[];           // original Wix files (hero, card, gallery)
}

/** The 2026 turmas as the old Wix pages printed them (recorded 2026-10-19): the dates of the "edição 2026" prices. */
export const KSA_EDITIONS: Record<string, Record<number, Array<[string, string]>>> = {
  classic: { 2026: [['2026-07-20', '2026-07-26'], ['2026-08-10', '2026-08-16']] },
  ilha: { 2026: [['2026-06-22', '2026-06-28'], ['2026-09-21', '2026-09-27']] },
};

const WIX_MEDIA = 'https://static.wixstatic.com/media/a6f15c_';
const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
const unq = (x: string): string => x.replace(/\\(.)/g, '$1').replace(/<[^>]+>/g, '').replace(/\s*[–—]\s*/g, ' - ').replace(/\s+/g, ' ').trim();

/** The `<key>:{...}` object of TRIPS in /trips.js, by brace matching outside string literals. */
export function ksaTripBlock(js: string, key: string): string | null {
  const at = js.search(new RegExp(String.raw`(?:^|[\s,{])${key}:\{page:`));
  if (at < 0) return null;
  const open = js.indexOf('{', at);
  let depth = 0, inStr = false;
  for (let i = open; i < js.length; i++) {
    const c = js[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return js.slice(open, i + 1);
  }
  return null;
}
/** T3("pt","en","fr") after `field:` -> [pt, en, fr] */
function t3(block: string, field: string): [string, string, string] | null {
  const m = block.match(new RegExp(String.raw`${field}:T3\(${STR},${STR},${STR}\)`));
  return m ? [unq(m[1]), unq(m[2]), unq(m[3])] : null;
}
/** T3([...],[...],[...]) of string lists after `field:` -> the EN list */
function t3List(block: string, field: string): string[] {
  const m = block.match(new RegExp(String.raw`${field}:T3\((\[[^\]]*\]),(\[[^\]]*\]),\[[^\]]*\]\)`));
  return m ? [...m[2].matchAll(new RegExp(STR, 'g'))].map(x => unq(x[1])) : [];
}

/** One trip of /trips.js. `key` is the TRIPS key ("classic", "ilha"). */
export function parseKsaTripsJs(js: string, key: string): KsaTrip | null {
  const b = ksaTripBlock(js, key);
  if (!b) return null;
  const status = t3(b, 'status');
  const turmas: KsaTurma[] = [];
  for (const m of (status?.[0] ?? '').matchAll(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\s*a\s*(\d{1,2})\/(\d{1,2})\/(20\d{2})/g)) {
    const y2 = +m[6], m1 = +m[2], m2 = +m[5];
    const y1 = m[3] ? +m[3] : (m1 > m2 ? y2 - 1 : y2);
    turmas.push({ name: `Turma ${turmas.length + 1}`, start: iso(y1, m1, +m[1]), end: iso(y2, m2, +m[4]), label: m[0] });
  }
  const edition = (status?.[0] ?? '').match(/Edi[çc][ãa]o\s*(20\d{2})/i);
  const year = turmas.length ? Number(turmas[0].start.slice(0, 4)) : edition ? Number(edition[1]) : null;
  // prices: cols (PT) + rows [[T3(pt,en,fr),[n|null,...]],...] + note
  const pb = b.match(/prices:\{cols:T3\((\[[^\]]*\])[\s\S]*?\),rows:(\[[\s\S]*?\]\]\]),note:/);
  const cols = pb ? [...pb[1].matchAll(new RegExp(STR, 'g'))].map(x => unq(x[1]).toLowerCase()) : [];
  const note = t3(b, 'note') ?? ['', '', ''];
  const lot = note[0].match(/(\d+)\s*[º°o]?\s*lote/i);
  const prices: KsaPrice[] = [];
  let noStay: number | null = null;
  for (const r of (pb?.[2] ?? '').matchAll(new RegExp(String.raw`\[T3\(${STR},${STR},${STR}\),\[([^\]]*)\]\]`, 'g'))) {
    const label = unq(r[1]);
    const vals = r[4].split(',').map(v => (/^\s*\d+\s*$/.test(v) ? Number(v) : null));
    if (/^Sem hospedagem/i.test(label)) { noStay = vals.find(v => v) ?? null; continue; }
    const pkg = /^Velejador/i.test(label) ? 'velejador' : /^Iniciante/i.test(label) ? 'iniciante' : null;
    if (!pkg) continue; // "Acompanhante" (companion): no price in the row
    vals.forEach((price, i) => {
      const room = cols[i] as KsaPrice['room'];
      if (price && (room === 'triplo' || room === 'duplo' || room === 'single')) prices.push({ pkg, room, price, lot: lot ? `lot ${lot[1]}` : null });
    });
  }
  const py = note[0].match(/edi[çc][ãa]o\s*(20\d{2})/i);
  const stats = b.match(/stats:\[\["(\d{1,2})\s*·\s*(\d{1,2})"/);
  const route = [...(b.match(/route:(\[[\s\S]*?\]),\s*\n?\s*gallery:/)?.[1] ?? '')
    .matchAll(new RegExp(String.raw`\[(?:${STR}|T3\(${STR},${STR},${STR}\)),T3\(${STR},${STR},${STR}\)\]`, 'g'))]
    .map(x => `${unq(x[1] ?? x[3])}: ${unq(x[6])}`);
  const ids = [b.match(/hero:"([^"]+)"/)?.[1], b.match(/card:"([^"]+)"/)?.[1],
    ...[...(b.match(/gallery:\[([^\]]*)\]/)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map(x => x[1])].filter((x): x is string => !!x);
  return {
    year, priceYear: py ? Number(py[1]) : null, turmas, prices,
    days: stats ? Number(stats[1]) : null, nights: stats ? Number(stats[2]) : null, noStay,
    status: status?.[1] ?? '', priceNote: note[1], sub: t3(b, 'sub')?.[1] ?? '',
    included: t3List(b, 'incl'), excluded: t3List(b, 'excl'), route,
    images: [...new Set(ids)].map(id => WIX_MEDIA + id),
  };
}

const ROOM = { triplo: { label: 'triple room', occ: 3 }, duplo: { label: 'double room', occ: 2 }, single: { label: 'single room', occ: 1 } } as const;
const PKG = { velejador: 'Rider package (Pacote Velejador)', iniciante: 'Beginner package (Pacote Iniciante, +10 h private lessons)' } as const;

/** turma x package x room; a turma of a later year than the printed prices gets no price (on request). */
export function buildKsaSlots(trip: KsaTrip, today: string): Slot[] {
  const out: Slot[] = [];
  for (const tu of trip.turmas.filter(x => x.start >= today)) {
    const stale = trip.priceYear !== null && Number(tu.start.slice(0, 4)) > trip.priceYear;
    for (const p of trip.prices) {
      out.push({
        key: `${p.pkg}-${p.room}|${tu.start}`,
        startDate: tu.start,
        endDate: tu.end,
        unit: `${PKG[p.pkg]}, ${ROOM[p.room].label}`,
        price: stale ? null : p.price,
        currency: 'BRL',
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: ROOM[p.room].occ,
        availability: 'on_request',
        availabilityText: stale
          ? `${tu.label} · ${tu.start.slice(0, 4)} prices on request (${trip.priceYear} edition: BRL ${p.price.toLocaleString('en-US')}, ${p.lot ?? 'first lot'})`
          : `${tu.label}${p.lot ? ` · price ${p.lot}` : ''}`,
        spotsLeft: null,
      });
    }
  }
  return out;
}

/** The printed prices as slots of the edition they belong to (KSA_EDITIONS), for FetchContext.lastPublished. */
export function ksaEditionSlots(trip: KsaTrip, key: string): Slot[] {
  const dates = trip.priceYear !== null ? KSA_EDITIONS[key]?.[trip.priceYear] : undefined;
  if (!dates) return [];
  const edition: KsaTrip = { ...trip, turmas: dates.map(([start, end], i) => ({ name: `Turma ${i + 1}`, start, end, label: `${trip.priceYear} edition, ${start} to ${end}` })) };
  return buildKsaSlots(edition, ALL_DATES);
}

const human = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/** Dates sentence for the summary: next turmas, or "not published yet" with the dates of the priced edition. */
export function ksaDatesLine(trip: KsaTrip, key: string, today: string, yearly: boolean): string {
  const next = trip.turmas.filter(x => x.start >= today);
  if (next.length) return `Dates ${trip.year}: ${next.map(x => `${human(x.start)} to ${human(x.end)}`).join(' and ')}.`;
  const past = trip.priceYear !== null ? KSA_EDITIONS[key]?.[trip.priceYear] ?? [] : [];
  return `${yearly ? 'Runs every year; ' : ''}${trip.year ?? 'the next'} dates are not published yet${past.length ? ` (${trip.priceYear}: ${past.map(([a, b]) => `${human(a)} to ${human(b)}`).join(' and ')})` : ''}.`;
}

export function ksaPriceLine(trip: KsaTrip): string {
  if (!trip.prices.length) return '';
  const min = Math.min(...trip.prices.map(p => p.price));
  const max = Math.max(...trip.prices.map(p => p.price));
  const fmt = (n: number) => n.toLocaleString('en-US');
  const later = trip.year !== null && trip.priceYear !== null && trip.year > trip.priceYear;
  return ` ${later ? `Prices of the ${trip.priceYear} edition` : 'Published prices'}: BRL ${fmt(min)} to ${fmt(max)} per person depending on package and room (first price lot)${later ? `; ${trip.year} prices on request` : ''}.`;
}

export async function loadKsaTrip(key: string): Promise<KsaTrip> {
  const trip = parseKsaTripsJs(await ksaPage(KSA_TRIPS_JS), key);
  if (!trip) throw new Error(`kitesurf-adventure: trip "${key}" not found in ${KSA_TRIPS_JS} (layout changed?)`);
  if (!trip.year) throw new Error(`kitesurf-adventure: no edition year or "dd/mm a dd/mm/yyyy" dates in the "${key}" status (layout changed?)`);
  if (trip.prices.length === 0) throw new Error(`kitesurf-adventure: no prices rows for "${key}" in ${KSA_TRIPS_JS} (layout changed?)`);
  return trip;
}

export async function fetchKsaSlots(key: string, today: string, ctx?: Pick<FetchContext, 'note' | 'lastPublished'>): Promise<Slot[]> {
  const trip = await loadKsaTrip(key);
  const slots = buildKsaSlots(trip, today);
  // past turmas of the page plus the edition the printed prices belong to
  ctx?.lastPublished?.([...buildKsaSlots(trip, ALL_DATES).filter(s => s.price !== null && !slots.some(x => x.key === s.key)), ...ksaEditionSlots(trip, key)]);
  if (slots.length === 0) ctx?.note(`${trip.year} dates not published yet (status "${trip.status}"); prices of the ${trip.priceYear ?? '?'} edition`);
  else if (slots.every(s => s.price === null)) ctx?.note(`${trip.year} dates published, prices on request (printed prices are the ${trip.priceYear} edition's)`);
  return slots;
}

// --- Cumbuco Classic ---------------------------------------------------------------------------------
export function parseKsaClassicContent(js: string, today = todayIso()): OfferContent {
  const trip = parseKsaTripsJs(js, 'classic');
  if (!trip) throw new Error(`kitesurf-adventure: trip "classic" not found in ${KSA_TRIPS_JS}`);
  const nights = trip.nights ?? 6;
  const season = trip.sub.match(/(\d{1,2})\s*seasons/i)?.[1] ?? null;
  return {
    kind: 'camp',
    title: 'Kitesurf Adventure Cumbuco Classic',
    summary: [
      `Kitesurf Adventure's yearly kite week in Cumbuco (Ceará, Brazil)${season ? `, run for ${season} seasons` : ''}: ${nights + 1} days / ${nights} nights at a beachfront pousada with pool and breakfast, guided sessions on the lagoons and the sea around Cumbuco, a group lesson, downwinders, transfers, one group dinner, photos and sport insurance.`,
      'The beginner package adds 10 hours of private lessons with equipment; all levels and non-kiting companions welcome.',
      `${ksaDatesLine(trip, 'classic', today, true)}${ksaPriceLine(trip)}${trip.noStay ? ` Joining without accommodation: BRL ${trip.noStay.toLocaleString('en-US')}.` : ''}`,
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
    includedServices: trip.included.length ? trip.included : [
      `${nights} nights at a beachfront pousada in Cumbuco with pool and breakfast`,
      'Guided kite sessions and a group lesson by the Kitesurf Adventure instructors, downwinders',
    ],
    optionalServices: [...trip.excluded, 'Non-kiting companion (price on request)'],
    accommodation: 'beachfront pousada with pool (double, triple or single room)',
    mealPlan: 'breakfast',
    languages: ['pt', 'en', 'fr'], // site in PT / EN / FR since the relaunch (2026-11-11)
    rooms: [],
    imageUrls: trip.images.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KSA_CLASSIC_URL,
    bookingUrl: KSA_CLASSIC_URL,
    sourceText: [
      `trips.js classic: ${trip.sub} | status: ${trip.status} | prices: ${trip.priceNote}`,
      `route: ${trip.route.join(' | ')}`,
      `included: ${trip.included.join('; ')} | not included: ${trip.excluded.join('; ')}`,
      `parsed: edition ${trip.year}; prices of ${trip.priceYear}; turmas ${trip.turmas.map(x => `${x.start}..${x.end}`).join(', ') || 'none'}; prices ${trip.prices.map(p => `${p.pkg}/${p.room} BRL ${p.price}`).join(', ')}; no stay ${trip.noStay}`,
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
  async fetchContent() { return parseKsaClassicContent(await ksaPage(KSA_TRIPS_JS)); },
  fetchSlots: ctx => fetchKsaSlots('classic', todayIso(), ctx),
};
