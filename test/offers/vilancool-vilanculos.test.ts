// VilanCool (Vilanculos, Mozambique): replays the Wix home and kite-school pages recorded 2026-10-12 (fixtures trimmed:
// script/style bodies dropped). Slots = the five villas' "from N$ per night" prices, on request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vilancoolVilanculos, buildVcSlots, parseVcCourses, parseVcUnits } from '../../src/offers/adapters/vilancool-vilanculos.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/vilancool-vilanculos');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const home = read('www.vilancool.com_.');

test('vc: villa tabs (name, max guests, from-price)', () => {
  assert.deepEqual(parseVcUnits(home).map(u => [u.name, u.maxGuests, u.fromUsd]), [
    ['Flying Turtle', 4, 99], ['Waving Manta', 4, 129], ['Sleeping Dugong', 6, 176], ['Dancing Flamingo', 2, 89], ['Smiling Dolphin', 4, 89],
  ]);
  assert.match(parseVcUnits(home)[1].description ?? '', /2 bedrooms with air condition/);
});

test('vc: slots', async () => {
  const slots = await vilancoolVilanculos.fetchSlots(ctx);
  assert.deepEqual(slots, buildVcSlots(parseVcUnits(home)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.occupancy]), [
    ['flying-turtle', 99, 4], ['waving-manta', 129, 4], ['sleeping-dugong', 176, 6], ['dancing-flamingo', 89, 2], ['smiling-dolphin', 89, 4],
  ]);
  assert.ok(ok.every(s => s.currency === 'USD' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.availability === 'on_request' && s.startDate === null));
});

test('vc: IKO course list', () => {
  const courses = parseVcCourses(read('www.vilancool.com_kitesurfing-mozambique.'));
  assert.equal(courses.length, 8);
  assert.deepEqual(courses[0], { name: 'IKO Level 1 - Discovery (2 hrs)', usd: 90 });
  assert.ok(courses.some(c => /Kiteclub Package/.test(c.name) && c.usd === 350));
});

test('vc: content', async () => {
  const c = await vilancoolVilanculos.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'VilanCool Beach Resort & Kite School');
  assert.equal(c.country, 'Mozambique');
  assert.equal(c.spot, 'Vilanculos');
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /from 89 to 176 US dollars per night/);
  assert.equal(c.rooms.length, 5);
  assert.equal(c.imageUrls.length, 9);
  assert.ok(c.imageUrls.every(u => /^https:\/\/static\.wixstatic\.com\/media\/[^/]+~mv2[^/]*\.jpe?g$/.test(u)));
});
