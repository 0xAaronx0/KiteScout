// ---------------------------------------------------------------------------
// Villa Esencia, Long Bay Beach (Providenciales, Turks and Caicos Islands) - 2.25-acre beachfront property with
// 10 suites in 4 villas (Karana, Wyakha, Esencia Premiere, cottages) run by owners who kite: compressed air on
// the beach, two self-launch/landing posts, loaner boards, gear storage; lessons through partner schools.
//
// Data path (checked 2026-10-12): WordPress + the Streamline VRS plugin ("streamline-core" / ResortPro).
//   content  / (property, beach, kite intro, hosts) and /top-kiteboarding-destination/ (kite set-up, season
//            "early October until end of August") + the unit list below.
//   engine   the plugin's own anonymous proxy, exactly as its AngularJS front end calls it (resortpro.min.js
//            rpapi.getWithParams -> $http POST, parameters in the query string, empty body):
//              POST /wp-admin/admin-ajax.php?action=streamlinecore-api-request&params={"methodName":M,"params":P}
//            M = GetPropertyListWordPress {page_number:1, page_results_number:50, use_description:"no",
//                use_amenities:"no"} -> data.property[] (id, name, bedrooms_number, max_occupants, view_name,
//                city/state_name, location_latitude/longitude, price_data {daily, currency}, default_image_path);
//            M = GetPropertyRatesRawData {unit_id} -> data.rates[] (season_name, period_begin/end MM/DD/YYYY,
//                narrow_defined_days = minimum nights, daily_first_interval_price "$410.80", currency).
//            No login, nonce, cookie or token. NOT used: GetTapeChartData (returns guest names - personal data)
//            and the per-unit availability calendar (one more call per unit).
//   slots    per Turks and Caicos unit (the two Asheville NC cabins of the same owners are skipped) one slot per
//            rate period with its real dates, USD per unit per night, minNights; availability 'unknown'.
// robots.txt (2026-10-12): "User-agent: * allow: /".
// Requests per run: content 2 + 1 (unit list, memoised), slots 1 + one rate table per unit (15) -> 18 for a
//   full run.
// Known limits: rates are the base nightly rate (base occupancy; extra persons cost extra, taxes and fees on
//   top, "Use the Inquiry button to get a complete quote"); no availability (calendar not read).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, imageCandidates, iso, parse, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.villaesencia.com';
export const VE_HOME_URL = `${SITE}/`;
export const VE_KITE_URL = `${SITE}/top-kiteboarding-destination/`;
const AJAX = `${SITE}/wp-admin/admin-ajax.php`;

export interface VeUnit {
  id: number; name: string; slug: string; bedrooms: number | null; bathrooms: number | null; maxGuests: number | null;
  view: string | null; category: string | null; city: string | null; state: string | null;
  lat: number | null; lng: number | null; fromDaily: number | null; currency: string | null; image: string | null; description: string | null;
}
export interface VeRate { season: string; start: string; end: string; minNights: number | null; price: number; currency: string }

/** The plugin's admin-ajax proxy URL for one Streamline method. */
export function veApiUrl(method: string, params: Record<string, unknown>): string {
  return `${AJAX}?action=streamlinecore-api-request&params=${encodeURIComponent(JSON.stringify({ methodName: method, params }))}`;
}
export const VE_LIST_URL = veApiUrl('GetPropertyListWordPress', { page_number: 1, page_results_number: 50, use_description: 'no', use_amenities: 'no' });
export const veRatesUrl = (unitId: number): string => veApiUrl('GetPropertyRatesRawData', { unit_id: unitId });

