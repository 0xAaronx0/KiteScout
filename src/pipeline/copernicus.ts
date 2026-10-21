// Climate cells from Copernicus ERA5 (CDS) plus a computed UV index - minimal client.
// Chosen over the free Open-Meteo API, which is non-commercial only (Aaron, 2026-10-19).
// ERA5 is CC-BY 4.0; attribution: "Contains modified Copernicus Climate Change Service
// information". UV is a whole-number guide value (Aaron, 2026-10-21: "Richtwerte, so wie
// man sie googeln kann"), computed from sun angle and ozone, so no CAMS data is needed.
// Protocol (CADS retrieve API): POST processes/{dataset}/execution -> poll jobs/{id} ->
// jobs/{id}/results -> asset.value.href. Auth: PRIVATE-TOKEN = personal access token.
import { inflateRawSync } from 'node:zlib';
import {
  type ClimateCell, monthlyMeanOfDailyMax, monthlyMeanOfDailyMean, monthlyMeanOfDailyMin,
} from './climate.js';

export type Store = 'cds';

const BASE: Record<Store, string> = {
  cds: 'https://cds.climate.copernicus.eu/api/retrieve/v1',
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

/** retrieve() with up to 3 attempts on transient server errors (HTTP 5xx, network). */
export async function retrieveRetrying(...args: Parameters<typeof retrieve>): Promise<Buffer> {
  const sleep = args[3].sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await retrieve(...args);
    } catch (e) {
      const transient = !(e instanceof CopernicusError) || /HTTP 5\d\d/.test((e as Error).message);
      if (!transient || attempt >= 3) throw e;
      await sleep(attempt * 15_000);
    }
  }
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
export const COPERNICUS_SOURCES = 'Copernicus (CC-BY 4.0): air temp + SST: ERA5 hourly point time series (CDS reanalysis-era5-single-levels-timeseries) 2016-2025, nearest 0.25 deg grid point (SST: nearest sea point); UV: computed clear-sky noon UV index, whole numbers (sun angle mid-month + ozone climatology, UVI = 12.5 mu^2.42 (O3/300)^-1.23, +6%/km)';

export const ERA5_YEARS = ['2016-01-01', '2025-12-31'] as const;

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
  const buf = await retrieveRetrying('cds', ERA5_DATASET, {
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

// ---------------------------------------------------------------------- UV guide value

const MID_MONTH_DAY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];

/**
 * Typical monthly MAX UV index (clear sky, solar noon, mid-month), whole numbers - a guide
 * value like the ones travel sites list. UVI = 12.5 mu^2.42 (O3/300)^-1.23 (Madronich) with
 * ozone ~ 270 + 1.3 |lat| DU and +6 % per km of elevation. Against CAMS clear-sky values for
 * the 96 country spots (docs/country_uv_stats_reference.csv): 86 % within +-1, RMSE 1.0;
 * up to +3 where dust/haze cuts UV (Oman, Senegal summer).
 */
export function clearSkyUvMonths(lat: number, elevationM = 0): number[] {
  const ozone = 270 + 1.3 * Math.abs(lat);
  return MID_MONTH_DAY.map(day => {
    const decl = 23.44 * Math.sin((2 * Math.PI * (284 + day)) / 365);
    const mu = Math.cos(((lat - decl) * Math.PI) / 180);
    if (mu <= 0) return 0;
    return Math.round(12.5 * mu ** 2.42 * (ozone / 300) ** -1.23 * (1 + 0.06 * Math.max(0, elevationM) / 1000));
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

export interface CellRequest { key: string; lat: number; lng: number; label: string; elevation?: number | null }
type CellOut = Omit<ClimateCell, 'lat10' | 'lng10'>;

/**
 * All five monthly series for many points: one ERA5 point time series each (~30 s, 6 in
 * parallel; SST from the nearest sea grid point when the point itself is land) plus the
 * computed UV. onCell fires per point, so callers can store cells incrementally;
 * shouldStart() is checked before every point (budget).
 */
export async function fetchCellsCopernicus(points: CellRequest[], opts: {
  token: string; log?: Log;
  shouldStart?: () => boolean;
  onCell: (p: CellRequest, cell: CellOut) => Promise<void> | void;
  onFail: (p: CellRequest, err: Error) => void;
}): Promise<void> {
  const { default: pLimit } = await import('p-limit');
  const go = opts.shouldStart ?? (() => true);
  const limit = pLimit(6);
  await Promise.all(points.map(p => limit(async () => {
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
      const uv = clearSkyUvMonths(p.lat, p.elevation ?? 0);
      const cell: CellOut = {
        sample_lat: Number(p.lat.toFixed(4)), sample_lng: Number(p.lng.toFixed(4)), elevation_m: p.elevation ?? null,
        uv_months: uv, uv_clear_sky_months: uv, ...m,
      };
      checkPlausible(cell);
      await opts.onCell(p, cell);
    } catch (e) { opts.onFail(p, e as Error); }
  })));
}
