// Lakeside Paradise Sport Hostel (Knokke-Heist): replays the English pages + Surfers Paradise home recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  lakesideParadiseSportHostelKnokkeHeist as lp, buildLpSlots, parseLpFacilities, parseLpRates,
} from '../../src/offers/adapters/lakeside-paradise-sport-hostel-knokke-heist.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/lakeside-paradise-sport-hostel-knokke-heist');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('lakeside: rate table (EUR per bed per night)', () => {
  assert.deepEqual(parseLpRates(read('www.lakesideparadise.be_en_sports-hostel_rates_.')).map(r => [r.beds, r.price]), [[12, 25], [8, 29], [4, 39]]);
});

test('lakeside: facility table', () => {
  const f = parseLpFacilities(read('www.lakesideparadise.be_en_sports-hostel_accommodation_.'));
  assert.deepEqual(f.roomsBySize, { 4: 2, 8: 6, 12: 2 });
  assert.equal(f.rooms, 10);
  assert.equal(f.beds, 64);
  assert.equal(f.distances['Surfers Paradise'], '5 km');
  assert.equal(f.distances['Beach & North Sea'], '1 km');
  assert.equal(f.themes.length, 10);
});

test('lakeside: slots = one undated slot per room size', async () => {
  const slots = await lp.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots, buildLpSlots([{ beds: 12, price: 25 }, { beds: 8, price: 29 }, { beds: 4, price: 39 }]));
  assert.deepEqual(slots.map(s => [s.key, s.unit, s.price]), [
    ['dorm-12-beds', '12-bed room (bunk beds)', 25], ['dorm-8-beds', '8-bed room (bunk beds)', 29], ['dorm-4-beds', '4-bed room (bunk beds)', 39],
  ]);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'person'
    && s.availability === 'unknown' && s.startDate === null && s.endDate === null));
});

test('lakeside: content says honestly where the kiting happens', async () => {
  const c = await lp.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Lakeside Paradise Sport Hostel');
  assert.equal(c.country, 'Belgium');
  assert.equal(c.region, 'Knokke-Heist, West Flanders');
  assert.equal(c.spotCoords, undefined);
  assert.match(c.summary, /The hostel has no kite school of its own: the same club runs the Surfers Paradise water sports center with a kitesurf center on the beach of Knokke-Heist, about 5 km away/);
  assert.match(c.summary, /10 rooms with bunk beds for 4, 8 or 12 people \(64 beds\)/);
  assert.match(c.summary, /EUR 25 to 39 per night/);
  assert.equal(c.kiteLessons, true);
  assert.deepEqual(c.rooms.map(r => r.name), ['12-bed room (bunk beds)', '8-bed room (bunk beds)', '4-bed room (bunk beds)']);
  assert.equal(c.rooms[1].description, '6 rooms with 8 beds, each themed after a surf spot.');
  assert.ok(c.optionalServices.some(s => /^Kitesurfing at Surfers Paradise/.test(s)));
  assert.ok(!/BE\d{2} \d{4}/.test(c.sourceText ?? ''), 'no bank details in sourceText');
  assert.ok(c.imageUrls.length >= 8 && c.imageUrls.every(u => !/travelmyth|no-pets|\.svg|logo/i.test(u)));
});
