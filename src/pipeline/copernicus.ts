// Copernicus data stores (CDS = ERA5, ADS = CAMS) - minimal client for the climate cells.
// Chosen over the free Open-Meteo API, which is non-commercial only (Aaron, 2026-10-19).
// Both datasets are CC-BY 4.0; attribution: "Contains modified Copernicus Climate Change
// Service / Atmosphere Monitoring Service information".
// Protocol (CADS retrieve API): POST processes/{dataset}/execution -> poll jobs/{id} ->
// jobs/{id}/results -> asset.value.href. Auth: PRIVATE-TOKEN = personal access token.
import { inflateRawSync } from 'node:zlib';
import {
  type ClimateCell, monthlyMean, monthlyMeanOfDailyMax, monthlyMeanOfDailyMean, monthlyMeanOfDailyMin,
} from './climate.js';

export type Store = 'cds' | 'ads';

const BASE: Record<Store, string> = {
  cds: 'https://cds.climate.copernicus.eu/api/retrieve/v1',
  ads: 'https://ads.atmosphere.copernicus.eu/api/retrieve/v1',
};

/**
 * Personal access token as pasted: tolerates a .cdsapirc "key: ..." line, the old
 * "UID:KEY" form and surrounding whitespace/quotes. shape() describes it without the value.
 */
export function normalizeToken(raw: string): { token: string; shape: string } {
  const notes: string[] = [];
  let t = raw;
  const keyLine = /(?:^|\n)\s*key\s*:\s*(\S+)/i.exec(t);
  if (keyLine) { t = keyLine[1]; notes.push('took .cdsapirc key line'); }
  const trimmed = t.trim().replace(/^["']|["']$/g, '');
  if (trimmed !== t) notes.push('trimmed');
  t = trimmed;
  const uid = /^\d+:(.+)$/.exec(t);
  if (uid) { t = uid[1]; notes.push('dropped UID: prefix'); }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
  return { token: t, shape: `length ${t.length}, ${uuid ? 'uuid-like' : 'NOT uuid-like'}${notes.length ? `, ${notes.join(', ')}` : ''}` };
}

export class CopernicusError extends Error {}

/** Submits a request, waits for the job and returns the downloaded result bytes. */
export async function retrieve(
  store: Store, dataset: string, inputs: Record<string, unknown>,
  opts: { token: string; pollMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<unknown> },
): Promise<Buffer> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));
  const headers = { 'PRIVATE-TOKEN': opts.token, 'Content-Type': 'application/json' };
  const json = async (res: Response) => {
    const body = await res.json().catch(() => null) as any;
    if (!res.ok) throw new CopernicusError(`${store} ${dataset}: HTTP ${res.status} ${body?.title ?? ''} ${body?.detail ?? ''}`.trim());
    return body;
  };

  let job = await json(await fetch(`${BASE[store]}/processes/${dataset}/execution`, {
    method: 'POST', headers, body: JSON.stringify({ inputs }),
  }));
  const deadline = Date.now() + (opts.timeoutMs ?? 30 * 60_000);
  while (job.status !== 'successful') {
    if (job.status === 'failed' || job.status === 'rejected' || job.status === 'dismissed') {
      throw new CopernicusError(`${store} ${dataset}: job ${job.jobID} ${job.status}`);
    }
    if (Date.now() > deadline) throw new CopernicusError(`${store} ${dataset}: job ${job.jobID} timed out (${job.status})`);
    await sleep(opts.pollMs ?? 5000);
    job = await json(await fetch(`${BASE[store]}/jobs/${job.jobID}`, { headers }));
  }
  const results = await json(await fetch(`${BASE[store]}/jobs/${job.jobID}/results`, { headers }));
  const href = results?.asset?.value?.href;
  if (!href) throw new CopernicusError(`${store} ${dataset}: job ${job.jobID} has no result href`);
  const file = await fetch(href);
  if (!file.ok) throw new CopernicusError(`${store} ${dataset}: download HTTP ${file.status}`);
  return Buffer.from(await file.arrayBuffer());
}

