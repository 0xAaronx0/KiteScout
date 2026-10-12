// Villa Aloha (Praia de Patos): replays the English pages recorded 2026-10-12 (script/style bodies trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  villaAlohaPraiaDePatos, buildVaSlots, parseVaLesson, parseVaRates,
} from '../../src/offers/adapters/villa-aloha-praia-de-patos.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/villa-aloha-praia-de-patos');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const hotel = read('www.pousadavillaaloha.com_en_hotel-brazil_.');

test('villa aloha: price list = night with breakfast per occupancy', () => {
  assert.deepEqual(parseVaRates(hotel), [{ persons: 1, nightly: 300 }, { persons: 2, nightly: 400 }, { persons: 3, nightly: 480 }]);
  assert.equal(parseVaLesson(hotel), 'Group kite lesson (3 students max): BRL 280 per hour per person');
  // the same block is printed on the school page
  assert.deepEqual(parseVaRates(read('www.pousadavillaaloha.com_en_kitesurf-school_.')), parseVaRates(hotel));
});

test('villa aloha: slots = one per occupancy, BRL per bungalow per night, no dates, on request', async () => {
  const slots = await villaAlohaPraiaDePatos.fetchSlots(ctx);
  assert.deepEqual(slots, buildVaSlots(parseVaRates(hotel)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.occupancy]), [['bungalow-1p', 300, 1], ['bungalow-2p', 400, 2], ['bungalow-3p', 480, 3]]);
  assert.ok(slots.every(s => s.unit === 'Sea-view bungalow' && s.currency === 'BRL' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'on_request' && s.startDate === null && s.endDate === null));
});

test('villa aloha: content', async () => {
  const c = await villaAlohaPraiaDePatos.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Villa Aloha');
  assert.deepEqual([c.country, c.region, c.spot, c.mealPlan, c.spotCoords], ['Brazil', 'Praia de Patos, Ceará', 'Praia de Patos', 'breakfast', null]);
  assert.match(c.summary, /about 200 km north-west of Fortaleza/);
  assert.match(c.summary, /bungalows of 25 m2 for 2 or 3 people/);
  assert.match(c.summary, /BRL 300 to 480 per bungalow/);
  assert.match(c.summary, /20 to 30 knots from July to January/);
  const sentences = c.summary.split(/(?<=\.)\s+(?=[A-Z])/);
  assert.ok(sentences.length >= 2 && sentences.length <= 4, `${sentences.length} sentences`);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.ok(c.optionalServices.includes('Group kite lesson (3 students max): BRL 280 per hour per person'));
  assert.deepEqual(c.rooms.map(r => r.name), ['Sea-view bungalow']);
  assert.ok(c.rooms[0].features.includes('2 guests: BRL 400 per night with breakfast'));
  assert.ok(c.imageUrls.length >= 15);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://www.pousadavillaaloha.com/wp-content/uploads/') && /\.jpe?g$/.test(u) && !/-\d+x\d+\./.test(u)));
  assert.equal(villaAlohaPraiaDePatos.operator.contactEmail, 'contact@pousadavillaaloha.com');
});
