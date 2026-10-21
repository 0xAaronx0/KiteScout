// Kite Buen Hombre 7-Day Special, replayed from the fixture recorded 2026-10-21 (packages page, trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { buildKbh7DaySlots, parseKbh7Day, parseKbh7DayContent } from '../../src/offers/adapters/kite-buen-hombre-7-day-special.js';
import { kbhText, parseKbhSeasonSpecial } from '../../src/offers/adapters/kite-buen-hombre-10-day-special.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-buen-hombre-7-day-special');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, 'www.kitebuenhombre.com_kite-stay-packages-dominican-republic.86d8c525.txt'), 'utf8');
const TODAY = '2026-10-21';

test('parseKbh7Day: beginner + advanced from the visible line', () => {
  const p = parseKbh7Day(html)!;
  assert.deepEqual([p.beginner, p.advanced, p.currency, p.nights], [1333, 1433, 'USD', 6]);
});

test('7-day slots on 2026-10-21: two variants + the season special band', () => {
  const p = parseKbh7Day(html)!;
  const season = parseKbhSeasonSpecial(kbhText(html));
  const slots = buildKbh7DaySlots(p, season, TODAY);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.startDate, s.endDate, s.availability, s.packageNights, s.priceValidUntil ?? null]), [
    ['7-day-special|beginner', 1333, null, null, 'on_request', 6, null],
    ['7-day-special|advanced', 1433, null, null, 'on_request', 6, null],
    ['season-special|2026-11-01', 1235, '2026-11-01', '2026-12-15', 'available', 6, '2026-11-15'],
  ]);
  assert.ok(ok.every(s => s.currency === 'USD' && s.priceUnit === 'package' && s.priceBasis === 'person'));
});

test('7-day slots: the season special drops after its deposit deadline', () => {
  const p = parseKbh7Day(html)!;
  const season = parseKbhSeasonSpecial(kbhText(html));
  assert.equal(buildKbh7DaySlots(p, season, '2026-11-16').length, 2);
  assert.equal(buildKbh7DaySlots(p, null, TODAY).length, 2);
});

test('7-day content (pinned today)', () => {
  const c = parseKbh7DayContent(html, TODAY);
  assert.equal(contentProblem(c), null);
  assert.equal(c.durationDays, 7);
  assert.deepEqual(c.skillLevels, ['beginner', 'intermediate', 'advanced']);
  assert.match(c.summary, /USD 1,333 per person with the beginner course or USD 1,433 with the advanced course/);
  assert.match(c.summary, /Season Special/);
  assert.doesNotMatch(parseKbh7DayContent(html, '2026-12-20').summary, /Season Special/);
  assert.doesNotMatch(c.summary, /[—–]/);
  assert.ok(c.includedServices.includes('11-hour beginner course (10 + 1 bonus hour) OR 10-hour advanced course'));
  assert.ok(c.imageUrls.length >= 10);
});
