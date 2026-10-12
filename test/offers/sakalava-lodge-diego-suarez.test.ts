// Sakalava Lodge (Madagascar): replays the English pages of sakalava.com recorded 2026-10-12 (fixtures
// trimmed: script/style bodies dropped except the budget simulator script that holds the season limits).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  sakalavaLodgeDiegoSuarez, buildSkSlots, parseSkBungalows, parseSkRates, parseSkSeason,
} from '../../src/offers/adapters/sakalava-lodge-diego-suarez.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/sakalava-lodge-diego-suarez');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const ratesHtml = read('sakalava.com_en_tarifs-sakalava_.');

test('sakalava: 2027 rate lists (3 nights / 1 week) incl. add-ons', () => {
  assert.deepEqual(parseSkRates(ratesHtml).map(r => [r.nights, r.label, r.amount]), [
    [3, '1 PERSON KITESURFING', 680], [3, '2 PEOPLE KITESURFING', 1165], [3, '2 PEOPLE, 1 KITESURFING AND 1 WITHOUT KITESURFING', 865],
    [3, 'ADDITIONAL ADULT KITESURFING PACKAGE', 565], [3, 'ADDITIONAL ADULT - PACKAGE WITHOUT KITESURFING', 310], [3, 'CHILDREN UNDER 12', 110],
    [7, '1 PERSON KITESURFING', 1400], [7, '2 PEOPLE KITESURFING', 2400], [7, '2 PEOPLE, 1 KITESURFING AND 1 WITHOUT KITESURFING', 1850],
    [7, 'ADDITIONAL ADULT KITESURFING PACKAGE', 1050], [7, 'ADDITIONAL ADULT - PACKAGE WITHOUT KITESURFING', 700], [7, 'CHILDREN UNDER 12', 275],
  ]);
});

test('sakalava: season limits and minimum stay from the budget simulator', () => {
  assert.deepEqual(parseSkSeason(ratesHtml), { start: '2027-04-01', end: '2027-11-30', minNights: 3 });
});

test('sakalava: slots = bungalow composition x package length, 2027 season, on request', async () => {
  const slots = await sakalavaLodgeDiegoSuarez.fetchSlots(ctx);
  assert.deepEqual(slots, buildSkSlots(parseSkRates(ratesHtml), parseSkSeason(ratesHtml)!));
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.occupancy, s.packageNights]), [
    ['bungalow-1p-kite|3n|2027', 680, 1, 3], ['bungalow-2p-kite|3n|2027', 1165, 2, 3], ['bungalow-2p-1kite|3n|2027', 865, 2, 3],
    ['bungalow-1p-kite|7n|2027', 1400, 1, 7], ['bungalow-2p-kite|7n|2027', 2400, 2, 7], ['bungalow-2p-1kite|7n|2027', 1850, 2, 7],
  ]);
  assert.ok(slots.every(s => s.startDate === '2027-04-01' && s.endDate === '2027-11-30' && s.currency === 'EUR'
    && s.priceUnit === 'package' && s.priceBasis === 'room' && s.availability === 'on_request' && s.minNights === 3));
});

test('sakalava: bungalow types', () => {
  const rooms = parseSkBungalows(read('sakalava.com_en_culture-sakalava_bungalows_.'));
  assert.deepEqual(rooms.map(r => r.name), ['Triple Bungalow', 'Family Bungalow', 'Family XL', 'Bridal suite']);
  assert.deepEqual(rooms[0].features, ['35m²', '1 to 3 pers.']);
});

test('sakalava: content', async () => {
  const c = await sakalavaLodgeDiegoSuarez.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Sakalava Lodge');
  assert.equal(c.country, 'Madagascar');
  assert.deepEqual(c.spotCoords, { lat: -12.27645, lng: 49.39364 });
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /10 bungalows facing the lagoon \(at most 15 guests\)/);
  assert.match(c.summary, /EUR 680 for 3 nights/);
  assert.match(c.summary, /8 IKO instructors/);
  assert.ok(c.rooms[0].features.includes('7 nights: children under 12 +EUR 275'));
  assert.ok(c.imageUrls.length >= 15);
  assert.ok(c.imageUrls.every(u => !/logo|cropped-|-\d+x\d+\./i.test(u)));
});
