// Punta Trettu Kitesurf House (Sardinia): replays the pages recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  puntaTrettuKitesurfHouseSardinia, buildPtkSlots, parseMonthRange, parsePtkTables, parsePuntaTrettuContent, seasonBand,
} from '../../src/offers/adapters/punta-trettu-kitesurf-house-sardinia.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/punta-trettu-kitesurf-house-sardinia');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const prices = read('puntatrettukitesurfhouse.com_prices_.');

test('ptk: low + high season tables (rooms used x stay length)', () => {
  const t = parsePtkTables(prices);
  assert.deepEqual(t.map(x => [x.season, x.startMonth, x.endMonth, x.monthsLabel]), [['low', 9, 6, 'from September to June'], ['high', 7, 8, 'July and August']]);
  assert.deepEqual(t[0].columns.map(c => [c.rooms, c.persons]), [[1, 2], [2, 4], [3, 6], [4, 8], [4, 10]]);
  assert.deepEqual(t[0].rows.map(r => [r.code, r.minNights, r.prices]), [
    ['KV-L5', 5, [270, 295, 320, 345, 370]], ['KV-L7', 7, [245, 270, 295, 320, 345]], ['KV-L9', 9, [220, 245, 270, 295, 320]],
  ]);
  assert.deepEqual(t[1].rows.map(r => [r.code, r.prices[0], r.prices[4]]), [['KV-H5', 400, 500], ['KV-H7', 375, 475], ['KV-H9', 350, 450]]);
  assert.equal(t[0].rows[1].nightsLabel, '7 or 8 nights'); // the page says "7 ore 8 nights"
});

test('ptk: season bands = next occurrence of the month range', () => {
  assert.deepEqual(parseMonthRange('(from September to June)'), { startMonth: 9, endMonth: 6 });
  assert.deepEqual(seasonBand(9, 6, '2026-10-12'), { start: '2026-09-01', end: '2027-06-30', label: '2026-27' });
  assert.deepEqual(seasonBand(7, 8, '2026-10-12'), { start: '2027-07-01', end: '2027-08-31', label: '2027' });
  assert.deepEqual(seasonBand(9, 6, '2027-07-20'), { start: '2027-09-01', end: '2028-06-30', label: '2027-28' });
  assert.deepEqual(seasonBand(7, 8, '2027-08-31'), { start: '2027-07-01', end: '2027-08-31', label: '2027' });
});

test('ptk: slots = rooms used x season at the 5-night rate, whole villa, on request', () => {
  const slots = buildPtkSlots(parsePtkTables(prices), '2026-10-12');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 10);
  assert.deepEqual(ok.map(s => [s.key, s.startDate, s.endDate, s.price, s.occupancy]).filter((_, i) => i === 0 || i === 9), [
    ['1-room-2p|low|2026-27', '2026-09-01', '2027-06-30', 270, 2],
    ['4-rooms-10p|high|2027', '2027-07-01', '2027-08-31', 500, 10],
  ]);
  assert.ok(ok.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'group'
    && s.availability === 'on_request' && s.minNights === 5 && s.datePrecision === 'month'));
});

test('ptk: fetchSlots replays /prices/', async () => {
  const slots = await puntaTrettuKitesurfHouseSardinia.fetchSlots(ctx);
  assert.equal(slots.length, 10);
  assert.equal(Math.min(...slots.map(s => s.price!)), 270);
});

test('ptk: content', () => {
  const c = parsePuntaTrettuContent({ home: read('puntatrettukitesurfhouse.com_.'), prices, rooms: read('puntatrettukitesurfhouse.com_punta-trettu-rooms_.') }, '2026-10-12');
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Punta Trettu Kitesurf House');
  assert.equal(c.country, 'Italy');
  assert.equal(c.region, 'Sardinia');
  assert.equal(c.spot, 'Punta Trettu');
  assert.equal(c.mealPlan, 'self_catering');
  assert.match(c.summary, /4 independent suites/);
  assert.match(c.summary, /from EUR 220 to 500 .*\(minimum 5 nights\)/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Entire villa (exclusive use)', 'Independent suite']);
  assert.ok(c.rooms[0].features.includes('High season (July and August), 2 rooms (up to 4 people): 5 nights EUR 425 / 7 nights EUR 400 / 9 or more nights EUR 375 per night'));
  assert.ok(c.rooms[0].features.some(f => /cleaning fee is €100/.test(f)));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://puntatrettukitesurfhouse.com/wp-content/uploads/') && !/logo|favicon|-\d+x\d+\./i.test(u)));
});
