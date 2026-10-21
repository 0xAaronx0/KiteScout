import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeGrib2 } from '../../src/lib/grib2.js';
import {
  awsUrl, cycleCandidates, idxRanges, nomadsUrl, pickForecastHour, runGfsWind, toVelocityJson, validateVelocityJson,
  type VelocityRecord,
} from '../../src/pipeline/gfs-wind.js';

const grib = new Uint8Array(readFileSync(new URL('../fixtures/gfs-wind/gfs.20261021.t00z.1p00.f006.uv10m.grb2', import.meta.url)));
const at = (iso: string) => new Date(iso);

test('cycleCandidates: newest 6-hourly cycle first, stops at newerThan', () => {
  assert.deepEqual(cycleCandidates(at('2026-10-21T09:25:00Z'), 16).map(d => d.toISOString()),
    ['2026-10-21T06:00:00.000Z', '2026-10-21T00:00:00.000Z', '2026-10-20T18:00:00.000Z']);
  assert.deepEqual(cycleCandidates(at('2026-10-21T09:25:00Z'), 30, at('2026-10-21T00:00:00Z')).map(d => d.toISOString()),
    ['2026-10-21T06:00:00.000Z']);
  assert.deepEqual(cycleCandidates(at('2026-10-21T09:25:00Z'), 30, at('2026-10-21T06:00:00Z')), []);
});

test('pickForecastHour: 3-hourly step closest to now + 3 h, clamped', () => {
  assert.equal(pickForecastHour(at('2026-10-21T00:00:00Z'), at('2026-10-21T04:15:00Z')), 6);
  assert.equal(pickForecastHour(at('2026-10-21T00:00:00Z'), at('2026-10-21T05:15:00Z')), 9);
  assert.equal(pickForecastHour(at('2026-10-21T00:00:00Z'), at('2026-10-21T09:25:00Z')), 12);
  assert.equal(pickForecastHour(at('2026-10-21T00:00:00Z'), at('2026-10-20T20:00:00Z')), 0);
  assert.equal(pickForecastHour(at('2026-10-01T00:00:00Z'), at('2026-10-21T00:00:00Z')), 120);
});

test('source URLs', () => {
  assert.equal(nomadsUrl(at('2026-10-21T06:00:00Z'), 6),
    'https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl?dir=%2Fgfs.20261021%2F06%2Fatmos&file=gfs.t06z.pgrb2.1p00.f006&var_UGRD=on&var_VGRD=on&lev_10_m_above_ground=on');
  assert.match(nomadsUrl(at('2026-10-21T00:00:00Z'), 12, '0p50'), /filter_gfs_0p50\.pl\?.*file=gfs\.t00z\.pgrb2full\.0p50\.f012/);
  assert.equal(awsUrl(at('2026-10-21T18:00:00Z'), 9),
    'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261021/18/atmos/gfs.t18z.pgrb2.1p00.f009');
});

test('idxRanges picks UGRD/VGRD at 10 m only', () => {
  const idx = [
    '587:34500000:d=2026102100:TMP:2 m above ground:6 hour fcst:',
    '588:34556898:d=2026102100:UGRD:10 m above ground:6 hour fcst:',
    '589:34608936:d=2026102100:VGRD:10 m above ground:6 hour fcst:',
    '590:34660000:d=2026102100:UGRD:20 m above ground:6 hour fcst:',
  ].join('\n');
  assert.deepEqual(idxRanges(idx), [{ start: 34556898, end: 34608935 }, { start: 34608936, end: 34659999 }]);
  assert.deepEqual(idxRanges('1:0:d=2026102100:VGRD:10 m above ground:anl:\n'), [{ start: 0, end: null }]);
});

