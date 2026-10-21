// Kite Buen Hombre 10-Day Special, replayed from the fixture recorded 2026-10-21 (packages page, trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import {
  kiteBuenHombre10DaySpecial as adapter, kbhInclusions, kbhNormalValue, kbhText, parseKbhOffers, parseKbhSeasonSpecial,
} from '../../src/offers/adapters/kite-buen-hombre-10-day-special.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-buen-hombre-10-day-special');
process.env.OFFERS_FIXTURE_DIR = DIR;
const ctx = { note: () => {}, incomplete: () => {} };
const html = readFileSync(join(DIR, 'www.kitebuenhombre.com_kite-stay-packages-dominican-republic.86d8c525.txt'), 'utf8');

test('parseKbhOffers: the JSON-LD OfferCatalog (per person, USD)', () => {
  const o = parseKbhOffers(html);
  assert.deepEqual(o.map(x => [x.name, x.price, x.currency, x.nights]), [
    ['Weekend Special', 555, 'USD', 1],
    ['7-Day Special', 1333, 'USD', 6],
    ['10-Day Special', 2222, 'USD', 9],
    ['14-Day Special', 2795, 'USD', 13],
  ]);
});

test('parseKbhOffers: falls back to the older Product.offers block', () => {
  const old = '<script type="application/ld+json">{"@type":"Product","name":"Kite Stay Packages","offers":[{"@type":"Offer","name":"10-Day Special","price":"2222","priceCurrency":"USD","description":"9 nights accommodation, meals"}]}</script>';
  assert.deepEqual(parseKbhOffers(old).map(x => [x.name, x.price, x.nights]), [['10-Day Special', 2222, 9]]);
});

test('visible helpers: normal value, inclusion block, season special', () => {
  const t = kbhText(html);
  assert.equal(kbhNormalValue(t, /10-Day\s*Special/), 2390);
  const inc = kbhInclusions(html, 9);
  assert.equal(inc[0], '9 nights accommodation');
  assert.ok(inc.includes('Graduation boat trip + downwinder'));
  assert.ok(inc.at(-1) === 'Lounge chairs');
  assert.deepEqual(parseKbhSeasonSpecial(t), {
    start: '2026-11-01', end: '2026-12-15', total: 1235, days: 7, coursePrice: 850, mealsPerDay: 55,
    deposit: 425, depositBy: '2026-11-15', placesPerWeek: 10,
  });
});

test('10-day slots: one undated per-person package', async () => {
  const slots = await adapter.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 1);
  assert.deepEqual(
    { key: slots[0].key, price: slots[0].price, cur: slots[0].currency, unit: slots[0].priceUnit, basis: slots[0].priceBasis, nights: slots[0].packageNights, a: slots[0].availability },
    { key: '10-day-special', price: 2222, cur: 'USD', unit: 'package', basis: 'person', nights: 9, a: 'on_request' },
  );
});

test('10-day content', async () => {
  const c = await adapter.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 10);
  assert.equal(c.region, 'Monte Cristi');
  assert.equal(c.spot, 'Playa Buen Hombre');
  assert.deepEqual(c.spotCoords, { lat: 19.87004, lng: -71.40395 });
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /USD 2,222 per person \(normal value USD 2,390\)/);
  assert.doesNotMatch(c.summary, /[—–]/);
  assert.ok(c.imageUrls.length >= 10, `images: ${c.imageUrls.length}`);
  assert.ok(c.imageUrls.every(u => /^https:\/\/static\.wixstatic\.com\/media\/[^/]+$/.test(u)), 'Wix originals only');
  assert.ok(!c.imageUrls.some(u => u.includes('d76113_02c13be3bf144efe90f9e4fba1447b01')), 'transport photo dropped');
  assert.ok(!c.imageUrls.some(u => u.includes('dd80b9_89a4d659d6804cd1a161387952931e0a')), 'logo dropped');
});
