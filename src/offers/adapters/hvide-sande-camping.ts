// ---------------------------------------------------------------------------
// Hvide Sande Camping, Hvide Sande (West Jutland, Denmark) - family campsite in the dunes between the North Sea
// and Ringkøbing Fjord, 11 cabin types (simple surfer cabins to luxury cabins for 6) and a holiday flat. The site
// pitches the fjord and the sea for windsurfing, kitesurfing and SUP; Westwind Surf School is right opposite the
// campsite (lessons for everyone over 12, equipment hire).
//
// Data path (checked 2026-10-12), WordPress/Bricks site behind NitroPack:
//   content  /?lang=en (home: kite sentence, opening 2026), /cabins-and-holiday-apartments/?lang=en (cabin cards:
//            <h2> name with the Danish name in brackets, description <p>, capacity / feature chips), /surfing/?lang=en
//            (Westwind Surf School opposite), /priser/ (Danish only: season dates 2026 + 2027, "fra" price per night
//            per cabin type for low / high season 2026 and 2027, final cleaning per type).
//   slots    Compusoft online booking (the site's "Online booking" button, v3.onlinebooking.dk/v3hvidesan, portal key in
//            that page). The widget's own anonymous GETs, no login, no session cookie needed (checked 2026-10-12):
//              /profile/getCSProfileListViewModel?portalKey&fromDateStr=YYYYMMDD-000000&toDateStr=..  -> every profile
//                 (cabin type / pitch) with availableUnits for that stay;
//              /profile/GetCSProfilePriceListMultipleProfilesV2?portalKey&ids=..  -> total price per profile for that
//                 stay (Rates[] per currency: price = total incl. final cleaning, profileItemPrice = accommodation).
//            We sample ONE Saturday-to-Saturday week per month inside the published seasons (2026: 28.03.-31.10.,
//            2027: 13.03.-31.10.), at most 9 samples within 12 months.
// robots.txt (2026-10-12): hvidesandecamping.dk none relevant (WordPress defaults); v3.onlinebooking.dk "Allow: /".
// Requests per run: content 4, slots 1 (seasons page, memoised) + up to 2 per sample week (list + prices) = max 19.
// Parsed: slot = cabin type x sample week ("beach-cabins|2027-06-05"), DKK per cabin for 7 nights incl. final cleaning
//   (priceUnit 'package', packageNights 7, priceBasis 'room'), available (>= 3 free) / limited (1-2 free, spotsLeft) /
//   sold_out (0 free while other units of the campsite are bookable that week). Weeks in which no unit of the campsite
//   is bookable at all are skipped (engine not loaded or closed), and so are unit types free in none of the sampled weeks.
// Known limits: one sample week per month, prices by exact stay only; the engine's 2027 prices did not match the
//   printed 2027 "fra" table on 2026-10-12 (Beach Cabins 05.-12.06.2027: DKK 8,330 + 700 cleaning = 1,190 per night,
//   the table says low season from DKK 900) - the engine is what a guest is charged, the table goes into the room
//   features. Pitches are never listed.
// Shared: the Compusoft helpers below (csob*) are imported by drejby-strand-camping-als.ts and feddet-strand-resort.ts
//   (candidates for a src/offers/engines/compusoft.ts module).
// ---------------------------------------------------------------------------
import { BlockedByHost, fetchText } from '../http.js';
import { clean, iso, parseAmount, todayIso } from '../parse.js';
import type { Availability, ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

// =============================================================================================
// Compusoft online booking (csob, v3.onlinebooking.dk) - shared engine helpers
// =============================================================================================
export const CSOB_HOST = 'https://v3.onlinebooking.dk';
const JSON_ACCEPT = 'application/json, text/javascript, */*; q=0.01';

export interface CsobPortal {
  portalKey: string;
  /** languageShortName of the widget ('en' gives English profile titles) */
  language: string;
  /** site currency (the price answer carries several currencies; we keep this one) */
  currency: string;
  /** which profiles are rental units (cabins, flats, mobile homes ...): pitches and add-ons return false */
  isUnit(p: CsobProfile): boolean;
}
export interface CsobProfile { id: number; uniqueId: string; siteId: number; title: string; subTitle: string; units: number; customerType: string }
export interface CsobPrice { total: number; accommodation: number | null; currency: string }
export interface CsobSample {
  checkIn: string;
  nights: number;
  /** rental-unit profiles (deduplicated by profile id) */
  profiles: CsobProfile[];
  /** true when any profile of the portal (pitches included) is bookable for this stay */
  open: boolean;
  /** by profile uniqueId */
  prices: Map<string, CsobPrice>;
}

export const csobAddDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const weekday = (d: string): number => new Date(`${d}T00:00:00Z`).getUTCDay();
export const csobKeyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** the widget's date format for list calls (csob.CommonConstants.dateTimeSendFormats.dateTime) */
export const csobDate = (d: string): string => `${d.replace(/-/g, '')}-000000`;

export function csobListUrl(portal: Pick<CsobPortal, 'portalKey' | 'language'>, checkIn: string, nights: number): string {
  const q = new URLSearchParams({
    portalKey: portal.portalKey, languageShortName: portal.language, compubookProfileId: '', portalProfileId: '', profileId: '',
    fromDateStr: csobDate(checkIn), toDateStr: csobDate(csobAddDays(checkIn, nights)), searchWithSiteIds: '', searchWithProfileNames: '',
    loginCustomerType: '', includeAlternative: 'false', isDealSearch: 'false', firstCalendarDateStr: '', lastCalendarDateStr: '',
    includeProfilesWithoutAvailability: 'true',
  });
  return `${CSOB_HOST}/profile/getCSProfileListViewModel?${q}`;
}

/** Profile list answer: bookable + not bookable profiles; duplicates (same profile in two menu groups) keep the larger count. */
export function parseCsobList(json: string): CsobProfile[] {
  const d = JSON.parse(json) as { success?: boolean; csProfileListViewModel?: Record<string, unknown> };
  if (!d.success || !d.csProfileListViewModel) throw new Error('compusoft: profile list answer without success / view model');
  const v = d.csProfileListViewModel;
  const raw = [...((v.csProfileList as unknown[]) ?? []), ...((v.csProfileWithNoAvailabilityList as unknown[]) ?? [])] as Array<Record<string, unknown>>;
  const byId = new Map<number, CsobProfile>();
  for (const r of raw) {
    const p: CsobProfile = {
      id: Number(r.compuBookProfileId), uniqueId: String(r.uniqueId ?? ''), siteId: Number(r.siteId ?? 0),
      title: clean(String(r.title ?? '')), subTitle: clean(String(r.subTitle ?? '')), units: Number(r.availableUnits ?? 0) || 0,
      customerType: String(r.customerType ?? ''),
    };
    if (!Number.isFinite(p.id) || !p.uniqueId || !p.title) continue;
    const prev = byId.get(p.id);
    if (!prev || p.units > prev.units) byId.set(p.id, p);
  }
  return [...byId.values()];
}

/** The widget's price call for several profiles and one stay (ids = "uniqueId,siteId,profileId,customerType,from,to,lang,currency" joined by ¤, url-encoded twice). */
export function csobPriceUrl(portal: Pick<CsobPortal, 'portalKey' | 'language' | 'currency'>, profiles: CsobProfile[], checkIn: string, nights: number): string {
  const from = JSON.stringify(`${checkIn}T00:00:00.000Z`);
  const to = JSON.stringify(`${csobAddDays(checkIn, nights)}T00:00:00.000Z`);
  const ids = profiles.map(p => [p.uniqueId, p.siteId, p.id, p.customerType, from, to, portal.language, portal.currency].join(',')).join('¤');
  const q = new URLSearchParams({ portalKey: portal.portalKey, ids: encodeURIComponent(ids), loginCustomerType: '', variables: '', package: '', memberCustomerType: '' });
  return `${CSOB_HOST}/profile/GetCSProfilePriceListMultipleProfilesV2?${q}`;
}

/** Price answer -> total per profile uniqueId in the site currency (first rate when that currency is missing). */
export function parseCsobPrices(json: string, currency: string): Map<string, CsobPrice> {
  const d = JSON.parse(json) as { success?: boolean; csProfilePriceModelList?: Array<{ UniqueId?: string; Rates?: Array<Record<string, unknown>> }> };
  const out = new Map<string, CsobPrice>();
  for (const m of d.csProfilePriceModelList ?? []) {
    const rates = m.Rates ?? [];
    const r = rates.find(x => x.currencyShortName === currency) ?? rates[0];
    const total = Number(r?.price);
    if (!m.UniqueId || !r || !Number.isFinite(total) || total <= 0) continue;
    const acc = Number(r.profileItemPrice);
    out.set(m.UniqueId, { total, accommodation: Number.isFinite(acc) && acc > 0 ? acc : null, currency: String(r.currencyShortName ?? currency) });
  }
  return out;
}

/** One sample stay: profile list (+ one price call when any rental unit is free). */
export async function fetchCsobSample(portal: CsobPortal, checkIn: string, nights = 7): Promise<CsobSample> {
  const all = parseCsobList(await fetchText(csobListUrl(portal, checkIn, nights), { accept: JSON_ACCEPT }));
  const profiles = all.filter(p => portal.isUnit(p));
  const free = profiles.filter(p => p.units > 0);
  const prices = free.length
    ? parseCsobPrices(await fetchText(csobPriceUrl(portal, free, checkIn, nights), { accept: JSON_ACCEPT }), portal.currency)
    : new Map<string, CsobPrice>();
  return { checkIn, nights, profiles, open: all.some(p => p.units > 0), prices };
}

/**
 * Sample check-ins: per calendar month (from tomorrow, `horizonMonths` ahead) the first Saturday whose whole stay lies
 * inside one of the open seasons (check-out on the closing day is fine). At most `max` samples.
 */
export function csobSaturdaySamples(today: string, seasons: Array<{ start: string; end: string }>, opts: { horizonMonths?: number; max?: number; nights?: number } = {}): string[] {
  const horizon = opts.horizonMonths ?? 12;
  const max = opts.max ?? 9;
  const nights = opts.nights ?? 7;
  const first = csobAddDays(today, 1);
  const y0 = Number(today.slice(0, 4));
  const m0 = Number(today.slice(5, 7));
  const limit = iso(y0 + Math.floor((m0 - 1 + horizon) / 12), ((m0 - 1 + horizon) % 12) + 1, Number(today.slice(8, 10)));
  const out: string[] = [];
  for (let i = 0; i <= horizon && out.length < max; i++) {
    const y = y0 + Math.floor((m0 - 1 + i) / 12);
    const m = ((m0 - 1 + i) % 12) + 1;
    const ym = iso(y, m, 1).slice(0, 7);
    let d = iso(y, m, 1) < first ? first : iso(y, m, 1);
    while (weekday(d) !== 6) d = csobAddDays(d, 1);
    for (; d.slice(0, 7) === ym && d <= limit; d = csobAddDays(d, 7)) {
      const out7 = csobAddDays(d, nights);
      if (seasons.some(s => s.start <= d && out7 <= s.end)) { out.push(d); break; }
    }
  }
  return out;
}

/**
 * Sample weeks -> slots (rental units only). Weeks in which nothing at all is bookable are skipped, and so are unit types that
 * are free in none of the sampled weeks (out of their own season, e.g. glamping tents in winter - not "sold out").
 */
export function csobSlots(samples: CsobSample[], ctx?: Pick<FetchContext, 'note'>): Slot[] {
  const out: Slot[] = [];
  let unpriced = 0;
  const everFree = new Set(samples.flatMap(s => s.profiles.filter(p => p.units > 0).map(p => p.id)));
  const never = new Set(samples.flatMap(s => s.profiles.filter(p => !everFree.has(p.id)).map(p => p.title)));
  for (const s of samples) {
    if (!s.open) continue;
    for (const p of s.profiles) {
      if (!everFree.has(p.id)) continue;
      const price = s.prices.get(p.uniqueId) ?? null;
      if (p.units > 0 && !price) { unpriced++; continue; }
      const availability: Availability = p.units === 0 ? 'sold_out' : p.units <= 2 ? 'limited' : 'available';
      out.push({
        key: `${csobKeyPart(p.title)}|${s.checkIn}`,
        startDate: s.checkIn,
        endDate: csobAddDays(s.checkIn, s.nights - 1),
        unit: p.title,
        price: price ? price.total : null,
        currency: price ? price.currency : null,
        priceUnit: price ? 'package' : null,
        priceBasis: 'room',
        occupancy: null,
        availability,
        availabilityText: p.units === 0 ? `no free unit for ${s.nights} nights from ${s.checkIn}` : `${p.units} free for ${s.nights} nights from ${s.checkIn}`,
        spotsLeft: p.units,
        packageNights: s.nights,
      });
    }
  }
  if (unpriced && ctx) ctx.note(`compusoft: ${unpriced} free unit(s) without a price for the sample stay skipped`);
  if (never.size && ctx) ctx.note(`compusoft: not bookable in any sampled week, left out: ${[...never].join(', ')}`);
  return out;
}

/**
 * All samples of a portal; a failing sample marks the run incomplete, a block stops it. `stopAfterClosed` ends the run after
 * that many consecutive weeks in which nothing at all is bookable (engine not loaded further ahead - saves requests).
 */
export async function fetchCsobSamples(portal: CsobPortal, checkIns: string[], ctx: FetchContext, nights = 7, stopAfterClosed?: number): Promise<CsobSample[]> {
  const out: CsobSample[] = [];
  let closed = 0;
  for (const d of checkIns) {
    try {
      const s = await fetchCsobSample(portal, d, nights);
      out.push(s);
      closed = s.open ? 0 : closed + 1;
      if (stopAfterClosed && closed >= stopAfterClosed) { ctx.note(`compusoft: stopped sampling after ${closed} closed weeks in a row (last ${d})`); break; }
    } catch (e) {
      if (e instanceof BlockedByHost) throw e;
      ctx.incomplete(`compusoft sample ${d}: ${(e as Error).message}`);
    }
  }
  return out;
}

// =============================================================================================
// Hvide Sande Camping
// =============================================================================================
const SITE = 'https://hvidesandecamping.dk';
export const HSC_HOME_URL = `${SITE}/?lang=en`;
export const HSC_CABINS_URL = `${SITE}/cabins-and-holiday-apartments/?lang=en`;
export const HSC_SURF_URL = `${SITE}/surfing/?lang=en`;
export const HSC_PRICES_URL = `${SITE}/priser/`;
const BOOKING_URL = `${CSOB_HOST}/v3hvidesan`;
export const HSC_PORTAL: CsobPortal = {
  portalKey: 'e1a8e897-51ff-42e9-8086-d0cccc0fd8ae',
  language: 'en',
  currency: 'DKK',
  // filter group "Property type": TYPE_Hytter = cabins (+ the holiday flat), TYPE_Pladser = pitches
  isUnit: p => !/pitch|plads/i.test(`${p.title} ${p.subTitle}`),
};

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the season page */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines (scripts, styles, SVGs dropped), split at block tags. */
export function hscLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

/** Season blocks of /priser/: "Sæson 2027 Åbner: 13.03.2027 Lukker: 31.10.2027", or (2026) the outer limits of the band dates. */
export function parseHscSeasons(html: string): Array<{ year: number; start: string; end: string }> {
  const text = hscLines(html).join('\n');
  const out: Array<{ year: number; start: string; end: string }> = [];
  for (const m of text.matchAll(/S(?:æ|ae)son (20\d{2})\n([\s\S]*?)(?=\nS(?:æ|ae)son 20\d{2}\n|\nPriser for|$)/g)) {
    const year = Number(m[1]);
    const body = m[2];
    const open = body.match(/Åbner:\s*(\d{1,2})\.(\d{1,2})\.(20\d{2})/);
    const close = body.match(/Lukker:\s*(\d{1,2})\.(\d{1,2})\.(20\d{2})/);
    if (open && close) {
      out.push({ year, start: iso(+open[3], +open[2], +open[1]), end: iso(+close[3], +close[2], +close[1]) });
      continue;
    }
    const ranges = [...body.matchAll(/(\d{1,2})\.(\d{1,2})(?:\.(20\d{2}))?\s*[-–]\s*(\d{1,2})\.(\d{1,2})(?:\.(20\d{2}))?/g)]
      .map(r => [iso(r[3] ? +r[3] : year, +r[2], +r[1]), iso(r[6] ? +r[6] : year, +r[5], +r[4])]);
    if (ranges.length) out.push({ year, start: ranges.map(r => r[0]).sort()[0], end: ranges.map(r => r[1]).sort().reverse()[0] });
  }
  return out;
}

export interface HscCabinPrice { year: number; name: string; type: number; low: number; high: number; cleaning: number | null }

/** Cabin price tabs of /priser/ ("Priser for hytter 2026"): "Strandhytte | Type 11" -> "fra 999 kr. | fra 1.190 kr." + cleaning list. */
export function parseHscCabinPrices(html: string): HscCabinPrice[] {
  const titles = [...html.matchAll(/class="brxe-div tab-title"[^>]*>\s*<div[^>]*class="brxe-text-basic"[^>]*>([^<]*)<\/div>/g)].map(m => clean(m[1]));
  const panes = html.split(/class="brxe-block tab-pane"/).slice(1);
  const out: HscCabinPrice[] = [];
  panes.forEach((pane, i) => {
    const year = Number(titles[i]?.match(/hytter (20\d{2})/i)?.[1] ?? NaN);
    if (!year) return;
    const lists = pane.split(/class="brxe-list"/).slice(1);
    const rows = (list: string) => [...list.matchAll(/<span class="title">([\s\S]*?)<\/span>[\s\S]*?<span class="meta">([\s\S]*?)<\/span>/g)]
      .map(r => [clean(r[1].replace(/<[^>]+>/g, ' ')), clean(r[2].replace(/<[^>]+>/g, ' '))] as const);
    const cleaning = new Map<string, number>();
    for (const [t, v] of rows(lists[1] ?? '')) { const a = parseAmount(v); if (a && /Type \d+/.test(t)) cleaning.set(t, a); }
    for (const [t, v] of rows(lists[0] ?? '')) {
      const nm = t.match(/^(.+?)\s*\|\s*Type (\d+)$/);
      const [lo, hi] = v.split('|').map(x => parseAmount(x));
      if (!nm || !lo || !hi) continue;
      out.push({ year, name: nm[1], type: Number(nm[2]), low: lo, high: hi, cleaning: cleaning.get(t) ?? null });
    }
  });
  return out;
}

export interface HscCabin { name: string; danish: string | null; description: string | null; features: string[]; image: string | null }

/** Original upload URL of a NitroPack CDN image (…/hvidesandecamping.dk/wp-content/uploads/…). */
function hscOriginal(u: string): string | null {
  const m = u.match(/hvidesandecamping\.dk\/(wp-content\/uploads\/[^"?\s]+)/);
  return m ? `${SITE}/${m[1]}` : null;
}

/** Cabin cards of the English overview: <h2> name "(Danish)", first <p>, feature chips (tekstbook). */
export function parseHscCabins(html: string): HscCabin[] {
  const out: HscCabin[] = [];
  for (const card of html.split(/class="brxe-block oversigt__list-item"/).slice(1)) {
    const h = card.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    if (!h) continue;
    const heading = clean(h[1].replace(/<[^>]+>/g, ' '));
    const danish = heading.match(/\(([^)]+)\)\s*$/)?.[1] ?? null;
    const name = heading.replace(/\s*\([^)]+\)\s*$/, '');
    const desc = card.match(/<div[^>]*class="brxe-text"[^>]*>\s*<p>([\s\S]*?)<\/p>/)?.[1];
    const features = [...card.matchAll(/class="brxe-text tekstbook"[^>]*>\s*<p>([\s\S]*?)<\/p>/g)].map(m => clean(m[1].replace(/<[^>]+>/g, ' '))).filter(Boolean);
    const img = card.match(/nitro-lazy-src="([^"]+)"/)?.[1] ?? card.match(/<img[^>]+src="(https?:[^"]+)"/)?.[1] ?? null;
    out.push({
      name,
      danish,
      description: desc ? clean(desc.replace(/<[^>]+>/g, ' ')).replace(/\s*Read more here\.?\s*$/, '') : null,
      features,
      image: img ? hscOriginal(img) ?? img : null,
    });
  }
  return out;
}

/** Stem for matching table names ("Strandhytter", "Troldebjerghytten") to card names ("Strandhytten", "Troldehytten"). */
const stem = (s: string): string => s.toLowerCase().replace(/\s+/g, '').replace(/hytt(?:en|er|e)$/, '');
function tableRowsFor(c: HscCabin, prices: HscCabinPrice[]): HscCabinPrice[] {
  if (/holiday (flat|apartment)/i.test(c.name)) return prices.filter(p => /ferielejlighed/i.test(p.name));
  if (!c.danish) return [];
  const a = stem(c.danish);
  return prices.filter(p => { const b = stem(p.name); return a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)); });
}

