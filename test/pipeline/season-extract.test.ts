import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contiguousRange, decideSeason, parseExtraction, quoteInText, seasonUpsertColumns, seasonWindows, selectForApply, monthsLabel, isOwnSite, type PlanRow, type SeasonExtraction } from '../../src/pipeline/season-extract.js';

const x = (over: Partial<SeasonExtraction>): SeasonExtraction => ({ basis: 'operating_period', open_months: [], closed_months: [], evidence_quote: null, confidence: 'high', note: null, ...over });
const page = 'Welcome! Our kite season runs from November to April. We are open all year for guests. Closed in January and February for maintenance.';

test('contiguous month blocks, wrapping over the year end; two seasons are not one block', () => {
  assert.deepEqual(contiguousRange([4, 5, 6, 7, 8, 9, 10]), { start: 4, end: 10 });
  assert.deepEqual(contiguousRange([11, 12, 1, 2, 3, 4]), { start: 11, end: 4 });
  assert.deepEqual(contiguousRange([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), { start: 1, end: 12 });
  assert.equal(contiguousRange([4, 5, 6, 9, 10]), null);
  assert.equal(contiguousRange([]), null);
  assert.equal(monthsLabel([11, 12, 1, 2]), 'Nov-Feb');
  assert.equal(monthsLabel([4, 5, 9]), 'Apr, May, Sep');
});

test('quote check survives formatting but needs the real words', () => {
  assert.ok(quoteInText('kite season  runs from November to April.', page));
  assert.ok(quoteInText('Season: April \u2013 October', 'season: april - october'));
  assert.ok(!quoteInText('season runs from October to April', page));
  assert.ok(!quoteInText('April', page), 'too short to be evidence');
  assert.ok(!quoteInText(null, page));
});

test('cruise: stated season (also wind-only) is written; low confidence or missing quote is not', () => {
  const d = decideSeason('cruise', x({ open_months: [11, 12, 1, 2, 3, 4], evidence_quote: 'Our kite season runs from November to April' }), page);
  assert.deepEqual(d, { write: true, start: 11, end: 4, months: [1, 2, 3, 4, 11, 12], kind: 'range' });
  const w = decideSeason('cruise', x({ basis: 'wind_season', open_months: [11, 12, 1, 2, 3, 4], evidence_quote: 'kite season runs from November to April' }), page);
  assert.equal(w.write && w.kind, 'wind_season');
  assert.equal(decideSeason('cruise', x({ open_months: [5, 6], confidence: 'low', evidence_quote: 'kite season runs from November to April' }), page).write, false);
  assert.deepEqual(decideSeason('cruise', x({ open_months: [5, 6], evidence_quote: 'season from May to June' }), page), { write: false, reason: 'quote_not_found', months: [5, 6] });
  assert.deepEqual(decideSeason('cruise', x({ basis: 'none' }), page), { write: false, reason: 'unknown', months: [] });
});

test('camp/tour: a wind-only window, price seasons, dated trips and other facilities are reported, not written; two seasons stay unknown', () => {
  const quote = 'kite season runs from November to April';
  assert.deepEqual(decideSeason('camp', x({ basis: 'price_seasons', open_months: [5, 6, 7], evidence_quote: quote }), page), { write: false, reason: 'price_only', months: [5, 6, 7] });
  assert.deepEqual(decideSeason('tour', x({ basis: 'dated_departures', open_months: [3], evidence_quote: quote }), page), { write: false, reason: 'dates_only', months: [3] });
  assert.deepEqual(decideSeason('accommodation', x({ basis: 'other_facility', closed_months: [5, 6, 7, 8, 9, 10], evidence_quote: quote }), page).write, false);
  assert.deepEqual(decideSeason('cruise', x({ basis: 'price_seasons', open_months: [1, 2], evidence_quote: quote }), page).write, false);
  assert.deepEqual(decideSeason('camp', x({ basis: 'wind_season', open_months: [11, 12, 1, 2, 3, 4], evidence_quote: quote }), page), { write: false, reason: 'wind_only', months: [1, 2, 3, 4, 11, 12] });
  assert.deepEqual(decideSeason('tour', x({ open_months: [4, 5, 6, 9, 10], evidence_quote: quote }), page), { write: false, reason: 'non_contiguous', months: [4, 5, 6, 9, 10] });
});

test('accommodation: explicit year-round -> 1..12, explicit closing months -> the rest; wind-only never', () => {
  const all = decideSeason('accommodation', x({ basis: 'year_round', evidence_quote: 'We are open all year for guests.' }), page);
  assert.deepEqual(all, { write: true, start: 1, end: 12, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], kind: 'year_round' });
  const closed = decideSeason('accommodation', x({ closed_months: [1, 2], evidence_quote: 'Closed in January and February for maintenance.' }), page);
  assert.deepEqual(closed, { write: true, start: 3, end: 12, months: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12], kind: 'closed_months' });
  assert.equal(decideSeason('accommodation', x({ basis: 'wind_season', open_months: [11, 12, 1], evidence_quote: 'kite season runs from November to April' }), page).write, false);
  assert.deepEqual(decideSeason('accommodation', x({ open_months: [1, 2, 3], closed_months: [3], evidence_quote: 'Closed in January and February' }), page), { write: false, reason: 'conflict', months: [1, 2, 3] });
});

