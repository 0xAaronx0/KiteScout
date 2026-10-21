import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeGrib2 } from '../../src/lib/grib2.js';

// Ground truth = eccodes 2.43 decoding the same bytes (see test/fixtures/gfs-wind/).
const dir = new URL('../fixtures/gfs-wind/', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, dir));

test('real GFS 1.0 deg UGRD/VGRD 10 m (template 5.3, order 2) decodes exactly like eccodes', () => {
  const fields = decodeGrib2(read('gfs.20261021.t00z.1p00.f006.uv10m.grb2'));
  const exp = JSON.parse(read('gfs.20261021.t00z.1p00.f006.uv10m.expected.json').toString()).records;
  assert.equal(fields.length, 2);
  fields.forEach((f, i) => {
    const e = exp[i];
    assert.equal(f.parameterCategory, 2);
    assert.equal(f.parameterNumber, e.parameterNumber);
    assert.equal(f.refTime.toISOString(), '2026-10-21T00:00:00.000Z');
    assert.equal(f.forecastHours, 6);
    assert.equal(f.surface1Type, 103);
    assert.equal(f.surface1Value, 10);
    assert.deepEqual(f.grid, { template: 0, shapeOfEarth: 6, nx: 360, ny: 181, la1: 90, lo1: 0, la2: -90, lo2: 359, dx: 1, dy: 1, scanMode: 0 });
    assert.equal(f.values.length, e.n);
    for (const [k, v] of Object.entries(e.sample)) assert.ok(Math.abs(f.values[Number(k)] - (v as number)) < 1e-9, `value ${k}`);
    assert.ok(Math.abs(Math.min(...f.values) - e.min) < 1e-9);
    assert.ok(Math.abs(Math.max(...f.values) - e.max) < 1e-9);
    assert.ok(Math.abs(f.values.reduce((a, b) => a + b, 0) - e.sum) < 1e-6);
  });
});

const synthetic = JSON.parse(read('synthetic-expected.json').toString()) as Record<string, {
  template: number; order: number | null; bitmap: number; grid: number[]; forecastTime: number; values: (number | null)[];
}>;

for (const [name, e] of Object.entries(synthetic)) {
  test(`synthetic ${name}: template 5.${e.template}${e.order ? ` order ${e.order}` : ''}${e.bitmap ? ' + bitmap' : ''} matches eccodes`, () => {
    const [f] = decodeGrib2(read(`synthetic-${name}.grb2`));
    const [nx, ny, la1, lo1, la2, lo2, dx, dy] = e.grid;
    assert.deepEqual({ nx: f.grid.nx, ny: f.grid.ny, la1: f.grid.la1, lo1: f.grid.lo1, la2: f.grid.la2, lo2: f.grid.lo2, dx: f.grid.dx, dy: f.grid.dy },
      { nx, ny, la1, lo1, la2, lo2, dx, dy });
    assert.equal(f.refTime.toISOString(), '2026-10-21T18:00:00.000Z');
    assert.equal(f.forecastHours, e.forecastTime);
    assert.equal(f.values.length, e.values.length);
    e.values.forEach((v, i) => {
      if (v === null) assert.ok(Number.isNaN(f.values[i]), `point ${i} should be missing`);
      else assert.ok(Math.abs(f.values[i] - v) < 1e-9, `point ${i}: ${f.values[i]} vs ${v}`);
    });
  });
}

test('rejects non-GRIB2 input and unsupported templates instead of returning garbage', () => {
  assert.deepEqual(decodeGrib2(new TextEncoder().encode('<html>403 Forbidden</html>')), []);
  const b = new Uint8Array(read('synthetic-simple.grb2'));
  // section 5 template number -> 5.40 (JPEG2000)
  let o = 16;
  while (b[o + 4] !== 5) o += (b[o] << 24) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  b[o + 9] = 0; b[o + 10] = 40;
  assert.throws(() => decodeGrib2(b), /5\.40 not supported/);
});
