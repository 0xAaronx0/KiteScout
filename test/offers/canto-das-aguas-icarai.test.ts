// Canto das Águas (Icaraí de Amontada): replays the English pages recorded 2026-10-12 (script/style bodies trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cantoDasAguasIcarai, caVisiblePrices, parseCaRooms } from '../../src/offers/adapters/canto-das-aguas-icarai.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/canto-das-aguas-icarai');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const rooms = read('www.cantodasaguas.com_en_rooms_.');

test('canto das aguas: 3 units with text and amenities (Portuguese amenities translated)', () => {
  const r = parseCaRooms(rooms);
  assert.deepEqual(r.map(x => x.name), ['Canto Mar', 'Canto Rio - 1st floor', 'Canto Rio - Ground floor']);
  assert.match(r[0].text, /^Casa Canto Mar has 5 bedrooms, 4 on the 1st floor and 1 on the ground floor\./);
  assert.deepEqual(r[0].amenities, ['1 Double bed', 'Air conditioning', 'Private bathroom', 'Sea view', 'TV', 'Wi-fi', 'Minibar']);
  assert.deepEqual(r[2].amenities, ['50 m²', '3 Bedrooms', 'Private bathroom', '1 Double bed', '1 Single bed', 'Wi-fi', 'Private Kitchen', 'Air conditioning', 'TV', 'Private balcony']);
  assert.deepEqual(caVisiblePrices(rooms), []);
});

test('canto das aguas: no published price -> no slots', async () => {
  const notes: string[] = [];
  const slots = await cantoDasAguasIcarai.fetchSlots({ note: n => notes.push(n), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
});

test('canto das aguas: content', async () => {
  const c = await cantoDasAguasIcarai.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Canto das Águas');
  assert.deepEqual([c.country, c.region, c.spot, c.spotCoords, c.mealPlan], ['Brazil', 'Icaraí de Amontada, Ceará', 'Icaraí de Amontada', null, null]);
  assert.match(c.summary, /Nacélio and his team have run it since 2011/);
  assert.match(c.summary, /Canto Mar house with 5 sea-view bedrooms and two Canto Rio apartments \(30 m2, 1st floor; 50 m2, ground floor, with kitchen and private balcony\)/);
  assert.match(c.summary, /own wing school, Icarai Wing Academy/);
  assert.match(c.summary, /strongest from August to November with an average above 25 knots/);
  const sentences = c.summary.split(/(?<=\.)\s+(?=[A-Z])/);
  assert.ok(sentences.length >= 2 && sentences.length <= 4, `${sentences.length} sentences`);
  assert.equal(c.kiteLessons, null);
  assert.equal(c.equipmentRental, true);
  assert.ok(c.includedServices.includes('Kite / wing / foil area with landing zone, compressor and gear storage'));
  assert.equal(c.rooms.length, 3);
  assert.ok(c.imageUrls.length >= 20);
  assert.ok(c.imageUrls.includes('https://www.cantodasaguas.com/wp-content/uploads/2026/04/deck.jpg'));
  assert.ok(c.imageUrls.every(u => u.startsWith('https://www.cantodasaguas.com/wp-content/uploads/') && /\.jpe?g$/.test(u) && !/ico|logo|thumbs/.test(u)));
  assert.equal(cantoDasAguasIcarai.confidence, 'low');
});
