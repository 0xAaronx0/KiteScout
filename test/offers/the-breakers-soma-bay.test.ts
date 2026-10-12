// The Breakers Diving & Surfing Lodge (Soma Bay): replays the English pages recorded 2026-10-12
// (script/style bodies trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  theBreakersSomaBay, buildTbSlots, parseTbRates, tbPolicies,
} from '../../src/offers/adapters/the-breakers-soma-bay.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/the-breakers-soma-bay');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const rooms = read('www.thebreakers-somabay.com_rooms_.');
const TODAY = '2026-10-12';

test('breakers: summer 2026 + winter 2026/27 rate tables', () => {
  const rates = parseTbRates(rooms);
  assert.equal(rates.length, 32); // 8 + 8 periods x single/double
  assert.deepEqual(rates.filter(r => r.unit === 'Double Room Sea View' && /Winter/.test(r.table)).map(r => [r.start, r.end, r.price]), [
    ['2026-11-01', '2026-12-02', 114], ['2026-12-03', '2026-12-12', 103], ['2026-12-13', '2026-12-21', 86],
    ['2026-12-22', '2027-01-06', 114], ['2027-01-07', '2027-02-10', 86], ['2027-02-11', '2027-03-09', 103],
    ['2027-03-10', '2027-04-04', 114], ['2027-04-05', '2027-04-30', 103], // "103,00 €" (comma) in the last row
  ]);
  assert.deepEqual(rates.find(r => r.unit === 'Single Room Sea View' && r.start === '2027-01-07')!.price, 100);
});

test('breakers: slots = column x period ahead of today, EUR per person per night, on request', () => {
  const slots = buildTbSlots(parseTbRates(rooms), TODAY);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 18); // 27.09.-31.10.2026 + 8 winter periods, x 2
  const d = slots.find(s => s.key === 'double-room-sea-view|2027-01-07')!;
  assert.deepEqual([d.startDate, d.endDate, d.unit, d.price, d.currency, d.priceUnit, d.priceBasis, d.occupancy, d.availability],
    ['2027-01-07', '2027-02-10', 'Double Room Sea View', 86, 'EUR', 'per_night', 'person', 2, 'on_request']);
  assert.equal(slots.find(s => s.key === 'single-room-sea-view|2026-09-27')!.price, 139);
  assert.equal(Math.min(...slots.map(s => s.price!)), 86);
  assert.ok(!slots.some(s => s.endDate! < TODAY));
});

test('breakers: fetchSlots reads the rooms page', async () => {
  const slots = await theBreakersSomaBay.fetchSlots(ctx);
  assert.ok(slots.length >= 16 && slots.every(s => s.currency === 'EUR'));
});

test('breakers: policies under the tables', () => {
  const p = tbPolicies(rooms);
  assert.equal(p.basis, 'All mentioned rates are on half board basis, per person per night.');
  assert.match(p.fees!, /Christmas \(24\.12\.2026\): 96\.00 € per person\. .*New Year’s Eve \(31\.12\.2026\): 154\.00 €/);
  assert.match(p.prepayment!, /prepayment of Euro 200,00 per room/);
});

test('breakers: content', async () => {
  const c = await theBreakersSomaBay.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'The Breakers Diving & Surfing Lodge');
  assert.equal(c.country, 'Egypt');
  assert.equal(c.spot, 'Soma Bay');
  assert.equal(c.mealPlan, 'half_board');
  assert.match(c.summary, /173-room watersport hotel in Soma Bay/);
  assert.match(c.summary, /7Bft KiteHouse, 8 minutes away by the hotel's free shuttle/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Double Room Sea View', 'Single Room Sea View', 'LifeStyle Room', 'XL LifeStyle Room']);
  assert.ok(c.rooms[0].features.includes('2027-01-07 to 2027-02-10: EUR 86 per person per night (half board)'));
  assert.ok(c.optionalServices.includes('Hurghada airport transfer (EUR 50,00 per way for one or two persons)'));
  assert.ok(c.optionalServices.includes('Kite equipment rental (120 kites, 60 boards)'));
  assert.deepEqual(c.languages, ['en', 'de']);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => !/logo|award|Klitschko|holiday-check|\/\d_/i.test(u)));
});
