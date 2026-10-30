// Climate per offer spot (UV, air temperature, water temperature) — pure helpers.
// No Supabase import here so the logic is unit-testable; the runner lives in
// climate-stats.ts. Tables: climate_points (cache per 0.1° cell),
// climate_port_points (hand-geocoded departure ports), offer_climate_stats
// (one row per offer) — see migration 20261012190000_create_offer_climate_stats.

export type OfferType = 'cruise' | 'tour' | 'camp' | 'accommodation' | 'course' | 'experience' | string;
export type PointBasis = 'departure_port' | 'start_point' | 'location' | 'first_itinerary_spot';

export interface OfferRef {
  offer_id: string;
  offer_table: 'cruise_offers' | 'package_offers';
  offer_type: OfferType;
  title?: string | null;
  country: string | null;
  departure_port: string | null;
  itinerary_spots: unknown;
}

export interface PortPoint { departure_port: string; country: string; lat: number; lng: number; name: string }

export interface ResolvedPoint {
  basis: PointBasis;
  name: string | null;
  lat: number;
  lng: number;
  /** set when a cruise/tour had a departure_port we could not resolve */
  unknownPort?: string;
}

export interface ClimateCell {
  lat10: number;
  lng10: number;
  sample_lat: number;
  sample_lng: number;
  elevation_m: number | null;
  uv_months: number[];
  uv_clear_sky_months: number[];
  air_temp_max_months: number[];
  air_temp_min_months: number[];
  water_temp_months: number[] | null;
  /** ERA5 share of kiteable days per month, % (Copernicus cells only) */
  wind_kiteable_months?: (number | null)[] | null;
  /** CAMS all-sky UV, whole numbers (one-off fill for country/region cells) */
  uv_cloudy_months?: number[] | null;
  uv_cloudy_source?: string | null;
}

/**
 * Per-country wind source policy (Aaron 2026-10-22, "Ja, beides"):
 * - 'era5': Bstoked's row is a flat placeholder (49 almost every month) and ERA5 at the kite spot
 *   matches the known seasons (Rameswaram monsoons, Jeju winter monsoon, Lake Nicaragua trades),
 *   so ERA5 replaces Bstoked (still only in months with water >= 10 C).
 * - 'no-era5': no ERA5 fill until the snowkite question is settled (Norway Oct/Nov would read 82/81).
 * - 'era5-row': the wind_stats row is itself an ERA5 estimate with its own rule (not the cell's
 *   12 kn / 3 h), so its values are used as they are and labelled 'era5'.
 * Everywhere else ('default'): Bstoked where real, ERA5 only for its gaps.
 */
export type WindPolicy = 'default' | 'era5' | 'no-era5' | 'none' | 'era5-row';
export const WIND_POLICY: Record<string, WindPolicy> = {
  India: 'era5', 'South Korea': 'era5', Nicaragua: 'era5', Norway: 'no-era5',
  // 2026-10-23: ERA5 at Nitinat Lake (CA-BC) reads 0-3 % in summer; the sea grid point misses
  // the valley thermal of one of the windiest summer spots - no data beats a false 'calm'
  Canada: 'no-era5',
  // 2026-10-29 (Aaron): Belgium's wind_stats row is an ERA5 estimate (no bstoked data), so the
  // map must not label it 'bstoked'
  Belgium: 'era5',
  // 2026-10-29 (Aaron): Caribbean, Portugal and Cyprus wind_stats rows are ERA5 estimates too
  'Antigua and Barbuda': 'era5', Bahamas: 'era5', Barbados: 'era5', 'Saint Martin': 'era5',
  'Turks and Caicos Islands': 'era5', Portugal: 'era5', Cyprus: 'era5',
  // 2026-10-30 (Aaron): Qatar = ERA5 12 kn / 3 h at Fuwairit; UAE = ERA5 11 kn / 3 h at Khor Al
  // Yeefrah (Umm Al Quwain) to allow for the Gulf sea breeze that ERA5 likely under-resolves
  // ("Empfehlung: 11 kn nur für die VAE" - "ok, so machen")
  Qatar: 'era5', 'United Arab Emirates': 'era5-row',
};
/**
 * Countries coloured for temperature and UV only (Aaron 2026-10-30): grey areas next to our kite regions, no kite
 * offers. Never wind (no Bstoked row, and an ERA5 grid point says little without a kite spot); water only where it
 * is the sea people would ride (Caribbean, South-East Asia / Pacific), not for Europe's inland or micro states.
 * Points from migration 20261030160000_climate_only_countries.
 */
