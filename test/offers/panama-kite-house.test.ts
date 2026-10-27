// Panama Kite House & Villa: replays the Squarespace pages recorded 2026-10-09 (rider-experience page
// trimmed of style/script blocks the parser does not read).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  panamaKiteHouse, buildPkhSlots, parsePkhRooms, parsePkhSeason,
} from '../../src/offers/adapters/panama-kite-house.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/panama-kite-house');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('pkh: kite house price tables (incl. the malformed single-column ones)', () => {
  const rooms = parsePkhRooms(read('www.panamakitehouse.com_kitehouse.'));
  assert.deepEqual(rooms.map(r => [r.name, r.prices.map(p => [p.persons, p.amount, p.currency, p.from])]), [
    ['Premium seaview Cabin', [[1, 875, 'USD', true], [2, 1175, 'USD', true]]],
    ['BIG Seaview Cabin', [[1, 775, 'USD', true], [2, 1075, 'USD', true]]],
    ['Small Seaview Cabin', [[1, 650, 'USD', true], [2, 950, 'USD', true]]],
    ['Single Room', [[1, 550, 'USD', true]]],
    ['Glamping Tent', [[1, 425, 'USD', true], [2, 725, 'USD', true]]],
    ['Dorm Room', [[1, 375, 'USD', true]]],
    ['Quadruple Room / OverFlow Dorm', [[1, 525, 'USD', true], [2, 825, 'USD', true], [3, 1125, 'USD', true], [4, 1425, 'USD', true]]],
  ]);
  assert.deepEqual(rooms[0].features, ['Queen size Bed | Table inside', 'Modern Private Bathroom with hot water', 'Terrace & Hammock', 'A/C & WIFI']);
});

test('pkh: villa tables with extra-day rows', () => {
  const villa = parsePkhRooms(read('www.panamakitehouse.com_the-kitesurfers-villa.'), 'Villa ');
  assert.deepEqual(villa.map(r => r.name), ['Villa Premium Double', 'Villa Double', 'Villa Premium Tent', 'Villa King + Single or Triple']);
  assert.deepEqual(villa[0].prices.map(p => [p.persons, p.amount, p.from]), [[1, 800, false], [2, 950, false]]);
  assert.deepEqual(villa[0].extraDay, [{ persons: 1, amount: 160 }, { persons: 2, amount: 190 }]);
});

test('pkh: season bands from the calendar script', () => {
  const s = parsePkhSeason(read('www.panamakitehouse.com_book-now-overview.'))!;
  assert.equal(s.start, '2026-12-01');
  assert.equal(s.end, '2027-04-30');
  assert.deepEqual(s.bands.map(b => b.season), ['shoulder', 'high', 'shoulder']);
  // fallback: header years + "December to April"
  assert.deepEqual(parsePkhSeason('<h3>Panama Season Calendar 2027 / 2028</h3><p>windy season runs from December to April</p>'),
    { start: '2027-12-01', end: '2028-04-30', bands: [] });
});

test('pkh: slots = room x guests for the season, 5-day package, unknown availability', async () => {
  const slots = await panamaKiteHouse.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 23); // kite house 7 cards (14 prices) + villa 4 cards (9 prices)
  const cabin = slots.find(s => s.key === 'premium-seaview-cabin-2p|2026-27')!;
  assert.deepEqual([cabin.startDate, cabin.endDate, cabin.unit, cabin.price, cabin.currency, cabin.priceUnit, cabin.priceBasis, cabin.occupancy, cabin.availability],
    ['2026-12-01', '2027-04-30', 'Premium seaview Cabin', 1175, 'USD', 'package', 'room', 2, 'unknown']);
  assert.equal(slots.find(s => s.key === 'dorm-room-1p|2026-27')!.priceBasis, 'person');
  assert.equal(slots.find(s => s.key === 'villa-king-single-or-triple-3p|2026-27')!.price, 825);
  assert.deepEqual(slots, buildPkhSlots([
    ...parsePkhRooms(read('www.panamakitehouse.com_kitehouse.')),
    ...parsePkhRooms(read('www.panamakitehouse.com_the-kitesurfers-villa.'), 'Villa '),
  ], parsePkhSeason(read('www.panamakitehouse.com_book-now-overview.'))!));
});

test('pkh: content', async () => {
  const c = await panamaKiteHouse.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Panama Kite House & Villa');
  assert.equal(c.country, 'Panama');
  assert.equal(c.continent, 'North America');
  assert.equal(c.spot, 'Punta Chame');
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /December to April with a minimum stay of 5 nights/);
  assert.equal(c.rooms.length, 11);
  assert.ok(c.rooms.find(r => r.name === 'Villa Double')!.features.includes('2 guests: extra day +$135'));
  assert.equal(c.heroVideoUrl, null); // YouTube trailer only (audit 2026-10-27)
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://') && /squarespace/.test(u) && !/screenshot|untitled|logo/i.test(u)));
});