test('toVelocityJson: leaflet-velocity shape, 0.1 m/s rounding, metadata', () => {
  const gen = at('2026-10-21T04:12:00Z');
  const recs = toVelocityJson(decodeGrib2(grib), gen);
  const fields = decodeGrib2(grib);
  assert.equal(recs.length, 2);
  const [u, v] = recs;
  assert.equal(`${u.header.parameterCategory},${u.header.parameterNumber}`, '2,2');
  assert.equal(`${v.header.parameterCategory},${v.header.parameterNumber}`, '2,3');
  assert.deepEqual(
    { nx: u.header.nx, ny: u.header.ny, lo1: u.header.lo1, la1: u.header.la1, lo2: u.header.lo2, la2: u.header.la2, dx: u.header.dx, dy: u.header.dy, scanMode: u.header.scanMode },
    { nx: 360, ny: 181, lo1: 0, la1: 90, lo2: 359, la2: -90, dx: 1, dy: 1, scanMode: 0 });
  assert.equal(u.header.refTime, '2026-10-21T00:00:00.000Z');
  assert.equal(u.header.forecastTime, 6);
  assert.equal(u.header.validTime, '2026-10-21T06:00:00.000Z');
  assert.equal(u.header.generatedAt, '2026-10-21T04:12:00.000Z');
  assert.equal(u.header.staleAfter, '2026-10-21T16:12:00.000Z');
  assert.equal(u.header.source, 'NOAA GFS');
  assert.equal(u.header.parameterUnit, 'm.s-1');
  assert.equal(u.header.surface1Value, 10);
  assert.equal(u.data.length, 65160);
  u.data.forEach((x, i) => assert.ok(Math.abs((x as number) - fields[0].values[i]) <= 0.05 + 1e-9));
  assert.ok(u.data.every(x => typeof x === 'number' && Math.round(x * 10) === x * 10));
  // what leaflet-velocity computes as the display date: new Date(refTime) + forecastTime hours
  const d = new Date(u.header.refTime); d.setHours(d.getHours() + u.header.forecastTime);
  assert.equal(d.toISOString(), u.header.validTime);
});

test('validateVelocityJson rejects shapes leaflet-velocity cannot use', () => {
  const good = toVelocityJson(decodeGrib2(grib), at('2026-10-21T04:12:00Z'));
  const clone = () => JSON.parse(JSON.stringify(good)) as VelocityRecord[];
  validateVelocityJson(clone());
  const bad: [string, (r: VelocityRecord[]) => unknown][] = [
    ['single record', r => [r[0]]],
    ['no V', r => { r[1].header.parameterNumber = 9; return r; }],
    ['short data', r => { r[0].data.pop(); return r; }],
    ['scan mode', r => { r[0].header.scanMode = 32; return r; }],
    ['regional grid', r => { r[0].header.nx = 10; r[0].data = r[0].data.slice(0, 10 * 181); return r; }],
    ['NaN', r => { r[1].data[5] = Number.NaN; return r; }],
    ['U/V time mismatch', r => { r[1].header.forecastTime = 9; return r; }],
    ['missing metadata', r => { delete (r[0].header as Partial<VelocityRecord['header']>).staleAfter; return r; }],
  ];
  for (const [name, mutate] of bad) assert.throws(() => validateVelocityJson(mutate(clone())), /velocity JSON invalid/, name);
});

// fake upstreams: NOMADS refuses (403 HTML, as it does for missing files), AWS serves the
// fixture through its .idx + byte ranges
function fakeFetch(opts: { nomads: 'grib' | '403'; aws: 'grib' | '404' }, calls: string[]): typeof fetch {
  const msg1 = Number(Buffer.from(grib.subarray(8, 16)).readBigUInt64BE());
  const idx = `1:0:d=2026102100:UGRD:10 m above ground:6 hour fcst:\n2:${msg1}:d=2026102100:VGRD:10 m above ground:6 hour fcst:\n`;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const ok00 = url.includes('gfs.20261021') && url.includes('t00z') && url.includes('f006');
    if (url.includes('nomads')) {
      return opts.nomads === 'grib' && ok00 ? new Response(grib) : new Response('<html>no</html>', { status: 403 });
    }
    if (opts.aws === '404' || !ok00) return new Response('', { status: 404 });
    if (url.endsWith('.idx')) return new Response(idx);
    const m = /bytes=(\d+)-(\d*)/.exec(new Headers(init?.headers).get('range') ?? '');
    assert.ok(m, 'AWS fetch must be a range request');
    return new Response(grib.subarray(Number(m[1]), m[2] ? Number(m[2]) + 1 : grib.length), { status: 206 });
  }) as typeof fetch;
}

