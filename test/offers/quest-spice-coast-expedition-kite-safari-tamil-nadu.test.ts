// Quest Spice Coast Expedition kite safari: replays /kitesurfing-tours recorded 2026-10-21 (shared parsers tested in
// quest-island-hopping-kite-safari-rameswaram.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { questSpiceCoastExpeditionKiteSafariTamilNadu } from '../../src/offers/adapters/quest-spice-coast-expedition-kite-safari-tamil-nadu.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

process.env.OFFERS_FIXTURE_DIR = join(import.meta.dirname, '../fixtures/offers/quest-spice-coast-expedition-kite-safari-tamil-nadu');
const ctx = { note: () => {}, incomplete: () => {} };

test('quest-spice: slot INR 110,000 for 14 days', async () => {
  const slots = await questSpiceCoastExpeditionKiteSafariTamilNadu.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.currency, s.priceUnit, s.priceBasis, s.availability]),
    [['14-days', 110000, 'INR', 'package', 'person', 'on_request']]);
});

test('quest-spice: content (no route printed -> no itinerary stops, base as spot)', async () => {
  const c = await questSpiceCoastExpeditionKiteSafariTamilNadu.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.spot, c.itinerarySpots.length, c.accommodation], ['tour', 14, 'Rameswaram', 0, 'home-stays and hotels along the route']);
  assert.deepEqual(c.skillLevels, ['advanced']);
  assert.match(c.summary, /challenging 14-day guided kite safari/);
  assert.match(c.summary, /INR 1,10,000 \(per person, inferred\)/);
  assert.doesNotMatch(c.summary, /[–—]/);
});
