// Kite Me Up 8 days Hostel Kite Camp (Lo Stagnone): replays the page recorded 2026-10-21 (trimmed: scripts/styles
// dropped except the page's `var packages` data). Price = startingPrice from that page data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kiteMeUpHostelKiteCampLoStagnone, kmuPackages, kmuProduct, kmuFacts, buildKmuSlots, fetchKmuSlots, parseKmuContent,
} from '../../src/offers/adapters/kite-me-up-hostel-kite-camp-lo-stagnone.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-me-up-hostel-kite-camp-lo-stagnone');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');

test('kmu: page data and facts', () => {
  assert.ok(Object.keys(kmuPackages(html)).length >= 10);
  const p = kmuProduct(html);
  assert.equal(p.id, 'sevenDaysHostel');
  assert.equal(p.title, '8 days Hostel Kite Camp');
  assert.deepEqual(kmuFacts(html, p), { price: 813, original: 904, euroOnPage: true, season: 'March - November', promo: 'SEASON 2026 - 10% Off All Courses!' });
  assert.throws(() => kmuPackages('<html></html>'), /var packages/);
});

test('kmu: one undated slot at the startingPrice', async () => {
  const s = await fetchKmuSlots({ note: () => {}, incomplete: () => {} });
  assert.deepEqual(checkSlots(s).problems, []);
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].key, s[0].startDate, s[0].price, s[0].currency, s[0].priceUnit, s[0].priceBasis, s[0].packageNights, s[0].availability],
    ['dorm', null, 813, 'EUR', 'package', 'person', 7, 'on_request']);
  assert.match(s[0].availabilityText ?? '', /read from the page data \(startingPrice\)/);
  assert.match(buildKmuSlots({ price: 813, original: null, euroOnPage: false, season: null, promo: null })[0].availabilityText ?? '', /EUR inferred/);
});

test('kmu: content', async () => {
  const c = parseKmuContent(html);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.beginnerFriendly], ['camp', 8, 'Italy', 'Lo Stagnone, Sicily', 'Lo Stagnone', true]);
  assert.match(c.summary, /starts at EUR 813 per person \(season discount; regular EUR 904\)/);
  assert.ok(!/[–—]/.test(c.summary));
  assert.ok(c.optionalServices.some(x => /^Transfers to Trapani airport/.test(x)));
  assert.ok(!c.includedServices.some(x => /\*/.test(x)));
  assert.ok(c.imageUrls.length >= 10 && c.imageUrls.every(u => /^https:\/\/kitemeup\.com\/img_webp\/[\w/]+\.webp$/.test(u)));
  assert.equal((await kiteMeUpHostelKiteCampLoStagnone.fetchContent({ note: () => {}, incomplete: () => {} })).title, c.title);
});