/** Original photos of a page (NitroPack lazy sources and plain upload sources), logos / icons dropped. */
export function hscImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/(?:nitro-lazy-src|src)="([^"]*wp-content\/uploads\/[^"]+)"/g)) {
    const u = hscOriginal(m[1]);
    // Google review avatars (imgi_1_A…-h72-p-…) and a screenshot sit in the uploads folder too
    if (!u || /logo|icon|favicon|\.svg|-\d+x\d+\.|campingdanmark|dk-camp|imgi_1_A|-h\d+-p-|Skaermbillede/i.test(u)) continue;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export interface HscPages { home: string; cabins: string; surf: string; prices: string }

export function parseHvideSandeCampingContent(p: HscPages): OfferContent {
  const home = hscLines(p.home);
  const surf = hscLines(p.surf);
  const cabins = parseHscCabins(p.cabins);
  const prices = parseHscCabinPrices(p.prices);
  const seasons = parseHscSeasons(p.prices);
  const kiteLine = home.find(l => /kitesurfing/i.test(l)) ?? null;
  const westwind = surf.find(l => /Westwind Surf School/.test(l) && /opposite/i.test(l)) ?? null;
  const dk = (n: number) => `DKK ${n.toLocaleString('en-US')}`;
  const fmt = (d: string) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.${d.slice(0, 4)}`;

  const rooms: ContentRoom[] = cabins.map(c => ({
    name: c.danish && !/^hytte \d/i.test(c.danish) ? `${c.name} (${c.danish})` : c.name,
    description: c.description,
    features: [
      ...c.features,
      ...tableRowsFor(c, prices).map(r => `${r.year} (${r.name}, type ${r.type}): low season from ${dk(r.low)}, high season from ${dk(r.high)} per night${r.cleaning ? `, final cleaning ${dk(r.cleaning)}` : ''}`),
    ],
  }));

  const imgs: string[] = [];
  for (const u of [...cabins.map(c => c.image).filter((x): x is string => !!x), ...hscImages(p.home), ...hscImages(p.surf)]) if (!imgs.includes(u)) imgs.push(u);

  const cheapest = prices.filter(r => r.year === Math.max(...prices.map(x => x.year))).sort((a, b) => a.low - b.low)[0];
  const cheapestCard = cheapest ? cabins.find(c => tableRowsFor(c, [cheapest]).length > 0) : undefined;
  const seasonText = seasons.map(s => `${fmt(s.start)}-${fmt(s.end)}`).join(' and ');
  const summary = [
    `Hvide Sande Camping is a family campsite in the dunes between the North Sea and Ringkøbing Fjord at Hvide Sande on the west coast of Jutland, Denmark${seasonText ? `, open ${seasonText}` : ''}.`,
    `Besides pitches it rents ${cabins.length || 11} types of cabins, from small basic surfer cabins for two to luxury cabins for up to six, and a holiday flat${cheapest ? `; the ${cheapest.year} price list starts at ${dk(cheapest.low)} per night (${cheapestCard?.name.replace(/^The /, '').toLowerCase() ?? cheapest.name}, low season) plus final cleaning` : ''}.`,
    'The campsite names the fjord and the sea as ideal for windsurfing, kitesurfing and SUP, and Westwind Surf School right opposite gives lessons to everyone over 12 and hires out equipment.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Hvide Sande Camping',
    summary,
    continent: 'Europe',
    country: 'Denmark',
    region: 'Hvide Sande, West Jutland',
    spot: 'Hvide Sande',
    // Google Maps embed on every page (!2d8.1527 !3d56.0342, wide zoom centred on the campsite's place id)
    spotCoords: { lat: 56.0342, lng: 8.1527 },
    itinerarySpots: [],
    durationDays: null,
    // surfing page: "room here for both beginners in the fjord's calmer waters and more experienced surfers"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: null, // the site names Westwind's surf lessons, not kite lessons
    equipmentRental: surf.some(l => /hire everything you need on site/i.test(l)) ? true : null,
    beginnerFriendly: true,
    includedServices: ['Free Wi-Fi', 'Outdoor showers for rinsing off after surfing', 'Dogs allowed in the cabins'],
    optionalServices: ['Final cleaning (DKK 350-800 depending on the cabin)', 'Surf lessons and equipment hire at Westwind Surf School (opposite the campsite)', 'Campsite shop (bread rolls)'],
    accommodation: 'camping cabins and a holiday flat on a family campsite',
    mealPlan: 'self_catering',
    languages: ['da', 'en', 'de'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: HSC_CABINS_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${kiteLine ?? ''} | ${home.find(l => /^Opening 20\d{2}/.test(l)) ?? ''}`,
      `surfing: ${westwind ?? ''}`,
      `seasons: ${seasons.map(s => `${s.year} ${s.start}..${s.end}`).join('; ')}`,
      `cabins: ${cabins.map(c => `${c.name}${c.danish ? ` (${c.danish})` : ''}: ${c.features.join(', ')}`).join('; ')}`,
      `cabin prices: ${prices.map(r => `${r.year} ${r.name} type ${r.type} low ${r.low} high ${r.high} cleaning ${r.cleaning ?? '-'}`).join('; ')}`,
    ].join('\n'),
  };
}

