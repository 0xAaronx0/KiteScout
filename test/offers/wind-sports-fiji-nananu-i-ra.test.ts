// Wind Sports Fiji (Nananu-i-Ra, Fiji): replays the Squarespace pages recorded 2026-10-12 (fixtures trimmed:
// script/style bodies dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  windSportsFijiNananuIRa, buildWsfSlots, parseWsfSeason, parseWsfUnits,
} from '../../src/offers/adapters/wind-sports-fiji-nananu-i-ra.js';
import { todayIso } from '../../src/offers/parse.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/wind-sports-fiji-nananu-i-ra');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const book = read('windsportsfiji.com_book-now.');
const stay = read('windsportsfiji.com_stay.');

test('wsf: 2026 season from the booking page', () => {
  const s = parseWsfSeason(book)!;
  assert.deepEqual([s.start, s.end], ['2026-04-04', '2026-11-07']);
});

test('wsf: accommodation types with weekly prices per person (AUD from the page context)', () => {
  assert.deepEqual(parseWsfUnits(stay).map(u => [u.name, u.price, u.currency, u.rooms.length]), [
    ['Beachfront Bures', 3595, 'AUD', 3], ['Shared Seaview mango LODGES', 2595, 'AUD', 2],
  ]);
});

test('wsf: slots = type x season, 7-night package per person, on request; none after the season', async () => {
  const units = parseWsfUnits(stay);
  const season = parseWsfSeason(book)!;
  const slots = buildWsfSlots(units, season, '2026-10-12');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.startDate, s.endDate]), [
    ['beachfront-bures|2026', 3595, '2026-04-04', '2026-11-07'], ['shared-seaview-mango-lodges|2026', 2595, '2026-04-04', '2026-11-07'],
  ]);
  assert.ok(slots.every(s => s.currency === 'AUD' && s.priceUnit === 'package' && s.packageNights === 7 && s.minNights === 7
    && s.priceBasis === 'person' && s.availability === 'on_request'));
  assert.deepEqual(buildWsfSlots(units, season, '2026-11-08'), []);
  assert.deepEqual(await windSportsFijiNananuIRa.fetchSlots(ctx), buildWsfSlots(units, season, todayIso()));
});

test('wsf: content', async () => {
  const c = await windSportsFijiNananuIRa.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Wind Sports Fiji');
  assert.equal(c.country, 'Fiji');
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /from AUD 2,595 per person/);
  assert.match(c.summary, /the 2026 season runs from 2026-04-04 to 2026-11-07/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Beachfront bure', 'Shared seaview Mango Lodge']);
  assert.ok(c.optionalServices.includes('Kite gear hire: AUD 150 per day / AUD 700 per week'));
  assert.ok(c.includedServices.some(s => /^Dedicated Boat Support:/.test(s)));
  assert.equal(c.imageUrls.length, 30);
});
