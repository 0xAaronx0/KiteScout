// Kitereizen Kite Camp Vietnam (My Hoa lagoon): replays the store list, both week products and the camp page recorded
// 2026-10-19 (two private customer product names, the page's embedded keys and session JWTs are redacted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildKrSlots, fetchKrSlots, kitereizenKiteCampMyHoaPhanRang, parseKrProduct, parseKrVietnamProducts, parseKrWeekStatus,
} from '../../src/offers/adapters/kitereizen-kite-camp-my-hoa-phan-rang.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitereizen-kite-camp-my-hoa-phan-rang');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (part: string) => readFileSync(join(DIR, files.find(f => f.includes(part))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('kitereizen: the store list links the two Vietnam weeks', () => {
  assert.deepEqual(parseKrVietnamProducts(read('product-list')).map(l => l.name), ['January 1-8, 2027', 'January 8-15, 2027']);
});

test('kitereizen: product JSON-LD gives shared / private base prices and stock', () => {
  const w = parseKrProduct(read('699462d8ed0a7af45de1712d'), 'u');
  assert.deepEqual([w.start, w.end], ['2027-01-01', '2027-01-08']);
  assert.deepEqual(w.variants.map(v => [v.room, v.price, v.currency, v.inStock]), [['shared', 1995, 'EUR', true], ['private', 2395, 'EUR', true]]);
});

test('kitereizen: camp page week status words', () => {
  assert.deepEqual(parseKrWeekStatus(read('en_vietnam')), [
    { start: '2027-01-01', end: '2027-01-08', status: 'Only a few spots left' },
    { start: '2027-01-08', end: '2027-01-15', status: 'Only a few spots left' },
  ]);
});

test('kitereizen: slots per week x room, past weeks dropped, sold out from the shop', async () => {
  const slots = await fetchKrSlots('2026-10-19', ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.priceBasis, s.occupancy, s.availability, s.endDate]), [
    ['2027-01-01|shared', 1995, 'person', 2, 'limited', '2027-01-08'],
    ['2027-01-01|private', 2395, 'person', 1, 'limited', '2027-01-08'],
    ['2027-01-08|shared', 1995, 'person', 2, 'limited', '2027-01-15'],
    ['2027-01-08|private', 2395, 'person', 1, 'limited', '2027-01-15'],
  ]);
  const w = parseKrProduct(read('69afeba022144960a1c6082f'), 'u');
  w.variants[0].inStock = false;
  w.variants[0].availability = 'OutOfStock';
  const later = buildKrSlots([w], [], '2027-01-05');
  assert.deepEqual(later.map(s => [s.key, s.availability]), [['2027-01-08|shared', 'sold_out'], ['2027-01-08|private', 'available']]);
  assert.deepEqual(buildKrSlots([w], [], '2027-01-09'), []);
});

test('kitereizen: content', async (t) => {
  // pinned wall clock: the adapter reads the real date (todayIso / new Date) and the expectations are from 2026-10-21
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-21T12:00:00Z') });
  const c = await kitereizenKiteCampMyHoaPhanRang.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.mealPlan], ['camp', 8, 'Vietnam', 'Ninh Thuan', 'My Hoa Lagoon', 'full_board']);
  assert.match(c.summary, /Weeks 2027: January 1-8 and January 8-15, EUR 1,995 per person in a shared room, EUR 2,395 in a private room/);
  assert.ok(c.includedServices.some(s => /^Full Board/.test(s)));
  assert.ok(c.imageUrls.length >= 5);
  assert.ok(!c.imageUrls.some(u => u.includes('698f57ac24813c784f5007ba'))); // also labelled as an Italy photo on the page
});
