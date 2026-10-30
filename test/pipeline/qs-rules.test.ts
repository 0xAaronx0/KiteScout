import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysSince, normUrl, recentlyExpired, sourceProblem } from '../../src/pipeline/qs-rules.js';

const NOW = new Date('2026-10-30T09:00:00Z');
const TODAY = '2026-10-30';
const src = (over: Partial<Parameters<typeof sourceProblem>[0]> = {}) => ({
  active: true, last_ok_at: '2026-10-29T12:00:00Z', last_error: null, history: [], ...over,
});

test('daysSince: whole days, null for missing or broken input', () => {
  assert.equal(daysSince('2026-10-27T09:00:00Z', NOW), 3);
  assert.equal(daysSince(null, NOW), null);
  assert.equal(daysSince('not a date', NOW), null);
});

test('sourceProblem: a healthy or inactive source is no case', () => {
  assert.equal(sourceProblem(src(), NOW), null);
  assert.equal(sourceProblem(src({ active: false, last_ok_at: null }), NOW), null);
});

test('sourceProblem: no success for 3 days, or never, is a case with the error', () => {
  assert.match(sourceProblem(src({ last_ok_at: '2026-10-21T10:00:00Z', last_error: 'HTTP 401' }), NOW)!, /seit 8 Tagen.*HTTP 401/);
  assert.equal(sourceProblem(src({ last_ok_at: '2026-10-28T08:00:00Z' }), NOW), null);  // 2 days: still quiet
  assert.match(sourceProblem(src({ last_ok_at: null, last_error: 'blocked' }), NOW)!, /noch nie erfolgreich: blocked/);
});

test('sourceProblem: bookable dropping to 0 after bookable runs is a case (stale slot guard)', () => {
  const history = [{ bookable: 0, error: 'fetch failed' }, { bookable: 144 }, { bookable: 144 }];
  assert.match(sourceProblem(src({ history }), NOW)!, /auf 0 gefallen \(vorher 144\): fetch failed/);
  // never had bookable slots (season over, on request): no case
  assert.equal(sourceProblem(src({ history: [{ bookable: 0 }, { bookable: 0 }] }), NOW), null);
  // older than the last 5 runs before: no case
  assert.equal(sourceProblem(src({ history: [{ bookable: 0 }, ...Array(5).fill({ bookable: 0 }), { bookable: 3 }] }), NOW), null);
});

test('recentlyExpired: all past and the last one recent', () => {
  const dates = [
    { start_date: '2026-06-06', end_date: '2026-06-13' },
    { start_date: '2026-10-10', end_date: '2026-10-17' },
  ];
  assert.equal(recentlyExpired(dates, TODAY), '2026-10-17');
});

test('recentlyExpired: an upcoming departure, no dates, or a long-past season is no case', () => {
  assert.equal(recentlyExpired([{ start_date: '2026-10-10', end_date: '2026-10-17' }, { start_date: '2026-11-07', end_date: null }], TODAY), null);
  assert.equal(recentlyExpired([{ start_date: '2026-10-25', end_date: '2026-11-01' }], TODAY), null);  // still running
  assert.equal(recentlyExpired(null, TODAY), null);
  assert.equal(recentlyExpired([], TODAY), null);
  assert.equal(recentlyExpired([{ start_date: '2025-05-01', end_date: '2025-05-08' }], TODAY), null);  // > 120 days
  assert.equal(recentlyExpired([{ start_date: 'TBA' }], TODAY), null);
});

test('normUrl: scheme, www and trailing slash do not matter', () => {
  assert.equal(normUrl('https://www.Example.com/a/'), normUrl('http://example.com/a'));
});
