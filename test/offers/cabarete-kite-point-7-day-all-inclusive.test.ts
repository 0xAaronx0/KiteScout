// Cabarete Kite Point 7-Day All-Inclusive, replayed from the fixtures recorded 2026-10-21 (Instagram feed removed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { cabareteKitePoint7DayAllInclusive as adapter } from '../../src/offers/adapters/cabarete-kite-point-7-day-all-inclusive.js';

process.env.OFFERS_FIXTURE_DIR = join(import.meta.dirname, '../fixtures/offers/cabarete-kite-point-7-day-all-inclusive');
const ctx = { note: () => {}, incomplete: () => {} };

test('kite point slots: one undated "starting at" package', async () => {
  const slots = await adapter.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 1);
  const s = ok[0];
  assert.deepEqual([s.key, s.price, s.currency, s.priceUnit, s.priceBasis, s.packageNights, s.availability, s.availabilityText],
    ['all-inclusive', 1375, 'USD', 'package', 'person', 7, 'on_request', 'Booking via WhatsApp only']);
});

test('kite point content', async () => {
  const c = await adapter.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 8, '7 nights');
  assert.equal(c.spot, 'Kite Beach, Cabarete');
  assert.equal(c.region, 'Puerto Plata');
  assert.deepEqual(c.skillLevels, ['beginner', 'intermediate']);
  assert.equal(c.includedServices[0], '9 hours of private beginner kite lessons (certified instructors, Ozone kites)');
  assert.doesNotMatch(c.summary, /[—–]/);
  assert.deepEqual(c.imageUrls.slice(0, 4), [
    'https://cabaretekitepoint.com/wp-content/uploads/2019/10/kiteboarding-lessons-cabarete.jpg',
    'https://cabaretekitepoint.com/wp-content/uploads/2019/09/DJI_0010.jpg',
    'https://cabaretekitepoint.com/wp-content/uploads/2021/11/cabarete-kite-point-drone.jpg',
    'https://cabaretekitepoint.com/wp-content/uploads/2024/09/kiteboarding-lessons-kite-beach.jpg',
  ]);
  assert.ok(!c.imageUrls.some(u => /instagram|logo|favicon|bkg|background|banner/i.test(u)));
});
