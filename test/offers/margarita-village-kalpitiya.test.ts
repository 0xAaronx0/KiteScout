// Margarita Village (Kalpitiya, Sri Lanka): replays the own site's English pages recorded 2026-10-12 (trimmed:
// script/style bodies dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  margaritaVillageKalpitiya, buildMvSlots, parseMvCoords, parseMvRates, parseMvServices,
} from '../../src/offers/adapters/margarita-village-kalpitiya.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/margarita-village-kalpitiya');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const prices = read('www.margarita-village.com_prices_.');

test('mv: bungalow rates per occupancy (EUR per person per night, B&B)', () => {
  assert.deepEqual(parseMvRates(prices).map(r => [r.label, r.persons, r.price]), [
    ['Single occupancy', 1, 45], ['Double occupancy', 2, 20], ['Triple occupancy', 3, 18],
  ]);
});

test('mv: camp services and add-ons', () => {
  const { included, addOns } = parseMvServices(prices);
  assert.equal(included.length, 6);
  assert.ok(included.includes('Boat transfers to the lagoon'));
  assert.ok(addOns.includes('Bike rental: EUR 3 per day'));
  assert.ok(addOns.includes('Lunch at the beach hut: EUR 5.50 per person'));
  assert.ok(addOns.includes('Kite lessons at Margarita Kite School: from EUR 50 per hour'));
  assert.ok(addOns.includes('Full IKO beginner course: from EUR 270'));
});

test('mv: map pin from the home page Google Maps embed', () => {
  assert.deepEqual(parseMvCoords(read('www.margarita-village.com_.')), { lat: 8.23315390008622, lng: 79.74558152042265 });
});

test('mv: slots = one per occupancy, on request, no dates', async () => {
  const slots = await margaritaVillageKalpitiya.fetchSlots(ctx);
  assert.deepEqual(slots, buildMvSlots(parseMvRates(prices)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.occupancy]), [
    ['bungalow-1p', 'Wooden bungalow', 45, 1], ['bungalow-2p', 'Wooden bungalow', 20, 2], ['bungalow-3p', 'Wooden bungalow', 18, 3],
  ]);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'person'
    && s.availability === 'on_request' && s.startDate === null && s.endDate === null));
});

test('mv: content', async () => {
  const c = await margaritaVillageKalpitiya.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Margarita Village');
  assert.equal(c.country, 'Sri Lanka');
  assert.equal(c.spot, 'Kalpitiya');
  assert.equal(c.mealPlan, 'breakfast');
  assert.match(c.summary, /5 rustic wooden bungalows with open-air showers/);
  assert.match(c.summary, /EUR 18 to 45 a night/);
  assert.match(c.summary, /wind seasons run mid-May to mid-October and mid-December to mid-March/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Wooden bungalow']);
  assert.deepEqual(c.skillLevels, ['beginner', 'intermediate', 'advanced']);
  assert.equal(c.kiteLessons, true);
  assert.ok(c.imageUrls.length >= 15);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://www.margarita-village.com/wp-content/uploads/') && !/logo|cropped-/i.test(u)));
});
