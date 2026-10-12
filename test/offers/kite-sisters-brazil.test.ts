// Kite Sisters Brazil adapter, replayed from the fixture recorded 2026-10-09.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { kiteSistersBrazil as adapter, weekRange, weekStatus } from '../../src/offers/adapters/kite-sisters-brazil.js';

process.env.OFFERS_FIXTURE_DIR = join(import.meta.dirname, '../fixtures/offers/kite-sisters-brazil');
const ctx = { note: () => {}, incomplete: () => {} };

test('weekRange: the page date styles', () => {
  assert.deepEqual(weekRange('October 25th – November 1st, 2026'), { start: '2026-10-25', end: '2026-11-01' });
  assert.deepEqual(weekRange('November 7th – 14th, 2026'), { start: '2026-11-07', end: '2026-11-14' });
  assert.deepEqual(weekRange('October 16th to 23rd 2027'), { start: '2027-10-16', end: '2027-10-23' });
});

test('weekStatus: own words first, then the inquiry default', () => {
  assert.deepEqual(weekStatus('2 spots have just opened!', null), { availability: 'limited', text: '2 spots have just opened!', spotsLeft: 2 });
  assert.equal(weekStatus('SOLD OUT.', null).availability, 'sold_out');
  assert.deepEqual(weekStatus('', '2027 Dates – Reservations open – Wingfoiling also available:'), { availability: 'on_request', text: 'Reservations open', spotsLeft: null });
});

test('kite sisters slots: one per visible week', async () => {
  const slots = await adapter.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 6, 'the hidden 2025 list is not emitted');
  assert.deepEqual(slots.map(s => [s.key, s.endDate, s.availability, s.spotsLeft]), [
    ['co-ed|2026-10-25', '2026-11-01', 'limited', 2],
    ['women|2026-11-07', '2026-11-14', 'sold_out', null],
    ['women|2026-11-15', '2026-11-22', 'sold_out', null],
    ['women|2027-10-16', '2027-10-23', 'on_request', null],
    ['women|2027-10-24', '2027-10-31', 'on_request', null],
    ['co-ed|2027-11-06', '2027-11-13', 'on_request', null],
  ]);
  assert.ok(slots.every(s => s.price === null && s.currency === null), 'no prices on the page');
  assert.equal(slots[1].availabilityText, 'SOLD OUT');
  assert.equal(slots[3].availabilityText, 'Reservations open');
});

test('kite sisters content', async () => {
  const c = await adapter.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kite Sisters Boutique Kitesurf Retreat Brazil');
  assert.equal(c.country, 'Brazil');
  assert.equal(c.region, 'Ceará');
  assert.equal(c.spot, 'Moitas');
  assert.equal(c.durationDays, 8);
  assert.equal(c.mealPlan, 'full_board');
  assert.equal(c.equipmentRental, true);
  assert.equal(c.includedServices.length, 12);
  assert.ok(c.includedServices.includes('6 x Kitesurfing / Kiteboarding Lessons & Coaching'));
  assert.ok(c.imageUrls.length >= 20, `images: ${c.imageUrls.length}`);
  assert.ok(!(c.sourceText ?? '').includes('2025 Dates'), 'hidden widget dropped');
});