export const CLIMATE_ONLY: Record<string, { water: boolean }> = Object.fromEntries([
  ...['Haiti', 'Jamaica', 'Dominica', 'Trinidad and Tobago', 'Aruba', 'Curaçao', 'Sint Maarten', 'Anguilla', 'Montserrat',
    'Saint Kitts and Nevis', 'Cayman Islands', 'United States Virgin Islands', 'Saint Barthélemy',
    'Myanmar', 'Laos', 'Cambodia', 'Malaysia', 'Brunei', 'East Timor', 'Singapore', 'Solomon Islands', 'Vanuatu', 'New Caledonia',
    // Aaron 2026-10-30: the same colours as the rest of Cyprus (its point, Kiti), only without wind
    'Northern Cyprus']
    .map(country => [country, { water: true }]),
  // Aaron 2026-10-30: Russia and Belarus stay grey.
  ...['Andorra', 'Bosnia and Herzegovina', 'Czech Republic', 'Hungary', 'Kosovo', 'Liechtenstein', 'Luxembourg',
    'Malta', 'Moldova', 'Monaco', 'San Marino', 'Serbia', 'Slovakia', 'Vatican City']
    .map(country => [country, { water: false }]),
]);
export const windPolicy = (country: string): WindPolicy => CLIMATE_ONLY[country] ? 'none' : WIND_POLICY[country] ?? 'default';
/** false for climate-only countries without water (Europe): their rows carry no water temperature */
export const showsWater = (country: string): boolean => CLIMATE_ONLY[country]?.water ?? true;

/**
 * Region wind rows kept as source 'bstoked' although wind_stats (per country) has no row for them
 * (Aaron 2026-10-28: "werte anpassen, quelle bstoked lassen"). Same scale as wind_stats.months,
 * never exactly 10 (that is the "< 40 %" placeholder). BR-SC: ERA5 at Ibiraquera read 5-30 %
 * against Sep-Mar seasons in every spot guide; values from Open-Meteo kiteable-day shares 2022-2025
 * (Floripa, Ibiraquera; best_match matched Bstoked at the Cumbuco peak) + Windfinder + guides.
 * BR-RN keeps the trades longer than the north coast (Gostoso/Galinhos in all 3 models), BR-RS
 * from Tramandaí/Cassino; regions from migration 20261028150000.
 * ES-CT (Aaron 2026-10-30, "deine Werte, Juni und August auf 58"): ERA5 at Sant Pere Pescador read 7-24 %,
 * Meteocat stations in town (U2 0-7 %, Roses D4 5-21 %, 2021-2025, same 12 kn / 3 h rule) miss the beach
 * thermal; Kite Jungle 11-15 days >= 12 kn a month without thermals, the local school a daily summer
 * thermal (12-20 kn, Jun-Sep) plus Tramuntana spells Sep-May. Estimate between them, only July above 60.
 */
export const REGION_BSTOKED: Record<string, number[]> = {
  'BR-SC': [35, 30, 30, 30, 25, 25, 25, 40, 50, 50, 50, 40],
  'BR-RN': [50, 50, 20, 15, 30, 45, 75, 85, 95, 95, 85, 80],
  'BR-RS': [45, 40, 35, 35, 30, 30, 30, 45, 50, 55, 55, 50],
  'ES-CT': [35, 40, 40, 45, 50, 58, 65, 58, 50, 35, 40, 35],
};

/**
 * Bstoked row for a region's wind: REGION_BSTOKED first; else only when the region sits on the
 * same climate cell as its country's point (it IS the country's kite spot, e.g. BR-NE = Cumbuco);
 * other regions get ERA5 only. Without this, BR-NE showed ERA5 0-10 % Jan-May where Bstoked has
 * 79/61/39/30 (ERA5 misses the thermal) - found 2026-10-23.
 */
export function regionBstoked(
  regionCell: { lat10: number; lng10: number }, countryCell: { lat10: number; lng10: number } | null | undefined,
  bstoked: number[] | null | undefined, regionKey?: string,
): number[] | null {
  if (regionKey && REGION_BSTOKED[regionKey]) return REGION_BSTOKED[regionKey];
  return countryCell && bstoked && countryCell.lat10 === regionCell.lat10 && countryCell.lng10 === regionCell.lng10 ? bstoked : null;
}

