// Swiss Kitesurf Kite Camp Egypt (Soma Bay): replays the camp page + request form recorded 2026-10-19 (trimmed).
// The status rows carry no year; the request form gives it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkFormWeeks, parseSkStatus, parseSkSlots, parseSkVariants, fetchSkSlots } from '../../src/offers/adapters/swiss-kitesurf-camp-lo-stagnone.js';
import { swissKitesurfCampSomaBay, parseSkEgyptContent, SK_EGYPT_URL } from '../../src/offers/adapters/swiss-kitesurf-camp-soma-bay.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/swiss-kitesurf-camp-soma-bay');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (part: string) => readFileSync(join(DIR, files.find(f => f.includes(part))!), 'utf8');
const pages = { camp: read('kite-camp-egypt'), request: read('booking-request') };

test('sk egypt: year-less rows get the year from the form', () => {
  const { weeks, unresolved } = parseSkStatus(pages.camp, parseSkFormWeeks(pages.request, 'Egypt'));
  assert.deepEqual(unresolved, []);
  assert.deepEqual(weeks.map(w => [w.start, w.end, w.status]), [
    ['2026-10-03', '2026-10-10', 'Fully Booked'], ['2026-10-10', '2026-10-17', 'Fully Booked'], ['2026-10-17', '2026-10-24', 'Fully Booked'],
    ['2026-10-24', '2026-10-31', 'Confirmed!'], ['2026-10-31', '2026-11-07', 'Confirmed!'],
  ]);
  // without the form, the page's "fall of 2026" resolves the same weeks
  assert.equal(parseSkStatus(pages.camp, new Map()).weeks[4].start, '2026-10-31');
});

test('sk egypt: 3 packages x shared/single', () => {
  assert.deepEqual(parseSkVariants(pages.camp).map(v => [v.key, v.price, v.occupancy]), [
    ['lessons-package-shared', 1750, 2], ['lessons-package-single', 2050, 1],
    ['board-lodging-rental-gear-shared', 1350, 2], ['board-lodging-rental-gear-single', 1650, 1],
    ['board-lodging-only-shared', 950, 2], ['board-lodging-only-single', 1250, 1],
  ]);
});

test('sk egypt: slots by pinned today; sold-out weeks keep sold_out', async () => {
  const early = parseSkSlots(pages, 'Egypt', '2026-10-01').slots;
  assert.equal(early.length, 30);
  assert.deepEqual(checkSlots(early).problems, []);
  assert.equal(early.find(s => s.key === 'lessons-package-shared|2026-10-03')!.availability, 'sold_out');
  const notes: string[] = [];
  const now = await fetchSkSlots(SK_EGYPT_URL, 'Egypt', { note: t => notes.push(t), incomplete: () => {} }, '2026-10-19');
  assert.deepEqual([...new Set(now.map(s => s.startDate))], ['2026-10-24', '2026-10-31']);
  assert.equal(now.length, 12);
  assert.match(notes[0], /3 past week/);
  assert.deepEqual(await fetchSkSlots(SK_EGYPT_URL, 'Egypt', { note: () => {}, incomplete: () => {} }, '2026-11-01'), []);
});

test('sk egypt: content', async () => {
  const c = parseSkEgyptContent(pages, '2026-10-19');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.mealPlan], ['camp', 8, 'Egypt', 'Red Sea', 'Soma Bay', 'full_board']);
  assert.match(c.summary, /lessons package CHF 1750, board & lodging \+ rental gear CHF 1350, board & lodging only CHF 950; single room \+ CHF 300/);
  assert.match(c.summary, /Camp weeks 2026: 24 Oct - 31 Oct, 31 Oct - 7 Nov/);
  assert.match(parseSkEgyptContent(pages, '2026-11-10').summary, /next dates are not published yet \(2026: 3 Oct/);
  assert.ok(c.imageUrls.length >= 15);
  assert.equal((await swissKitesurfCampSomaBay.fetchContent({ note: () => {}, incomplete: () => {} })).title, c.title);
});
