import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { retrieve, unzip } from '../../src/pipeline/copernicus.js';

const fx = (f: string) => readFileSync(new URL(`../fixtures/copernicus/${f}`, import.meta.url));

test('unzip reads deflated and stored entries, passes non-zip through', () => {
  const files = unzip(fx('deflated.zip'));
  assert.deepEqual(files.map(f => f.name), ['one.csv', 'two.csv']);
  assert.equal(files[0].data.toString(), 'a,b\n1,2\n');
  assert.equal(files[1].data.toString(), 'x'.repeat(3000));
  assert.equal(unzip(fx('stored.zip'))[0].data.toString(), 'a,b\n1,2\n');
  assert.deepEqual(unzip(Buffer.from('a,b\n'), 'x.csv'), [{ name: 'x.csv', data: Buffer.from('a,b\n') }]);
});

test('retrieve submits, polls until successful and downloads the asset', async () => {
  const calls: string[] = [];
  const real = globalThis.fetch;
  const statuses = ['accepted', 'running', 'successful'];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    assert.equal((init?.headers as any)?.['PRIVATE-TOKEN'] ?? 'tok', 'tok');
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.endsWith('/execution')) return ok({ jobID: 'j1', status: statuses.shift() });
    if (url.endsWith('/jobs/j1')) return ok({ jobID: 'j1', status: statuses.shift() });
    if (url.endsWith('/jobs/j1/results')) return ok({ asset: { value: { href: 'https://dl.example/x.csv' } } });
    return new Response('a,b\n', { status: 200 });
  }) as typeof fetch;
  try {
    const buf = await retrieve('cds', 'ds', { x: 1 }, { token: 'tok', sleep: async () => {} });
    assert.equal(buf.toString(), 'a,b\n');
    assert.deepEqual(calls, [
      'POST https://cds.climate.copernicus.eu/api/retrieve/v1/processes/ds/execution',
      'GET https://cds.climate.copernicus.eu/api/retrieve/v1/jobs/j1',
      'GET https://cds.climate.copernicus.eu/api/retrieve/v1/jobs/j1',
      'GET https://cds.climate.copernicus.eu/api/retrieve/v1/jobs/j1/results',
      'GET https://dl.example/x.csv',
    ]);
  } finally { globalThis.fetch = real; }
});

// ---------------------------------------------------------------- parsers (synthetic fixtures)
import {
  camsBoxes, checkPlausible, dailyMaxUvi, era5Monthly, noonLeadtimes, parseCamsNetcdf, parseEra5Csv, seaNeighbours, toLocal,
} from '../../src/pipeline/copernicus.js';

/** two years of hourly UTC stamps with a value function */
function hourly(fn: (d: Date) => string): string[] {
  const out: string[] = [];
  for (let t = Date.UTC(2016, 0, 1); t < Date.UTC(2018, 0, 1); t += 3_600_000) out.push(fn(new Date(t)));
  return out;
}

test('parseEra5Csv: one file with both variables, Kelvin -> deg C, empty SST -> null', () => {
  const lines = hourly(d => `${d.toISOString().slice(0, 19).replace('T', ' ')},${d.getUTCHours() === 12 ? 303.15 : 293.15},,10.0,20.0`);
  const csv = ['valid_time,t2m,sst,latitude,longitude', ...lines].join('\n');
  const s = parseEra5Csv([{ name: 'x.csv', data: Buffer.from(csv) }]);
  assert.equal(s.time[0], '2016-01-01T00:00');
  assert.ok(Math.abs(s.t2m[12]! - 30) < 1e-9);
  assert.equal(s.sst[0], null);
  const m = era5Monthly(s, 0);
  assert.deepEqual(m.air_temp_max_months, Array(12).fill(30));
  assert.deepEqual(m.air_temp_min_months, Array(12).fill(20));
  assert.equal(m.water_temp_months, null);
});

test('parseEra5Csv: one file per variable is merged on time', () => {
  const t2m = ['time,latitude,longitude,t2m', ...hourly(d => `${d.toISOString()},1,2,290`)].join('\n');
  const sst = ['time,latitude,longitude,sst', ...hourly(d => `${d.toISOString()},1,2,${d.getUTCMonth() === 6 ? 300.15 : 290.15}`)].join('\n');
  const s = parseEra5Csv([{ name: 'a.csv', data: Buffer.from(t2m) }, { name: 'b.csv', data: Buffer.from(sst) }]);
  const m = era5Monthly(s, 0);
  assert.equal(m.water_temp_months?.[6], 27);
  assert.equal(m.water_temp_months?.[0], 17);
});

