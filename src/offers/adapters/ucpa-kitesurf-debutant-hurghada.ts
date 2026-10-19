// ---------------------------------------------------------------------------
// UCPA "Kitesurf spécial débutant", Hurghada (Red Sea, Egypt) - UCPA's (French non-profit sports-holiday operator)
// beginner kite week at its Hurghada site (Hotel Bellagio): 7 nights in a shared room of 2-3, full board, 5 days of
// kitesurf (or another activity when there is no wind) with 1 instructor per 4 students, all gear, spot transfers.
// The "Kitesurf coaching perfectionnement" week (riders who master the water start) runs on the same dates at the
// same hotel and is a second unit of this listing.
//
// This file also holds the SHARED UCPA parser used by the other UCPA adapters (Dakhla, Essaouira, Djerba,
// Cape Town): every ucpa.com product page is an AMP page whose booking box loads its own state
//   <amp-state id="reserve" src="/api/product/<product id>?agency=1-1-1&...&locale=fr&workspace=speedboat">
// i.e. the site's own anonymous calendar JSON (robots.txt 2026-10-19 disallows /cgi/, /af/page/, /af/ucpa/, /xp/,
// Panier.do, search pages; /sejour/ and /api/product/ are allowed). `offersInfo` lists one row per departure date
// and transport variant: `transInc` 0 = land only ("sans transport"), 1 = with UCPA flights from a French airport
// (`departC`). Per row: `dF` (dd/mm/yyyy), `pD`/`pN` (days / nights), `price` (current, EUR; the page's JSON-LD
// Offer says priceCurrency "EUR"), `prePrice` + `promo` (percentage) when discounted, `available_stock`,
// `available` / `vendable`, `status.message` ("Départ garanti", "Plus que 2 places disponibles", "Complet").
// The page itself prints the same data (productStartDateISO / productPrice / productAvailability in its data
// layer); the "plus en vente" banner in the HTML is a hidden template state.
//
// Slots: one per land-only departure that has not started (key "<unit>|<date>"), EUR per person (package of pN
//   nights, room shared with other guests), availability from the engine: not available and not vendable ->
//   sold_out ("Complet"); "Plus que N place(s)" -> limited with spotsLeft N; otherwise available. Flight-inclusive
//   rows are not stored (they depend on the departure airport); the summary says UCPA sells them.
// Flags: liveAvailability (UCPA's own reservation engine, read on every run); instantBooking: the booking box
//   sends the chosen date to UCPA's own reservation funnel (/af/reservation, "Paiement sécurisé", stock-controlled
//   dates) - checked from the page markup 2026-10-19, the checkout itself was not walked.
// Requests per run: content 2 (debutant + coaching page, memoised), slots +2 (one calendar JSON per unit).
// State 2026-10-19: Hurghada 51 land-only departures 24.10.2026-23.10.2027 (EUR 980-1,250; 2 sold out) and 51 for
//   the coaching week (EUR 950-1,150).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, ldOfType, meta, parse, todayIso } from '../parse.js';
import type { Availability, FetchContext, OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';

export const UCPA_SITE = 'https://www.ucpa.com';
export const UCPA_OPERATOR: OperatorRef = {
  name: 'UCPA',
  websiteUrl: UCPA_SITE,
  rootDomain: 'ucpa.com',
  phone: '+33 825 880 800', // JSON-LD contactPoint (customer service)
};

// --- fetch (memoised within a run: content and slots read the same pages) -----------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
export function ucpaFetch(url: string, accept?: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, accept ? { accept } : {});
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

// --- page --------------------------------------------------------------------------------------------
export interface UcpaPage {
  name: string | null;
  sku: string | null;
  currency: string | null;
  ldPrice: number | null;
  /** the calendar JSON the booking box loads (absolute URL), null when the page has no booking box */
  apiUrl: string | null;
  included: string[];
  excluded: string[];
  options: string[];
  accommodationName: string | null;
  accommodationText: string | null;
  spotName: string | null;
  brief: string | null;
  coords: { lat: number; lng: number } | null;
  /** product photos (UCPA-SPORT-NATURE/International), og:image first, 1280 px transform */
  images: string[];
}

const IMG_RE = /https:\/\/media\.ucpa\.com\/image\/upload\/[^"'\s)]*?\/(UCPA-[A-Z-]+\/International\/[^"'\s)?/]+\.(?:jpe?g|png|webp))/gi;
/** Another UCPA centre's photo (related trips, programme teasers) - names like 00108273-kalpitiya-adultes-kitesurf.jpg. */
function foreignPhoto(file: string, tokens: string[]): boolean {
  const name = file.toLowerCase().replace(/\.[a-z]+$/, '');
  if (/^\d+$/.test(name)) return false;               // bare archive number: used on the product's own galleries
  return !tokens.some(t => name.includes(t));
}
export function ucpaImage(path: string): string {
  return `https://media.ucpa.com/image/upload/f_auto/t_UCPA/${path}`;
}

/** Text of the <li> items of the n-th accordion in #activity-inclus (Inclus / Non Inclus / En option). */
function accordionItems(root: ReturnType<typeof parse>, heading: RegExp): string[] {
  for (const acc of root.querySelectorAll('section#activity-inclus amp-accordion')) {
    const h = collapse(acc.querySelector('h4')?.text ?? '');
    if (heading.test(h)) return acc.querySelectorAll('li').map(li => collapse(li.text).replace(/^>\s*/, '')).filter(Boolean);
  }
  return [];
}

/** The section's own <h2> (UCPA: "Hébergement" is an <h3>, the name an <h2 class="caps">), first letter capitalised. */
function sectionTitle(root: ReturnType<typeof parse>, id: string): string | null {
  const t = collapse(root.querySelector(`#${id} h2`)?.text ?? '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
}

export function parseUcpaPage(html: string, imageTokens: string[]): UcpaPage {
  const root = parse(html);
  const product = ldOfType(html, 'Product')[0] as Record<string, unknown> | undefined;
  const offer = (product?.offers ?? null) as Record<string, unknown> | null;
  const src = html.match(/<amp-state id="reserve" src="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&') ?? null;
  const q = html.match(/maps\/embed\/v1\/place\?[^"]*?q=(-?\d+\.\d+),(-?\d+\.\d+)/);

  const reviewAt = html.indexOf('id="review-section"');
  const body = reviewAt > 0 ? html.slice(0, reviewAt) : html;
  const og = meta(html, 'og:image');
  const ogPath = og?.match(/\/(UCPA-[A-Z-]+\/International\/[^"'\s)?/]+)$/)?.[1] ?? null;
  const seen = new Set<string>();
  const images: string[] = [];
  for (const p of [ogPath, ...[...body.matchAll(IMG_RE)].map(m => m[1])]) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    if (foreignPhoto(p.split('/').pop()!, imageTokens)) continue;
    images.push(ucpaImage(p));
  }

  const hebP = root.querySelector('#hebergement-section h2')?.nextElementSibling;
  const bref = root.querySelector('#bref-section');
  return {
    name: typeof product?.name === 'string' ? product.name : null,
    sku: typeof product?.sku === 'string' ? product.sku : null,
    currency: typeof offer?.priceCurrency === 'string' ? offer.priceCurrency : null,
    ldPrice: typeof offer?.price === 'number' ? offer.price : null,
    apiUrl: src ? new URL(src, UCPA_SITE).toString() : null,
    included: accordionItems(root, /^Inclus$/i),
    excluded: accordionItems(root, /^Non inclus$/i),
    options: accordionItems(root, /^En option$/i),
    accommodationName: sectionTitle(root, 'hebergement-section'),
    accommodationText: hebP ? collapse(hebP.text) || null : null,
    spotName: sectionTitle(root, 'spot-section'),
    // the block is rendered twice (desktop + mobile tab): keep the first copy
    brief: bref ? collapse(bref.text).split(/LE SÉJOUR EN BREF\s*(?:Pure sport\/)?/i).map(x => x.trim()).find(Boolean) ?? null : null,
    coords: q ? { lat: Number(q[1]), lng: Number(q[2]) } : null,
    images,
  };
}

// --- calendar JSON -----------------------------------------------------------------------------------------
export interface UcpaDeparture {
  date: string;
  nights: number;
  days: number;
  price: number;
  /** price before the promotion when discounted */
  listPrice: number | null;
  promoPct: number | null;
  available: boolean;
  vendable: boolean;
  stock: number | null;
  status: string | null;
}
export interface UcpaCalendar {
  /** land-only departures, by date */
  departures: UcpaDeparture[];
  /** cheapest flight-inclusive row (any French airport), for the summary only */
  lowestWithFlights: number | null;
  /** land-only rows dropped as duplicates of an earlier row with the same date */
  duplicates: number;
}

interface RawOffer {
  dF?: string; date?: number; pD?: number; pN?: number; price?: number; prePrice?: number; promo?: string | number | null;
  available?: boolean; vendable?: boolean; available_stock?: number; transInc?: number; status?: { message?: string } | null;
}

function ddmmyyyy(s: string | undefined, epoch: number | undefined): string | null {
  const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return typeof epoch === 'number' ? new Date(epoch * 1000).toISOString().slice(0, 10) : null;
}

export function parseUcpaCalendar(json: string): UcpaCalendar {
  const data = JSON.parse(json) as { offersInfo?: RawOffer[]; lowestPriceWithTransport?: number };
  if (!Array.isArray(data.offersInfo)) throw new Error('ucpa: calendar JSON without offersInfo (format changed?)');
  const departures: UcpaDeparture[] = [];
  let duplicates = 0;
  for (const o of data.offersInfo) {
    if (o.transInc !== 0) continue;
    const date = ddmmyyyy(o.dF, o.date);
    if (!date || typeof o.price !== 'number' || !(o.price > 0) || !o.pN) continue;
    if (departures.some(d => d.date === date)) { duplicates++; continue; }
    const promo = o.promo === null || o.promo === undefined || o.promo === '' ? null : Number(o.promo);
    departures.push({
      date,
      nights: o.pN,
      days: o.pD ?? o.pN + 1,
      price: o.price,
      listPrice: typeof o.prePrice === 'number' && o.prePrice > o.price ? o.prePrice : null,
      promoPct: promo !== null && Number.isFinite(promo) ? promo : null,
      available: o.available === true,
      vendable: o.vendable === true,
      stock: typeof o.available_stock === 'number' ? o.available_stock : null,
      status: o.status?.message?.trim() || null,
    });
  }
  departures.sort((a, b) => a.date.localeCompare(b.date));
  const lw = data.lowestPriceWithTransport;
  return { departures, lowestWithFlights: typeof lw === 'number' && lw > 0 ? lw : null, duplicates };
}

export function ucpaAvailability(d: UcpaDeparture): { availability: Availability; spotsLeft: number | null } {
  if (!d.available && !d.vendable) return { availability: 'sold_out', spotsLeft: 0 };
  const m = d.status?.match(/plus que (\d+) places?/i);
  if (m) return { availability: 'limited', spotsLeft: Number(m[1]) };
  if (/complet/i.test(d.status ?? '')) return { availability: 'sold_out', spotsLeft: 0 };
  return { availability: 'available', spotsLeft: null };
}

function addDays(isoDate: string, n: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

// --- listing config ------------------------------------------------------------------------------------------
export interface UcpaUnit {
  /** slot key prefix, e.g. 'debutant' */
  id: string;
  /** unit label stored on each slot */
  label: string;
  url: string;
}

export interface UcpaListing {
  key: string;
  name: string;
  title: string;
  /** first unit = the listing's page */
  units: UcpaUnit[];
  continent: string;
  country: string;
  region: string;
  spot: string;
  /** file-name tokens of this centre's photos ("hurghada"); other centres' photos are dropped */
  imageTokens: string[];
  /** English summary; gets the parsed accommodation name and the flight note appended */
  summary: (p: UcpaPage) => string;
  skillLevels: string[];
  beginnerFriendly: boolean;
  durationDays: number;
  /** nights the land-only package covers (checked against the calendar JSON) */
  nights: number;
  includedServices: string[];
  optionalServices: string[];
  accommodation: string;
  mealPlan: string;
}

export function buildUcpaSlots(unit: UcpaUnit, cal: UcpaCalendar, currency: string, today: string): Slot[] {
  return cal.departures.filter(d => d.date >= today).map(d => {
    const a = ucpaAvailability(d);
    const promo = d.listPrice ? `; promotion${d.promoPct ? ` -${d.promoPct}%` : ''} (was ${currency} ${d.listPrice})` : '';
    return {
      key: `${unit.id}|${d.date}`,
      startDate: d.date,
      endDate: addDays(d.date, d.nights),
      unit: unit.label,
      price: d.price,
      currency,
      priceUnit: 'package',
      priceBasis: 'person',
      occupancy: null,
      availability: a.availability,
      availabilityText: `${d.status ?? (a.availability === 'sold_out' ? 'Complet' : 'disponible')} - ${currency} ${d.price} per person, ${d.nights} nights land only (no flights)${promo}`,
      spotsLeft: a.spotsLeft,
      packageNights: d.nights,
    } satisfies Slot;
  });
}

export async function fetchUcpaSlots(l: UcpaListing, today: string, ctx?: Pick<FetchContext, 'note' | 'incomplete'>): Promise<Slot[]> {
  const out: Slot[] = [];
  for (const [i, unit] of l.units.entries()) {
    let page: UcpaPage;
    let cal: UcpaCalendar;
    try {
      page = parseUcpaPage(await ucpaFetch(unit.url), l.imageTokens);
      if (!page.apiUrl) throw new Error(`${l.key}: no booking calendar (amp-state "reserve") on ${unit.url} (layout changed?)`);
      cal = parseUcpaCalendar(await ucpaFetch(page.apiUrl, 'application/json'));
    } catch (e) {
      if (i === 0) throw e;                   // the listing's own product must read
      ctx?.incomplete?.(`${unit.label}: ${(e as Error).message}`);
      continue;
    }
    const odd = cal.departures.filter(d => d.nights !== l.nights);
    if (odd.length) ctx?.note(`${unit.label}: ${odd.length} departures with ${odd[0].nights} nights instead of ${l.nights}`);
    if (cal.duplicates) ctx?.note(`${unit.label}: ${cal.duplicates} duplicate land-only rows ignored`);
    const past = cal.departures.filter(d => d.date < today).length;
    if (past) ctx?.note(`${unit.label}: ${past} past departures dropped`);
    const slots = buildUcpaSlots(unit, cal, page.currency ?? 'EUR', today);
    if (!page.currency) ctx?.note(`${unit.label}: JSON-LD priceCurrency missing; EUR assumed (ucpa.com prices in EUR)`);
    if (slots.length === 0) ctx?.note(`${unit.label}: the calendar lists no future land-only departure`);
    out.push(...slots);
  }
  return out;
}

export async function fetchUcpaContent(l: UcpaListing): Promise<OfferContent> {
  const pages: UcpaPage[] = [];
  for (const [i, u] of l.units.entries()) {
    try {
      const html = await ucpaFetch(u.url);
      pages.push(parseUcpaPage(html, l.imageTokens));
    } catch (e) {
      if (i === 0) throw e;
    }
  }
  return parseUcpaContent(l, pages);
}

export function parseUcpaContent(l: UcpaListing, pages: UcpaPage[]): OfferContent {
  const p = pages[0];
  if (!p.included.length) throw new Error(`${l.key}: "Inclus" list not found (layout changed?)`);
  const images: string[] = [];
  for (const pg of pages) for (const u of pg.images) if (!images.includes(u)) images.push(u);
  const summary = [
    l.summary(p),
    `Prices are per person for the land-only week; UCPA also sells each date with flights from French airports.`,
  ].join(' ');
  return {
    kind: 'camp',
    title: l.title,
    summary,
    continent: l.continent,
    country: l.country,
    region: l.region,
    spot: l.spot,
    spotCoords: p.coords,
    itinerarySpots: [],
    durationDays: l.durationDays,
    skillLevels: l.skillLevels,
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: l.beginnerFriendly,
    includedServices: l.includedServices,
    optionalServices: l.optionalServices,
    accommodation: l.accommodation,
    mealPlan: l.mealPlan,
    languages: ['fr'],
    rooms: [],
    imageUrls: images.slice(0, 40),
    heroVideoUrl: null,
    sourceUrl: l.units[0].url,
    bookingUrl: l.units[0].url,
    sourceText: pages.map((pg, i) => [
      `${l.units[i]?.label ?? 'unit'} (${pg.name ?? '-'}, ${pg.sku ?? '-'}): ${pg.brief ?? ''}`,
      `inclus: ${pg.included.join(' | ')}`,
      `non inclus: ${pg.excluded.join(' | ')}`,
      `en option: ${pg.options.join(' | ')}`,
      `hébergement: ${pg.accommodationText ?? '-'}`,
      `spot: ${pg.spotName ?? '-'}`,
    ].join('\n')).join('\n\n'),
  };
}

export function makeUcpaAdapter(l: UcpaListing): OfferAdapter {
  return {
    key: l.key,
    name: l.name,
    kind: 'camp',
    operator: UCPA_OPERATOR,
    url: l.units[0].url,
    slotMethod: 'booking_engine',
    liveAvailability: true,
    instantBooking: true,
    fetchBudget: 2 * l.units.length + 1,
    fetchContent: () => fetchUcpaContent(l),
    fetchSlots: ctx => fetchUcpaSlots(l, todayIso(), ctx),
  };
}

// --- Hurghada ------------------------------------------------------------------------------------------------
export const UCPA_HURGHADA: UcpaListing = {
  key: 'ucpa-kitesurf-debutant-hurghada',
  name: 'UCPA Kitesurf spécial débutant, Hurghada',
  title: 'UCPA Beginner Kitesurf Week Hurghada',
  units: [
    { id: 'debutant', label: 'Kitesurf spécial débutant (beginners)', url: 'https://www.ucpa.com/sejour/egypte-site-de-hurghada/1856-kitesurf-special-debutant-vacances' },
    { id: 'coaching', label: 'Kitesurf coaching perfectionnement (water start mastered)', url: 'https://www.ucpa.com/sejour/egypte-site-de-hurghada/1857-kitesurf-coaching-perfectionnement-vacances' },
  ],
  continent: 'Africa',
  country: 'Egypt',
  region: 'Red Sea',
  spot: 'Hurghada',
  imageTokens: ['hurghada'],
  summary: p => [
    `UCPA's beginner kite week at its Hurghada site on the Red Sea: 7 nights in a shared room for 2-3 at the ${p.accommodationName ?? 'partner hotel'} (pool), full board, and 5 days of kitesurf with 1 instructor for 4 students, kites shared in pairs until the water start.`,
    `Lessons run on a shallow sandbank with warm, flat water and 10-25 knots; on windless days there is theory, paddle / kayak or a snorkelling boat trip.`,
    `Riders who already master the water start can book the coaching week on the same dates.`,
  ].join(' '),
  skillLevels: ['beginner', 'intermediate'],
  beginnerFriendly: true,
  durationDays: 8,
  nights: 7,
  includedServices: [
    '7 nights in a shared room for 2-3 at the Hotel Bellagio, Hurghada',
    'Full board',
    '5 days of kitesurf (or another activity when there is no wind)',
    'Instruction: 1 instructor for 4 students (beginners share one kite per pair)',
    'All kite equipment',
    'Transfers to the kite spots',
  ],
  optionalServices: [
    'Flights from Paris or Lyon with airport transfer (booked with the week)',
    'Double room or single room supplement',
    'Equipment breakage cover',
    'Day trip to Luxor (on site)',
  ],
  accommodation: 'hotel (shared rooms for 2-3, pool)',
  mealPlan: 'full_board',
};

export const ucpaKitesurfDebutantHurghada: OfferAdapter = makeUcpaAdapter(UCPA_HURGHADA);