test('runGfsWind: NOMADS -> writes json + gz that round-trip', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'gfs-wind-')), 'w.json');
  const calls: string[] = [];
  const r = await runGfsWind({ out, now: at('2026-10-21T04:12:00Z'), fetchImpl: fakeFetch({ nomads: 'grib', aws: '404' }, calls) });
  assert.equal(r.source, 'nomads');
  assert.equal(r.refTime, '2026-10-21T00:00:00.000Z');
  assert.equal(r.forecastTime, 6);
  assert.equal(calls.length, 1);
  const json = readFileSync(out, 'utf8');
  assert.equal(gunzipSync(readFileSync(`${out}.gz`)).toString('utf8'), json);
  validateVelocityJson(JSON.parse(json));
  assert.ok(r.gzBytes! < r.bytes! / 3);
});

test('runGfsWind: NOMADS refuses -> AWS byte ranges give the same data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gfs-wind-'));
  const now = at('2026-10-21T04:12:00Z');
  await runGfsWind({ out: join(dir, 'a.json'), now, fetchImpl: fakeFetch({ nomads: 'grib', aws: '404' }, []) });
  const calls: string[] = [];
  const r = await runGfsWind({ out: join(dir, 'b.json'), now, fetchImpl: fakeFetch({ nomads: '403', aws: 'grib' }, calls) });
  assert.equal(r.source, 'aws');
  assert.equal(calls.filter(c => c.includes('amazonaws') && !c.endsWith('.idx')).length, 2);
  assert.equal(readFileSync(join(dir, 'a.json'), 'utf8'), readFileSync(join(dir, 'b.json'), 'utf8'));
});

test('runGfsWind: missing runs -> tries NOMADS then AWS per cycle, newest to oldest, then gives up', async () => {
  const calls: string[] = [];
  const r = await runGfsWind({ out: join(mkdtempSync(join(tmpdir(), 'gfs-wind-')), 'w.json'), now: at('2026-10-21T07:00:00Z'), fetchImpl: fakeFetch({ nomads: '403', aws: '404' }, calls) });
  assert.match(r.skipped!, /no GFS run available/);
  assert.deepEqual(r.tried, [
    '2026-10-21T06Z f003 nomads: not available', '2026-10-21T06Z f003 aws: not available',
    '2026-10-21T00Z f009 nomads: not available', '2026-10-21T00Z f009 aws: not available',
    '2026-10-20T18Z f015 nomads: not available', '2026-10-20T18Z f015 aws: not available',
    '2026-10-20T12Z f021 nomads: not available', '2026-10-20T12Z f021 aws: not available',
    '2026-10-20T06Z f027 nomads: not available', '2026-10-20T06Z f027 aws: not available',
  ]);
});

test('runGfsWind: refuses a file whose run or forecast hour differs from the request', async () => {
  const lying: typeof fetch = (async () => new Response(grib)) as typeof fetch; // always the 00Z f006 file
  await assert.rejects(
    runGfsWind({ out: join(mkdtempSync(join(tmpdir(), 'gfs-wind-')), 'w.json'), now: at('2026-10-21T07:00:00Z'), fetchImpl: lying }),
    /asked for 2026-10-21T06Z f003, file says 2026-10-21T00:00:00.000Z f006/);
});

test('runGfsWind: nothing newer than the published run -> no fetch, no file', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'gfs-wind-')), 'w.json');
  const calls: string[] = [];
  const r = await runGfsWind({ out, now: at('2026-10-21T04:12:00Z'), newerThan: at('2026-10-21T00:00:00Z'), fetchImpl: fakeFetch({ nomads: 'grib', aws: 'grib' }, calls) });
  assert.match(r.skipped!, /keeping the published file/);
  assert.equal(calls.length, 0);
  assert.equal(existsSync(out), false);
});
