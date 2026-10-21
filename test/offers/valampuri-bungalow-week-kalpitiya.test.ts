// Valampuri bungalow week kite package: replays /rates-offers/ and /gallery/ recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildValBwSlots, parseValBwCard, parseValBwRow, valampuriBungalowWeekKalpitiya } from '../../src/offers/adapters/valampuri-bungalow-week-kalpitiya.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/valampuri-bungalow-week-kalpitiya');
process.env.OFFERS_FIXTURE_DIR = DIR;
const rates = readFileSync(join(DIR, 'www.valampuriresort.com_rates-offers_.0e115942.txt'), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('valampuri bungalow week: comparison-table row and offer card', () => {
  const row = parseValBwRow(rates)!;
  assert.deepEqual([row.name, row.nights, row.accommodation, row.kite, row.price, row.currency], [
    'Independent Rider Bungalow Week', 5, 'Air-conditioned bungalow', '6-hour private lesson course', 590, 'EUR',
  ]);
  assert.equal(parseValBwCard(rates)?.facts.Certification, 'IKO certificate');
});

test('valampuri bungalow week: the old research name still matches', () => {
  const html = '<table><tr><td>Full Week Bungalow Package</td><td>7</td><td>Bungalow</td><td>Lessons</td><td>€640 pp</td></tr></table>';
  assert.equal(parseValBwRow(html)?.price, 640);
  assert.equal(parseValBwRow('<table><tr><td>Nomad Extended Stay</td><td>10</td><td>x</td><td>y</td><td>€250 pp</td></tr></table>'), null);
});

test('valampuri bungalow week: one undated slot, EUR 590 per person, 5 nights', async () => {
  const slots = await valampuriBungalowWeekKalpitiya.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 1);
  assert.deepEqual([ok[0].price, ok[0].currency, ok[0].priceBasis, ok[0].packageNights, ok[0].availability], [590, 'EUR', 'person', 5, 'on_request']);
  assert.deepEqual(buildValBwSlots({ ...parseValBwRow(rates)!, price: null }), []);
});

test('valampuri bungalow week: content is a valid 6-day camp', async () => {
  const c = await valampuriBungalowWeekKalpitiya.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 6);
  assert.equal(c.mealPlan, 'half_board');
  assert.ok(c.spotCoords && Math.abs(c.spotCoords.lat - 8.249) < 0.01);
  assert.ok(c.imageUrls.length >= 6 && c.imageUrls.length <= 12);
  assert.ok(!c.imageUrls.some(u => /logo|brand|dorm/i.test(u)));
});
