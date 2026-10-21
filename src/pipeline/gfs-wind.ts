// NOAA GFS 10 m wind (u/v) -> one static leaflet-velocity JSON for the animated wind layer
// on the KCS world map (MartinMarzi/KiteCruiseScout#238). Runs every 6 h in the gfs-wind
// GitHub Action; the file is served by kitescout.tech/data/wind/gfs-10m-latest.json.
//
// Source: NOMADS GRIB filter (only the two 10 m records, ~100 KB at 1.0 deg); the AWS
// open-data mirror (noaa-gfs-bdp-pds, byte ranges via the .idx) is the fallback when
// NOMADS refuses or has not got the run yet. GFS output is US public domain.
//
// Output = the grib2json format leaflet-velocity reads: an array of two records (U, V), each
// { header, data }, data in scan order (west->east from lo1, north->south from la1). Our
// metadata (validTime, generatedAt, staleAfter, source, schemaVersion) rides in both
// headers; leaflet-velocity ignores unknown header keys.

import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { decodeGrib2, type Grib2Field } from '../lib/grib2.js';
import { withRetry } from '../lib/retry.js';

export const SCHEMA_VERSION = 1;
/** consumers treat the file as stale this long after generatedAt (one missed 6 h cycle + slack) */
export const STALE_AFTER_H = 12;
const H = 3_600_000;

export type Resolution = '1p00' | '0p50' | '0p25';
const RES: Record<Resolution, { filter: string; file: (hh: string, fff: string) => string }> = {
  '1p00': { filter: 'filter_gfs_1p00.pl', file: (hh, fff) => `gfs.t${hh}z.pgrb2.1p00.f${fff}` },
  '0p50': { filter: 'filter_gfs_0p50.pl', file: (hh, fff) => `gfs.t${hh}z.pgrb2full.0p50.f${fff}` },
  '0p25': { filter: 'filter_gfs_0p25.pl', file: (hh, fff) => `gfs.t${hh}z.pgrb2.0p25.f${fff}` },
};

const pad = (n: number, w: number) => String(n).padStart(w, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCDate(), 2)}`;

/** GFS cycles (00/06/12/18 UTC) newest first, from the one at/before `now` back `backH` hours. */
export function cycleCandidates(now: Date, backH = 30, newerThan?: Date | null): Date[] {
  const newest = Math.floor(now.getTime() / (6 * H)) * 6 * H;
  const out: Date[] = [];
  for (let t = newest; t >= now.getTime() - backH * H; t -= 6 * H) {
    if (newerThan && t <= newerThan.getTime()) break;
    out.push(new Date(t));
  }
  return out;
}

/**
 * Forecast hour (3-hourly steps) whose valid time is closest to the middle of the file's
 * ~6 h serving window, i.e. now + 3 h. A run picked up ~4 h after its reference time thus
 * gets f006 or f009.
 */
export function pickForecastHour(refTime: Date, now: Date): number {
  const fh = Math.round((now.getTime() + 3 * H - refTime.getTime()) / (3 * H)) * 3;
  return Math.min(120, Math.max(0, fh));
}

export function nomadsUrl(refTime: Date, fh: number, res: Resolution = '1p00'): string {
  const hh = pad(refTime.getUTCHours(), 2);
  const q = new URLSearchParams({
    dir: `/gfs.${ymd(refTime)}/${hh}/atmos`,
    file: RES[res].file(hh, pad(fh, 3)),
    var_UGRD: 'on', var_VGRD: 'on', lev_10_m_above_ground: 'on',
  });
  return `https://nomads.ncep.noaa.gov/cgi-bin/${RES[res].filter}?${q}`;
}

export function awsUrl(refTime: Date, fh: number, res: Resolution = '1p00'): string {
  const hh = pad(refTime.getUTCHours(), 2);
  return `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.${ymd(refTime)}/${hh}/atmos/${RES[res].file(hh, pad(fh, 3))}`;
}

/** Byte ranges of the UGRD/VGRD 10 m records from a wgrib2 .idx inventory. */
export function idxRanges(idx: string): { start: number; end: number | null }[] {
  const lines = idx.split('\n').filter(Boolean).map(l => l.split(':'));
  const out: { start: number; end: number | null }[] = [];
  lines.forEach((f, i) => {
    if ((f[3] === 'UGRD' || f[3] === 'VGRD') && f[4] === '10 m above ground') {
      const next = lines[i + 1];
      out.push({ start: Number(f[1]), end: next ? Number(next[1]) - 1 : null });
    }
  });
  return out;
}

type Fetch = typeof fetch;
const isGrib = (b: Uint8Array) => b.length > 16 && b[0] === 0x47 && b[1] === 0x52 && b[2] === 0x49 && b[3] === 0x42;

