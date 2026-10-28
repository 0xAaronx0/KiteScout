// Kitekurs.no snowkite weekend course, Haugastøl: replays the WooCommerce product page recorded 2026-10-28.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { buildKkSlots, kitekursSnowkiteWeekendHaugastol, kkDayMonth, kkSaturday, parseKkContent } from '../../src/offers/adapters/kitekurs-snowkite-weekend-haugastol.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitekurs-snowkite-weekend-haugastol');
const files = readdirSync(DIR);
const html = readFileSync(join(DIR, files.find(f => f.startsWith('kitekurs.no_produkt_kitekurs-haugstol_.'))!), 'utf8');
const TODAY = '2026-10-28';

test('kitekurs: weekend labels and the Saturday year', () => {
  assert.deepEqual(kkDayMonth('9-jan'), { day: 9, month: 1 });
  assert.deepEqual(kkDayMonth('30.-31.-jan'), { day: 30, month: 1 });
  assert.deepEqual(kkDayMonth('10.-11.april'), { day: 10, month: 4 });
  assert.equal(kkSaturday(2, 1, TODAY), '2027-01-02');
  assert.equal(kkSaturday(6, 3, TODAY), '2027-03-06');
  assert.equal(kkSaturday(5, 3, TODAY), null); // 5 March is a Saturday in neither 2026 (past) nor 2027
});

test('kitekurs: one slot per weekend, stock = spots left, hidden weekends sold out', () => {
  const slots = buildKkSlots(html, TODAY);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 17);
  assert.deepEqual(slots.filter(s => s.availability === 'sold_out').map(s => s.key), ['2027-01-02', '2027-04-17', '2027-04-24']);
  const feb13 = slots.find(s => s.key === '2027-02-13')!;
  assert.deepEqual([feb13.startDate, feb13.endDate, feb13.price, feb13.currency, feb13.priceUnit, feb13.priceBasis, feb13.availability, feb13.spotsLeft],
    ['2027-02-13', '2027-02-14', 4400, 'NOK', 'package', 'person', 'available', 10]);
});

test('kitekurs: slots after the season are dropped', () => {
  assert.deepEqual(buildKkSlots(html, '2027-05-01').filter(s => s.startDate! < '2027-05-01'), []);
});

test('kitekurs: content', () => {
  const c = parseKkContent(html, TODAY);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'course');
  assert.equal(c.durationDays, 2);
  assert.match(c.summary, /14 weekends from 9 January to 10 April are bookable online at NOK 4,400 per person/);
  assert.ok(c.optionalServices.includes('Refresh course for returning kiters (NOK 3270)'));
  assert.equal(c.imageUrls.length, 9);
  assert.deepEqual(kitekursSnowkiteWeekendHaugastol.disciplines, ['snowkite']);
  assert.equal(kitekursSnowkiteWeekendHaugastol.liveAvailability, true);
});
