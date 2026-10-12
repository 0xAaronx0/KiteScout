// Ruuk Village (Kalpitiya): replays the ruukvillage.com pages recorded 2026-10-12 (fixtures trimmed:
// script/style bodies dropped, the JSON-LD kept).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ruukVillageKalpitiya, buildRvSlots, parseRvFullBoard, parseRvTypes,
} from '../../src/offers/adapters/ruuk-village-kalpitiya.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/ruuk-village-kalpitiya');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('ruuk: cabana types with B&B price hints (EUR | USD)', () => {
  const types = parseRvTypes(read('ruukvillage.com_sri-lanka-eco-friendly-accommodation.'));
  assert.deepEqual(types.map(t => [t.name, t.bb, t.bbUsd]), [
    ['Wooden Chalet', 58, 69], ['Garden Cabana', 38, 45], ['Superior Wooden Cabana', 38, 45], ["Fisherman's Cabin", 23, 28], ['VW Surfer Van', null, null],
  ]);
});

test('ruuk: full-board pages (two wordings of double / single rates)', () => {
  assert.deepEqual(parseRvFullBoard(read('ruukvillage.com_no-worries-package-kalpitiya.'), 'W', 'wadiya'), { unit: 'W', slug: 'wadiya', double: 41.25, single: 54 });
  assert.deepEqual(parseRvFullBoard(read('ruukvillage.com_no-worries-package-kalpitiya-junior-suite.'), 'E', 'ensuite'), { unit: 'E', slug: 'ensuite', double: 56, single: 71 });
});

test('ruuk: slots = B&B hints per type + full board per occupancy, EUR pp/night, on request, no dates', async () => {
  const slots = await ruukVillageKalpitiya.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.occupancy]), [
    ['wooden-chalet-bb', 58, 2], ['garden-cabana-bb', 38, 2], ['superior-wooden-cabana-bb', 38, 2], ['fishermans-cabin-bb', 23, 2],
    ['wadiya-full-board-2p', 41.25, 2], ['wadiya-full-board-1p', 54, 1], ['ensuite-full-board-2p', 56, 2], ['ensuite-full-board-1p', 71, 1],
  ]);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'person'
    && s.availability === 'on_request' && s.startDate === null && s.endDate === null));
  assert.equal(buildRvSlots([], []).length, 0);
});

test('ruuk: content', async () => {
  const c = await ruukVillageKalpitiya.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Ruuk Village');
  assert.equal(c.country, 'Sri Lanka');
  assert.equal(c.spot, 'Kalpitiya');
  assert.deepEqual(c.spotCoords, { lat: 8.244, lng: 79.739 });
  assert.match(c.summary, /about 10 wooden cabanas for at most 20 guests/);
  assert.match(c.summary, /full board from EUR 41.25 per person per night/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Wooden Chalet', 'Garden Cabana', 'Superior Wooden Cabana', "Fisherman's Cabin", 'VW Surfer Van', 'Ensuite cabana']);
  assert.ok(c.optionalServices.some(s => /8 days \/ 7 nights, EUR 740 per person/.test(s)));
  assert.ok(c.optionalServices.some(s => /group from EUR 80 per person, private from EUR 100/.test(s)));
  assert.ok(c.imageUrls.length >= 15);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://images.squarespace-cdn.com/content/') && !/logo|\.png/i.test(u)));
  assert.ok(!c.imageUrls.some(u => /booking\.com|airbnb/i.test(u)));
});
