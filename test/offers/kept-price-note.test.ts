import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keptPriceNote } from '../../src/offers/ingest.js';

// live Cuxhaven 2026-11-03: the guard kept a 2026-10-31 price whose dates all ended that day
const cuxNote = 'From EUR 25 / night per room (cheapest bookable: Strandgut-Koje (covered outdoor bed), Mon-Fri nights, 2026-10-25; as of 2026-10-31)';
const stored = (start: string | null, end: string | null, price: number | null = 25) => ({ key: `k|${start}`, start_date: start, end_date: end, price, currency: 'EUR', date_precision: 'day' });

test('keptPriceNote: a kept price whose dates are all over is marked last published, amount and read date stay', () => {
  const note = keptPriceNote('accommodation', cuxNote, [stored('2026-10-25', '2026-10-31'), stored('2026-10-25', '2026-10-31', 90)], '2026-11-03');
  assert.equal(note, 'From EUR 25 / night per room (last published price, 2026 dates are over, new dates not published yet: Strandgut-Koje (covered outdoor bed), Mon-Fri nights, 2026-10-25; as of 2026-10-31)');
  // idempotent: the next guarded run leaves the marked note alone
  assert.equal(keptPriceNote('accommodation', note, [stored('2026-10-25', '2026-10-31')], '2026-11-04'), null);
});

test('keptPriceNote: the full-or-waitlist label is marked too, the latest year names the season', () => {
  const note = keptPriceNote('camp', 'From EUR 900 p.p. (next dates full or waitlist only: Camp, 2026-09-12; as of 2026-09-01)',
    [stored('2025-09-13', '2025-09-20', 850), stored('2026-09-12', '2026-09-19', 900)], '2026-11-03');
  assert.match(note!, /^From EUR 900 p\.p\. \(last published price, 2026 dates are over, new dates not published yet: Camp, 2026-09-12; as of 2026-09-01\)$/);
});

test('keptPriceNote: the stored note stands while a slot is ahead, for undated rates, without priced slots or a note', () => {
  assert.equal(keptPriceNote('accommodation', cuxNote, [stored('2026-10-25', '2026-10-31'), stored('2026-11-01', '2026-11-30')], '2026-11-03'), null);
  assert.equal(keptPriceNote('accommodation', cuxNote, [stored(null, null)], '2026-11-03'), null);
  assert.equal(keptPriceNote('accommodation', cuxNote, [stored('2026-10-25', '2026-10-31', null)], '2026-11-03'), null);
  assert.equal(keptPriceNote('accommodation', cuxNote, [], '2026-11-03'), null);
  assert.equal(keptPriceNote('accommodation', null, [stored('2026-10-25', '2026-10-31')], '2026-11-03'), null);
  // a camp that started yesterday is over for camps (isAhead uses the start date), a stay running until today is not
  assert.notEqual(keptPriceNote('camp', 'From EUR 1 (cheapest bookable: x; as of 2026-10-01)', [stored('2026-11-02', '2026-11-09')], '2026-11-03'), null);
  assert.equal(keptPriceNote('accommodation', cuxNote, [stored('2026-10-25', '2026-11-03')], '2026-11-03'), null);
});
