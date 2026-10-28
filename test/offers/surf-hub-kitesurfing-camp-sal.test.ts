// Surf Hub Kitesurfing Camp (Sal): replays /kitesurfing-camp/ recorded 2026-10-28 (dateModified 2025-12-08).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { surfHubKitesurfingCampSal, fetchSurfHubSlots, parseSurfHubPrices, surfHubFresh, unwrapOptimole } from '../../src/offers/adapters/surf-hub-kitesurfing-camp-sal.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

process.env.OFFERS_FIXTURE_DIR = join(import.meta.dirname, '../fixtures/offers/surf-hub-kitesurfing-camp-sal');
const ctx = { note: () => {}, incomplete: () => {} };

test('surf hub: price caption, freshness gate, optimole unwrap', () => {
  assert.deepEqual(parseSurfHubPrices('1 Person 7 Nights 1,295€ - 2 Person 7 Nights 2,115€'),
    [{ persons: 1, nights: 7, total: 1295 }, { persons: 2, nights: 7, total: 2115 }]);
  assert.equal(surfHubFresh('2025-12-08', '2026-10-28'), true);
  assert.equal(surfHubFresh('2025-12-08', '2027-03-09'), false);
  assert.equal(unwrapOptimole('https://mld7tujf17wf.i.optimole.com/w:960/h:635/q:mauto/f:best/http://www.surfhubcapeverde.com/wp-content/uploads/2025/12/Twin.jpg'),
    'https://www.surfhubcapeverde.com/wp-content/uploads/2025/12/Twin.jpg');
});

test('surf hub: undated per-person slots while the page is fresh, none after', async () => {
  const slots = await fetchSurfHubSlots('2026-10-28');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.priceTotal, s.occupancy, s.currency, s.priceUnit, s.packageNights, s.availability, s.startDate]), [
    ['1-person-7-nights', 1295, null, 1, 'EUR', 'package', 7, 'on_request', null],
    ['2-person-7-nights', 1057.5, 2115, 2, 'EUR', 'package', 7, 'on_request', null],
  ]);
  const notes: string[] = [];
  assert.deepEqual(await fetchSurfHubSlots('2027-06-01', { note: t => notes.push(t) }), []);
  assert.match(notes[0], /last edited 2025-12-08/);
});

test('surf hub: content', async () => {
  const c = await surfHubKitesurfingCampSal.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.mealPlan], ['camp', 8, 'Cape Verde', 'Sal', 'Santa Maria, Sal', 'breakfast']);
  assert.equal(c.includedServices[0], '8 hours of private kitesurf lessons (4 sessions)');
  assert.deepEqual(c.skillLevels, ['beginner', 'intermediate', 'advanced']);
  assert.deepEqual(c.languages, ['en', 'fr', 'it', 'pt', 'es']);
  assert.match(c.summary, /EUR 1,295 for one person or EUR 2,115 for two/);
  assert.ok(!/Misturod/.test(c.summary));
  assert.ok(!/[–—]/.test(c.summary));
  assert.ok(c.imageUrls.length >= 15);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://www.surfhubcapeverde.com/wp-content/uploads/') && !/surf-camp|logo|icon/i.test(u)));
});