test('parseEra5Csv: unknown layout throws with the header', () => {
  assert.throws(() => parseEra5Csv([{ name: 'x.csv', data: Buffer.from('foo,bar\n1,2\n') }]), /foo,bar/);
});

test('toLocal shifts by solar hours; noonLeadtimes bracket local noon', () => {
  assert.equal(toLocal('2020-01-01 23:00:00', 30), '2020-01-02T01:00');
  assert.equal(toLocal('2020-01-01T02:00', -75), '2019-12-31T21:00');
  assert.deepEqual(noonLeadtimes(0), [9, 10, 11, 12, 13, 14]);
  assert.deepEqual(noonLeadtimes(-75), [14, 15, 16, 17, 18, 19]);
  assert.deepEqual(noonLeadtimes(177), [21, 22, 23, 24, 25, 26]);
});

test('dailyMaxUvi: flux x 40, accumulations differenced first', () => {
  assert.deepEqual(dailyMaxUvi([[0.05, 0.1, 0.25, 0.2]]), [10]);
  // accumulated J m-2: hourly means 0.1, 0.25, 0.2 W m-2
  assert.deepEqual(dailyMaxUvi([[1000, 1360, 2260, 2980]]).map(v => Math.round(v * 10) / 10), [10]);
  assert.ok(Number.isNaN(dailyMaxUvi([[NaN, NaN]])[0]));
});

test('seaNeighbours: 8 points, axis neighbours first', () => {
  const n = seaNeighbours(10, 20);
  assert.equal(n.length, 8);
  assert.deepEqual(n.slice(0, 4).map(p => Math.abs(p[0] - 10) + Math.abs(p[1] - 20)), [0.25, 0.25, 0.25, 0.25]);
});

test('parseCamsNetcdf: (time, step, lat, lon) with packing, nearest cell', async () => {
  const h5 = (await import('h5wasm/node')).default; await h5.ready;
  const { mkdtempSync, readFileSync: rf } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'nc-')), 'f.nc');
  const f = new h5.File(path, 'w');
  const nT = 3, nS = 2, nLa = 2, nLo = 2;
  const t = f.create_dataset({ name: 'forecast_reference_time', data: new Float64Array([0, 86400, 2678400]), shape: [nT] });
  t.create_attribute('units', 'seconds since 2023-01-01');
  f.create_dataset({ name: 'forecast_period', data: new Float64Array([11, 12]), shape: [nS] });
  f.create_dataset({ name: 'latitude', data: new Float64Array([10.2, 9.8]), shape: [nLa] });
  f.create_dataset({ name: 'longitude', data: new Float64Array([19.8, 20.2]), shape: [nLo] });
  const vals = (base: number) => {
    const a = new Int16Array(nT * nS * nLa * nLo);
    for (let ti = 0; ti < nT; ti++) for (let si = 0; si < nS; si++) for (let la = 0; la < nLa; la++) for (let lo = 0; lo < nLo; lo++)
      a[((ti * nS + si) * nLa + la) * nLo + lo] = base + ti * 10 + si + (la === 1 && lo === 1 ? 100 : 0);
    return a;
  };
  for (const [name, base] of [['uvbed', 1], ['uvbedcs', 2]] as const) {
    const d = f.create_dataset({ name, data: vals(base), shape: [nT, nS, nLa, nLo] });
    d.create_attribute('scale_factor', 0.001);
    d.create_attribute('add_offset', 0);
  }
  f.close();
  const out = await parseCamsNetcdf(rf(path), [{ key: 'a', lat: 9.8, lng: 20.2 }, { key: 'b', lat: 10.3, lng: 19.7 }]);
  const r = out.get('a')!; // nearest = la 1, lo 1
  assert.deepEqual(out.get('b')!.uv[0].map(v => Math.round(v * 1000)), [1, 2]); // la 0, lo 0
  assert.deepEqual(r.dates, ['2023-01-01', '2023-01-02', '2023-02-01']);
  assert.deepEqual(r.uv.map(s => s.map(v => Math.round(v * 1000))), [[101, 102], [111, 112], [121, 122]]);
  assert.deepEqual(r.uvClear[0].map(v => Math.round(v * 1000)), [102, 103]);
});

