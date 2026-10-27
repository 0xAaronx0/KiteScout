import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeGrib1, ibmFloat, type Grib1Field } from '../../src/lib/grib1.js';
import {
  accumulate, boxMean, buildBundle, climateRequest, emptySums, runWindClimate, toOneDegree, validateClimateBundle,
} from '../../src/pipeline/wind-climate.js';

const fixture = (name: string) => new URL(`../fixtures/wind-climate/${name}`, import.meta.url);

test('decodeGrib1 matches eccodes: simple packing, both scan modes, bitmap, constant field', () => {
  const fields = decodeGrib1(new Uint8Array(readFileSync(fixture('synthetic.grib1'))));
  const expected = JSON.parse(readFileSync(fixture('grib1-expected.json'), 'utf8'));
  assert.equal(fields.length, expected.length);
  fields.forEach((f, i) => {
    const e = expected[i];
    assert.equal(f.param, e.param, e.name);
    assert.equal(f.centre, 98);
    assert.equal(f.grid.scanMode, e.scanMode, e.name);
    assert.deepEqual([f.grid.nx, f.grid.ny, f.grid.la1, f.grid.lo1, f.grid.dx, f.grid.dy], [e.nx, e.ny, e.la1, e.lo1, 3, 5], e.name);
    assert.equal(f.date.toISOString(), '2024-07-01T00:00:00.000Z');
    e.values.forEach((v: number | null, k: number) => {
      if (v === null) assert.ok(Number.isNaN(f.values[k]), `${e.name}[${k}] missing`);
      else assert.ok(Math.abs(f.values[k] - v) < 1e-5, `${e.name}[${k}] ${f.values[k]} vs ${v}`);
    });
  });
});

test('ibmFloat decodes IBM single precision', () => {
  assert.equal(ibmFloat(new Uint8Array([0x41, 0x10, 0x00, 0x00]), 0), 1);
  assert.equal(ibmFloat(new Uint8Array([0xc2, 0x76, 0xa0, 0x00]), 0), -118.625);
});

test('decodeGrib1 refuses truncated input and other editions', () => {
  const buf = new Uint8Array(readFileSync(fixture('synthetic.grib1')));
  assert.throws(() => decodeGrib1(buf.subarray(0, 100)), /truncated/);
  const other = buf.slice(); other[7] = 2;
  assert.throws(() => decodeGrib1(other), /edition 2/);
});

test('climateRequest asks CDS for one year of u/v/speed monthly means on the 1.0 deg grid', () => {
  const r = climateRequest(2020) as Record<string, string[]>;
  assert.deepEqual(r.year, ['2020']);
  assert.equal(r.month.length, 12);
  assert.deepEqual(r.grid, ['1.0', '1.0']);
  assert.equal(r.data_format as unknown as string, 'grib');
});

// --- synthetic global ERA5-like fields -------------------------------------------------------
type Fn = (lat: number, lon: number) => number;
function globalField(param: number, year: number, month: number, fn: Fn, opts: { dx?: number; scan64?: boolean } = {}): Grib1Field {
  const dx = opts.dx ?? 1, nx = Math.round(360 / dx), ny = Math.round(180 / dx) + 1;
  const values = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const lat = opts.scan64 ? -90 + j * dx : 90 - j * dx;
    values[j * nx + i] = fn(lat, i * dx);
  }
  return {
    table2Version: 128, centre: 98, param, levelType: 1, level: 0, date: new Date(Date.UTC(year, month, 1)), timeRangeIndicator: 0,
    grid: { nx, ny, la1: opts.scan64 ? -90 : 90, lo1: 0, la2: opts.scan64 ? 90 : -90, lo2: 360 - dx, dx, dy: dx, scanMode: opts.scan64 ? 64 : 0 },
    values,
  };
}

/** Rough real-world zonal wind: trades, westerlies, Arabian Sea monsoon reversal. */
const zonal = (month: number): Fn => (lat, lon) => {
  if (lat >= 8 && lat <= 18 && lon >= 50 && lon <= 75) return month >= 5 && month <= 8 ? 10 : -4;
  if (Math.abs(lat) >= 5 && Math.abs(lat) <= 25) return -6;
  if (lat <= -40 && lat >= -60) return 9;
  if (lat >= 40 && lat <= 60) return 6;
  return 2;
};
const TARIFA = { lat: 36, lon: 354 };
function yearFields(year: number, monthMap: (m: number) => number = m => m): Grib1Field[] {
  const out: Grib1Field[] = [];
  for (let month = 0; month < 12; month++) {
    const u = zonal(monthMap(month));
    // Tarifa: Levante one year, Poniente the next -> no steady direction
    const uT: Fn = (lat, lon) => (lat === TARIFA.lat && lon === TARIFA.lon ? (year % 2 ? 8 : -8) : u(lat, lon));
    out.push(globalField(165, year, month, uT), globalField(166, year, month, () => 0.5),
      globalField(207, year, month, (lat, lon) => Math.abs(uT(lat, lon)) + 1));
  }
  return out;
}

