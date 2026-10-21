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
  checkPlausible, clearSkyUvMonths, era5Monthly, parseEra5Csv, seaNeighbours, toLocal,
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

test('toLocal shifts by solar hours', () => {
  assert.equal(toLocal('2020-01-01 23:00:00', 30), '2020-01-02T01:00');
  assert.equal(toLocal('2020-01-01T02:00', -75), '2019-12-31T21:00');
});

test('clearSkyUvMonths: whole-number monthly max UV guide values', () => {
  // values checked against CAMS clear-sky daily max for the same spots (within +-2)
  assert.deepEqual(clearSkyUvMonths(11.97), [9, 10, 12, 13, 13, 13, 13, 13, 13, 11, 9, 8]); // Boracay
  assert.deepEqual(clearSkyUvMonths(54.44), [0, 1, 2, 5, 6, 7, 7, 5, 3, 1, 1, 0]); // Fehmarn
  assert.deepEqual(clearSkyUvMonths(-31.02), [12, 11, 9, 6, 4, 3, 4, 5, 8, 10, 11, 12]); // Lancelin
  assert.ok(clearSkyUvMonths(46.46, 1791)[6] > clearSkyUvMonths(46.46)[6]); // altitude adds UV
  assert.ok(clearSkyUvMonths(-89).every(v => v >= 0));
});

test('seaNeighbours: 8 points, axis neighbours first', () => {
  const n = seaNeighbours(10, 20);
  assert.equal(n.length, 8);
  assert.deepEqual(n.slice(0, 4).map(p => Math.abs(p[0] - 10) + Math.abs(p[1] - 20)), [0.25, 0.25, 0.25, 0.25]);
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

test('retrieveRetrying retries HTTP 5xx, not 4xx', async () => {
  const { retrieveRetrying } = await import('../../src/pipeline/copernicus.js');
  const real = globalThis.fetch;
  let posts = 0;
  const run = async (status: number) => {
    posts = 0;
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith('/execution')) { posts++; if (posts < 2) return new Response('{}', { status }); return new Response(JSON.stringify({ jobID: 'j', status: 'successful' })); }
      if (url.endsWith('/results')) return new Response(JSON.stringify({ asset: { value: { href: 'https://dl.example/x' } } }));
      return new Response('ok');
    }) as typeof fetch;
    return retrieveRetrying('cds', 'ds', {}, { token: 't', sleep: async () => {} });
  };
  try {
    assert.equal((await run(502)).toString(), 'ok');
    assert.equal(posts, 2);
    await assert.rejects(run(401), /HTTP 401/);
    assert.equal(posts, 1);
  } finally { globalThis.fetch = real; }
});

test('kiteableShare: >= 12 kn for >= 3 consecutive daylight hours, local solar time', async () => {
  const { kiteableShare } = await import('../../src/pipeline/copernicus.js');
  // u/v columns in m/s; 7 m/s = 13.6 kn. January: 14:00-16:00 UTC windy (3 h) -> kiteable;
  // February: only 14:00 windy (1 h) -> not; March: windy at 03:00 UTC only (night) -> not.
  const lines = hourly(d => {
    const m = d.getUTCMonth(), h = d.getUTCHours();
    const windy = (m === 0 && h >= 14 && h <= 16) || (m === 1 && h === 14) || (m === 2 && h === 3);
    return `${d.toISOString()},${windy ? 7 : 2},0`;
  });
  const csv = ['valid_time,u10,v10', ...lines].join('\n');
  const s = parseEra5Csv([{ name: 'w.csv', data: Buffer.from(csv) }]);
  assert.ok(Math.abs(s.wind![0] - 3.89) < 0.01); // 2 m/s in knots
  const share = kiteableShare(s, 0);
  assert.deepEqual(share.slice(0, 4), [100, 0, 0, 0]);
  assert.deepEqual(kiteableShare(s, 0, 12, 1).slice(0, 2), [100, 100]);
});

test('submitJob / jobStatus / jobResult: async ADS job handling', async () => {
  const { submitJob, jobStatus, jobResult } = await import('../../src/pipeline/copernicus.js');
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.endsWith('/execution')) return new Response(JSON.stringify({ jobID: 'j9', status: 'accepted' }));
    if (url.endsWith('/jobs/j9')) return new Response(JSON.stringify({ jobID: 'j9', status: 'running' }));
    if (url.endsWith('/jobs/old')) return new Response('{}', { status: 404 });
    if (url.endsWith('/jobs/j9/results')) return new Response(JSON.stringify({ asset: { value: { href: 'https://dl.example/r' } } }));
    return new Response('data');
  }) as typeof fetch;
  try {
    assert.equal(await submitJob('ads', 'ds', {}, 't'), 'j9');
    assert.equal(await jobStatus('ads', 'j9', 't'), 'running');
    assert.equal(await jobStatus('ads', 'old', 't'), 'gone');
    assert.equal((await jobResult('ads', 'j9', 't')).toString(), 'data');
  } finally { globalThis.fetch = real; }
});
