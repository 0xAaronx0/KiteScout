// Expeditions Unlimited, South to North crossing of Greenland by snowkite: replays the product page recorded 2026-10-19
// (scripts except JSON-LD, styles and SVGs trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  expeditionsUnlimitedGreenlandSnowkiteCrossing, buildEugSlots, eugImages, parseEugContent, parseEugDepartures, parseEugTrip,
} from '../../src/offers/adapters/expeditions-unlimited-greenland-snowkite-crossing.js';
import { todayIso } from '../../src/offers/parse.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/expeditions-unlimited-greenland-snowkite-crossing');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith('www.expeditions-unlimited.com_en_expeditions_'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('greenland: trip facts from the JSON-LD TouristTrip', () => {
  const t = parseEugTrip(html);
  assert.equal(t.durationDays, 35);
  assert.equal(t.groupSize, 'De 2 à 3 participants');
  assert.equal(t.productId, 'EXU01397');
  assert.equal(t.days.length, 28);
  assert.match(t.days[0], /ARRIVAL IN KANGERLUSSUAQ/);
});

test('greenland: departures from the JSON-LD offers', () => {
  assert.deepEqual(parseEugDepartures(html).map(d => [d.start, d.price, d.currency, d.availability]), [
    ['2027-04-25', 39000, 'EUR', 'available'],
    ['2028-04-24', 39000, 'EUR', 'available'],
  ]);
});

test('greenland: one slot per departure, 35 days, EUR per person; past departures dropped', () => {
  const deps = parseEugDepartures(html);
  const { ok, problems } = checkSlots(buildEugSlots(deps, 35, '2026-10-19'));
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.endDate, s.price, s.priceUnit, s.priceBasis]), [
    ['2027-04-25', '2027-05-29', 39000, 'package', 'person'],
    ['2028-04-24', '2028-05-28', 39000, 'package', 'person'],
  ]);
  assert.deepEqual(buildEugSlots(deps, 35, '2027-04-26').map(s => s.key), ['2028-04-24']);
});

test('greenland: adapter slots match the builder for today', async () => {
  assert.deepEqual(await expeditionsUnlimitedGreenlandSnowkiteCrossing.fetchSlots(ctx), buildEugSlots(parseEugDepartures(html), 35, todayIso()));
});

test('greenland: content (pinned date)', async () => {
  const c = parseEugContent(html, '2026-10-19');
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'tour');
  assert.equal(c.durationDays, 35);
  assert.deepEqual(c.itinerarySpots.map(s => s.name), ['Kangerlussuaq', 'Dye 2', 'Siorapaluk', 'Qaanaaq']);
  assert.match(c.summary, /Departures: 25 April 2027, 24 April 2028, from EUR 39,000 per person/);
  assert.equal(c.imageUrls[0], 'https://www.expeditions-unlimited.com/sites/default/files/imported/2024/EXU01397-01_0.jpg');
  assert.deepEqual(eugImages(html, 'EXU01397', null).every(u => /\/imported\/2024\/EXU01397-/.test(u)), true);
  assert.ok(c.imageUrls.length >= 20);
  assert.equal(contentProblem(await expeditionsUnlimitedGreenlandSnowkiteCrossing.fetchContent(ctx)), null);
});
