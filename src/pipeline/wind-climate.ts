// `pnpm cli wind-climate` - typical 10 m wind per calendar month for the animated wind layer
// on the KCS world map (MartinMarzi/KiteCruiseScout#445): when a visitor picks another month,
// the map plays that month's typical flow instead of today's GFS forecast.
//
// Source: Copernicus ERA5 monthly means (CDS reanalysis-era5-single-levels-monthly-means,
// CC BY 4.0), 2016-2025 like the conditions layer, regridded by CDS to 1.0 deg (same grid as
// the GFS file). Per point and month: direction = mean u/v vector, length = mean wind speed,
// faded where the direction is unsteady (mean vector < 30 % of the mean speed), so opposing
// winds (Tarifa's Levante/Poniente) show as weak flow instead of a made-up steady one.
// Output: one bundle (12 months of leaflet-velocity records) published as a `wind-data`
// release asset; kitescout.tech/data/wind/climate/MM.json serves one month each.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { decodeGrib1, type Grib1Field } from '../lib/grib1.js';
import { retrieveRetrying, unzip } from './copernicus.js';

export const CLIMATE_SCHEMA_VERSION = 1;
export const CLIMATE_DATASET = 'reanalysis-era5-single-levels-monthly-means';
export const CLIMATE_YEARS = Array.from({ length: 10 }, (_, i) => 2016 + i);
export const CLIMATE_SOURCE = 'Copernicus ERA5 monthly means 2016-2025 (CC BY 4.0), processed by KiteScout';
export const CLIMATE_METHOD = 'Direction: mean 10 m wind vector. Length: mean 10 m wind speed, faded where the mean vector is below 30 % of the mean speed (variable directions). 1.0 deg grid.';
/** mean vector / mean speed at or above which the full mean speed is drawn */
export const STEADY_FULL = 0.3;
const PARAMS = { u: 165, v: 166, s: 207 } as const;
const NX = 360, NY = 181;

export interface ClimateHeader {
  parameterCategory: number; parameterNumber: number; parameterNumberName: string; parameterUnit: string;
  refTime: string; forecastTime: number;
  nx: number; ny: number; lo1: number; la1: number; lo2: number; la2: number; dx: number; dy: number; scanMode: number;
  numberPoints: number;
  // ours
  schemaVersion: number; kind: 'monthly-climatology'; source: string; month: number; period: string;
  generatedAt: string; resolutionDeg: number;
}
export interface ClimateRecord { header: ClimateHeader; data: (number | null)[] }
export interface ClimateBundle {
  schemaVersion: number; kind: 'monthly-climatology'; source: string; method: string; period: string; generatedAt: string;
  /** index 0 = January; each month is [U record, V record] in leaflet-velocity format */
  months: ClimateRecord[][];
}

export function climateRequest(year: number): Record<string, unknown> {
  return {
    product_type: ['monthly_averaged_reanalysis'],
    variable: ['10m_u_component_of_wind', '10m_v_component_of_wind', '10m_wind_speed'],
    year: [String(year)],
    month: Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')),
    time: ['00:00'],
    data_format: 'grib',
    download_format: 'unarchived',
    grid: ['1.0', '1.0'],
  };
}

/** Values of a global regular grid at the 1.0 deg points (lat 90..-90, lon 0..359, GFS order). */
export function toOneDegree(f: Grib1Field): Float64Array {
  const g = f.grid;
  const eps = 1e-6;
  if (g.nx * g.dx < 360 - g.dx / 2 || Math.abs(Math.abs(g.la1 - g.la2) - 180) > eps) {
    throw new Error(`wind-climate: param ${f.param} grid is not global (${g.nx}x${g.ny}, dx ${g.dx}, lat ${g.la1}..${g.la2})`);
  }
  const out = new Float64Array(NX * NY);
  for (let j = 0; j < NY; j++) {
    const lat = 90 - j;
    const sj = g.scanMode & 64 ? (lat - g.la1) / g.dy : (g.la1 - lat) / g.dy;
    for (let i = 0; i < NX; i++) {
      const si = (((i - g.lo1) % 360) + 360) % 360 / g.dx;
      if (Math.abs(sj - Math.round(sj)) > eps || Math.abs(si - Math.round(si)) > eps) {
        throw new Error(`wind-climate: ${lat},${i} is not on the source grid (dx ${g.dx}, dy ${g.dy})`);
      }
      const idx = Math.round(sj) * g.nx + Math.round(si);
      if (Math.round(sj) < 0 || Math.round(sj) >= g.ny || Math.round(si) >= g.nx) throw new Error('wind-climate: grid index out of range');
      out[j * NX + i] = f.values[idx];
    }
  }
  return out;
}