// --- local helpers ----------------------------------------------------------------------------
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const num = (v: unknown): number | null => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) ? n : null; };
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
/** MM/DD/YYYY -> YYYY-MM-DD */
function usDate(s: string): string | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? iso(+m[3], +m[1], +m[2]) : null;
}
function post(url: string): Promise<string> {
  return fetchText(url, { method: 'POST', contentType: 'application/json', accept: 'application/json, text/plain, */*' });
}
const memo = new Map<string, { at: number; p: Promise<string> }>();
function once(url: string, load: (u: string) => Promise<string>): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = load(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

// --- pure parsers -----------------------------------------------------------------------------
/** GetPropertyListWordPress -> units (all locations; filter with veIsTci). */
export function parseVeUnits(json: string): VeUnit[] {
  const d = JSON.parse(json) as { data?: { property?: unknown } };
  const raw = d.data?.property;
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<Record<string, unknown>>;
  return list.map(p => {
    const price = (p.price_data ?? {}) as Record<string, unknown>;
    return {
      id: Number(p.id),
      name: collapse(String(p.name ?? '')),
      slug: String(p.seo_page_name ?? ''),
      bedrooms: num(p.bedrooms_number),
      bathrooms: num(p.bathrooms_number),
      maxGuests: num(p.max_occupants),
      view: str(p.view_name),
      category: str(p.category_name) ?? str(p.location_area_name),
      city: str(p.city),
      state: str(p.state_name),
      lat: num(p.location_latitude ?? p.latitude),
      lng: num(p.location_longitude ?? p.longitude),
      fromDaily: num(price.daily),
      currency: str(price.currency),
      image: str(p.default_image_path),
      description: str(p.short_description) ? clean(String(p.short_description).replace(/<br\s*\/?>/gi, ' ')) : null,
    };
  }).filter(u => u.id && u.name);
}

/** The Turks and Caicos units (Long Bay, Providenciales); the owners also list cabins in Asheville, NC. */
export function veIsTci(u: VeUnit): boolean {
  return /providenciales|long bay|turks/i.test(`${u.city ?? ''} ${u.state ?? ''}`);
}

/** GetPropertyRatesRawData -> rate periods with real dates. */
export function parseVeRates(json: string): VeRate[] {
  const d = JSON.parse(json) as { data?: { rates?: unknown } };
  const raw = d.data?.rates;
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<Record<string, unknown>>;
  const out: VeRate[] = [];
  for (const r of list) {
    const start = usDate(String(r.period_begin ?? ''));
    const end = usDate(String(r.period_end ?? ''));
    const price = parseAmount(String(r.daily_first_interval_price ?? ''));
    const currency = str(r.currency) ?? (/\$/.test(String(r.daily_first_interval_price ?? '')) ? 'USD' : null);
    if (!start || !end || !price || !currency) continue;
    out.push({ season: collapse(String(r.season_name ?? r.period_name ?? '')), start, end, minNights: num(r.narrow_defined_days), price, currency });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export function buildVeSlots(rates: Array<{ unit: VeUnit; rates: VeRate[] }>, today: string): Slot[] {
  const out: Slot[] = [];
  for (const { unit, rates: rs } of rates) {
    for (const r of rs) {
      if (r.end < today) continue;
      out.push({
        key: `${keyPart(unit.name)}|${r.start}`,
        startDate: r.start,
        endDate: r.end,
        unit: unit.name,
        price: r.price,
        currency: r.currency,
        priceUnit: 'per_night',
        priceBasis: 'room',
        occupancy: null,
        availability: 'unknown',
        availabilityText: null,
        spotsLeft: null,
        minNights: r.minNights && r.minNights > 1 ? r.minNights : null,
      });
    }
  }
  return out;
}

/** Most common coordinate pair of the units (the engine repeats one property pin; a few units carry typos). */
export function veCoords(units: VeUnit[]): { lat: number; lng: number } | null {
  const tally = new Map<string, number>();
  for (const u of units) if (u.lat !== null && u.lng !== null) tally.set(`${u.lat},${u.lng}`, (tally.get(`${u.lat},${u.lng}`) ?? 0) + 1);
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] * 2 < units.length) return null;
  const [lat, lng] = best[0].split(',').map(Number);
  return { lat, lng };
}

// --- content ----------------------------------------------------------------------------------
function textLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav, form')) el.remove();
  return (root.querySelector('body') ?? root).querySelectorAll('h1, h2, h3, h4, h5, p, li').map(e => collapse(e.text)).filter(Boolean);
}
/** WordPress photos of a page (lazy-load attributes included), no logos / buttons / icons. */
export function veImages(html: string, base: string): string[] {
  const out: string[] = [];
  const urls = [...html.matchAll(/(?:src|data-src|data-lazy-src)="((?:https:\/\/www\.villaesencia\.com)?\/wp-content\/uploads\/[^"]+\.(?:jpe?g|webp))"/gi)].map(m => new URL(m[1], base).toString());
  for (const u of [...imageCandidates(html, base, null, 40), ...urls]) {
    if (!/villaesencia\.com\/wp-content\/uploads\//.test(u) || /logo|icon|button|review|cancellation|\.png$|\.svg$/i.test(u)) continue;
    const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
    if (!out.some(x => x.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '') === k)) out.push(u);
  }
  return out;
}