/** null = this run/hour is not available from the source (or the source refused). */
async function fetchNomads(url: string, f: Fetch): Promise<Uint8Array | null> {
  const r = await f(url, { signal: AbortSignal.timeout(60_000) });
  // NOMADS answers 403 + HTML for files that don't exist (yet) and when rate limiting
  if (!r.ok) return null;
  const b = new Uint8Array(await r.arrayBuffer());
  return isGrib(b) ? b : null;
}

async function fetchAws(url: string, f: Fetch): Promise<Uint8Array | null> {
  const ri = await f(`${url}.idx`, { signal: AbortSignal.timeout(30_000) });
  if (!ri.ok) return null;
  const ranges = idxRanges(await ri.text());
  if (ranges.length !== 2) return null;
  const parts: Uint8Array[] = [];
  for (const { start, end } of ranges) {
    const r = await f(url, { headers: { Range: `bytes=${start}-${end ?? ''}` }, signal: AbortSignal.timeout(60_000) });
    if (r.status !== 206 && r.status !== 200) throw new Error(`AWS GFS range ${r.status} for ${url}`);
    parts.push(new Uint8Array(await r.arrayBuffer()));
  }
  const b = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { b.set(p, o); o += p.length; }
  return isGrib(b) ? b : null;
}

export interface VelocityHeader {
  discipline: number;
  center: number;
  centerName: string;
  refTime: string;
  forecastTime: number;
  parameterCategory: number;
  parameterNumber: number;
  parameterNumberName: string;
  parameterUnit: string;
  surface1Type: number;
  surface1TypeName: string;
  surface1Value: number;
  gridDefinitionTemplate: number;
  shape: number;
  scanMode: number;
  numberPoints: number;
  nx: number; ny: number;
  lo1: number; la1: number; lo2: number; la2: number; dx: number; dy: number;
  // ours
  schemaVersion: number;
  source: string;
  validTime: string;
  generatedAt: string;
  staleAfter: string;
  resolutionDeg: number;
}
export interface VelocityRecord { header: VelocityHeader; data: (number | null)[] }

/** Round to 0.1 m/s: GFS packs these fields at 0.1 m/s precision anyway (decimal scale 1). */
const round1 = (v: number) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

export function toVelocityJson(fields: Grib2Field[], generatedAt: Date): VelocityRecord[] {
  const pick = (num: number) => fields.find(f =>
    f.discipline === 0 && f.parameterCategory === 2 && f.parameterNumber === num && f.surface1Type === 103 && f.surface1Value === 10);
  const u = pick(2), v = pick(3);
  if (!u || !v) throw new Error(`GFS wind: expected UGRD+VGRD at 10 m, got ${fields.map(f => `${f.parameterCategory}.${f.parameterNumber}@${f.surface1Type}:${f.surface1Value}`).join(', ') || 'nothing'}`);
  if (JSON.stringify(u.grid) !== JSON.stringify(v.grid)) throw new Error('GFS wind: U and V grids differ');
  if (u.refTime.getTime() !== v.refTime.getTime() || u.forecastHours !== v.forecastHours) throw new Error('GFS wind: U and V times differ');
  const g = u.grid;
  const valid = new Date(u.refTime.getTime() + u.forecastHours * H);
  const meta = {
    schemaVersion: SCHEMA_VERSION,
    source: 'NOAA GFS',
    validTime: valid.toISOString(),
    generatedAt: generatedAt.toISOString(),
    staleAfter: new Date(generatedAt.getTime() + STALE_AFTER_H * H).toISOString(),
    resolutionDeg: g.dx,
  };
  const rec = (f: Grib2Field, name: string): VelocityRecord => ({
    header: {
      discipline: f.discipline, center: f.center, centerName: 'US National Weather Service - NCEP',
      refTime: f.refTime.toISOString(), forecastTime: f.forecastHours,
      parameterCategory: f.parameterCategory, parameterNumber: f.parameterNumber,
      parameterNumberName: name, parameterUnit: 'm.s-1',
      surface1Type: f.surface1Type, surface1TypeName: 'Specified height level above ground', surface1Value: f.surface1Value,
      gridDefinitionTemplate: g.template, shape: g.shapeOfEarth, scanMode: g.scanMode, numberPoints: g.nx * g.ny,
      nx: g.nx, ny: g.ny, lo1: g.lo1, la1: g.la1, lo2: g.lo2, la2: g.la2, dx: g.dx, dy: g.dy,
      ...meta,
    },
    data: Array.from(f.values, round1),
  });
  const out = [rec(u, 'U-component_of_wind'), rec(v, 'V-component_of_wind')];
  validateVelocityJson(out);
  return out;
}

/**
 * Checks what leaflet-velocity 2.1.x's buildGrid() relies on (U = "2,2", V = "2,3", lat/lon
 * grid, scan mode 0 or 64, nx*ny values, refTime parseable, forecastTime numeric) plus our
 * own contract (global coverage, finite values, metadata). Throws on the first violation.
 */
