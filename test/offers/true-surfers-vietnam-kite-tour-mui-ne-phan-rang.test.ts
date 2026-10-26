// True Surfers Vietnam kitesurf tour: replays the trip page recorded 2026-10-19 (Shopify storefront token redacted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildTsSlots, fetchTsSlots, parseTsTour, trueSurfersVietnamKiteTourMuiNePhanRang,
} from '../../src/offers/adapters/true-surfers-vietnam-kite-tour-mui-ne-phan-rang.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/true-surfers-vietnam-kite-tour-mui-ne-phan-rang');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const html = readFileSync(join(DIR, files.find(f => f.includes('vietnam-kitetrip'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('true-surfers: tour dates and both room prices with the early-booking cutoff', () => {
  const t = parseTsTour(html);
  assert.deepEqual([t.start, t.end, t.days], ['2027-01-08', '2027-01-22', 14]);
  assert.deepEqual(t.prices.map(p => [p.unit, p.occupancy, p.early, p.late, p.cutoff]), [
    ['Shared double or twin room', 2, 1450, 1550, '2026-10-01'],
    ['Private room (single occupancy)', 1, 2000, 2100, '2026-10-01'],
  ]);
});

test('true-surfers: after October 1 the later price applies; before it the early price with priceValidUntil', async () => {
  const t = parseTsTour(html);
  const late = buildTsSlots(t, '2026-10-19');
  assert.deepEqual(checkSlots(late).problems, []);
  assert.deepEqual(late.map(s => [s.key, s.price, s.currency, s.priceUnit, s.priceBasis, s.availability, s.priceValidUntil]), [
    ['2027-01-08|shared', 1550, 'EUR', 'package', 'person', 'on_request', null],
    ['2027-01-08|private', 2100, 'EUR', 'package', 'person', 'on_request', null],
  ]);
  const early = buildTsSlots(t, '2026-09-20');
  assert.deepEqual(early.map(s => [s.price, s.priceValidUntil]), [[1450, '2026-10-01'], [2000, '2026-10-01']]);
  assert.deepEqual(buildTsSlots(t, '2027-01-09'), []);
  const notes: string[] = [];
  const live = await fetchTsSlots('2026-10-19', { note: n => notes.push(n) });
  assert.equal(live.length, 2);
  assert.deepEqual(notes, []); // the only other trip page in the menu is the past February 2026 one
});

test('true-surfers: content', async (t) => {
  // pinned wall clock: the adapter reads the real date (todayIso / new Date) and the expectations are from 2026-10-21
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-21T12:00:00Z') });
  const c = await trueSurfersVietnamKiteTourMuiNePhanRang.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['tour', 14, 'Vietnam', 'Lam Dong (Binh Thuan)', 'Mui Ne']);
  assert.deepEqual(c.itinerarySpots.map(s => s.name), ['Mui Ne', 'Phan Rang']);
  assert.match(c.summary, /8 January - 22 January 2027: EUR 1,550 per person in a shared double or twin room, EUR 2,100 in a private room/);
  assert.ok(c.includedServices.includes('2 advanced coaching sessions'));
  assert.ok(c.imageUrls.length >= 10 && c.imageUrls.every(u => u.startsWith('https://cdn.shopify.com/s/files/')));
  assert.match(c.heroVideoUrl ?? '', /\.mp4$/);
});