/**
 * How the map colours a country, for all layers (Aaron 2026-10-23, migration 20261023120000):
 * 'country' = whole country, region rows override their admin-1 units; 'regions_only' = only
 * region rows' units (one point can't stand for the USA or Brazil); 'hidden' = no data.
 * 'hidden-until-offers' resolves to 'hidden' without offers and to 'regions_only' with offers
 * (Canada: "ausblenden, solange wir dort keine offers haben (und mit offers dann nur regions zeigen)").
 * Keys are lower-case so alias rows (usa, us, united states of america) follow their country.
 */
export type MapDisplay = 'country' | 'regions_only' | 'hidden';
const MAP_DISPLAY: Record<string, MapDisplay | 'hidden-until-offers'> = {
  'united states': 'regions_only', usa: 'regions_only', us: 'regions_only', 'united states of america': 'regions_only',
  brazil: 'regions_only',
  india: 'regions_only', // Aaron 2026-10-23: regions with offers only (IN-TN Rameswaram)
  canada: 'hidden-until-offers',
  china: 'hidden-until-offers',
  russia: 'hidden',
};
export function mapDisplay(country: string, hasOffers: boolean): MapDisplay {
  const m = MAP_DISPLAY[country.toLowerCase()] ?? 'country';
  return m === 'hidden-until-offers' ? (hasOffers ? 'regions_only' : 'hidden') : m;
}

/**
 * Wind value per month for the map (Aaron 2026-10-21): Bstoked windProbability where it is a
 * real number (the stored 10 is the "< 40 %" placeholder); otherwise the ERA5 share of
 * kiteable days, but only in months whose water temperature is >= 10 C; else null (no data).
 * Points without water temperature get no ERA5 fill.
 */
export function combineWind(
  bstoked: number[] | null, era5: (number | null)[] | null | undefined, water: number[] | null,
  policy: WindPolicy = 'default',
) {
  const months: (number | null)[] = [], sources: ('bstoked' | 'era5' | null)[] = [];
  const useBstoked = policy !== 'era5' && policy !== 'none', useEra5 = policy !== 'no-era5' && policy !== 'none';
  for (let i = 0; i < 12; i++) {
    if (policy === 'era5-row') {
      const v = bstoked?.[i] ?? null;
      months.push(v); sources.push(v == null ? null : 'era5');
    } else if (useBstoked && bstoked && bstoked[i] != null && bstoked[i] !== 10) { months.push(bstoked[i]); sources.push('bstoked'); }
    else if (useEra5 && era5 && era5[i] != null && water && water[i] != null && water[i] >= 10) { months.push(era5[i]); sources.push('era5'); }
    else { months.push(null); sources.push(null); }
  }
  return { wind_months: months, wind_source_months: sources };
}

/** Tolerance for re-using a cached cell (degrees, per axis) — matches the migration. */
export const CELL_TOLERANCE = 0.075;

const usesPort = (t: OfferType) => t === 'cruise' || t === 'tour';

function firstSpot(spots: unknown): { lat: number; lng: number; name: string | null } | null {
  if (!Array.isArray(spots) || spots.length === 0) return null;
  const s = spots[0] as Record<string, unknown>;
  const lat = typeof s.lat === 'number' ? s.lat : s.lat != null ? Number(s.lat) : NaN;
  const lng = typeof s.lng === 'number' ? s.lng : s.lng != null ? Number(s.lng) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, name: typeof s.name === 'string' ? s.name : null };
}

/**
 * Point rule (Aaron, 2026-10-12): cruise -> departure port, tour -> start point
 * (both = departure_port, resolved via climate_port_points), everything else ->
 * location (itinerary_spots[0]). Cruises/tours fall back to their first itinerary spot.
 */