export function validateVelocityJson(data: unknown): void {
  const fail = (m: string) => { throw new Error(`velocity JSON invalid: ${m}`); };
  if (!Array.isArray(data) || data.length !== 2) fail('expected an array of exactly 2 records');
  const recs = data as VelocityRecord[];
  const key = (r: VelocityRecord) => `${r.header?.parameterCategory},${r.header?.parameterNumber}`;
  const u = recs.find(r => key(r) === '2,2'), v = recs.find(r => key(r) === '2,3');
  if (!u || !v) fail('need U (2,2) and V (2,3) records');
  for (const r of [u!, v!]) {
    const h = r.header;
    for (const k of ['nx', 'ny', 'lo1', 'la1', 'dx', 'dy', 'forecastTime'] as const) if (typeof h[k] !== 'number' || !Number.isFinite(h[k])) fail(`header.${k} must be a number`);
    if (h.gridDefinitionTemplate !== 0) fail('grid must be regular lat/lon (template 0)');
    if (h.scanMode !== 0 && h.scanMode !== 64) fail(`scanMode ${h.scanMode} unsupported`);
    if (Number.isNaN(Date.parse(h.refTime))) fail('refTime not parseable');
    if (!Array.isArray(r.data) || r.data.length !== h.nx * h.ny) fail(`data length ${r.data?.length} != nx*ny ${h.nx * h.ny}`);
    if (Math.floor(h.nx * h.dx) < 360 || Math.round((h.ny - 1) * h.dy) !== 180) fail('grid is not global');
    if (r.data.some(x => x !== null && (typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > 150))) fail('non-finite or implausible value');
    if (r.data.filter(x => x === null).length > r.data.length * 0.01) fail('more than 1% missing values');
    if (h.schemaVersion !== SCHEMA_VERSION || h.source !== 'NOAA GFS') fail('metadata missing');
    for (const k of ['validTime', 'generatedAt', 'staleAfter'] as const) if (Number.isNaN(Date.parse(h[k]))) fail(`${k} not parseable`);
  }
  const hu = u!.header, hv = v!.header;
  for (const k of ['nx', 'ny', 'lo1', 'la1', 'dx', 'dy', 'refTime', 'forecastTime'] as const) if (hu[k] !== hv[k]) fail(`U/V header ${k} differ`);
}

export interface GfsWindResult {
  skipped?: string;
  refTime?: string;
  forecastTime?: number;
  validTime?: string;
  source?: 'nomads' | 'aws';
  url?: string;
  bytes?: number;
  gzBytes?: number;
  out?: string;
  tried: string[];
}

export async function runGfsWind(opts: {
  out: string;
  res?: Resolution;
  /** only publish a run strictly newer than this (refTime of the currently published file) */
  newerThan?: Date | null;
  now?: Date;
  fetchImpl?: Fetch;
}): Promise<GfsWindResult> {
  const now = opts.now ?? new Date();
  const res = opts.res ?? '1p00';
  const f = opts.fetchImpl ?? fetch;
  const tried: string[] = [];
  for (const ref of cycleCandidates(now, 30, opts.newerThan)) {
    const fh = pickForecastHour(ref, now);
    const label = `${ref.toISOString().slice(0, 13)}Z f${pad(fh, 3)}`;
    let grib: Uint8Array | null = null;
    let source: 'nomads' | 'aws' = 'nomads';
    let url = nomadsUrl(ref, fh, res);
    try { grib = await withRetry(() => fetchNomads(url, f), 2, 5000); } catch (e) { tried.push(`${label} nomads: ${(e as Error).message}`); }
    if (!grib) {
      if (!tried.some(t => t.startsWith(`${label} nomads`))) tried.push(`${label} nomads: not available`);
      source = 'aws';
      url = awsUrl(ref, fh, res);
      try { grib = await withRetry(() => fetchAws(url, f), 2, 5000); } catch (e) { tried.push(`${label} aws: ${(e as Error).message}`); }
      if (!grib) { if (!tried.some(t => t.startsWith(`${label} aws`))) tried.push(`${label} aws: not available`); continue; }
    }
    const records = toVelocityJson(decodeGrib2(grib), now);
    const got = records[0].header;
    if (got.refTime !== ref.toISOString() || got.forecastTime !== fh) {
      throw new Error(`GFS wind: asked for ${label}, file says ${got.refTime} f${pad(got.forecastTime, 3)}`);
    }
    const json = JSON.stringify(records);
    const gz = gzipSync(json, { level: 9 });
    mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, json);
    writeFileSync(`${opts.out}.gz`, gz);
    const h = records[0].header;
    return {
      refTime: h.refTime, forecastTime: h.forecastTime, validTime: h.validTime, source, url,
      bytes: Buffer.byteLength(json), gzBytes: gz.length, out: opts.out, tried,
    };
  }
  return {
    skipped: opts.newerThan
      ? `no GFS run newer than ${opts.newerThan.toISOString()} available yet - keeping the published file`
      : 'no GFS run available in the last 30 h',
    tried,
  };
}
