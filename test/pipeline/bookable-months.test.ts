import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookableMonths } from '../../src/pipeline/bookable-months.js';

const today = Date.UTC(2026, 9, 21); // 2026-10-21

test('season range wraps over the year end', () => {
  assert.deepEqual(bookableMonths({ season_start_month: 11, season_end_month: 3 }, false, today), { months: [1, 2, 3, 11, 12], basis: 'season' });
  assert.deepEqual(bookableMonths({ season_start_month: 6 }, false, today), { months: [6], basis: 'season' });
});

test('future open slots add every month they touch; closed, full and past slots do not', () => {
  const dates = [
    { start_date: '2026-12-28', end_date: '2027-01-04', status: 'available' },
    { start_date: '2026-11-01', status: 'sold out' },
    { start_date: '2026-08-01', end_date: '2026-08-08' },
    { start_date: '2027-03-01', spots_left: 0 },
    { start_date: '2027-04-10', spots_left: '2' },
  ];
  assert.deepEqual(bookableMonths({ dates }, false, today), { months: [1, 4, 12], basis: 'dates' });
  assert.deepEqual(bookableMonths({ season_start_month: 5, season_end_month: 5, dates }, false, today), { months: [1, 4, 5, 12], basis: 'season+dates' });
});

test('the season counts even when a package calendar has no open slot (Aaron 2026-10-28); nothing known = null', () => {
  const closed = [{ start_date: '2026-11-01', status: 'closed' }];
  assert.deepEqual(bookableMonths({ season_start_month: 1, season_end_month: 3, dates: closed }, true, today), { months: [1, 2, 3], basis: 'season' });
  assert.deepEqual(bookableMonths({ season_start_month: 1, season_end_month: 3, dates: closed }, false, today), { months: [1, 2, 3], basis: 'season' });
  assert.equal(bookableMonths({ dates: closed }, true, today), null);
  assert.equal(bookableMonths({}, true, today), null);
  assert.equal(bookableMonths({ season_start_month: 13 }, false, today), null);
});

test('season_months from the tables: several windows, and a stored set wins over start/end', async () => {
  const { withTableSeason } = await import('../../src/pipeline/bookable-months.js');
  assert.deepEqual(bookableMonths(withTableSeason({ dates: [] }, [12, 1, 2, 6, 7, 8]), true, today), { months: [1, 2, 6, 7, 8, 12], basis: 'season' });
  assert.deepEqual(bookableMonths(withTableSeason({ season_start_month: 4, season_end_month: 5 }, [7, 8]), false, today), { months: [7, 8], basis: 'season' });
  assert.deepEqual(withTableSeason({ dates: null }, undefined), { dates: null });
  assert.deepEqual(withTableSeason({ dates: null }, []), { dates: null });
  assert.deepEqual(bookableMonths({ season_months: [13, 0] }, false, today), null, 'junk months are ignored');
});

test('a month/season window counts until its last month has passed, from the current month on (KCS buildDateWindowLabels)', () => {
  const now = Date.UTC(2026, 9, 28); // 2026-10-28
  const season = [{ start_date: '2026-10-01', end_date: '2026-12-31', status: 'on_request', date_precision: 'season' }];
  assert.deepEqual(bookableMonths({ dates: season }, true, now), { months: [10, 11, 12], basis: 'dates' });
  const longSeason = [{ start_date: '2026-06-01', end_date: '2027-01-31', date_precision: 'season' }];
  assert.deepEqual(bookableMonths({ dates: longSeason }, true, now), { months: [1, 10, 11, 12], basis: 'dates' }, 'months already behind us are not claimed');
  const ended = [{ start_date: '2026-09-01', end_date: '2026-09-30', date_precision: 'month' }];
  assert.deepEqual(bookableMonths({ season_months: [4, 5], dates: ended }, true, now), { months: [4, 5], basis: 'season' }, 'an ended window adds nothing, the season stays');
  const month = [{ start_date: '2026-10-01', end_date: '2026-10-31', date_precision: 'month' }, { start_date: '2026-11-01', end_date: '2026-12-31', date_precision: 'month' }];
  assert.deepEqual(bookableMonths({ dates: month }, true, now), { months: [10], basis: 'dates' }, 'a "month" slot spanning two months is malformed and skipped');
  const startedDay = [{ start_date: '2026-10-20', end_date: '2026-11-03', status: 'available' }];
  assert.equal(bookableMonths({ dates: startedDay }, false, now), null, 'a started day-precision departure is still gone');
});
