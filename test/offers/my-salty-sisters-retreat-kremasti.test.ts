// My Salty Sisters women's kite retreat Rhodes (Kremasti): replays the page recorded 2026-10-19 (trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mySaltySistersRetreatKremasti, mssLines, parseMssWeeks, parseMssPrices, mssCurrentPrice, buildMssSlots, parseMssContent, mssImages,
} from '../../src/offers/adapters/my-salty-sisters-retreat-kremasti.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/my-salty-sisters-retreat-kremasti');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');
const lines = mssLines(html);

test('mss: week and price tiers', () => {
  assert.deepEqual(parseMssWeeks(lines), [{ start: '2027-06-19', end: '2027-06-26' }]);
  assert.deepEqual(parseMssWeeks(['28.06.-05.07.2027', '28. June - 5. July 2027']), [{ start: '2027-06-28', end: '2027-07-05' }]);
  const p = parseMssPrices(lines);
  assert.deepEqual(p, { regular: 1390, early: 1290, earlyUntil: '2027-02-01', lastMinute: 1450, lastMinuteAfter: '2027-05-15' });
  assert.deepEqual(mssCurrentPrice(p, '2027-02-01'), { price: 1290, tier: 'Early Bird', validUntil: '2027-02-01' });
  assert.deepEqual(mssCurrentPrice(p, '2027-02-02'), { price: 1390, tier: 'Regular', validUntil: '2027-05-15' });
  assert.deepEqual(mssCurrentPrice(p, '2027-05-16'), { price: 1450, tier: 'Last Minute', validUntil: null });
});

test('mss: one slot with the early-bird price (pinned today)', () => {
  const s = buildMssSlots(parseMssWeeks(lines), parseMssPrices(lines), '2026-10-19');
  assert.deepEqual(checkSlots(s).problems, []);
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].key, s[0].endDate, s[0].price, s[0].currency, s[0].priceUnit, s[0].priceBasis, s[0].availability, s[0].priceValidUntil],
    ['2027-06-19', '2027-06-26', 1290, 'EUR', 'package', 'person', 'on_request', '2027-02-01']);
  assert.deepEqual(buildMssSlots(parseMssWeeks(lines), parseMssPrices(lines), '2027-06-20'), []);
});

test('mss: content, no other-destination photos', async () => {
  assert.ok(mssImages(html).every(u => !/colombia/i.test(u) && u.includes('/transf/none/')));
  const c = parseMssContent(html, '2026-10-19');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.mealPlan], ['camp', 8, 'Greece', 'Dodecanese', 'Kremasti, Rhodes', 'breakfast']);
  assert.equal(c.spotCoords, undefined);
  assert.match(c.summary, /women-only/);
  assert.match(c.summary, /Next retreat: 19 June 2027 - 26 June 2027, EUR 1,290 per person \(early bird, regular 1,390, last minute 1,450\)/);
  assert.equal(c.includedServices.length, 12);
  assert.equal((await mySaltySistersRetreatKremasti.fetchContent({ note: () => {}, incomplete: () => {} })).title, c.title);
});
