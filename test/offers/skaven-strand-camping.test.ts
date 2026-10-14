// Skaven Strand Camping: replays the Danish site pages recorded 2026-10-14 (scripts / styles / srcsets dropped, so three
// CSS background photos of the live pages are not in the replayed image list).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  skavenStrandCamping, buildSscSlots, fetchSscSlots, parseSscOpening, parseSscPrices, sscBands,
} from '../../src/offers/adapters/skaven-strand-camping.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/skaven-strand-camping');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const prices = parseSscPrices(read('skaven.dk_priser_.'));
const open = parseSscOpening(read('skaven.dk_.'));

test('ssc: cabin table, main-season periods, opening and autumn end', () => {
  assert.deepEqual(prices.cabin2, { mainDay: 450, mainWeek: 2600, otherDay: 400, otherWeek: 2400 });
  assert.equal(prices.luxury.day, 700);
  assert.deepEqual(prices.mainPeriods, [
    { start: '2026-03-28', end: '2026-04-06' }, { start: '2026-05-14', end: '2026-05-17' },
    { start: '2026-05-23', end: '2026-05-26' }, { start: '2026-06-27', end: '2026-08-16' },
  ]);
  assert.equal(prices.autumnEnd, '2026-10-24');
  assert.equal(open, '2026-03-28');
  const bands = sscBands(open!, '2026-10-23', prices.mainPeriods);
  assert.equal(bands.length, 8);
  assert.deepEqual(bands[1], { season: 'other', start: '2026-04-07', end: '2026-05-13' });
  assert.deepEqual(bands[7], { season: 'other', start: '2026-08-17', end: '2026-10-23' });
});

test('ssc: slots = future bands, DKK per cabin per night', async () => {
  const slots = await fetchSscSlots('2026-10-14');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.unit, s.startDate, s.endDate, s.price, s.priceUnit, s.availability]), [
    ['cabin-2p|2026-08-17', 'Camping cabin for 2', '2026-08-17', '2026-10-23', 400, 'per_night', 'unknown'],
    ['luxury-cabin|2026-03-28', 'Luxury cabin (35 m², 6 people)', '2026-03-28', '2026-10-23', 700, 'per_night', 'unknown'],
  ]);
  assert.equal(buildSscSlots(prices, open, '2026-03-01').length, 9);
  assert.deepEqual(buildSscSlots(prices, open, '2026-10-24'), []);
});

test('ssc: content', async () => {
  const c = await skavenStrandCamping.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.region, 'Skaven Strand, West Jutland');
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /about 250 units directly on the beach of Ringkøbing Fjord/);
  assert.match(c.summary, /one of the best surf and kite areas in Northern Europe/);
  assert.ok(c.rooms[1].features.includes('Package: Weeks 27,28,29,30,31,32,33 4900 DKK'));
  assert.match(c.sourceText ?? '', /Mulighed for undervisning og introduktion til kitesurfing/);
  assert.ok(c.imageUrls.length >= 8 && c.imageUrls.every(u => u.startsWith('https://skaven.dk/wp-content/uploads/') && !/logo/.test(u)));
});