export async function fetchHscSlots(today: string, ctx: FetchContext): Promise<Slot[]> {
  const seasons = parseHscSeasons(await page(HSC_PRICES_URL));
  if (seasons.length === 0) throw new Error('hvide-sande-camping: no "Sæson YYYY" block on /priser/ (layout changed?)');
  const checkIns = csobSaturdaySamples(today, seasons, { max: 9 });
  if (checkIns.length === 0) { ctx.note('hvide-sande-camping: no sample week inside a published season within 12 months'); return []; }
  return csobSlots(await fetchCsobSamples(HSC_PORTAL, checkIns, ctx), ctx);
}

export const hvideSandeCamping: OfferAdapter = {
  key: 'hvide-sande-camping',
  name: 'Hvide Sande Camping',
  kind: 'accommodation',
  operator: {
    name: 'Hvide Sande Camping',
    websiteUrl: SITE,
    rootDomain: 'hvidesandecamping.dk',
    contactEmail: 'info@hvidesandecamping.dk',
    phone: '+4597311218',
  },
  url: HSC_CABINS_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 23,
  async fetchContent() {
    const home = await page(HSC_HOME_URL);
    const cabins = await page(HSC_CABINS_URL);
    const surf = await page(HSC_SURF_URL);
    const prices = await page(HSC_PRICES_URL);
    if (parseHscCabins(cabins).length === 0) throw new Error('hvide-sande-camping: no cabin cards on the English overview (layout changed?)');
    return parseHvideSandeCampingContent({ home, cabins, surf, prices });
  },
  async fetchSlots(ctx) {
    return fetchHscSlots(todayIso(), ctx);
  },
};
