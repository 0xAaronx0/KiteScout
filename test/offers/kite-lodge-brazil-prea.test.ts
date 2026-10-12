// Kite Lodge Brazil (Preá): replays the English pages recorded 2026-10-12 (script/style/svg bodies dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kiteLodgeBrazilPrea, buildKlSlots, parseKlCourses, parseKlPriceBasis, parseKlUnits,
} from '../../src/offers/adapters/kite-lodge-brazil-prea.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-lodge-brazil-prea');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const accommodations = read('kitelodgebrasil.com_accommodations_.');

test('kite-lodge: unit cards with size, guests, bedrooms and from-price', () => {
  assert.deepEqual(parseKlUnits(accommodations).map(u => [u.name, u.sizeM2, u.maxPersons, u.bedrooms, u.fromPrice, u.currency]), [
    ['Mar', 31, 3, 1, 690, 'BRL'], ['Superior', 31, 3, 1, 570, 'BRL'], ['Bougainvillea', 32, 3, 1, 570, 'BRL'],
    ['Bougainvillea Rosa', 36, 3, 1, 570, 'BRL'], ['Ocean', 46, 4, 2, 830, 'BRL'], ['Garden', 47, 4, 2, 690, 'BRL'],
    ['Coco', 26, 2, 1, 690, 'BRL'], ['Sunset', 41, 4, 2, 690, 'BRL'],
  ]);
  assert.equal(parseKlUnits(accommodations)[1].url, 'https://kitelodgebrasil.com/accommodations/superior/');
});

test('kite-lodge: price basis note and course tables', () => {
  assert.deepEqual(parseKlPriceBasis(read('kitelodgebrasil.com_accommodations_mar_.')), { persons: 2, breakfast: true });
  assert.deepEqual(parseKlCourses(read('kitelodgebrasil.com_kite-school-prices_.')), [
    { course: 'Semi private course', fromPrice: 450, hours: '2h' },
    { course: 'Private course', fromPrice: 1020, hours: '3h' },
  ]);
});

test('kite-lodge: slots = unit from-price, no dates, availability unknown', async () => {
  const slots = await kiteLodgeBrazilPrea.fetchSlots(ctx);
  assert.deepEqual(slots, buildKlSlots(parseKlUnits(accommodations), 2));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price]), [
    ['mar', 'Mar', 690], ['superior', 'Superior', 570], ['bougainvillea', 'Bougainvillea', 570], ['bougainvillea-rosa', 'Bougainvillea Rosa', 570],
    ['ocean', 'Ocean', 830], ['garden', 'Garden', 690], ['coco', 'Coco', 690], ['sunset', 'Sunset', 690],
  ]);
  assert.ok(slots.every(s => s.currency === 'BRL' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.occupancy === 2
    && s.availability === 'unknown' && s.startDate === null && s.endDate === null));
});

test('kite-lodge: content', async () => {
  const c = await kiteLodgeBrazilPrea.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kite Lodge Brazil');
  assert.deepEqual([c.country, c.region, c.spot, c.mealPlan], ['Brazil', 'Ceará', 'Preá', 'breakfast']);
  assert.match(c.summary, /own kite school with a launch and landing service/);
  assert.match(c.summary, /from R\$ 570 to R\$ 830 per night for two persons with breakfast/);
  assert.match(c.summary, /reliable wind from June to January/);
  assert.equal(c.rooms.length, 8);
  assert.ok(c.rooms[4].features.includes('From R$ 830 per night for 2 persons incl. breakfast'));
  assert.ok(c.optionalServices.includes('Private kite course (1 student per instructor) with radio helmet: 1 day (3h) R$ 1,020'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => !/logo|\.png|Element-|best-rates/i.test(u)));
  assert.ok(!c.imageUrls.some(u => /-1024x\d+\.jpg$/.test(u)), 'originals instead of resized copies');
  assert.equal(kiteLodgeBrazilPrea.confidence, 'medium');
});
