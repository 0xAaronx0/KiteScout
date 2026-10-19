// Road 2 Adventure Kite Safari Perth to Exmouth: replays the product page recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildR2aSlots, fetchR2aSlots, parseR2aContent, parseR2aDepartures, r2aCurrency, road2adventureKiteSafariPerthExmouth,
} from '../../src/offers/adapters/road2adventure-kite-safari-perth-exmouth.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/road2adventure-kite-safari-perth-exmouth');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('road2adventure: departures from the shop variations', () => {
  const d = parseR2aDepartures(html);
  assert.deepEqual(d.map(x => [x.start, x.end, x.route, x.variation.price]), [
    ['2025-12-20', '2026-01-02', 'perth-exmouth-perth', 2800],
    ['2025-12-20', '2025-12-28', 'perth-to-exmouth', 2200],
    ['2026-01-10', '2026-01-23', 'perth-exmouth-perth', 2800],
    ['2026-01-10', '2026-01-18', 'perth-to-exmouth', 2200],
  ]);
  assert.equal(r2aCurrency(html), 'AUD');
});

test('road2adventure: all printed departures are past -> no slots', async () => {
  assert.deepEqual(await fetchR2aSlots('2026-10-19', ctx), []);
});

test('road2adventure: the parser keeps future departures once the shop lists them', () => {
  const { ok, problems } = checkSlots(buildR2aSlots(parseR2aDepartures(html), 'AUD', '2025-12-01'));
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 4);
  assert.deepEqual(ok.slice(0, 2).map(s => [s.key, s.price, s.availability]), [
    ['2025-12-20|return', 2800, 'available'],
    ['2025-12-20|one-way', 2200, 'available'],
  ]);
});

test('road2adventure: content is a valid tour, summary says no new dates yet', async () => {
  const c = parseR2aContent(html, '2026-10-19');
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'tour');
  assert.equal(c.durationDays, 9);
  assert.deepEqual(c.itinerarySpots.map(s => s.name), ['Perth', 'Lancelin', 'Coronation Beach', 'Shark Bay', 'Gnaraloo', 'Exmouth']);
  assert.match(c.summary, /next dates are not published yet \(last: December 2025 and January 2026\)/);
  assert.match(c.summary, /AUD 2,200/);
  assert.equal(contentProblem(await road2adventureKiteSafariPerthExmouth.fetchContent(ctx)), null);
  assert.ok(c.imageUrls.length >= 20);
});
