// Escape Eco Adventures Sri Lanka Kitesurfing Tour 2027: replays the Wix page recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEeTour } from '../../src/offers/adapters/escape-eco-fiji-kitesurf-tour-korolevu.js';
import { escapeEcoSriLankaKitesurfTourKalpitiya, fetchEeSriLankaSlots } from '../../src/offers/adapters/escape-eco-sri-lanka-kitesurf-tour-kalpitiya.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/escape-eco-sri-lanka-kitesurf-tour-kalpitiya');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('escape eco sri lanka: three September 2027 weeks, three rooms in AUD', () => {
  const t = parseEeTour(html);
  assert.deepEqual(t.weeks.map(w => [w.start, w.end]), [['2027-09-04', '2027-09-11'], ['2027-09-11', '2027-09-18'], ['2027-09-18', '2027-09-25']]);
  assert.deepEqual(t.rooms.map(r => [r.unit, r.price, r.occupancy]), [['Aircon twin share', 3895, 2], ['Aircon couples', 3895, 2], ['Aircon private room', 4295, 1]]);
  assert.equal(t.currency, 'AUD');
});

test('escape eco sri lanka: 3 weeks x 3 rooms; past weeks dropped', async () => {
  const slots = await fetchEeSriLankaSlots('2026-10-21', ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 9);
  assert.equal(Math.min(...ok.map(s => s.price!)), 3895);
  assert.ok(ok.every(s => s.currency === 'AUD' && s.priceUnit === 'package' && s.availability === 'on_request'));
  assert.equal((await fetchEeSriLankaSlots('2027-09-12', ctx)).length, 3);
});

test('escape eco sri lanka: content is a valid camp at The Rascals', async () => {
  const c = await escapeEcoSriLankaKitesurfTourKalpitiya.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 8);
  assert.equal(c.spot, 'Kalpitiya');
  assert.deepEqual(c.spotCoords, { lat: 8.259215, lng: 79.765256 });
  assert.match(c.summary, /The Rascals/);
  assert.ok(c.imageUrls.length >= 8);
  assert.ok(!c.imageUrls.some(u => /\.png$/i.test(u)), 'screenshots (png) are skipped');
});
