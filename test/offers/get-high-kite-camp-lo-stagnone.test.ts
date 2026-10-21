// GET HIGH Kite Camp Sicily (Lo Stagnone): replays the page recorded 2026-10-21 (trimmed: scripts/styles and the
// Google review widget dropped). Only 2026 weeks are printed -> 0 slots on the recording day; checked with an
// earlier today as well.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getHighKiteCampLoStagnone, parseGhsContent, GHS_PLACE, GHS_URL } from '../../src/offers/adapters/get-high-kite-camp-lo-stagnone.js';
import { buildGhxSlots, fetchGhxSlots, parseGhxWeeks, ghxPastSeason } from '../../src/offers/adapters/get-high-kite-camp-hamata.js';
import { ghLines, parseGhPackages } from '../../src/offers/adapters/get-high-kite-camp-theologos.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/get-high-kite-camp-lo-stagnone');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');
const lines = ghLines(html);

test('ghs: weeks and packages', () => {
  const weeks = parseGhxWeeks(lines);
  assert.deepEqual(weeks.map(w => [w.start, w.end]), [
    ['2026-04-11', '2026-04-18'], ['2026-04-18', '2026-04-25'], ['2026-04-25', '2026-05-02'], ['2026-09-26', '2026-10-03'], ['2026-10-03', '2026-10-10'],
  ]);
  assert.equal(ghxPastSeason(weeks), '2026: April, September and October');
  assert.deepEqual(parseGhPackages(lines).map(p => [p.key, p.price, p.nights]), [
    ['complete', 1705, 7], ['camp-only', 1090, null], ['windproof', 2720, 14], ['a-package', 1250, 7],
  ]);
});

test('ghs: past weeks never become slots; an earlier today yields complete/camp-only/windproof', async () => {
  assert.deepEqual(await fetchGhxSlots({ note: () => {}, incomplete: () => {} }, GHS_URL, GHS_PLACE, 'test', '2026-10-21'), []);
  const s = buildGhxSlots(parseGhxWeeks(lines), parseGhPackages(lines), GHS_PLACE, '2026-09-01');
  assert.deepEqual(checkSlots(s).problems, []);
  assert.deepEqual(s.map(x => x.key), ['complete|2026-09-26', 'camp-only|2026-09-26', 'windproof|2026-09-26', 'complete|2026-10-03', 'camp-only|2026-10-03']);
  const c = s[0];
  assert.deepEqual([c.price, c.occupancy, c.packageNights, c.endDate], [1705, 1, 7, '2026-10-03']);
  assert.match(c.availabilityText ?? '', /incl\. flights .*Vienna-Palermo/);
});

test('ghs: content says the next dates are not published', async () => {
  const c = parseGhsContent(html, '2026-10-21');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.mealPlan], ['camp', 8, 'Italy', 'Lo Stagnone, Sicily', 'Lo Stagnone', 'self_catering']);
  assert.match(c.summary, /starts at EUR 1,705 per person .* about EUR 1,090/);
  assert.match(c.summary, /next dates are not published yet \(2026: April, September and October\)/);
  assert.ok(!/[–—]/.test(c.summary + c.includedServices.join() + c.optionalServices.join()));
  assert.ok(c.imageUrls.length >= 10 && c.imageUrls.every(u => !/-scaled\./.test(u)));
  assert.equal((await getHighKiteCampLoStagnone.fetchContent({ note: () => {}, incomplete: () => {} })).title, c.title);
});
