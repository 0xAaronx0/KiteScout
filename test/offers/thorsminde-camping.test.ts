// Thorsminde Camping: replays the English content pages and the Danish price page recorded 2026-10-14
// (scripts / styles / srcsets dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  thorsmindeCamping, buildTmcSlots, fetchTmcSlots, parseTmcCabins, parseTmcPrices,
} from '../../src/offers/adapters/thorsminde-camping.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/thorsminde-camping');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const prices = read('thorsmindecamping.dk_priser_.');

test('tmc: 2026 cabin prices, opening and season bands', () => {
  const p = parseTmcPrices(prices);
  assert.equal(p.year, 2026);
  assert.deepEqual([p.open, p.close], ['2026-03-27', '2026-10-18']);
  assert.equal(p.printedHigh, '27/6-18/10'); // overlaps the low season; the pitch-fee line 27/6-16/8 is used
  assert.deepEqual(p.bands, [
    { season: 'low', start: '2026-03-27', end: '2026-06-26' },
    { season: 'high', start: '2026-06-27', end: '2026-08-16' },
    { season: 'low', start: '2026-08-17', end: '2026-10-17' },
  ]);
  assert.deepEqual(p.rates.map(r => [r.type, r.season, r.night, r.week]), [
    ['fiskehytte', 'low', 450, 3150], ['familiehytte', 'low', 740, 5180], ['enghytte', 'low', 790, 5530],
    ['fiskehytte', 'high', 550, 3850], ['familiehytte', 'high', 890, 6230], ['enghytte', 'high', 990, 6930],
  ]);
  assert.deepEqual(p.cleaning, { fiskehytte: 300, familiehytte: 500, enghytte: 500 });
});

test('tmc: slots = cabin type x future band, DKK per night', async () => {
  const slots = await fetchTmcSlots('2026-10-14');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.unit, s.startDate, s.endDate, s.price, s.priceUnit, s.availability]), [
    ['fiskehytte|2026-08-17', 'Fishing hut (2 people)', '2026-08-17', '2026-10-17', 450, 'per_night', 'unknown'],
    ['familiehytte|2026-08-17', 'Family cabin (4-6 people)', '2026-08-17', '2026-10-17', 740, 'per_night', 'unknown'],
    ['enghytte|2026-08-17', 'Meadow cabin (6 people)', '2026-08-17', '2026-10-17', 790, 'per_night', 'unknown'],
  ]);
  assert.equal(buildTmcSlots(parseTmcPrices(prices), '2026-04-01').length, 9);
  assert.deepEqual(buildTmcSlots(parseTmcPrices(prices), '2026-10-18'), []);
});

test('tmc: cabins and content', async () => {
  assert.deepEqual(parseTmcCabins(read('thorsmindecamping.dk_en_cabins_.')).map(c => c.name), [
    'Meadow cabins with toilet and shower', 'Family cabin with toilet and shower', 'Fishing cabin with shared toilet and shower',
  ]);
  const c = await thorsmindeCamping.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.region, 'Thorsminde, West Jutland');
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /seven-day VDWS beginner courses at the campsite/);
  assert.match(c.summary, /2026 prices run from DKK 450 to 990 per night/);
  assert.ok(c.rooms[0].features.includes('2026 high season: DKK 990 per night, DKK 6,930 per week'));
  assert.ok(c.optionalServices.includes('Kite day pass for non-guests DKK 75'));
  assert.match(c.sourceText ?? '', /school https:\/\/thorsminde-kiten\.com\//);
  assert.ok(c.imageUrls.length >= 8 && c.imageUrls.every(u => !/ACSI|DK-CAMP|logo/i.test(u)));
});
