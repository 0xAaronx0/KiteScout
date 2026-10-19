// Shark Bay Kitesurfing One Week Progression: replays the product + home pages recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSbkSlots, parseSbkCamp, parseSbkContent, sbkCoords, sharkbayKitesurfingProgressionDenham,
} from '../../src/offers/adapters/sharkbay-kitesurfing-progression-denham.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/sharkbay-kitesurfing-progression-denham');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.includes('product_progression'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('shark bay: camp dates from the page, room prices from the shop variations', () => {
  const c = parseSbkCamp(html);
  assert.deepEqual(c.weeks.map(w => w.start), ['2026-02-08', '2026-11-08', '2026-12-06', '2027-02-07']);
  assert.equal(c.weeks[1].end, '2026-11-15');
  assert.deepEqual(c.rooms.map(r => r.price), [2995, 3195, 3295]);
  assert.equal(c.currency, 'AUD');
  assert.deepEqual(sbkCoords(html), { lat: -25.9170195, lng: 113.5178662 });
});

test('shark bay: 3 future dates x 3 rooms, the past February 2026 date dropped', () => {
  const slots = buildSbkSlots(parseSbkCamp(html), '2026-10-19');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 9);
  assert.ok(!ok.some(s => s.startDate === '2026-02-08'));
  assert.ok(ok.every(s => s.currency === 'AUD' && s.priceBasis === 'person' && s.availability === 'unknown'));
  assert.equal(Math.min(...ok.map(s => s.price!)), 2995);
  assert.equal(buildSbkSlots(parseSbkCamp(html), '2027-03-01').length, 0);
});

test('shark bay: content is a valid camp with the school pin and photos', async () => {
  const c = await sharkbayKitesurfingProgressionDenham.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 8);
  assert.equal(c.region, 'Shark Bay, Western Australia');
  assert.ok(c.imageUrls.length >= 5);
  assert.ok(!c.imageUrls.some(u => /logo|kitewest|Map_/i.test(u)), c.imageUrls.join('\n'));
  assert.match(parseSbkContent(html, null, '2026-10-19').summary, /Camp weeks: 2026-11-08 to 2026-11-15, 2026-12-06 to 2026-12-13, 2027-02-07 to 2027-02-14/);
  assert.match(parseSbkContent(html, null, '2027-03-01').summary, /next dates are not published yet/);
});
