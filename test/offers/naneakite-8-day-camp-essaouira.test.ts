// NaneaKite 8 days Kitesurf Camp Essaouira: replays the camp page recorded 2026-10-19 (three variants, EUR per person).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { naneakite8DayCampEssaouira, parseNaneaVariants, parseNaneaFacts } from '../../src/offers/adapters/naneakite-8-day-camp-essaouira.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

process.env.OFFERS_FIXTURE_DIR = join(import.meta.dirname, '../fixtures/offers/naneakite-8-day-camp-essaouira');
const ctx = { note: () => {}, incomplete: () => {} };

test('nanea: three variants with EUR per-person prices', async () => {
  const slots = await naneakite8DayCampEssaouira.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.currency, s.priceUnit, s.priceBasis, s.packageNights, s.availability]), [
    ['group', 599, 'EUR', 'package', 'person', 7, 'on_request'],
    ['semi-private', 699, 'EUR', 'package', 'person', 7, 'on_request'],
    ['private', 799, 'EUR', 'package', 'person', 7, 'on_request'],
  ]);
  assert.ok(slots.every(s => s.startDate === null && s.endDate === null));
  assert.match(slots[1].unit!, /Semi-Private classes and private room \(Maximum 2 students per instructor with 2 kite\)/);
});

test('nanea: parsers fail soft on an unrelated page', () => {
  assert.deepEqual(parseNaneaVariants('<html><body><p>nothing</p></body></html>'), []);
  assert.deepEqual(parseNaneaFacts('<p>8 Days / 7 Nights 12 Hours Kitesurf Lessons</p>'), { days: 8, nights: 7, hours: 12 });
});

test('nanea: content', async () => {
  const c = await naneakite8DayCampEssaouira.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.mealPlan], ['camp', 8, 'Morocco', 'Marrakech-Safi', 'Essaouira', 'breakfast']);
  assert.deepEqual(c.spotCoords, { lat: 31.5012286, lng: -9.7618337 });
  assert.match(c.summary, /7 nights in a riad in the medina \(Riad Aylal\).*Group classes EUR 599, Semi-Private classes EUR 699, Private classes EUR 799/);
  assert.ok(c.includedServices.includes('12-hour kitesurfing lessons'));
  assert.ok(c.imageUrls.length >= 8);
  assert.ok(!c.sourceText!.includes('@context'));
});
