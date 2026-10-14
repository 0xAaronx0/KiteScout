// Floras Lake House By The Sea (Langlois, Oregon): replays the pages recorded 2026-10-14.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  florasLakeHouseLanglois, buildFlSlots, parseFlBands, parseFlRooms, parseFlYear, sqsCurrency, sqsSitePin,
} from '../../src/offers/adapters/floras-lake-house-langlois.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/floras-lake-house-langlois');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const rates = read('floraslake.com_rooms-rates.');

test('floras: band text with and without the end month', () => {
  assert.deepEqual(parseFlBands('April 15-May 22: $ 260 May 23-Sept 14: $ 310 Sept 15-30: $ 285', 2026).map(b => [b.start, b.end, b.price]), [
    ['2026-04-15', '2026-05-22', 260], ['2026-05-23', '2026-09-14', 310], ['2026-09-15', '2026-09-30', 285],
  ]);
  assert.equal(parseFlBands('Sept 15-30 $ 310', 2026)[0].end, '2026-09-30');
});

test('floras: 2026 table = 4 rooms x 3 season bands, USD from the store setting', () => {
  assert.equal(parseFlYear(rates), 2026);
  assert.equal(sqsCurrency(rates), 'USD');
  const rooms = parseFlRooms(rates);
  assert.deepEqual(rooms.map(r => [r.name, r.maxPersons, r.bands.map(b => b.price)]), [
    ['North Room', 3, [285, 335, 310]],
    ['Nautical Room', 2, [260, 310, 285]],
    ['Garden Room', 2, [260, 310, 285]],
    ['South Room', 2, [285, 335, 310]],
  ]);
  assert.equal(rooms[0].extraPerson, 10);
  // as of a date inside the 2026 season every band is a valid slot
  const slots = buildFlSlots(rooms, 'USD', '2026-04-01');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 12);
  assert.deepEqual(ok.slice(0, 3).map(s => [s.key, s.startDate, s.endDate, s.price]), [
    ['north-room|2026-04-15', '2026-04-15', '2026-05-22', 285],
    ['north-room|2026-05-23', '2026-05-23', '2026-09-14', 335],
    ['north-room|2026-09-15', '2026-09-15', '2026-09-30', 310],
  ]);
  assert.ok(ok.every(s => s.currency === 'USD' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.availability === 'unknown'));
  // only bands that have not ended yet survive
  assert.deepEqual(buildFlSlots(rooms, 'USD', '2026-09-20').map(s => s.endDate), ['2026-09-30', '2026-09-30', '2026-09-30', '2026-09-30']);
});

test('floras: the 2026 season is over -> no slots ("price on request")', async () => {
  const notes: string[] = [];
  const slots = await florasLakeHouseLanglois.fetchSlots({ note: n => notes.push(n), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.match(notes[0], /2026 season bands are past/);
});

test('floras: content', async () => {
  const c = await florasLakeHouseLanglois.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Floras Lake House By The Sea');
  assert.equal(c.country, 'United States');
  assert.equal(c.region, 'Oregon Coast, Oregon');
  assert.deepEqual(c.spotCoords, { lat: 42.9029331, lng: -124.5008057 });
  assert.deepEqual(sqsSitePin(read('floraslake.com_.')), { lat: 42.9029331, lng: -124.5008057 });
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /kiteboarding, wing, foil and windsurfing at all levels/);
  assert.deepEqual(c.rooms.map(r => r.name), ['North Room', 'Nautical Room', 'Garden Room', 'South Room']);
  assert.ok(c.rooms[0].features.includes('12.75% state and county lodging taxes will be added to your total.'));
  assert.ok(c.imageUrls.length >= 20);
  assert.ok(c.imageUrls.every(u => /squarespace-cdn\.com\/content\/v1\//.test(u) && !/logo|screenshot|doodle/i.test(u)));
});
