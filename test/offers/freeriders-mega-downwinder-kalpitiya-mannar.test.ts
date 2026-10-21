// Freerider's Kite Tours Mega Downwinder Kalpitiya to Mannar: replays /node/5 recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildFrSlots, freeridersMegaDownwinderKalpitiyaMannar, frIsLive, parseFrTour,
} from '../../src/offers/adapters/freeriders-mega-downwinder-kalpitiya-mannar.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/freeriders-mega-downwinder-kalpitiya-mannar');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('freeriders: trip facts from the page (despite the PHP notices)', () => {
  const t = parseFrTour(html);
  assert.ok(frIsLive(t));
  assert.deepEqual([t.price, t.currency, t.days, t.distanceKm, t.dayKm, t.season, t.group], [250, 'EUR', 2, 135, [85, 45], 'June to September', { min: 4, max: 10 }]);
  assert.ok(t.provide.includes('All Meals, snacks and refreshments'));
  assert.ok(!/Deprecated function/.test(t.text), 'PHP notices are outside the product block');
});

test('freeriders: one undated slot, EUR 250 per person; a page without the product is not live', async () => {
  const slots = await freeridersMegaDownwinderKalpitiyaMannar.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 1);
  assert.deepEqual([ok[0].price, ok[0].currency, ok[0].priceUnit, ok[0].packageNights, ok[0].availability], [250, 'EUR', 'package', 1, 'on_request']);
  const gone = parseFrTour('<html><body><p>Error message</p><p>Page not found</p></body></html>');
  assert.equal(frIsLive(gone), false);
  assert.deepEqual(buildFrSlots(gone), []);
});

test('freeriders: content is a valid 2-day tour with three route stops', async () => {
  const c = await freeridersMegaDownwinderKalpitiyaMannar.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'tour');
  assert.equal(c.durationDays, 2);
  assert.deepEqual(c.itinerarySpots.map(s => [s.order, s.name, s.region]), [
    [1, 'Dutch Bay', 'North Western Province'], [2, 'Jungle beach camp', 'Northern Province'], [3, 'Mannar', 'Northern Province'],
  ]);
  assert.equal(c.imageUrls.length, 7);
  assert.ok(!c.imageUrls.some(u => /\/img\/|tourmap/i.test(u)), 'icons, logo and route map are skipped');
});
