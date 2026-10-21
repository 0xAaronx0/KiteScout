// KiteXcite "Stay and Play" package, replayed from the fixture recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { kitexciteStayAndPlayCabarete as adapter, kxLessonDoubt, parseKxPackage } from '../../src/offers/adapters/kitexcite-stay-and-play-cabarete.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitexcite-stay-and-play-cabarete');
process.env.OFFERS_FIXTURE_DIR = DIR;
const ctx = { note: () => {}, incomplete: () => {} };
const html = readFileSync(join(DIR, 'www.kitexcite.com_kitexcite-packages_.87424ac1.txt'), 'utf8');

test('parseKxPackage: price, nights and the 3-vs-4 lesson-day doubt', () => {
  const p = parseKxPackage(html)!;
  assert.deepEqual([p.price, p.currency, p.nights, p.guests, p.lessonDaysHeadline, p.lessonDaysList, p.extraNight, p.extraLessonDay, p.coach, p.equipment],
    [989, 'USD', 6, 2, 3, 4, 50, 140, 'Stefan Ruether', true]);
  assert.equal(kxLessonDoubt(p), true);
});

test('kitexcite slots: one undated package for 2 (room) + 1 (lessons)', async () => {
  const slots = await adapter.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 1);
  const s = ok[0];
  assert.deepEqual([s.key, s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.packageNights, s.availability],
    ['stay-and-play', 989, 'USD', 'package', 'group', 2, 6, 'on_request']);
  assert.match(s.unit ?? '', /3 or 4 days \(page says both\)/);
});

test('kitexcite content', async () => {
  const c = await adapter.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.durationDays, 7);
  assert.equal(c.mealPlan, null);
  assert.match(c.summary, /3 or 4 days of lessons \(it names both numbers\)/);
  assert.doesNotMatch(c.summary, /[—–]/);
  assert.equal(c.imageUrls.length, 5);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://www.kitexcite.com/wp-content/uploads/')));
  assert.ok(!c.imageUrls.some(u => /tripadvisor|globe|times/i.test(u)));
});
