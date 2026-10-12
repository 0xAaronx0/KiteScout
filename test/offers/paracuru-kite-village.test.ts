// Paracuru Kite Village: replays the Portuguese pages recorded 2026-10-12 (script bodies trimmed, style bodies cut down
// to their background-image URLs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  paracuruKiteVillage, featureEn, parsePkvIncluded, parsePkvUnits, pkvVisiblePrices,
} from '../../src/offers/adapters/paracuru-kite-village.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/paracuru-kite-village');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const rooms = read('paracurukitevillage.com.br_acomodacoes_.');

test('paracuru: 4 unit categories = 16 units, features translated', () => {
  const u = parsePkvUnits(rooms);
  assert.deepEqual(u.map(x => [x.count, x.name]), [[1, 'Garden Suite VIP'], [6, 'Chalet Suite'], [6, 'Standard Room'], [3, 'Dunas Suite']]);
  assert.equal(u.reduce((n, x) => n + x.count, 0), 16);
  assert.deepEqual(u[2].features, ['Fan', 'Hot shower', 'Shared veranda', 'Upper floor', 'Up to 3 guests']);
  assert.equal(featureEn('TV LED 40″ SKY'), '40" LED TV (Sky)');
  assert.equal(featureEn('Capacidade Máxima: 4 Pessoas'), 'Up to 4 guests');
});

test('paracuru: included in every rate (incl. the kite gear area)', () => {
  assert.deepEqual(parsePkvIncluded(rooms), [
    'Breakfast (varied menu)', 'Wi-Fi', 'Pool', 'Parking (subject to availability)', '24-hour security', 'TV and video room',
    'Area to clean, maintain and repair kite equipment',
  ]);
  assert.deepEqual(pkvVisiblePrices(rooms), []);
});

test('paracuru: no published price -> no slots', async () => {
  const notes: string[] = [];
  const slots = await paracuruKiteVillage.fetchSlots({ note: n => notes.push(n), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
});

test('paracuru: content', async () => {
  const c = await paracuruKiteVillage.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Paracuru Kite Village');
  assert.deepEqual([c.country, c.region, c.spot, c.spotCoords, c.mealPlan], ['Brazil', 'Paracuru, Ceará', 'Paracuru', null, 'breakfast']);
  assert.match(c.summary, /16 units on a 2,500 m2 plot/);
  assert.match(c.summary, /1 Garden Suite VIP, 6 Chalet Suites, 6 Standard Rooms and 3 Dunas Suites for 2 to 4 guests/);
  assert.match(c.summary, /arranges IKO lessons, downwinders and kite trips; the wind blows 20 to 30 knots from July to February/);
  const sentences = c.summary.split(/(?<=\.)\s+(?=[A-Z])/);
  assert.ok(sentences.length >= 2 && sentences.length <= 4, `${sentences.length} sentences`);
  assert.deepEqual(c.languages, ['pt', 'en', 'es']);
  assert.equal(c.rooms.length, 4);
  assert.match(c.sourceText!, /check-in 14h, check-out 12h/);
  assert.ok(c.imageUrls.length >= 8);
  assert.ok(c.imageUrls.includes('https://paracurukitevillage.com.br/wp-content/uploads/2020/06/GARDEN.jpg'));
  assert.ok(c.imageUrls.every(u => u.startsWith('https://paracurukitevillage.com.br/wp-content/uploads/') && !/_960_720|\/by-|avatar/.test(u)));
  assert.equal(paracuruKiteVillage.confidence, 'low');
});
