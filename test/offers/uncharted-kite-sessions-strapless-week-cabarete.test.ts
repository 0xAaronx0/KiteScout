// Uncharted Kite Sessions "Choose Your Strapless Week", replayed from the fixtures recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { unchartedKiteSessionsStraplessWeekCabarete as adapter } from '../../src/offers/adapters/uncharted-kite-sessions-strapless-week-cabarete.js';

process.env.OFFERS_FIXTURE_DIR = join(import.meta.dirname, '../fixtures/offers/uncharted-kite-sessions-strapless-week-cabarete');
const ctx = { note: () => {}, incomplete: () => {} };

test('strapless week slots: one undated "starting @ ... p/p" package', async () => {
  const slots = await adapter.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 1);
  const s = ok[0];
  assert.deepEqual([s.key, s.startDate, s.price, s.currency, s.priceUnit, s.priceBasis, s.packageNights, s.availability, s.availabilityText],
    ['strapless-week', null, 3195, 'USD', 'package', 'person', 6, 'on_request', 'All Year Long, 1 to 4 guests']);
});

test('strapless week content', async () => {
  const c = await adapter.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 7);
  assert.match(c.summary, /Andreas Lagopoulos/);
  assert.match(c.summary, /starts at USD 3,195 per person/);
  assert.doesNotMatch(c.summary, /[—–]/);
  assert.ok(c.includedServices.includes('Guided down winders'));
  assert.equal(c.imageUrls.length, 10);
});
