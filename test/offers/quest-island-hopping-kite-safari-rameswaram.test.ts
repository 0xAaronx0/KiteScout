// Quest Island Hopping kite safari: replays /kitesurfing-tours recorded 2026-10-21 (scripts/styles trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildQuestSlots, fetchQuestSlots, findQuestTour, parseQuestTours, questImages, questIslandHoppingKiteSafariRameswaram,
} from '../../src/offers/adapters/quest-island-hopping-kite-safari-rameswaram.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/quest-island-hopping-kite-safari-rameswaram');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.includes('kitesurfing-tours'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('quest: three tour blocks with INR prices (Indian digit grouping)', () => {
  const tours = parseQuestTours(html);
  assert.deepEqual(tours.map(t => [t.name, t.days, t.price, t.currency, t.startEnd]), [
    ['Flat Water Bay', 3, 25000, 'INR', 'Rameswaram'],
    ['Island Hoping', 5, 50000, 'INR', 'Rameswaram'],
    ['Spice Coast Expedition', 14, 110000, 'INR', null],
  ]);
  assert.deepEqual(findQuestTour(tours, /island\s+hop+ing/i)?.includes.slice(0, 3), ['Kiteboarding guide', 'Trip leader', 'Safety gear']);
});

test('quest: island hopping slot', async () => {
  const slots = buildQuestSlots(findQuestTour(parseQuestTours(html), /island\s+hop+ing/i));
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.unit, s.price, s.currency, s.priceUnit, s.priceBasis, s.availability, s.startDate]),
    [['5-days', 'Island Hopping, 5 days', 50000, 'INR', 'package', 'person', 'on_request', null]]);
  assert.equal((await fetchQuestSlots(/island\s+hop+ing/i)).length, 1);
  await assert.rejects(fetchQuestSlots(/no such tour/i), /no longer on/);
});

test('quest: gallery photos without portrait, food, duplicates and logos', () => {
  const imgs = questImages(html);
  assert.equal(imgs.length, 12);
  assert.ok(!imgs.some(u => /VSP8L84H3EMQE3OKIZ83|5PB7DEWEE2UI7ZHD8RYW|logo|bigwave/i.test(u)));
  assert.equal(imgs.filter(u => /IMG_0352/.test(u)).length, 1);
});

test('quest: island hopping content', async () => {
  const c = await questIslandHoppingKiteSafariRameswaram.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['tour', 5, 'India', 'Tamil Nadu', 'Rameswaram']);
  assert.deepEqual(c.itinerarySpots.map(s => s.name), ['Rameswaram']);
  assert.match(c.summary, /starts and ends in Rameswaram/);
  assert.match(c.summary, /INR 50,000 \(per person, inferred\)/);
  assert.doesNotMatch(c.summary, /[–—]/);
});
