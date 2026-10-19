// Mauritius Surf Holidays Kite Camp (La Gaulette): replays the kite camp page recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mauritiusSurfHolidaysKiteCampLaGaulette, parseMshPrices } from '../../src/offers/adapters/mauritius-surf-holidays-kite-camp-la-gaulette.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

process.env.OFFERS_FIXTURE_DIR = join(import.meta.dirname, '../fixtures/offers/mauritius-surf-holidays-kite-camp-la-gaulette');
const ctx = { note: () => {}, incomplete: () => {} };

test('msh: price list (site spelling "nigths"), per person with printed totals', async () => {
  const slots = await mauritiusSurfHolidaysKiteCampLaGaulette.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.priceTotal, s.occupancy, s.packageNights, s.currency, s.priceBasis, s.availability]), [
    ['7n|1p', 690, null, 1, 7, 'EUR', 'person', 'on_request'],
    ['7n|2p', 575, 1150, 2, 7, 'EUR', 'person', 'on_request'],
    ['14n|1p', 890, null, 1, 14, 'EUR', 'person', 'on_request'],
    ['14n|2p', 645, 1290, 2, 14, 'EUR', 'person', 'on_request'],
  ]);
  assert.ok(slots.every(s => s.startDate === null));
});

test('msh: price parser also takes the corrected spelling and the euro sign', () => {
  assert.deepEqual(parseMshPrices('<p>1 person 7 nights: 700 €</p><p>2 persons 7 nights : 1.200 euro</p>'),
    [{ persons: 1, nights: 7, total: 700 }, { persons: 2, nights: 7, total: 1200 }]);
});

test('msh: content', async () => {
  const c = await mauritiusSurfHolidaysKiteCampLaGaulette.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.mealPlan], ['camp', 8, 'Mauritius', 'Le Morne, Black River', 'La Gaulette', 'self_catering']);
  assert.ok(c.includedServices.includes('Airport transfer roundtrip'));
  assert.match(c.summary, /EUR 690 for one person and 7 nights, EUR 1150 for two; 14 nights from EUR 890/);
  assert.ok(c.imageUrls.length >= 15);
});
