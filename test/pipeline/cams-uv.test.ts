import { test } from 'node:test';
import assert from 'node:assert/strict';
import { camsBoxes, dailyMaxUvi, noonLeadtimes, parseCamsNetcdf } from '../../src/pipeline/cams-uv.js';

test('noonLeadtimes: noon-2 .. noon+1 from the 00 UTC run, shifted past midnight', () => {
  assert.deepEqual(noonLeadtimes(0), [10, 11, 12, 13]);
  assert.deepEqual(noonLeadtimes(-75), [15, 16, 17, 18]);
  assert.deepEqual(noonLeadtimes(177), [22, 23, 24, 25]);
});

test('camsBoxes: large boxes, padded, union of noon lead hours', () => {
  const boxes = camsBoxes([
    { key: 'tarifa', lat: 36.01, lng: -5.6 }, { key: 'dakhla', lat: 23.77, lng: -15.94 },
    { key: 'fiji', lat: -17.85, lng: 177.19 },
  ]);
  assert.equal(boxes.length, 2);
  const med = boxes.find(b => b.points.length === 2)!;
  assert.deepEqual(med.area, [36.41, -16.34, 23.37, -5.2]);
  assert.deepEqual(med.leadtimes, [10, 11, 12, 13, 14]);
});

test('dailyMaxUvi: flux x 40, accumulations differenced first', () => {
  assert.deepEqual(dailyMaxUvi([[0.05, 0.1, 0.25, 0.2]]), [10]);
  // accumulated J m-2: hourly means 0.1, 0.25, 0.2 W m-2
  assert.deepEqual(dailyMaxUvi([[1000, 1360, 2260, 2980]]).map(v => Math.round(v * 10) / 10), [10]);
  assert.ok(Number.isNaN(dailyMaxUvi([[NaN, NaN]])[0]));
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
  const out = await parseCamsNetcdf(rf(path), [{ key: 'x', lat: 0, lng: -30 }]); // noon 14 UTC -> 12..15
  assert.deepEqual(out.get('x')!.dates, ['2023-01-01']);
  assert.deepEqual(out.get('x')!.uv[0].map(v => Math.round(v * 100)), [12, 13, 14, 15]);
});

test('camsRequest and uvCloudyMonths', async () => {
  const { camsRequest, uvCloudyMonths } = await import('../../src/pipeline/cams-uv.js');
  const r = camsRequest({ area: [1, 2, 3, 4], leadtimes: [10, 11] }, 2024) as any;
  assert.deepEqual([r.date, r.leadtime_hour, r.area], [['2024-01-01/2024-12-31'], ['10', '11'], [1, 2, 3, 4]]);
  const days: [string, number][] = Array.from({ length: 12 }, (_, m) => [`2024-${String(m + 1).padStart(2, '0')}-15`, m + 0.4] as [string, number]);
  assert.deepEqual(uvCloudyMonths(days), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.throws(() => uvCloudyMonths(days.map(([d]) => [d, 40] as [string, number])), /implausible/);
});