/** Files of a zip archive (stored or deflated entries), or the buffer itself if it is no zip. */
export function unzip(buf: Buffer, name = 'data'): { name: string; data: Buffer }[] {
  if (buf.readUInt32LE(0) !== 0x04034b50) return [{ name, data: buf }];
  // end of central directory: last 22+ bytes, signature 0x06054b50
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new CopernicusError('zip: no central directory');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const fileName = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (!fileName.endsWith('/')) out.push({ name: fileName, data: method === 0 ? raw : inflateRawSync(raw) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ------------------------------------------------------------ climate cell from Copernicus

export const ERA5_DATASET = 'reanalysis-era5-single-levels-timeseries';
export const CAMS_DATASET = 'cams-global-atmospheric-composition-forecasts';
export const COPERNICUS_SOURCES = 'Copernicus (CC-BY 4.0): air temp + SST: ERA5 hourly point time series (CDS reanalysis-era5-single-levels-timeseries) 2016-2025, nearest 0.25 deg grid point (SST: nearest sea point); UV: CAMS global forecasts uv_biologically_effective_dose (ADS) 2023-2025, UV index = 40 x dose, daily max around local noon';

export const ERA5_YEARS = ['2016-01-01', '2025-12-31'] as const;
export const CAMS_YEARS = [2023, 2024, 2025];

type Log = (msg: string) => void;

/** Local (solar) time stamp: UTC + round(lng / 15) hours, 'YYYY-MM-DDTHH:MM'. */
export function toLocal(utc: string, lng: number): string {
  const ms = Date.parse(utc.replace(' ', 'T').slice(0, 19) + 'Z');
  if (!Number.isFinite(ms)) throw new CopernicusError(`bad time stamp "${utc}"`);
  return new Date(ms + Math.round(lng / 15) * 3_600_000).toISOString().slice(0, 16);
}

export interface PointSeries { time: string[]; t2m: (number | null)[]; sst: (number | null)[] }

const num = (s: string | undefined) => {
  if (s == null || s.trim() === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};
/** ERA5 temperatures come in Kelvin; anything above 150 is converted to deg C. */
const celsius = (v: number | null) => (v != null && v > 150 ? v - 273.15 : v);

/**
 * ERA5 time-series CSV(s) -> one series. Accepts one file with both variables or one file per
 * variable; time column valid_time|time|date, variable columns t2m|2m_temperature and
 * sst|sea_surface_temperature. Throws with the header when the layout is unknown.
 */
export function parseEra5Csv(files: { name: string; data: Buffer }[]): PointSeries {
  const rows = new Map<string, { t2m: number | null; sst: number | null }>();
  const headers: string[] = [];
  for (const f of files) {
    if (/\.(nc|grib)$/i.test(f.name)) continue;
    const lines = f.data.toString('utf8').split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'));
    if (!lines.length) continue;
    const head = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    headers.push(`${f.name}: ${head.join(',')}`);
    const ti = head.findIndex(h => /^(valid_time|time|date)$/i.test(h));
    const ai = head.findIndex(h => /^(t2m|2t|2m_temperature)$/i.test(h));
    const si = head.findIndex(h => /^(sst|sea_surface_temperature)$/i.test(h));
    if (ti < 0 || (ai < 0 && si < 0)) continue;
    for (const line of lines.slice(1)) {
      const c = line.split(',');
      const t = c[ti]?.trim().replace(/^"|"$/g, '').replace(' ', 'T').slice(0, 16);
      if (!t) continue;
      const r = rows.get(t) ?? { t2m: null, sst: null };
      if (ai >= 0) r.t2m = celsius(num(c[ai]));
      if (si >= 0) r.sst = celsius(num(c[si]));
      rows.set(t, r);
    }
  }
  if (!rows.size) throw new CopernicusError(`ERA5 CSV: no time/t2m/sst columns found (${headers.join(' | ') || files.map(f => f.name).join(', ')})`);
  const time = [...rows.keys()].sort();
  return { time, t2m: time.map(t => rows.get(t)!.t2m), sst: time.map(t => rows.get(t)!.sst) };
}

const once = new Set<string>();
function logOnce(log: Log | undefined, key: string, msg: () => string) {
  if (!log || once.has(key)) return;
  once.add(key);
  log(msg());
}

async function era5Series(lat: number, lng: number, variables: string[], token: string, log?: Log): Promise<PointSeries> {
  const buf = await retrieve('cds', ERA5_DATASET, {
    variable: variables,
    location: { latitude: Number(lat.toFixed(4)), longitude: Number(lng.toFixed(4)) },
    date: [`${ERA5_YEARS[0]}/${ERA5_YEARS[1]}`],
    data_format: 'csv',
  }, { token });
  const files = unzip(buf, 'era5.csv');
  logOnce(log, 'era5', () => `  [ERA5 raw] ${files.map(f => `${f.name} (${f.data.length} B): ${f.data.toString('utf8', 0, 300).split('\n').slice(0, 3).join(' / ')}`).join(' || ')}`);
  return parseEra5Csv(files);
}

/** Up to 8 neighbouring 0.25-degree grid points, nearest first (SST is NaN over land points). */
export function seaNeighbours(lat: number, lng: number): [number, number][] {
  const out: [number, number][] = [];
  for (const dy of [-0.25, 0, 0.25]) for (const dx of [-0.25, 0, 0.25]) {
    if (dx === 0 && dy === 0) continue;
    out.push([lat + dy, lng + dx]);
  }
  return out.sort((a, b) => (Math.abs(a[0] - lat) + Math.abs(a[1] - lng)) - (Math.abs(b[0] - lat) + Math.abs(b[1] - lng)));
}

export function era5Monthly(s: PointSeries, lng: number) {
  const local = s.time.map(t => toLocal(t, lng));
  return {
    air_temp_max_months: monthlyMeanOfDailyMax(local, s.t2m),
    air_temp_min_months: monthlyMeanOfDailyMin(local, s.t2m),
    water_temp_months: s.sst.some(v => v != null) ? monthlyMeanOfDailyMean(local, s.sst) : null,
  };
}

// ---------------------------------------------------------------------- CAMS UV (netCDF)

/** Forecast lead times (from the 00 UTC run) bracketing local solar noon: noon-3h .. noon+2h. */
export function noonLeadtimes(lng: number): number[] {
  const h0 = Math.round(12 - lng / 15);
  let hours = [-3, -2, -1, 0, 1, 2].map(d => h0 + d);
  if (hours[0] < 0) hours = hours.map(h => h + 24);
  return hours;
}

type H5 = typeof import('h5wasm/node').default;
let h5: H5 | null = null;
async function h5wasm(): Promise<H5> {
  if (!h5) { h5 = (await import('h5wasm/node')).default; await h5.ready; }
  return h5;
}

export interface UvDays { dates: string[]; uv: number[][]; uvClear: number[][] }
export interface GeoPoint { key: string; lat: number; lng: number }

function unitsToMs(units: string): { origin: number; scale: number } {
  const m = /^(seconds|minutes|hours|days) since (.+)$/i.exec(units.trim());
  if (!m) throw new CopernicusError(`netCDF: unknown time units "${units}"`);
  const scale = { seconds: 1e3, minutes: 6e4, hours: 3.6e6, days: 8.64e7 }[m[1].toLowerCase() as 'seconds'];
  let o = m[2].trim().replace(' ', 'T');
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(o)) o += 'T00:00:00';
  const origin = Date.parse(o.replace(/(T\d{1,2}:\d{2}(:\d{2})?).*$/, '$1') + 'Z');
  if (!Number.isFinite(origin)) throw new CopernicusError(`netCDF: bad time origin "${units}"`);
  return { origin, scale };
}

/**
 * CAMS netCDF (netCDF4/HDF5) -> per point and forecast run: UV dose at the point's own noon
 * lead times (noonLeadtimes), nearest grid cell; only that cell is read (h5wasm slice), so a
 * large regional box stays cheap. Layout seen from the ADS (2026-10-19):
 * uvbed[forecast_period, forecast_reference_time, latitude, longitude], time in seconds since 1970.
 */
export async function parseCamsNetcdf(data: Buffer, points: GeoPoint[], log?: Log): Promise<Map<string, UvDays>> {
  const h = await h5wasm();
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'cams-'));
  const path = join(dir, 'cams.nc');
  writeFileSync(path, data);
  const f = new h.File(path, 'r');
  try {
    const keys = f.keys();
    const attr = (ds: any, k: string) => ds.attrs?.[k]?.value;
    const unpack = (ds: any, raw: ArrayLike<number | bigint>) => {
      const sf = Number(attr(ds, 'scale_factor') ?? 1), off = Number(attr(ds, 'add_offset') ?? 0);
      const fill = attr(ds, '_FillValue') ?? attr(ds, 'missing_value');
      const fillN = fill == null ? null : Number(Array.isArray(fill) || ArrayBuffer.isView(fill) ? (fill as any)[0] : fill);
      return Array.from(raw, Number).map(v => (fillN != null && v === fillN) || !Number.isFinite(v) ? NaN : v * sf + off);
    };
    const read = (name: string) => {
      const ds: any = f.get(name);
      return { shape: ds.shape as number[], units: String(attr(ds, 'units') ?? ''), values: unpack(ds, ds.value) };
    };
    logOnce(log, 'cams', () => `  [CAMS raw] ${keys.map(k => { const d: any = f.get(k); return `${k}${d?.shape ? `[${d.shape}]` : ''}${d?.attrs?.units ? ` (${d.attrs.units.value})` : ''}`; }).join(', ')}`);

    const uvName = keys.find(k => /^(uvbed|.*biologically_effective_dose)$/i.test(k));
    const csName = keys.find(k => /^(uvbedcs|.*biologically_effective_dose_clear_sky)$/i.test(k));
    const tName = ['forecast_reference_time', 'time', 'valid_time'].find(k => keys.includes(k));
    const stepName = ['forecast_period', 'step', 'leadtime'].find(k => keys.includes(k));
    const latName = keys.find(k => /^lat(itude)?$/i.test(k)), lngName = keys.find(k => /^lon(gitude)?$/i.test(k));
    if (!uvName || !csName || !tName || !latName || !lngName) {
      throw new CopernicusError(`CAMS netCDF: unexpected variables ${keys.join(', ')}`);
    }
    const uvDs: any = f.get(uvName), csDs: any = f.get(csName);
    const t = read(tName), la = read(latName), lo = read(lngName);
    const steps = stepName ? read(stepName).values : null;
    const shape = uvDs.shape as number[];
    if (shape.length < 3 || shape.length > 4) throw new CopernicusError(`CAMS netCDF: ${uvName} has shape [${shape}]`);
    const nLat = shape[shape.length - 2], nLng = shape[shape.length - 1];
    if (nLat !== la.values.length || nLng !== lo.values.length) throw new CopernicusError(`CAMS netCDF: lat/lon axes [${shape}] vs ${la.values.length}/${lo.values.length}`);
    // reference-time axis = the leading axis whose length matches the time variable's first dimension
    const nT = t.shape[0];
    const lead = shape.slice(0, -2);
    const tAxis = lead.indexOf(nT);
    if (tAxis < 0) throw new CopernicusError(`CAMS netCDF: no axis of length ${nT} (${tName}) in [${shape}]`);
    const nStep = lead.length === 2 ? lead[1 - tAxis] : 1;
    if (steps && steps.length !== nStep) throw new CopernicusError(`CAMS netCDF: ${stepName}[${steps.length}] vs [${shape}]`);
    const { origin, scale } = unitsToMs(t.units);
    const tStride = t.shape.length === 2 ? t.shape[1] : 1; // 2-D valid_time: take the first step
    const dates = Array.from({ length: nT }, (_, ti) => new Date(origin + t.values[ti * tStride] * scale).toISOString().slice(0, 10));
    const at = (vals: number[], ti: number, si: number) => vals[lead.length === 2 ? (tAxis === 0 ? ti * nStep + si : si * nT + ti) : ti];

    const out = new Map<string, UvDays>();
    for (const p of points) {
      const iLat = la.values.reduce((b, v, i) => Math.abs(v - p.lat) < Math.abs(la.values[b] - p.lat) ? i : b, 0);
      const lngN = (x: number) => ((x - p.lng + 540) % 360) - 180;
      const iLng = lo.values.reduce((b, v, i) => Math.abs(lngN(v)) < Math.abs(lngN(lo.values[b])) ? i : b, 0);
      const ranges: [number, number][] | [][] = [...lead.map(() => [] as []), [iLat, iLat + 1], [iLng, iLng + 1]] as any;
      const uv = unpack(uvDs, uvDs.slice(ranges)), cs = unpack(csDs, csDs.slice(ranges));
      const want = new Set(noonLeadtimes(p.lng));
      let idx = Array.from({ length: nStep }, (_, i) => i).filter(i => !steps || want.has(Math.round(steps[i])));
      if (!idx.length) idx = Array.from({ length: nStep }, (_, i) => i);
      out.set(p.key, {
        dates,
        uv: dates.map((_, ti) => idx.map(si => at(uv, ti, si))),
        uvClear: dates.map((_, ti) => idx.map(si => at(cs, ti, si))),
      });
    }
    return out;
  } finally {
    f.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Daily max UV index per run: 40 x dose (W m-2). If the field is an accumulation (J m-2,
 * recognisable by values far above any UV flux), hourly means are differenced first.
 */
export function dailyMaxUvi(steps: number[][]): number[] {
  const all = steps.flat().filter(Number.isFinite);
  const accumulated = all.length > 0 && Math.max(...all) * 40 > 40;
  return steps.map(s => {
    const vals = accumulated ? s.slice(1).map((v, i) => (v - s[i]) / 3600) : s.slice(1); // first step only feeds the difference
    const ok = vals.filter(Number.isFinite);
    return ok.length ? Math.max(0, ...ok) * 40 : NaN;
  });
}

/** Max bounding-box size of one CAMS request (deg^2): ~130 MB of netCDF per year at most. */
export const CAMS_MAX_BOX_DEG2 = 600;

/**
 * Regional boxes for the CAMS requests: points bucketed by 50 deg latitude x 60 deg longitude
 * (edges at 60S/10S/40N and 30W/30E/90E/150E keep Europe+Africa and the Caribbean together),
 * then split at the median until a box's bounding area is <= CAMS_MAX_BOX_DEG2.
 */
export function camsBoxes<T extends GeoPoint>(points: T[]): { points: T[]; area: number[]; leadtimes: number[] }[] {
  const buckets = new Map<string, T[]>();
  for (const p of points) {
    const k = `${Math.floor((p.lat + 60) / 50)}:${Math.floor((p.lng + 30) / 60)}`;
    buckets.set(k, [...(buckets.get(k) ?? []), p]);
  }
  const span = (ps: T[], f: (p: T) => number) => Math.max(...ps.map(f)) - Math.min(...ps.map(f));
  const split = (ps: T[]): T[][] => {
    const dLat = span(ps, p => p.lat), dLng = span(ps, p => p.lng);
    if (ps.length < 2 || dLat * dLng <= CAMS_MAX_BOX_DEG2) return [ps];
    const sorted = [...ps].sort(dLng >= dLat ? (a, b) => a.lng - b.lng : (a, b) => a.lat - b.lat);
    const m = Math.floor(sorted.length / 2);
    return [...split(sorted.slice(0, m)), ...split(sorted.slice(m))];
  };
  const r = (v: number) => Number(v.toFixed(2));
  return [...buckets.values()].flatMap(split).map(ps => {
    const lats = ps.map(p => p.lat), lngs = ps.map(p => p.lng);
    return {
      points: ps,
      area: [r(Math.min(90, Math.max(...lats) + 0.4)), r(Math.max(-180, Math.min(...lngs) - 0.4)), r(Math.max(-90, Math.min(...lats) - 0.4)), r(Math.min(180, Math.max(...lngs) + 0.4))],
      leadtimes: [...new Set(ps.flatMap(p => noonLeadtimes(p.lng)))].sort((a, b) => a - b),
    };
  });
}

/** Rejects numbers that cannot be real climate (unit or layout mix-ups). */
export function checkPlausible(c: Omit<ClimateCell, 'lat10' | 'lng10'>): void {
  const bad: string[] = [];
  c.air_temp_max_months.forEach((v, i) => { if (!(v >= -50 && v <= 55) || v < c.air_temp_min_months[i]) bad.push(`air ${i + 1}: ${c.air_temp_min_months[i]}..${v}`); });
  c.water_temp_months?.forEach((v, i) => { if (!(v >= -3 && v <= 36)) bad.push(`sst ${i + 1}: ${v}`); });
  c.uv_months.forEach((v, i) => { if (!(v >= 0 && v <= 20) || v > c.uv_clear_sky_months[i] + 1) bad.push(`uv ${i + 1}: ${v}/${c.uv_clear_sky_months[i]}`); });
  if (Math.max(...c.uv_clear_sky_months) < 1) bad.push(`uv all ~0: ${c.uv_clear_sky_months}`);
  if (bad.length) throw new CopernicusError(`implausible climate: ${bad.slice(0, 6).join('; ')}`);
}

export interface CellRequest extends GeoPoint { label: string }
type CellOut = Omit<ClimateCell, 'lat10' | 'lng10'>;

/**
 * All five monthly series for many points. ERA5 runs per point (a ~30 s point time series);
 * CAMS UV, whose cost grows with the number of fields rather than the area, runs once per
 * regional box and year. onCell fires as soon as a box is complete, so callers can store
 * cells incrementally; shouldStart() is checked before every request (budget / max fetch).
 */
export async function fetchCellsCopernicus(points: CellRequest[], opts: {
  token: string; adsToken?: string; log?: Log;
  shouldStart?: () => boolean;
  onCell: (p: CellRequest, cell: CellOut) => Promise<void> | void;
  onFail: (p: CellRequest, err: Error) => void;
}): Promise<void> {
  const { default: pLimit } = await import('p-limit');
  const log = opts.log ?? (() => {});
  const go = opts.shouldStart ?? (() => true);
  const era5 = new Map<string, ReturnType<typeof era5Monthly>>();
  const era5Limit = pLimit(6);
  const t0 = Date.now();
  await Promise.all(points.map(p => era5Limit(async () => {
    if (!go()) return;
    try {
      const series = await era5Series(p.lat, p.lng, ['2m_temperature', 'sea_surface_temperature'], opts.token, opts.log);
      const m = era5Monthly(series, p.lng);
      if (!m.water_temp_months) {
        for (const [la, lo] of seaNeighbours(p.lat, p.lng)) {
          const s = await era5Series(la, lo, ['sea_surface_temperature'], opts.token, opts.log);
          if (s.sst.some(v => v != null)) { m.water_temp_months = era5Monthly({ ...s, t2m: s.sst }, lo).water_temp_months; break; }
        }
      }
      era5.set(p.key, m);
    } catch (e) { opts.onFail(p, e as Error); }
  })));
  log(`  ERA5: ${era5.size}/${points.length} points in ${Math.round((Date.now() - t0) / 1000)} s`);

  const boxes = camsBoxes(points.filter(p => era5.has(p.key)));
  log(`  CAMS: ${boxes.length} boxes x ${CAMS_YEARS.length} years`);
  const camsLimit = pLimit(4);
  await Promise.all(boxes.map(async (box, bi) => {
    const entries = new Map(box.points.map(p => [p.key, { uv: [] as [string, number][], clear: [] as [string, number][] }]));
    const years = await Promise.all(CAMS_YEARS.map(year => camsLimit(async () => {
      if (!go()) return false;
      const started = Date.now();
      try {
        const buf = await retrieve('ads', CAMS_DATASET, {
          variable: ['uv_biologically_effective_dose', 'uv_biologically_effective_dose_clear_sky'],
          date: [`${year}-01-01/${year}-12-31`],
          time: ['00:00'],
          leadtime_hour: box.leadtimes.map(String),
          type: ['forecast'],
          data_format: 'netcdf_zip',
          area: box.area,
        }, { token: opts.adsToken ?? opts.token, pollMs: 20_000, timeoutMs: 5 * 3_600_000 });
        const files = unzip(buf, 'cams.nc').filter(f => !/\.(txt|json|csv)$/i.test(f.name));
        logOnce(opts.log, 'cams-files', () => `  [CAMS files] ${files.map(f => `${f.name} (${f.data.length} B)`).join(', ')}`);
        for (const file of files) {
          const days = await parseCamsNetcdf(file.data, box.points, opts.log);
          for (const [key, d] of days) {
            const e = entries.get(key)!;
            dailyMaxUvi(d.uv).forEach((v, i) => { if (Number.isFinite(v)) e.uv.push([d.dates[i], v]); });
            dailyMaxUvi(d.uvClear).forEach((v, i) => { if (Number.isFinite(v)) e.clear.push([d.dates[i], v]); });
          }
        }
        log(`  CAMS box ${bi + 1}/${boxes.length} ${year} [${box.area}] ${box.points.length} points, ${box.leadtimes.length} lead hours: ${Math.round(buf.length / 1024)} KB in ${Math.round((Date.now() - started) / 1000)} s`);
        return true;
      } catch (e) {
        box.points.forEach(p => opts.onFail(p, e as Error));
        return false;
      }
    })));
    if (!years.every(Boolean)) return; // budget hit or a year failed: the box's cells wait for the next run
    for (const p of box.points) {
      try {
        const e = entries.get(p.key)!;
        const cell: CellOut = {
          sample_lat: Number(p.lat.toFixed(4)), sample_lng: Number(p.lng.toFixed(4)), elevation_m: null,
          uv_months: monthlyMean(e.uv), uv_clear_sky_months: monthlyMean(e.clear), ...era5.get(p.key)!,
        };
        checkPlausible(cell);
        await opts.onCell(p, cell);
      } catch (err) { opts.onFail(p, err as Error); }
    }
  }));
}
