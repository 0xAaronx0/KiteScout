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

test('a package calendar without open slots drops its season (KCS loader rule); nothing known = null', () => {
  const closed = [{ start_date: '2026-11-01', status: 'closed' }];
  assert.equal(bookableMonths({ season_start_month: 1, season_end_month: 3, dates: closed }, true, today), null);
  assert.deepEqual(bookableMonths({ season_start_month: 1, season_end_month: 3, dates: closed }, false, today), { months: [1, 2, 3], basis: 'season' });
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
