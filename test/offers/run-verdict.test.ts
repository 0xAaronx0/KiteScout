// Exit code of `offers ingest`: red only for an adapter that failed on its previous run too (2026-11-01:
// the slots cron was red 16 of 17 days from one-off failures, hiding real breaks like exotikite's new layout).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countLine, prevFailedFrom, runSummaryMarkdown, runVerdict, verdictLine } from '../../src/offers/run-verdict.js';
import type { AdapterReport } from '../../src/offers/ingest.js';

type R = Pick<AdapterReport, 'key' | 'status' | 'error' | 'prevFailed'>;
const ok = (key: string, prevFailed?: boolean): R => ({ key, status: 'ok', prevFailed });
const err = (key: string, prevFailed: boolean | undefined, error = 'fetch failed'): R => ({ key, status: 'error', error, prevFailed });
const blk = (key: string, prevFailed: boolean | undefined): R => ({ key, status: 'blocked', error: 'blocked by host (HTTP 403)', prevFailed });

test('runVerdict: a first failure after an ok run is listed but keeps exit 0', () => {
  const v = runVerdict([ok('a', false), err('b', false), err('c', false, 'HTTP 500 for https://c.example/')]);
  assert.equal(v.exitCode, 0);
  assert.deepEqual(v.first.map(r => r.key), ['b', 'c']);
  assert.deepEqual(v.repeated, []);
  assert.match(verdictLine(v), /^exit 0: 2 first failure/);
});

test('runVerdict: the same adapter failing on two runs in a row turns the run red', () => {
  const v = runVerdict([ok('a', false), err('b', true), err('c', false)]);
  assert.equal(v.exitCode, 1);
  assert.deepEqual(v.repeated.map(r => r.key), ['b']);
  assert.deepEqual(v.first.map(r => r.key), ['c']);
  assert.equal(verdictLine(v), 'exit 1: 1 adapter(s) failed on their previous run too (or it is unknown): b');
});

test('runVerdict: an unknown previous run (dry run, first run) stays strict', () => {
  assert.equal(runVerdict([err('new-adapter', undefined)]).exitCode, 1);
});

test('runVerdict: blocked hosts never turn the run red, also when blocked every day', () => {
  const v = runVerdict([ok('a', false), blk('b', true), blk('c', undefined)]);
  assert.equal(v.exitCode, 0);
  assert.deepEqual(v.blocked.map(r => r.key), ['b', 'c']);
  assert.equal(verdictLine(v), 'exit 0: no adapter failed');
});

test('runVerdict: an adapter that recovered (ok now, failed before) is not a failure', () => {
  assert.equal(runVerdict([ok('a', true)]).exitCode, 0);
});

test('prevFailedFrom: reads the newest history entry; an error or a block counts as failed', () => {
  assert.equal(prevFailedFrom([{ at: '2026-10-31', slots: 6 }, { at: '2026-10-30', error: 'x' }]), false);
  assert.equal(prevFailedFrom([{ at: '2026-10-31', error: 'exotikite: week list not found' }, { at: '2026-10-30' }]), true);
  assert.equal(prevFailedFrom([{ at: '2026-10-31', error: 'blocked by host (HTTP 403): https://x.example/' }]), true);
  assert.equal(prevFailedFrom([]), undefined);
  assert.equal(prevFailedFrom(null), undefined);
  assert.equal(prevFailedFrom(undefined), undefined);
});

