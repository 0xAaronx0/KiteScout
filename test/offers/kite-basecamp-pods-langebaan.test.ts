// Kite Basecamp PODS (Langebaan, South Africa): replays the one-page site recorded 2026-10-12 (fixture trimmed:
// script/style bodies dropped). Slots = the dated 2026/2027 ZAR rate table, per pod per night, on request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kiteBasecampPodsLangebaan, buildKbcSlots, kbcRange, parseKbcRates,
} from '../../src/offers/adapters/kite-basecamp-pods-langebaan.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-basecamp-pods-langebaan');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const html = readFileSync(join(DIR, files.find(f => f.startsWith('kitebasecamp.com_.'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('kbc: rate table rows (year cell spans its rows)', () => {
  const rates = parseKbcRates(html);
  assert.equal(rates.length, 14);
  assert.deepEqual(rates.slice(0, 3).map(r => [r.year, r.period, r.roomType, r.amount]), [
    [2026, 'PEAK', 'ALL', 1150], [2026, 'All Periods', 'Single', 550], [2026, 'All Periods', 'Double', 690],
  ]);
  assert.deepEqual(rates.filter(r => r.year === 2027).map(r => [r.period.replace(/[–—]/g, '-'), r.roomType, r.amount]), [
    ['PEAK', 'ALL', 1250], ['4 Jan - 30 Apr', 'Single', 600], ['4 Jan - 30 Apr', 'Double', 750],
    ['1 May till 30 Sep', 'Single', 480], ['1 May till 30 Sep', 'Double', 625],
    ['1 Oct - 17 Dec', 'Single', 600], ['1 Oct - 17 Dec', 'Double', 750],
  ]);
});

test('kbc: period ranges', () => {
  assert.deepEqual(kbcRange('1 May till 30 Sep', 2027), { start: '2027-05-01', end: '2027-09-30' });
  assert.deepEqual(kbcRange('1 Oct – 18 Dec', 2026), { start: '2026-10-01', end: '2026-12-18' });
  assert.equal(kbcRange('PEAK', 2026), null);
});

test('kbc: slots from 2026-10-12 (past periods dropped, peak = undated year-end days)', () => {
  const slots = buildKbcSlots(parseKbcRates(html), '2026-10-12');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.startDate, s.endDate, s.price, s.occupancy]), [
    ['pod-1p|2026-10-01', '2026-10-01', '2026-12-18', 550, 1],
    ['pod-2p|2026-10-01', '2026-10-01', '2026-12-18', 690, 2],
    ['pod|2026-12-19', '2026-12-19', '2026-12-31', 1150, null],
    ['pod|2027-01-01', '2027-01-01', '2027-01-03', 1250, null],
    ['pod-1p|2027-01-04', '2027-01-04', '2027-04-30', 600, 1],
    ['pod-2p|2027-01-04', '2027-01-04', '2027-04-30', 750, 2],
    ['pod-1p|2027-05-01', '2027-05-01', '2027-09-30', 480, 1],
    ['pod-2p|2027-05-01', '2027-05-01', '2027-09-30', 625, 2],
    ['pod-1p|2027-10-01', '2027-10-01', '2027-12-17', 600, 1],
    ['pod-2p|2027-10-01', '2027-10-01', '2027-12-17', 750, 2],
    ['pod|2027-12-18', '2027-12-18', '2027-12-31', 1250, null],
  ]);
  assert.ok(ok.every(s => s.currency === 'ZAR' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.availability === 'on_request'));
  // before October the 2026 winter band is still live
  assert.ok(buildKbcSlots(parseKbcRates(html), '2026-09-01').some(s => s.key === 'pod-2p|2026-05-01' && s.price === 550));
});

test('kbc: adapter slots + content', async () => {
  const slots = await kiteBasecampPodsLangebaan.fetchSlots(ctx);
  assert.equal(checkSlots(slots).problems.length, 0);
  const c = await kiteBasecampPodsLangebaan.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kite Basecamp PODS');
  assert.equal(c.country, 'South Africa');
  assert.equal(c.spot, 'Langebaan');
  assert.equal(c.mealPlan, 'self_catering');
  assert.match(c.summary, /Shark Bay/);
  assert.match(c.summary, /2026 and 2027/);
  assert.ok(c.includedServices.includes('Towel and bed linen'));
  assert.ok(c.rooms[0].features.includes('From R275 per person sharing'));
  assert.equal(c.imageUrls.length, 19);
  assert.ok(c.imageUrls[0].includes('/uploads/2026/04/'));
  assert.ok(c.imageUrls.every(u => /^https:\/\/kitebasecamp\.com\/wp-content\/uploads\//.test(u) && !/logo|mobi|\.png$/.test(u)));
});