test('LLM output parsing drops junk months and defaults to low confidence', () => {
  const p = parseExtraction('noise {"basis":"operating_period","open_months":[4,5,13,"6",5],"closed_months":[],"evidence_quote":" Apr-May ","confidence":"maybe"} trailing');
  assert.deepEqual(p, { basis: 'operating_period', open_months: [4, 5], closed_months: [], evidence_quote: 'Apr-May', confidence: 'low', note: null });
  assert.equal(parseExtraction('{"basis":"operating"}')?.basis, 'none');
  assert.equal(parseExtraction('no json'), null);
});

test('long pages are cut to windows around season words', () => {
  const long = 'x '.repeat(10000) + 'Our season is May to September. ' + 'y '.repeat(10000);
  const w = seasonWindows(long, 3000);
  assert.ok(w.length <= 3000 && w.includes('season is May to September'));
});

test('re-extraction leaves a stored season alone when it finds none', () => {
  assert.deepEqual(seasonUpsertColumns(null, null, null), {});
  assert.deepEqual(seasonUpsertColumns('Apr-Oct', 4, 10), { season_text: 'Apr-Oct', season_start_month: 4, season_end_month: 10 });
  assert.deepEqual(seasonUpsertColumns('all year', null, null), { season_text: 'all year' });
});

test('apply picks approved rows; wind-only only on request; --only/--exclude by id prefix', () => {
  const row = (id: string, decision: PlanRow['decision']): PlanRow => ({ catalog_source: 'package_offers', offer_id: id, type: 'camp', title: id, provider: 'p', source_url: null, text_source: 'stored', extraction: null, decision });
  const rows = [
    row('aaaa1111', { write: true, start: 4, end: 10, months: [4, 5, 6, 7, 8, 9, 10], kind: 'range' }),
    row('bbbb2222', { write: false, reason: 'wind_only', months: [12, 1, 2] }),
    row('cccc3333', { write: false, reason: 'non_contiguous', months: [4, 9] }),
  ];
  assert.deepEqual(selectForApply(rows, {}).map(p => p.row.offer_id), ['aaaa1111']);
  assert.deepEqual(selectForApply(rows, { includeWind: true }).map(p => [p.row.offer_id, p.start, p.end]), [['aaaa1111', 4, 10], ['bbbb2222', 12, 2]]);
  assert.deepEqual(selectForApply(rows, { exclude: ['aaaa'] }).length, 0);
  assert.deepEqual(selectForApply(rows, { only: ['bbbb'], includeWind: true }).map(p => p.row.offer_id), ['bbbb2222']);
});

test('aggregator pages are never a season source', () => {
  assert.ok(isOwnSite('https://www.kite-and-islands.ch/de/kitecruise'));
  assert.ok(!isOwnSite('https://www.bstoked.net/listing/123'));
  assert.ok(!isOwnSite('https://www.booking.com/hotel/x'));
  assert.ok(!isOwnSite(null));
});
