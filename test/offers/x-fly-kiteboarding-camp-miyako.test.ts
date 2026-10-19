// X-FLY Kiteboarding Camp School, Miyakojima: replays the English camp page recorded 2026-10-19. The only printed window
// (27 Nov 2025 - 13 Jan 2026) is over, so the adapter returns no slots; the window slot is checked with an earlier "today".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildXflySlots, fetchXflySlots, parseXflyCamp, parseXflyContent, parseXflyWindow, xFlyKiteboardingCampMiyako } from '../../src/offers/adapters/x-fly-kiteboarding-camp-miyako.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/x-fly-kiteboarding-camp-miyako');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith('x-fly.jp_kiteboard-program_'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('x-fly: price, extra day, window, inclusions', () => {
  const c = parseXflyCamp(html);
  assert.deepEqual([c.days, c.price, c.extraDay], [3, 66000, 17000]);
  assert.deepEqual(c.window && [c.window.start, c.window.end], ['2025-11-27', '2026-01-13']);
  assert.equal(c.included.length, 5);
  // the Japanese page's wording
  assert.deepEqual(parseXflyWindow('※開催期間は年によってズレます2026年度は\n11/26~1/12の期間です。'), { start: '2026-11-26', end: '2027-01-12', label: '2026年度は\n11/26~1/12' });
});

test('x-fly: one window slot while the window is open, none after', async () => {
  const c = parseXflyCamp(html);
  const open = buildXflySlots(c, '2025-12-01');
  assert.deepEqual(checkSlots(open).problems, []);
  assert.deepEqual(open.map(s => [s.key, s.startDate, s.endDate, s.price, s.currency, s.priceUnit, s.priceBasis, s.availability, s.datePrecision]), [
    ['season-2025', '2025-11-27', '2026-01-13', 66000, 'JPY', 'package', 'person', 'on_request', 'season'],
  ]);
  assert.match(open[0].availabilityText!, /\+ JPY 17,000 per extra day/);
  const notes: string[] = [];
  assert.deepEqual(await fetchXflySlots('2026-10-19', { note: t => notes.push(t) }), []);
  assert.match(notes[0], /is over; next window not published/);
});

test('x-fly: content', async () => {
  const c = await xFlyKiteboardingCampMiyako.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 3, 'Japan', 'Miyako Islands, Okinawa', 'Miyakojima']);
  assert.match(c.summary, /JPY 66,000 for 3 days plus JPY 17,000 per extra day/);
  assert.match(c.summary, /2025\/26: 27 Nov 2025 to 13 Jan 2026\); the 2026\/27 dates are not yet published/);
  assert.match(parseXflyContent(html, '2025-12-01').summary, /This season's camp window: 27 Nov 2025 to 13 Jan 2026/);
  assert.ok(c.imageUrls.length >= 4);
  assert.ok(!/[–—]/.test(c.summary));
});
