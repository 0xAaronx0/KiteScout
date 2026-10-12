// Mer & Sel Villa & Suites (JT Pro Center, Union Island): replays the two kitesurfgrenadines.com pages recorded
// 2026-10-12 (script/style bodies trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  merEtSelUnionIsland, buildMesSlots, mesBands, mesEditDate, mesRoomLists, parseMesRates,
} from '../../src/offers/adapters/mer-et-sel-union-island.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { todayIso } from '../../src/offers/parse.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/mer-et-sel-union-island');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const hotel = read('www.kitesurfgrenadines.com_hotel-union-island_.');

test('mer-et-sel: rate table = season x unit, USD per night', () => {
  const rates = parseMesRates(hotel);
  assert.equal(rates.length, 12);
  assert.deepEqual(rates.filter(r => r.season === 'November 20th to April 14th').map(r => [r.unit, r.amount, r.currency]), [
    ['2 Bedroom Villa', 990, 'USD'], ['Private Mayreau View Suite', 295, 'USD'], ['Cozy Room', 195, 'USD'],
  ]);
  assert.deepEqual(rates.find(r => r.season === 'August 1st to October 31st' && r.unit === 'Cozy Room')!.amount, 120);
});

test('mer-et-sel: year-less seasons anchored on the page edit (2026-08-11)', () => {
  assert.equal(mesEditDate(hotel), '2026-08-11');
  assert.deepEqual(mesBands(parseMesRates(hotel), '2026-08-11').map(b => [b.start, b.end]), [
    ['2026-08-01', '2026-10-31'], ['2026-11-01', '2026-11-19'], ['2026-11-20', '2027-04-14'], ['2027-04-15', '2027-07-31'],
  ]);
  // an edit in the high season starts the cycle in the previous year's November
  assert.deepEqual(mesBands(parseMesRates(hotel), '2027-02-01').map(b => b.start), ['2026-11-20', '2027-04-15', '2027-08-01', '2027-11-01']);
});

test('mer-et-sel: slots = 3 units x 4 bands, on request; past bands dropped', async () => {
  const slots = buildMesSlots(parseMesRates(hotel), '2026-08-11', '2026-10-12');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 12);
  const v = slots.find(s => s.key === '2-bedroom-villa|2026-11-20')!;
  assert.deepEqual([v.startDate, v.endDate, v.unit, v.price, v.currency, v.priceUnit, v.priceBasis, v.availability],
    ['2026-11-20', '2027-04-14', '2 Bedroom Villa', 990, 'USD', 'per_night', 'room', 'on_request']);
  assert.equal(Math.min(...slots.map(s => s.price!)), 120);
  assert.equal(buildMesSlots(parseMesRates(hotel), '2026-08-11', '2026-11-05').length, 9);
  assert.deepEqual(await merEtSelUnionIsland.fetchSlots(ctx), buildMesSlots(parseMesRates(hotel), '2026-08-11', todayIso()));
});

test('mer-et-sel: room tick lists', () => {
  const lists = mesRoomLists(hotel);
  assert.equal(lists[0].title, 'Luxury Mer et Sel Villa with Tobago Cays Views');
  assert.equal(lists[0].items[0], 'Two very large air-conditioned king bedrooms');
  assert.ok(lists[1].items.includes('Each suite is 305 sq ft, or 28 m²'));
});

test('mer-et-sel: content', async () => {
  const c = await merEtSelUnionIsland.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Mer & Sel Villa & Suites (JT Pro Center)');
  assert.equal(c.country, 'Saint Vincent and the Grenadines');
  assert.equal(c.spot, 'Union Island');
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /villa USD 550-990, suite USD 190-295, cozy room USD 120-195/);
  assert.match(c.summary, /mid November to July/);
  assert.deepEqual(c.rooms.map(r => r.name), ['2 Bedroom Villa', 'Private Mayreau View Suite', 'Cozy Room']);
  assert.ok(c.optionalServices.includes('Golf cart rental US$60 per day, scooter/moped US$40 per day (villa and suite guests)'));
  assert.ok(c.includedServices.some(s => /launch fee/.test(s)));
  assert.ok(c.imageUrls.length >= 15);
  assert.ok(c.imageUrls.every(u => !/logo|\.png$/i.test(u)));
});