// Replay of the real cron runs (offer-slots job logs, ERR and BLK keys per day; every other adapter was ok).
const RUNS: Array<{ day: string; err: string[]; blk: string[] }> = [
  { day: '2026-10-29', err: ['costa-kite-bahia-salinas', 'kailua-lodge-pelzerhaken', 'kitemex-camp-la-ventana'],
    blk: ['bsc-atlanticzin-essaouira', 'keros-blue-limnos', 'la-ballena-alegre-sant-pere-pescador', 'uncharted-kite-sessions-fred-hope-foil-master-cabarete', 'wadi-lahami-village-hamata'] },
  { day: '2026-10-30', err: [],
    blk: ['bsc-atlanticzin-essaouira', 'freeride-kitesurf-downwind-rio-grande-do-norte', 'freeride-kitesurf-downwind-wild-north', 'keros-blue-limnos', 'kitehi-maui-downwinder', 'la-ballena-alegre-sant-pere-pescador', 'red-star-surf-kite-camp-famara', 'road2adventure-kite-safari-perth-exmouth', 'uncharted-kite-sessions-fred-hope-foil-master-cabarete', 'uncharted-kite-sessions-strapless-week-cabarete', 'vela-baja-los-barriles', 'wadi-lahami-village-hamata'] },
  { day: '2026-10-31', err: ['djerbakite-villa-sedouikech', 'exotikite-baja-wave-camps', 'feddet-strand-resort', 'loop-it-academy-apartments-jastarnia'],
    blk: ['bsc-atlanticzin-essaouira', 'keros-blue-limnos', 'la-ballena-alegre-sant-pere-pescador', 'uncharted-kite-sessions-fred-hope-foil-master-cabarete', 'wadi-lahami-village-hamata'] },
  { day: '2026-11-01', err: ['batikite-resort-jeneponto', 'escape-pousada-barra-nova', 'exotikite-baja-wave-camps', 'feddet-strand-resort', 'jeju-kite-lab-sinyang', 'kailua-lodge-pelzerhaken', 'kiteboarding-colombia-wild-north-kite-trip', 'kite-lodge-brazil-prea', 'kite-me-up-hostel-kite-camp-lo-stagnone', 'kitekahunas-kite-villa-sunset-beach', 'kite-sisters-brazil', 'kite-sisters-essential-camp-peru', 'kite-sisters-morocco-retreat', 'kitesurf-tofo', 'lazy-kite-surf-house-tarifa', 'le-papayer-ecolodge-kitesurf-camp-cap-skirring', 'paracuru-kite-village', 'pousada-pais-tropical-icarai', 'wild-kite-peru-la-maison-mancora'],
    blk: ['bsc-atlanticzin-essaouira', 'keros-blue-limnos', 'la-ballena-alegre-sant-pere-pescador', 'uncharted-kite-sessions-fred-hope-foil-master-cabarete', 'uncharted-kite-sessions-strapless-week-cabarete', 'wadi-lahami-village-hamata'] },
];

function replay(i: number): R[] {
  const prev = new Set([...RUNS[i - 1].err, ...RUNS[i - 1].blk]);
  return [...RUNS[i].err.map(k => err(k, prev.has(k))), ...RUNS[i].blk.map(k => blk(k, prev.has(k))), ok('always-ok', false)];
}

test('replay 2026-10-30 / 10-31: blocks and first failures stay green (10-31 was red before)', () => {
  assert.equal(runVerdict(replay(1)).exitCode, 0);
  const v = runVerdict(replay(2));
  assert.equal(v.exitCode, 0);
  assert.equal(v.first.length, 4);
});

test('replay 2026-11-01: red for exotikite (new layout) and feddet (240 s timeout twice), not for the 17 one-offs', () => {
  const v = runVerdict(replay(3));
  assert.equal(v.exitCode, 1);
  assert.deepEqual(v.repeated.map(r => r.key), ['exotikite-baja-wave-camps', 'feddet-strand-resort']);
  assert.equal(v.first.length, 17);
  assert.equal(v.blocked.length, 6);
});

test('runSummaryMarkdown: lists every failure and block, also on a green run', () => {
  const md = runSummaryMarkdown(replay(2));
  assert.match(md, /^## Offer slots\n\n\*\*1\/10 ok, 5 blocked by host, 4 failed\*\*\n\nexit 0: 4 first failure/);
  for (const k of [...RUNS[2].err, ...RUNS[2].blk]) assert.ok(md.includes(`| ${k} |`), k);
  assert.ok(md.includes('| djerbakite-villa-sedouikech | error | ok | fetch failed |'));
  assert.ok(md.includes('| wadi-lahami-village-hamata | blocked | failed too |'));
  assert.ok(!md.includes('(red)'));
});

test('runSummaryMarkdown: red adapters first and marked; table cells survive pipes and newlines', () => {
  const md = runSummaryMarkdown([err('a', false), err('b', true, 'price table | changed\nagain')]);
  const rows = md.split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| Adapter') && !l.startsWith('| ---'));
  assert.deepEqual(rows, ['| b | **error (red)** | failed too | price table \\| changed again |', '| a | error | ok | fetch failed |']);
});

test('countLine: same wording as before the rule', () => {
  assert.equal(countLine([ok('a'), err('b', false), blk('c', false)]), '1/3 ok, 1 blocked by host, 1 failed');
  assert.equal(countLine([ok('a')]), '1/1 ok');
});
