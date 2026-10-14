// Bork Havn Camping: replays the Danish site pages recorded 2026-10-14 (scripts / styles / srcsets dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  borkHavnCamping, buildBhcSlots, fetchBhcSlots, parseBhcCabins, parseBhcPin, parseBhcPrices,
} from '../../src/offers/adapters/bork-havn-camping.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/bork-havn-camping');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const prices = read('www.borkhavncamping.dk_priser-hytter_.');

test('bhc: 2026 cabin price table with season bands', () => {
  const p = parseBhcPrices(prices);
  assert.equal(p.year, 2026);
  assert.deepEqual(p.bands, [
    { season: 'low', start: '2026-03-25', end: '2026-06-27' },
    { season: 'high', start: '2026-06-28', end: '2026-08-08' },
    { season: 'low', start: '2026-08-09', end: '2026-10-17' },
  ]);
  assert.deepEqual(p.rates, [
    { persons: 2, season: 'low', night: 450, week: 2850 }, { persons: 5, season: 'low', night: 550, week: 3550 },
    { persons: 2, season: 'high', night: 550, week: 3550 }, { persons: 5, season: 'high', night: 650, week: 4250 },
  ]);
  assert.equal(p.cleaning, 250);
  assert.equal(p.linen, 80);
});

test('bhc: slots = cabin type x future band, DKK per night', async () => {
  const slots = await fetchBhcSlots('2026-10-14');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.startDate, s.endDate, s.price, s.priceUnit, s.minNights, s.availability]), [
    ['cabin-2p|2026-08-09', '2026-08-09', '2026-10-17', 450, 'per_night', 2, 'unknown'],
    ['cabin-5p|2026-08-09', '2026-08-09', '2026-10-17', 550, 'per_night', 2, 'unknown'],
  ]);
  assert.equal(buildBhcSlots(parseBhcPrices(prices), '2026-05-01').length, 6);
  assert.deepEqual(buildBhcSlots(parseBhcPrices(prices), '2026-10-19'), []); // season over, 2027 not published
});

test('bhc: cabins, pin and content', async () => {
  const cabins = parseBhcCabins(read('www.borkhavncamping.dk_hytter_.'));
  assert.deepEqual(cabins.map(c => c.persons), [5, 2]);
  assert.ok(cabins[0].features.includes('Shower in the service building about 40 m away'));
  assert.deepEqual(parseBhcPin(read('www.borkhavncamping.dk_.')), { lat: 55.84811, lng: 8.28069 });
  const c = await borkHavnCamping.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.region, 'Bork Havn, West Jutland');
  assert.match(c.summary, /150 m from the harbour and the surf beach/);
  assert.match(c.summary, /open 25 March to 18 October 2026/);
  assert.match(c.summary, /one of the best kite and windsurf areas in Northern Europe/);
  assert.ok(c.rooms[1].features.includes('2026 low season: DKK 450 per night, DKK 2,850 per week'));
  assert.ok(c.imageUrls.length >= 10 && c.imageUrls.every(u => !/-\d+x\d+\.|LAG|Medfinansieret|Logo/.test(u)));
  assert.match(c.sourceText ?? '', /Windsurfing\/ kitesurfing\/ paddleboard/);
});
