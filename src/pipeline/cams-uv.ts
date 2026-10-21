// UV with clouds (Aaron 2026-10-21: "zwei Werte ... den berechneten theoretischen Hoechstwert bei
// wolkenlosem Himmel und den gemessenen"): CAMS global forecasts all-sky UV dose (ADS, CC-BY 4.0),
// daily max around local noon, mean per month over CAMS_YEARS, x 40 = UV index, whole numbers.
// One-off fill (climatology) for the cells of country and region points: `pnpm cli climate-uv-cloudy`
// fetches only cells without uv_cloudy_months, one request per regional box and year (ADS requests
// queue 20-70 min each regardless of size, so few large boxes, 6 in parallel), stores per box.
import { CopernicusError, retrieveRetrying, unzip } from './copernicus.js';
import { monthlyMean } from './climate.js';

type Log = (msg: string) => void;
const once = new Set<string>();
function logOnce(log: Log | undefined, key: string, msg: () => string) {
  if (!log || once.has(key)) return;
  once.add(key);
  log(msg());
}

export const CAMS_DATASET = 'cams-global-atmospheric-composition-forecasts';
export const CAMS_YEARS = [2024, 2025];
export const UV_CLOUDY_SOURCE = 'Copernicus (CC-BY 4.0): CAMS global forecasts uv_biologically_effective_dose (ADS) 2024-2025, all-sky daily max around local noon, UV index = 40 x dose, whole numbers';

/** Forecast lead times (00 UTC run) around local solar noon: noon-2h .. noon+1h (the first only feeds differences). */
export function noonLeadtimes(lng: number): number[] {
  const h0 = Math.round(12 - lng / 15);
  let hours = [-2, -1, 0, 1].map(d => h0 + d);
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

/** Max bounding-box size of one CAMS request (deg^2); requests are queue-bound, so fewer and larger. */
export const CAMS_MAX_BOX_DEG2 = 1500;

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

/**
 * All-sky UV per point: one CAMS request per box and year. onPoint fires once a box has all
 * years, so callers store incrementally; shouldStart() is checked before every request.
 */
export async function fetchUvCloudy<T extends GeoPoint>(points: T[], opts: {
  token: string; log?: Log; shouldStart?: () => boolean;
  onPoint: (p: T, uvCloudy: number[]) => Promise<void> | void;
  onFail: (p: T, err: Error) => void;
}): Promise<void> {
  const { default: pLimit } = await import('p-limit');
  const log = opts.log ?? (() => {});
  const go = opts.shouldStart ?? (() => true);
  const boxes = camsBoxes(points);
  log(`  CAMS: ${points.length} points in ${boxes.length} boxes x ${CAMS_YEARS.length} years`);
  const limit = pLimit(6);
  await Promise.all(boxes.map(async (box, bi) => {
    const entries = new Map(box.points.map(p => [p.key, [] as [string, number][]]));
    const years = await Promise.all(CAMS_YEARS.map(year => limit(async () => {
      if (!go()) return false;
      const started = Date.now();
      try {
        const buf = await retrieveRetrying('ads', CAMS_DATASET, {
          variable: ['uv_biologically_effective_dose', 'uv_biologically_effective_dose_clear_sky'],
          date: [`${year}-01-01/${year}-12-31`],
          time: ['00:00'],
          leadtime_hour: box.leadtimes.map(String),
          type: ['forecast'],
          data_format: 'netcdf_zip',
          area: box.area,
        }, { token: opts.token, pollMs: 30_000, timeoutMs: 5 * 3_600_000 });
        const files = unzip(buf, 'cams.nc').filter(f => !/\.(txt|json|csv)$/i.test(f.name));
        for (const file of files) {
          const days = await parseCamsNetcdf(file.data, box.points, opts.log);
          for (const [key, d] of days) {
            const e = entries.get(key)!;
            dailyMaxUvi(d.uv).forEach((v, i) => { if (Number.isFinite(v)) e.push([d.dates[i], v]); });
          }
        }
        log(`  CAMS box ${bi + 1}/${boxes.length} ${year} [${box.area}] ${box.points.length} points: ${Math.round(buf.length / 1024)} KB in ${Math.round((Date.now() - started) / 1000)} s`);
        return true;
      } catch (e) {
        box.points.forEach(p => opts.onFail(p, e as Error));
        return false;
      }
    })));
    if (!years.every(Boolean)) return;
    for (const p of box.points) {
      try {
        const uv = monthlyMean(entries.get(p.key)!).map(v => Math.round(v));
        if (uv.some(v => !(v >= 0 && v <= 20))) throw new CopernicusError(`implausible all-sky UV ${uv}`);
        await opts.onPoint(p, uv);
      } catch (err) { opts.onFail(p, err as Error); }
    }
  }));
}