export interface MonthSums { u: Float64Array; v: Float64Array; s: Float64Array; years: { u: Set<number>; v: Set<number>; s: Set<number> } }
export const emptySums = (): MonthSums[] => Array.from({ length: 12 }, () => ({
  u: new Float64Array(NX * NY), v: new Float64Array(NX * NY), s: new Float64Array(NX * NY),
  years: { u: new Set<number>(), v: new Set<number>(), s: new Set<number>() },
}));

/** Adds decoded monthly-mean fields to the per-month sums; each (param, month, year) only once. */
export function accumulate(fields: Grib1Field[], sums: MonthSums[]): void {
  for (const f of fields) {
    const key = f.param === PARAMS.u ? 'u' : f.param === PARAMS.v ? 'v' : f.param === PARAMS.s ? 's' : null;
    if (!key) throw new Error(`wind-climate: unexpected GRIB parameter ${f.param}`);
    const month = f.date.getUTCMonth(), year = f.date.getUTCFullYear();
    const m = sums[month];
    if (m.years[key].has(year)) throw new Error(`wind-climate: ${key} ${year}-${month + 1} twice`);
    m.years[key].add(year);
    const vals = toOneDegree(f);
    for (let k = 0; k < vals.length; k++) {
      if (!Number.isFinite(vals[k])) throw new Error(`wind-climate: missing ${key} value at ${year}-${month + 1}`);
      m[key][k] += vals[k];
    }
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10 || 0;

/** Typical flow of one month as a leaflet-velocity U/V pair. */
export function buildMonth(sums: MonthSums, month: number, generatedAt: Date): ClimateRecord[] {
  const n = sums.years.u.size;
  if (!n || sums.years.v.size !== n || sums.years.s.size !== n) throw new Error(`wind-climate: month ${month + 1} has uneven years`);
  const u = new Array<number>(NX * NY), v = new Array<number>(NX * NY);
  for (let k = 0; k < NX * NY; k++) {
    const ub = sums.u[k] / n, vb = sums.v[k] / n, s = sums.s[k] / n;
    const vec = Math.hypot(ub, vb);
    const len = vec > 1e-9 && s > 0 ? s * Math.min(1, vec / s / STEADY_FULL) : 0;
    u[k] = vec > 1e-9 ? round1((ub / vec) * len) : 0;
    v[k] = vec > 1e-9 ? round1((vb / vec) * len) : 0;
  }
  const header = (parameterNumber: number, name: string): ClimateHeader => ({
    parameterCategory: 2, parameterNumber, parameterNumberName: name, parameterUnit: 'm.s-1',
    refTime: generatedAt.toISOString(), forecastTime: 0,
    nx: NX, ny: NY, lo1: 0, la1: 90, lo2: 359, la2: -90, dx: 1, dy: 1, scanMode: 0, numberPoints: NX * NY,
    schemaVersion: CLIMATE_SCHEMA_VERSION, kind: 'monthly-climatology', source: CLIMATE_SOURCE, month: month + 1,
    period: `${Math.min(...sums.years.u)}-${Math.max(...sums.years.u)}`, generatedAt: generatedAt.toISOString(), resolutionDeg: 1,
  });
  return [{ header: header(2, 'U-component_of_wind'), data: u }, { header: header(3, 'V-component_of_wind'), data: v }];
}

/** Mean of a record's values inside a lat/lon box (lon 0..359). */
export function boxMean(rec: ClimateRecord, lat0: number, lat1: number, lon0: number, lon1: number): number {
  let sum = 0, n = 0;
  for (let lat = lat0; lat <= lat1; lat++) for (let lon = lon0; lon <= lon1; lon++) {
    const value = rec.data[(90 - lat) * NX + ((lon % 360) + 360) % 360];
    if (value != null) { sum += value; n++; }
  }
  return sum / n;
}

/** Structure checks plus physical sanity gates, so a broken decode or month mix-up never ships. */
export function validateClimateBundle(b: unknown): asserts b is ClimateBundle {
  const fail = (msg: string): never => { throw new Error(`wind-climate bundle: ${msg}`); };
  const x = b as ClimateBundle;
  if (x?.kind !== 'monthly-climatology' || x.schemaVersion !== CLIMATE_SCHEMA_VERSION) fail('kind/schemaVersion');
  if (!Array.isArray(x.months) || x.months.length !== 12) fail('needs 12 months');
  x.months.forEach((pair, i) => {
    if (!Array.isArray(pair) || pair.length !== 2) fail(`month ${i + 1}: needs U and V`);
    pair.forEach((r, c) => {
      const h = r.header;
      if (h.parameterCategory !== 2 || h.parameterNumber !== 2 + c || h.month !== i + 1) fail(`month ${i + 1}: header`);
      if (h.nx !== NX || h.ny !== NY || h.la1 !== 90 || h.lo1 !== 0 || h.dx !== 1 || h.dy !== 1 || h.scanMode !== 0) fail(`month ${i + 1}: grid`);
      if (!Array.isArray(r.data) || r.data.length !== NX * NY) fail(`month ${i + 1}: data length`);
      if (r.data.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 40)) fail(`month ${i + 1}: values`);
    });
    const [u, v] = pair;
    let speed = 0;
    for (let k = 0; k < NX * NY; k++) speed += Math.hypot(u.data[k]!, v.data[k]!);
    speed /= NX * NY;
    if (speed < 2 || speed > 10) fail(`month ${i + 1}: mean speed ${speed.toFixed(2)} m/s outside 2..10`);
    // North Pacific trade winds blow from the east all year.
    if (boxMean(u, 10, 20, 200, 240) > -3) fail(`month ${i + 1}: no Pacific trade easterlies`);
    // Southern Ocean westerlies all year.
    if (boxMean(u, -55, -45, 0, 359) < 4) fail(`month ${i + 1}: no Southern Ocean westerlies`);
  });
  // Arabian Sea monsoon: south-westerly in July, north-easterly in January (catches swapped months).
  if (boxMean(x.months[6][0], 10, 15, 55, 70) < 5) fail('July: no south-west monsoon');
  if (boxMean(x.months[0][0], 10, 15, 55, 70) > 0) fail('January: no north-east monsoon');
}

export function buildBundle(sums: MonthSums[], generatedAt: Date): ClimateBundle {
  const months = sums.map((m, i) => buildMonth(m, i, generatedAt));
  const bundle: ClimateBundle = {
    schemaVersion: CLIMATE_SCHEMA_VERSION, kind: 'monthly-climatology', source: CLIMATE_SOURCE, method: CLIMATE_METHOD,
    period: months[0][0].header.period, generatedAt: generatedAt.toISOString(), months,
  };
  validateClimateBundle(bundle);
  return bundle;
}

export async function runWindClimate(opts: {
  out: string;
  years?: number[];
  /** decoded ERA5 monthly means of one year (all 12 months, u/v/speed); defaults to a CDS request */
  fetchYear?: (year: number) => Promise<Grib1Field[]>;
  token?: string;
  now?: Date;
  log?: (msg: string) => void;
}): Promise<{ out: string; bytes: number; gzBytes: number; period: string }> {
  const log = opts.log ?? console.log;
  const years = opts.years ?? CLIMATE_YEARS;
  const fetchYear = opts.fetchYear ?? (async (year: number) => {
    if (!opts.token) throw new Error('wind-climate needs CDSAPI_KEY / CDS_API_KEY');
    const buf = await retrieveRetrying('cds', CLIMATE_DATASET, climateRequest(year), { token: opts.token, pollMs: 10_000, timeoutMs: 60 * 60_000 });
    return unzip(buf, `era5-${year}.grib`).flatMap(f => decodeGrib1(new Uint8Array(f.data)));
  });
  const sums = emptySums();
  for (const year of years) {
    const fields = await fetchYear(year);
    accumulate(fields, sums);
    log(`  ${year}: ${fields.length} fields`);
  }
  for (const [i, m] of sums.entries()) {
    for (const key of ['u', 'v', 's'] as const) {
      if (m.years[key].size !== years.length) throw new Error(`wind-climate: month ${i + 1} ${key} has ${m.years[key].size}/${years.length} years`);
    }
  }
  const bundle = buildBundle(sums, opts.now ?? new Date());
  const json = JSON.stringify(bundle);
  const gz = gzipSync(json, { level: 9 });
  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, json);
  writeFileSync(`${opts.out}.gz`, gz);
  return { out: opts.out, bytes: Buffer.byteLength(json), gzBytes: gz.length, period: bundle.period };
}
