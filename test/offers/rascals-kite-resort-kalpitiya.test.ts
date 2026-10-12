// The Rascals Kite Resort (Kalpitiya): replays the Wix pages recorded 2026-10-12 (fixtures trimmed:
// script/style bodies dropped, JSON-LD kept, the Wix video token redacted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  rascalsKiteResortKalpitiya, buildRkSlots, parseRkRooms, rkImages,
} from '../../src/offers/adapters/rascals-kite-resort-kalpitiya.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/rascals-kite-resort-kalpitiya');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const roomsHtml = read('www.rascalskiteresort.com_rooms.');

test('rascals: rate blocks are matched to the right room type', () => {
  const rooms = parseRkRooms(roomsHtml);
  assert.deepEqual(rooms.map(r => [r.name, r.rates.map(x => [x.occupancy, x.amount, x.currency])]), [
    ['Oyster Room', [[1, 90, 'EUR'], [2, 130, 'EUR']]],
    ['Tropical Cabana', [[1, 96, 'EUR'], [2, 136, 'EUR']]], // "Triple Occupancy: N/A" skipped
    ['Jungalow', [[1, 120, 'EUR'], [2, 160, 'EUR'], [3, 200, 'EUR']]],
  ]);
  assert.deepEqual(rooms[1].features, ['Air-Conditioned', 'Pool and garden view', 'Outdoor bathroom', 'Private relaxing area']);
  assert.equal(rooms[0].ratesNote, 'Prices below include breakfast, lunch and dinner');
});

test('rascals: slots = room x occupancy, EUR per room per night, on request, no dates', async () => {
  const slots = await rascalsKiteResortKalpitiya.fetchSlots(ctx);
  assert.deepEqual(slots, buildRkSlots(parseRkRooms(roomsHtml)));
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price]), [
    ['oyster-room-1p', 90], ['oyster-room-2p', 130], ['tropical-cabana-1p', 96], ['tropical-cabana-2p', 136],
    ['jungalow-1p', 120], ['jungalow-2p', 160], ['jungalow-3p', 200],
  ]);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'on_request' && s.startDate === null && s.endDate === null));
});

test('rascals: Wix images = owner photos at original size, no PNG graphics', () => {
  const imgs = rkImages(read('www.rascalskiteresort.com_kite.'));
  assert.ok(imgs.length >= 5);
  assert.ok(imgs.every(u => /^https:\/\/static\.wixstatic\.com\/media\/c24c9d_[0-9a-f]{32}~mv2\.(jpe?g|webp)$/.test(u)));
});

test('rascals: content', async () => {
  const c = await rascalsKiteResortKalpitiya.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'The Rascals Kite Resort');
  assert.equal(c.country, 'Sri Lanka');
  assert.deepEqual(c.spotCoords, { lat: 8.259215, lng: 79.765256 });
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /11 rooms .* \(5 Tropical Cabanas, 4 Oyster Rooms, 2 Jungalows\)/);
  assert.match(c.summary, /from EUR 90 to 200 per room/);
  assert.match(c.summary, /Duotone Pro Center \(over 4000 students taught\)/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Oyster Room', 'Tropical Cabana', 'Jungalow']);
  assert.ok(c.optionalServices.some(s => /80 EUR for a van/.test(s)));
  assert.ok(c.imageUrls.length >= 8);
  assert.ok(!c.imageUrls.some(u => u.includes('e3d0ce853f274ba29f1e99e8287cf0eb'))); // logo (LocalBusiness image)
  assert.match(c.sourceText ?? '', /home video uploaded 2026-10-11/);
});