test('checkPlausible rejects Kelvin temperatures and UV above clear sky', () => {
  const ok = {
    sample_lat: 0, sample_lng: 0, elevation_m: null,
    air_temp_max_months: Array(12).fill(30), air_temp_min_months: Array(12).fill(20),
    water_temp_months: Array(12).fill(26), uv_months: Array(12).fill(9), uv_clear_sky_months: Array(12).fill(11),
  };
  checkPlausible(ok);
  assert.throws(() => checkPlausible({ ...ok, air_temp_max_months: Array(12).fill(303) }), /implausible/);
  assert.throws(() => checkPlausible({ ...ok, uv_months: Array(12).fill(15) }), /implausible/);
});

test('normalizeToken tolerates .cdsapirc lines, UID prefixes and whitespace', async () => {
  const { normalizeToken } = await import('../../src/pipeline/copernicus.js');
  const u = '0123abcd-0000-4000-8000-0123456789ab';
  assert.deepEqual(normalizeToken(u), { token: u, shape: 'length 36, uuid-like' });
  assert.equal(normalizeToken(`url: https://cds.climate.copernicus.eu/api\nkey: ${u}\n`).token, u);
  assert.equal(normalizeToken(`12345:${u}`).token, u);
  assert.equal(normalizeToken(` "${u}"\n`).token, u);
  assert.match(normalizeToken('abc').shape, /NOT uuid-like/);
});

test('camsBoxes: 50 x 60 degree buckets, split above the size cap, padded area, noon lead hours', () => {
  const boxes = camsBoxes([
    { key: 'tarifa', lat: 36.01, lng: -5.6 }, { key: 'dakhla', lat: 23.77, lng: -15.94 },
    { key: 'cumbuco', lat: -3.63, lng: -38.73 }, { key: 'fiji', lat: -17.85, lng: 177.19 },
  ]);
  assert.equal(boxes.length, 3);
  const med = boxes.find(b => b.points.length === 2)!;
  assert.deepEqual(med.area, [36.41, -16.34, 23.37, -5.2]);
  assert.deepEqual(med.leadtimes, [9, 10, 11, 12, 13, 14, 15]); // noon 12 UTC (Tarifa), 13 UTC (Dakhla)
  // one bucket, but 28 x 36 deg > 600 deg^2 -> split
  const big = camsBoxes([
    { key: 'a', lat: 36, lng: -10 }, { key: 'b', lat: 10, lng: 25 }, { key: 'c', lat: 38, lng: 26 },
  ]);
  assert.ok(big.length >= 2 && big.every(b => (b.area[0] - b.area[2] - 0.8) * (b.area[3] - b.area[1] - 0.8) <= 600));
  assert.deepEqual(boxes.find(b => b.points[0].key === 'fiji')!.leadtimes, [21, 22, 23, 24, 25, 26]);
});

test('parseCamsNetcdf picks each point\'s own noon lead hours from a wider box request', async () => {
  const h5 = (await import('h5wasm/node')).default; await h5.ready;
  const { mkdtempSync, readFileSync: rf } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'nc-')), 'f.nc');
  const f = new h5.File(path, 'w');
  const steps = [9, 10, 11, 12, 13, 14, 15, 16];
  const t = f.create_dataset({ name: 'forecast_reference_time', data: new Float64Array([1672531200]), shape: [1] });
  t.create_attribute('units', 'seconds since 1970-01-01');
  f.create_dataset({ name: 'forecast_period', data: new Float64Array(steps), shape: [8] });
  f.create_dataset({ name: 'latitude', data: new Float64Array([0]), shape: [1] });
  f.create_dataset({ name: 'longitude', data: new Float64Array([0]), shape: [1] });
  for (const name of ['uvbed', 'uvbedcs']) f.create_dataset({ name, data: new Float32Array(steps.map(s => s / 100)), shape: [8, 1, 1, 1] });
  f.close();
  const out = await parseCamsNetcdf(rf(path), [{ key: 'x', lat: 0, lng: -30 }]); // noon 14 UTC -> 11..16
  assert.deepEqual(out.get('x')!.dates, ['2023-01-01']);
  assert.deepEqual(out.get('x')!.uv[0].map(v => Math.round(v * 100)), [11, 12, 13, 14, 15, 16]);
});