export interface VePages { home: string; kite: string; list: string }

export function parseVillaEsenciaContent(p: VePages): OfferContent {
  const home = textLines(p.home);
  const kite = textLines(p.kite);
  const homeText = home.join(' ');
  const kiteText = kite.join(' ');
  const units = parseVeUnits(p.list).filter(veIsTci);
  const coords = veCoords(units);
  const acres = homeText.match(/is a ([\d.]+) acre property/)?.[1] ?? null;
  const suites = homeText.match(/only (\d+) Turks and Caicos vacation suites in (\d+) elegant villas/);
  const season = kiteText.match(/Kiting season - ([^)]+)\)/)?.[1] ?? null;
  const setup = (() => {
    const a = kite.findIndex(l => /^set-up for kiters$/i.test(l));
    if (a < 0) return [];
    const b = kite.findIndex((l, i) => i > a && /^ease of use$/i.test(l));
    return kite.slice(a + 1, b > a ? b : a + 10).filter(l => l.length < 120);
  })();
  const prices = units.map(u => u.fromDaily).filter((x): x is number => x !== null);
  const usd = (n: number) => `USD ${Math.round(n)}`;

  // most units share one generic text about Long Bay Beach Drive: keep only unit-specific descriptions
  const descUse = new Map<string, number>();
  for (const u of units) if (u.description) descUse.set(u.description, (descUse.get(u.description) ?? 0) + 1);
  const rooms: ContentRoom[] = units.map(u => ({
    name: u.name,
    description: u.description && descUse.get(u.description) === 1 ? u.description.slice(0, 600) : null,
    features: [
      u.bedrooms !== null ? `${u.bedrooms} bedroom${u.bedrooms === 1 ? '' : 's'}` : null,
      u.bathrooms !== null ? `${u.bathrooms} bathroom${u.bathrooms === 1 ? '' : 's'}` : null,
      u.maxGuests !== null ? `Up to ${u.maxGuests} guests` : null,
      u.view,
      u.category && u.category !== u.view ? u.category : null,
      u.fromDaily !== null ? `From ${u.currency ?? 'USD'} ${u.fromDaily} per night` : null,
    ].filter((x): x is string => !!x),
  }));

  const imageUrls: string[] = [];
  for (const u of [...veImages(p.home, VE_HOME_URL), ...units.map(x => x.image).filter((x): x is string => !!x && /\.(jpe?g|webp)$/i.test(x)), ...veImages(p.kite, VE_KITE_URL)]) {
    if (!imageUrls.includes(u)) imageUrls.push(u);
  }

  const summary = [
    `Villa Esencia is a ${acres ? `${acres}-acre ` : ''}beachfront property of native vegetation on Long Bay Beach, Providenciales (Turks and Caicos Islands)${suites ? `, with ${suites[1]} suites in ${suites[2]} villas` : ''}; Long Bay is a 3-mile white-sand beach with shallow, flat water and side-onshore wind.`,
    `The owners kite themselves: the property has compressed air on the beach, two self-launch and landing posts, loaner boards for light wind and gear storage off the beach, and lessons are arranged through partner schools${season ? `; the kiting season runs ${season}` : ''}.`,
    `${units.length} bookable units from studios to a four-bedroom villa${prices.length ? ` start at ${usd(Math.min(...prices))} to ${usd(Math.max(...prices))} per night (seasonal rates, minimum 3 nights, taxes and fees extra)` : ''}, all with kitchens; SUP boards and kayaks are free for no-wind days.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Villa Esencia',
    summary,
    continent: 'North America',
    country: 'Turks and Caicos Islands',
    region: 'Providenciales',
    spot: 'Long Bay Beach',
    // most common unit pin of the site's Streamline data (the unit pages' map uses it)
    ...(coords ? { spotCoords: coords } : {}),
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // kite page: "both beginner and advanced kiters", "especially easy and safe environment to learn kiting"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: null, // via partner schools ("Inquire with our partners for lessons")
    equipmentRental: null, // loaner boards only
    beginnerFriendly: /easy and safe environment to learn kiting/i.test(kiteText) ? true : null,
    includedServices: [
      ...setup,
      ...(/SUP boards and ocean kayaks/i.test(kiteText) ? ['SUP boards and ocean kayaks'] : []),
      ...(/Tiki huts/i.test(kiteText) ? ['Beach shade (tiki huts, umbrellas), lounge chairs, hammocks'] : []),
    ],
    optionalServices: ['Kite lessons through partner schools', 'Concierge services', 'Pickleball court'],
    accommodation: 'beachfront villas and suites with kitchens',
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: VE_HOME_URL,
    bookingUrl: VE_HOME_URL,
    sourceText: [
      `home: ${homeText}`,
      `kite: ${kiteText}`,
      `units: ${units.map(u => `${u.id} ${u.name} ${u.bedrooms}br ${u.maxGuests}p ${u.view ?? ''} from ${u.fromDaily} ${u.currency}`).join(' | ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export async function fetchVeSlots(ctx: FetchContext, today: string): Promise<Slot[]> {
  const units = parseVeUnits(await once(VE_LIST_URL, post)).filter(veIsTci);
  if (units.length === 0) throw new Error('villa-esencia: Streamline unit list has no Turks and Caicos unit');
  const rates: Array<{ unit: VeUnit; rates: VeRate[] }> = [];
  for (const unit of units) {
    try { rates.push({ unit, rates: parseVeRates(await post(veRatesUrl(unit.id))) }); }
    catch (e) { ctx.incomplete(`rates of ${unit.name} (${unit.id}): ${(e as Error).message}`); }
  }
  const slots = buildVeSlots(rates, today);
  if (slots.length === 0) ctx.note('no current rate period in any Streamline rate table');
  return slots;
}

export const villaEsenciaLongBay: OfferAdapter = {
  key: 'villa-esencia-long-bay',
  name: 'Villa Esencia, Long Bay Beach',
  kind: 'accommodation',
  operator: {
    name: 'Villa Esencia',
    websiteUrl: SITE,
    rootDomain: 'villaesencia.com',
    phone: '+15619353365',
  },
  url: VE_HOME_URL,
  slotMethod: 'booking_engine',
  fetchBudget: 18,
  async fetchContent() {
    const home = await fetchText(VE_HOME_URL, { accept: 'text/html' });
    const kite = await fetchText(VE_KITE_URL, { accept: 'text/html' });
    const list = await once(VE_LIST_URL, post);
    return parseVillaEsenciaContent({ home, kite, list });
  },
  fetchSlots: ctx => fetchVeSlots(ctx, todayIso()),
};
