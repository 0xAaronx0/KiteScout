// ---------------------------------------------------------------------------
// Swiss Snowkiting School, Simplon Pass (Valais, Switzerland) - SNOWKITE packages (kiting on snow, not water):
// a snowkite course + nights with breakfast at Hotel Monte Leone on the pass. Four packages: Beginner (2-day course,
// 2 nights), Advanced (transition course for kitesurfers + supervised testing, 2 nights), Training (3-day course,
// 4 nights), Kite & Fly (1-day course + tandem paragliding flight at Belalp, 2 nights). Operator Kite Rider GmbH
// (Ried-Brig), which also runs the Ozone / GIN kite shop and test center on the pass.
//
// Data path (checked 2026-10-19): Craft CMS, server-rendered.
//   slots    /en/packages: one card per package - h3.kurs (data-preis = the price, data-kurs = id), the bullet list
//            ("2 nights in a double room with breakfast ..."), "CHF 690.– (per person)" and "Additional charge for single
//            room: CHF 20.–". The booking modal's month list (data-month / data-year: November 2026 .. April 2027) is
//            the bookable season -> one season band per package (datePrecision 'season').
//   content  /en/packages + /en/location (spot description and photos).
// Booking: "Check availability" POSTs to /en/check-availability with a per-session CSRF token; that is a session-bound
//   call, not used (never bypass) -> availability 'unknown'; instantBooking left unset (the result step was not seen).
// robots.txt (2026-10-19): none (the site answers /robots.txt with its HTML page) -> all allowed.
// Requests per run: content 2, slots 1 (memoised: 0 extra when content ran in the same process).
// Prices: CHF per person (printed "(per person)"), for the package's nights in a double room; the single-room surcharge
//   ("Additional charge for single room: CHF 20.–") goes into availabilityText (not stated whether per night).
// Training package = 4 nights (its own bullet "4 nights in a double room"; the modal's data-dauer=3 is the course days).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, iso, parse, parseAmount, todayIso, type HTMLElement } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.snowkiting.ch';
export const SSS_PACKAGES_URL = `${SITE}/en/packages`;
export const SSS_LOCATION_URL = `${SITE}/en/location`;

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
const keyPart = (s: string): string => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function mainRoot(html: string): HTMLElement {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  return root.querySelector('main') ?? root;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface SssPackage {
  id: string | null;
  name: string;
  price: number;
  currency: string;
  perPerson: boolean;
  singleSurcharge: number | null;
  nights: number | null;
  features: string[];
}

/** The package cards: h3.kurs + its list + "CHF 690.– (per person)". */
export function parseSssPackages(html: string): SssPackage[] {
  const out: SssPackage[] = [];
  for (const card of mainRoot(html).querySelectorAll('.card')) {
    const h = card.querySelector('h3.kurs');
    if (!h) continue;
    const name = txt(h);
    const features = card.querySelectorAll('li').map(li => txt(li)).filter(Boolean);
    const priceText = txt(card.querySelector('.card-preis')) || txt(card);
    const m = priceText.match(/(CHF|EUR|€)\s*([\d'.,]+)/);
    const amount = m ? parseAmount(m[2].replace(/'/g, '')) : null;
    const fromAttr = parseAmount(h.getAttribute('data-preis') ?? '');
    const price = amount ?? fromAttr;
    if (!name || !price) continue;
    const single = priceText.match(/single room:?\s*(?:CHF|EUR|€)\s*([\d'.,]+)/i);
    const nightsLine = features.map(f => f.match(/(\d+)\s+nights?\b/i)).find(Boolean);
    out.push({
      id: h.getAttribute('data-kurs') ?? null,
      name,
      price,
      currency: !m || m[1] === 'CHF' ? 'CHF' : 'EUR',
      perPerson: /per person/i.test(priceText),
      singleSurcharge: single ? parseAmount(single[1].replace(/'/g, '')) : null,
      nights: nightsLine ? Number(nightsLine[1]) : null,
      features,
    });
  }
  return out;
}

/** The booking modal's month list ("November 2026" .. "April 2027") -> the bookable season. */
export function parseSssSeason(html: string): { start: string; end: string; months: string[] } | null {
  const months: Array<{ y: number; m: number; label: string }> = [];
  for (const o of parse(html).querySelectorAll('select.select-month-and-year option[data-month]')) {
    const m = Number(o.getAttribute('data-month'));
    const y = Number(o.getAttribute('data-year'));
    if (!m || !y) continue;
    const label = collapse(o.text);
    if (!months.some(x => x.y === y && x.m === m)) months.push({ y, m, label });
  }
  if (!months.length) return null;
  months.sort((a, b) => a.y - b.y || a.m - b.m);
  const first = months[0];
  const last = months[months.length - 1];
  const lastDay = new Date(Date.UTC(last.y, last.m, 0)).getUTCDate();
  return { start: iso(first.y, first.m, 1), end: iso(last.y, last.m, lastDay), months: months.map(x => x.label) };
}

export function buildSssSlots(pkgs: SssPackage[], season: { start: string; end: string }, today: string): Slot[] {
  if (season.end < today) return [];
  const seasonKey = `${season.start.slice(0, 4)}-${season.end.slice(2, 4)}`;
  return pkgs.map(p => ({
    key: `${keyPart(p.name.replace(/\bpackage\b/i, ''))}|${seasonKey}`,
    startDate: season.start,
    endDate: season.end,
    unit: `${p.name}${p.nights ? ` (${p.nights} nights, double room with breakfast)` : ''}`,
    price: p.price,
    currency: p.currency,
    priceUnit: 'package',
    priceBasis: p.perPerson ? 'person' : null,
    occupancy: null,
    availability: 'unknown',
    availabilityText: `Dates checked on the school's own availability form${p.singleSurcharge ? `; single room +${p.currency} ${p.singleSurcharge}` : ''}`,
    spotsLeft: null,
    datePrecision: 'season',
    packageNights: p.nights,
  }));
}

/** Photos: originals where linked, else the largest rendition (_xxl > _xl > _contentLgUp > _lg). */
export function sssImages(...pages: string[]): string[] {
  const rank = (size: string | undefined): number => ({ '': 5, _xxl: 4, _xl: 3, _contentLgUp: 2, _lg: 1 } as Record<string, number>)[size ?? ''] ?? 0;
  const best = new Map<string, { url: string; r: number }>();
  for (const html of pages) {
    for (const m of html.matchAll(/https:\/\/www\.snowkiting\.ch\/assets\/img\/server\/fotos\/(?:(_[A-Za-z]+)\/)?(?:\d+\/)?([^"'\s)]+)/gi)) {
      if (!/\.(jpe?g|png|webp)$/i.test(m[2])) continue;
      const base = m[2].toLowerCase().replace(/\.jpe?g\.jpe?g$/, '.jpg');
      const r = rank(m[1]);
      const hit = best.get(base);
      if (!hit || r > hit.r) best.set(base, { url: m[0], r });
    }
  }
  return [...best.values()].filter(x => x.r > 0).map(x => x.url);
}

export interface SssPages { packages: string; location: string }

export function parseSssContent(p: SssPages, today = todayIso()): OfferContent {
  const pkgs = parseSssPackages(p.packages);
  const season = parseSssSeason(p.packages);
  const loc = mainRoot(p.location);
  const locText = txt(loc);
  const intro = txt(mainRoot(p.packages).querySelector('.block.text'));
  const fmt = (n: number): string => n.toLocaleString('en-US');
  const cheapest = pkgs.length ? pkgs.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const monthName = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const pkgLine = pkgs.map(x => `${x.name.replace(/\s*package$/i, '').replace(/\s*snowkite$/i, '')} ${x.currency} ${fmt(x.price)}${x.nights ? ` (${x.nights} nights)` : ''}`).join(', ');

  const summary = [
    'The Swiss Snowkiting School runs snowkiting packages - kiting on snow with skis or a snowboard, not on water - on the Simplon Pass (2,006 m) in Valais, where the school also has its kite shop and the Ozone / GIN test center.',
    'Each package combines a snowkite course with the kite gear and nights in a double room with breakfast at Hotel Monte Leone on the pass; the beginner package has a 2-day course, the advanced one a transition course for kitesurfers, the training package a 3-day course with 4 nights, and Kite & Fly adds a tandem paragliding flight at Belalp.',
    pkgs.length ? `Prices per person: ${pkgLine}.` : '',
    season && season.end >= today ? `The packages can be booked from ${monthName(season.start)} to ${monthName(season.end)}; dates are checked on the school's own availability form.` : 'The next season dates are not on the page yet.',
  ].filter(Boolean).join(' ');

  return {
    kind: 'camp',
    title: 'Swiss Snowkiting School Snowkite Packages, Simplon Pass',
    summary,
    continent: 'Europe',
    country: 'Switzerland',
    region: 'Valais',
    spot: 'Simplon Pass, Valais',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: (cheapest?.nights ?? 2) + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: pkgs.some(x => x.features.some(f => /kite equipment is included/i.test(f))),
    beginnerFriendly: pkgs.some(x => /beginner/i.test(x.name)),
    includedServices: [
      'Snowkite course with the kite equipment (length by package)',
      'Nights in a double room with breakfast at Hotel Monte Leone, Simplon Pass',
      ...(pkgs.some(x => /fly/i.test(x.name)) ? ['Kite & Fly package: one tandem paragliding flight at Belalp'] : []),
    ],
    optionalServices: [
      ...pkgs.flatMap(x => x.features.filter(f => /extension possible/i.test(f)).map(f => `${x.name}: course extension ${f.replace(/^.*?extension possible/i, 'possible').replace(/\.$/, '')}`)),
      ...pkgs.filter(x => x.singleSurcharge).map(x => `${x.name}: single room +${x.currency} ${x.singleSurcharge}`),
      'Vouchers for the packages',
    ],
    accommodation: 'Hotel Monte Leone on the Simplon Pass (double rooms, single on request)',
    mealPlan: 'breakfast',
    languages: ['de', 'en', 'fr'], // site in DE / EN / FR (2026-10-19)
    rooms: [],
    imageUrls: sssImages(p.packages, p.location).slice(0, 20),
    heroVideoUrl: null,
    sourceUrl: SSS_PACKAGES_URL,
    bookingUrl: SSS_PACKAGES_URL,
    sourceText: [
      `intro: ${intro}`,
      `season (booking months): ${season?.months.join(', ') ?? '?'}`,
      ...pkgs.map(x => `${x.name} (id ${x.id}): ${x.currency} ${x.price}${x.perPerson ? ' per person' : ''}; single +${x.singleSurcharge ?? '?'}; ${x.features.join('; ')}`),
      `location: ${locText}`,
    ].join('\n'),
  };
}

export async function fetchSssSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const html = await page(SSS_PACKAGES_URL);
  const pkgs = parseSssPackages(html);
  const season = parseSssSeason(html);
  if (pkgs.length < 2) throw new Error(`swiss-snowkiting-school: package cards not found or changed (${pkgs.length} parsed)`);
  if (!season) throw new Error('swiss-snowkiting-school: booking month list not found (layout changed?)');
  const slots = buildSssSlots(pkgs, season, today);
  if (!slots.length) ctx?.note(`bookable season ${season.start}..${season.end} is over; no new months listed yet`);
  return slots;
}

// --- adapter ----------------------------------------------------------------------------------
export const swissSnowkitingSchoolPackagesSimplon: OfferAdapter = {
  key: 'swiss-snowkiting-school-packages-simplon',
  name: 'Swiss Snowkiting School - Snowkite Packages, Simplon Pass',
  kind: 'camp',
  disciplines: ['snowkite'],
  operator: {
    name: 'Swiss Snowkiting School (Kite Rider GmbH)',
    websiteUrl: `${SITE}/en/`,
    rootDomain: 'snowkiting.ch',
    contactEmail: 'info@snowkiting.ch',
    phone: '+41 78 628 59 73',
  },
  url: SSS_PACKAGES_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  confidence: 'medium',
  async fetchContent() {
    const packages = await page(SSS_PACKAGES_URL);
    const location = await page(SSS_LOCATION_URL);
    return parseSssContent({ packages, location });
  },
  fetchSlots: ctx => fetchSssSlots(todayIso(), ctx),
};