export function resolvePoint(o: OfferRef, ports: Map<string, PortPoint>): ResolvedPoint | null {
  let unknownPort: string | undefined;
  if (usesPort(o.offer_type) && o.departure_port) {
    const p = ports.get(portKey(o.departure_port, o.country));
    if (p) {
      return { basis: o.offer_type === 'cruise' ? 'departure_port' : 'start_point', name: p.name, lat: p.lat, lng: p.lng };
    }
    unknownPort = o.departure_port;
  }
  const s = firstSpot(o.itinerary_spots);
  if (!s) return null;
  return {
    basis: usesPort(o.offer_type) ? 'first_itinerary_spot' : 'location',
    name: s.name, lat: s.lat, lng: s.lng,
    ...(unknownPort ? { unknownPort } : {}),
  };
}

export const portKey = (port: string, country: string | null) => `${port}\u0000${country ?? ''}`;

/** Offer spot nearest the median lat/lng of a country's offers (the seed rule of 2026-10-21). */
export function medianOfferSpot(spots: { lat: number; lng: number; name: string | null }[]) {
  const med = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const la = med(spots.map(s => s.lat)), lo = med(spots.map(s => s.lng));
  return spots.reduce((b, s) => (s.lat - la) ** 2 + (s.lng - lo) ** 2 < (b.lat - la) ** 2 + (b.lng - lo) ** 2 ? s : b);
}

/**
 * UV with clouds never above the clear-sky value (Aaron 2026-10-22): the computed clear-sky max
 * can sit ~1 below CAMS (e.g. Lancelin Jan 12 vs 13), and the app's cloud toggle must not show
 * "with clouds" higher than "without". Cells keep the raw CAMS values.
 */
export function capCloudyUv(cell: { uv_months: number[]; uv_cloudy_months?: number[] | null }): number[] | null {
  return cell.uv_cloudy_months ? cell.uv_cloudy_months.map((v, i) => Math.min(v, cell.uv_months[i])) : null;
}

/** round half away from zero, like Postgres round(numeric) */
export const round10 = (x: number) => Math.sign(x) * Math.round(Math.abs(x) * 10);

/** Nearest cached cell within CELL_TOLERANCE on both axes, else null. */
export function findCell<T extends { lat10: number; lng10: number }>(cells: T[], lat: number, lng: number): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const c of cells) {
    const dLat = Math.abs(c.lat10 / 10 - lat);
    const dLng = Math.abs(c.lng10 / 10 - lng);
    if (dLat > CELL_TOLERANCE + 1e-9 || dLng > CELL_TOLERANCE + 1e-9) continue;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const month = (iso: string) => Number(iso.slice(5, 7)) - 1;

/** hourly series -> per month: mean of the daily maximum (local time stamps). */
export function monthlyMeanOfDailyMax(time: string[], values: (number | null)[]): number[] {
  const day = new Map<string, number>();
  time.forEach((t, i) => {
    const v = values[i];
    if (v == null) return;
    const d = t.slice(0, 10);
    const cur = day.get(d);
    if (cur === undefined || v > cur) day.set(d, v);
  });
  return monthlyMean([...day.entries()]);
}

/** hourly series -> per month: mean of the daily minimum (local time stamps). */
export function monthlyMeanOfDailyMin(time: string[], values: (number | null)[]): number[] {
  const day = new Map<string, number>();
  time.forEach((t, i) => {
    const v = values[i];
    if (v == null) return;
    const d = t.slice(0, 10);
    const cur = day.get(d);
    if (cur === undefined || v < cur) day.set(d, v);
  });
  return monthlyMean([...day.entries()]);
}

/** hourly series -> per month: mean of daily means; null if any month has < minDays days. */
export function monthlyMeanOfDailyMean(time: string[], values: (number | null)[], minDays = 20): number[] | null {
  const day = new Map<string, [number, number]>();
  time.forEach((t, i) => {
    const v = values[i];
    if (v == null) return;
    const d = t.slice(0, 10);
    const cur = day.get(d) ?? [0, 0];
    cur[0] += v; cur[1]++;
    day.set(d, cur);
  });
  const perMonth = Array.from({ length: 12 }, () => 0);
  for (const d of day.keys()) perMonth[month(d)]++;
  if (perMonth.some(n => n < minDays)) return null;
  return monthlyMean([...day.entries()].map(([d, [s, n]]) => [d, s / n] as [string, number]));
}

/** daily series -> per month mean. */
export function monthlyMean(entries: [string, number][]): number[] {
  const acc = Array.from({ length: 12 }, () => [0, 0]);
  for (const [d, v] of entries) { const m = month(d); acc[m][0] += v; acc[m][1]++; }
  if (acc.some(a => a[1] === 0)) throw new Error('climate: a month has no data');
  return acc.map(([s, n]) => r1(s / n));
}

// ---------------------------------------------------------------- fetching

export class RateLimitError extends Error {
  constructor(msg: string, readonly scope: 'minute' | 'hour' | 'day') { super(msg); }
}

type FetchJson = (url: string) => Promise<any>;

/** Open-Meteo hosts; with OPEN_METEO_API_KEY the commercial customer-* hosts are used. */
export function openMeteoUrl(api: 'air-quality' | 'archive' | 'marine', params: Record<string, string | number>, apiKey?: string): string {
  const host = {
    'air-quality': 'air-quality-api.open-meteo.com/v1/air-quality',
    archive: 'archive-api.open-meteo.com/v1/archive',
    marine: 'marine-api.open-meteo.com/v1/marine',
  }[api];
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  if (apiKey) qs.set('apikey', apiKey);
  return `https://${apiKey ? 'customer-' : ''}${host}?${qs}`;
}

/** Calls fetchJson; waits out per-minute limits, throws RateLimitError for hourly/daily ones. */
export async function getWithLimits(fetchJson: FetchJson, url: string, sleep = (ms: number) => new Promise(r => setTimeout(r, ms))): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetchJson(url);
    if (!r?.error) return r;
    const reason = String(r.reason ?? 'unknown error');
    if (/minutely/i.test(reason)) { await sleep(65_000); continue; }
    if (/hourly/i.test(reason)) throw new RateLimitError(reason, 'hour');
    if (/daily/i.test(reason)) throw new RateLimitError(reason, 'day');
    throw new Error(`open-meteo: ${reason}`);
  }
  throw new RateLimitError('open-meteo: minutely limit persists', 'minute');
}

