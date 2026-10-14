// Cascade Kiteboarding Maui Winter Camp: replays the camp page recorded 2026-10-14.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cascadeKiteboardingMauiWinterCamp, buildCkSlots, parseCkCamp,
} from '../../src/offers/adapters/cascade-kiteboarding-maui-winter-camp.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { todayIso } from '../../src/offers/parse.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/cascade-kiteboarding-maui-winter-camp');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const html = readFileSync(join(DIR, files.find(f => f.startsWith('www.cascadekiteboarding.com_new-page-3.'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('cascade-maui: camp facts from the page', () => {
  const c = parseCkCamp(html);
  assert.equal(c.heading, 'Maui, Hawaii - Winter 2026');
  assert.deepEqual(c.weeks.map(w => [w.start, w.end]), [['2026-12-13', '2026-12-19']]);
  assert.equal(c.price, 5000);
  assert.equal(c.secondGuest, 1000);
  assert.equal(c.nights, 6);
  assert.equal(c.currency, 'USD');
  assert.match(c.reserveUrl ?? '', /^https:\/\/app\.acuityscheduling\.com\/catalog\.php\?owner=19868404&/);
  assert.ok(c.included.includes('Two Professional chef-prepared meals provided daily'));
});

test('cascade-maui: one dated week, USD per private room, availability unknown', async () => {
  const c = parseCkCamp(html);
  const slots = buildCkSlots(c, '2026-10-14');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.startDate, s.endDate, s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.availability]), [
    ['private-room|2026-12-13', '2026-12-13', '2026-12-19', 5000, 'USD', 'package', 'room', 1, 'unknown'],
  ]);
  assert.deepEqual(buildCkSlots(c, '2026-12-20'), []);   // past weeks are dropped
  assert.deepEqual(await cascadeKiteboardingMauiWinterCamp.fetchSlots(ctx), buildCkSlots(c, todayIso()));
});

test('cascade-maui: content', async () => {
  const c = await cascadeKiteboardingMauiWinterCamp.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 7);
  assert.equal(c.country, 'United States');
  assert.equal(c.region, 'Maui, Hawaii');
  assert.equal(c.mealPlan, 'half_board');
  assert.equal(c.spotCoords, null);
  assert.match(c.summary, /December 13th - December 19th, 2026/);
  assert.doesNotMatch(c.summary, /[–—]/);
  assert.ok(c.rooms[0].features.includes('second guest in the same room +USD 1,000'));
  assert.equal(c.imageUrls.length, 3);
  assert.ok(c.imageUrls.every(u => !/CenterID|logo/i.test(u)));
});
