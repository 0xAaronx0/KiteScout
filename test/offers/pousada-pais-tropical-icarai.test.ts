// Pousada País Tropical (Icaraí de Amontada): replays the English pages recorded 2026-10-12 (script/style bodies
// trimmed, JSON-LD kept).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pousadaPaisTropicalIcarai, parsePtLodging, parsePtRooms, ptVisiblePrices,
} from '../../src/offers/adapters/pousada-pais-tropical-icarai.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/pousada-pais-tropical-icarai');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const rooms = read('pais-tropical.com_en_accommodations.');

test('pais tropical: 4 room types with features and photos', () => {
  const r = parsePtRooms(rooms);
  assert.deepEqual(r.map(x => x.name), ['Garden Room', 'Garden Suite', 'Family Suite (Duplex)', 'Superior Suite']);
  assert.deepEqual(r[1].features, ['1 Queen bed', 'Air conditioning', 'Hammock veranda', '2–3 guests']);
  assert.equal(r[0].photo, 'https://pais-tropical.com/_astro/15082025-DSCF1167.EqxxhSl0_jcM89.webp'); // 1000w variant
});

test('pais tropical: LodgingBusiness JSON-LD (rooms, geo, priceRange kept out of slots)', () => {
  assert.deepEqual(parsePtLodging(rooms), {
    rooms: 15, lat: -3.0250829, lng: -39.6546235, priceRange: 'R$400–R$700', email: 'info@pais-tropical.com',
    phone: '+55 88 98120-3056', checkin: '14:00', checkout: '12:00',
  });
  assert.deepEqual(ptVisiblePrices(rooms), []);
});

test('pais tropical: no published room price -> no slots', async () => {
  const notes: string[] = [];
  const slots = await pousadaPaisTropicalIcarai.fetchSlots({ note: n => notes.push(n), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
});

test('pais tropical: content', async () => {
  const c = await pousadaPaisTropicalIcarai.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Pousada País Tropical');
  assert.deepEqual([c.country, c.region, c.spot, c.mealPlan], ['Brazil', 'Icaraí de Amontada, Ceará', 'Icaraí de Amontada', 'breakfast']);
  assert.deepEqual(c.spotCoords, { lat: -3.0250829, lng: -39.6546235 });
  assert.match(c.summary, /15 rooms in the village of Icaraizinho .* about 190 km from Fortaleza, 50 m from the beach/);
  assert.match(c.summary, /IKO and ABK certified instructors/);
  assert.match(c.summary, /from July to January/);
  // the room facts in sentence 2 come from the home page FAQ
  assert.match(read('pais-tropical.com_en_.'), /All accommodation has air conditioning, a private bathroom, a mini-fridge, Wi-Fi and a balcony with a hammock/);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.deepEqual(c.languages, ['pt', 'en', 'fr', 'es']);
  assert.ok(c.optionalServices.includes('Kite and wing equipment rental (ION, Duotone, North, Ozone and F-One) at Cabana do Kite'));
  assert.equal(c.rooms.length, 4);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://pais-tropical.com/_astro/') && !/maya/.test(u)));
  assert.match(c.sourceText!, /priceRange R\$400–R\$700 \(no unit\/dates: not used as a slot\)/);
  assert.equal(pousadaPaisTropicalIcarai.confidence, 'low');
});