/** Fetches all five monthly series for one point (sample = the offer's own coordinate). */
export async function fetchCellClimate(
  lat: number, lng: number,
  opts: { fetchJson: FetchJson; apiKey?: string; elevation?: number | null; sleep?: (ms: number) => Promise<unknown> },
): Promise<Omit<ClimateCell, 'lat10' | 'lng10'>> {
  const get = (u: string) => getWithLimits(opts.fetchJson, u, opts.sleep as any);
  const la = Number(lat.toFixed(4)), lo = Number(lng.toFixed(4));
  const uv = await get(openMeteoUrl('air-quality', {
    latitude: la, longitude: lo, hourly: 'uv_index,uv_index_clear_sky',
    start_date: '2023-01-01', end_date: '2025-12-31', timezone: 'auto', domains: 'cams_global',
  }, opts.apiKey));
  const air = await get(openMeteoUrl('archive', {
    latitude: la, longitude: lo, daily: 'temperature_2m_max,temperature_2m_min',
    start_date: '2016-01-01', end_date: '2025-12-31', timezone: 'auto',
    ...(opts.elevation != null ? { elevation: opts.elevation } : {}),
  }, opts.apiKey));
  const sea = await get(openMeteoUrl('marine', {
    latitude: la, longitude: lo, hourly: 'sea_surface_temperature',
    start_date: '2023-01-01', end_date: '2025-12-31', timezone: 'auto', cell_selection: 'sea',
  }, opts.apiKey)).catch((e: unknown) => {
    if (e instanceof RateLimitError) throw e;
    return null; // no sea cell nearby -> water temp stays NULL
  });

  const t: string[] = air.daily.time;
  return {
    sample_lat: la,
    sample_lng: lo,
    elevation_m: opts.elevation ?? null,
    uv_months: monthlyMeanOfDailyMax(uv.hourly.time, uv.hourly.uv_index),
    uv_clear_sky_months: monthlyMeanOfDailyMax(uv.hourly.time, uv.hourly.uv_index_clear_sky),
    air_temp_max_months: monthlyMean(t.map((d, i) => [d, air.daily.temperature_2m_max[i]] as [string, number]).filter(([, v]) => v != null)),
    air_temp_min_months: monthlyMean(t.map((d, i) => [d, air.daily.temperature_2m_min[i]] as [string, number]).filter(([, v]) => v != null)),
    water_temp_months: sea?.hourly ? monthlyMeanOfDailyMean(sea.hourly.time, sea.hourly.sea_surface_temperature) : null,
  };
}