test('toOneDegree regrids finer and south-first grids onto the GFS 1.0 deg order', () => {
  const fn: Fn = (lat, lon) => lat * 1000 + lon;
  for (const opts of [{ dx: 0.25 }, { dx: 1, scan64: true }]) {
    const out = toOneDegree(globalField(165, 2020, 0, fn, opts));
    assert.equal(out.length, 360 * 181);
    assert.equal(out[0], 90_000);
    assert.equal(out[(90 - 36) * 360 + 354], 36_354);
    assert.equal(out[180 * 360 + 359], -90_000 + 359);
  }
  const notGlobal = globalField(165, 2020, 0, fn); notGlobal.grid.nx = 100;
  assert.throws(() => toOneDegree(notGlobal), /not global/);
});

test('buildBundle: mean flow per month, unsteady directions fade out, passes the sanity gates', () => {
  const sums = emptySums();
  for (const year of [2016, 2017]) accumulate(yearFields(year), sums);
  const b = buildBundle(sums, new Date('2026-10-26T00:00:00Z'));
  assert.equal(b.period, '2016-2017');
  assert.equal(b.months.length, 12);
  const [julU, julV] = b.months[6];
  assert.equal(julU.header.month, 7);
  assert.ok(boxMean(julU, 10, 15, 55, 70) > 9, 'July monsoon westerly');
  assert.ok(boxMean(b.months[0][0], 10, 15, 55, 70) < -3, 'January north-east monsoon');
  // steady trades keep their mean speed (|u| + 1 = 7 along -6/0.5)
  const k = (90 - 15) * 360 + 220;
  assert.ok(Math.abs(Math.hypot(julU.data[k]!, julV.data[k]!) - 7) < 0.15);
  // Tarifa alternates Levante/Poniente: mean vector is only the 0.5 m/s v -> faded to a weak flow
  const t = (90 - TARIFA.lat) * 360 + TARIFA.lon;
  assert.ok(Math.hypot(julU.data[t]!, julV.data[t]!) < 2, 'unsteady wind fades');
  assert.doesNotThrow(() => validateClimateBundle(JSON.parse(JSON.stringify(b))));
});

test('accumulate refuses duplicates and unknown parameters; gates catch swapped months', () => {
  const sums = emptySums();
  accumulate(yearFields(2016), sums);
  assert.throws(() => accumulate(yearFields(2016), sums), /twice/);
  assert.throws(() => accumulate([globalField(167, 2018, 0, () => 1)], emptySums()), /unexpected GRIB parameter 167/);
  const swapped = emptySums();
  accumulate(yearFields(2016, m => (m + 6) % 12), swapped);
  assert.throws(() => buildBundle(swapped, new Date()), /monsoon/);
});

test('runWindClimate writes the bundle + gzip from fetched years and refuses gaps', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wind-climate-'));
  const out = join(dir, 'wind-climate.json');
  const logs: string[] = [];
  const r = await runWindClimate({ out, years: [2016, 2017], fetchYear: async y => yearFields(y), now: new Date('2026-10-26T00:00:00Z'), log: m => logs.push(m) });
  assert.equal(r.period, '2016-2017');
  const fromGz = JSON.parse(gunzipSync(readFileSync(`${out}.gz`)).toString('utf8'));
  assert.deepEqual(fromGz, JSON.parse(readFileSync(out, 'utf8')));
  assert.equal(fromGz.months[7][0].header.month, 8);
  assert.equal(logs.length, 2);
  await assert.rejects(runWindClimate({ out, years: [2016, 2017], fetchYear: async y => (y === 2017 ? yearFields(y).slice(0, 30) : yearFields(y)) }),
    /has 1\/2 years|uneven/);
  await assert.rejects(runWindClimate({ out, years: [2016] }), /CDSAPI_KEY/);
});
