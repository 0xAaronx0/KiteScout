// Kitesurf Tofo (Praia do Tofo, Mozambique): replays the accommodation, lessons and home pages recorded 2026-10-12
// (fixtures trimmed: script/style bodies dropped). Slots = the three room cards, MZN per night, booked by WhatsApp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kitesurfTofo, buildKstSlots, kstCoords, parseKstRooms } from '../../src/offers/adapters/kitesurf-tofo.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitesurf-tofo');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const stay = read('kitesurftofo.com_accommodation-tofo-mozambique-hostel-kitesurfing-stay-with-us_.');

test('kst: room cards with MZN prices', () => {
  assert.deepEqual(parseKstRooms(stay).map(r => [r.name, r.amount, r.perPerson]), [
    ['Bunk bed', 700, true], ['Queen bed room', 1800, false], ['King bed room', 2800, false],
  ]);
});

test('kst: slots = one per room, no dates, on request', async () => {
  const slots = await kitesurfTofo.fetchSlots(ctx);
  assert.deepEqual(slots, buildKstSlots(parseKstRooms(stay)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.priceBasis, s.occupancy]), [
    ['bunk-bed', 700, 'person', 1], ['queen-bed-room', 1800, 'room', 2], ['king-bed-room', 2800, 'room', 2],
  ]);
  assert.ok(ok.every(s => s.currency === 'MZN' && s.priceUnit === 'per_night' && s.availability === 'on_request' && s.startDate === null));
});

test('kst: map pin from the home page embed', () => {
  assert.deepEqual(kstCoords(read('kitesurftofo.com_.')), { lat: -23.85585, lng: 35.54758 });
});

test('kst: content', async () => {
  const c = await kitesurfTofo.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kitesurf Tofo');
  assert.equal(c.country, 'Mozambique');
  assert.equal(c.spot, 'Praia do Tofo');
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /700 meticais per person per night/);
  assert.match(c.summary, /IKO/);
  assert.ok(c.optionalServices.includes('IKO complete course, 9 hours: 320 USD per person'));
  assert.deepEqual(c.rooms.map(r => r.name), ['Bunk bed', 'Queen bed room', 'King bed room']);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /kitesurftofo\.com\/wp-content\/uploads\//.test(u) && !/logo|starlink|-\d+x\d+\./.test(u)));
});
