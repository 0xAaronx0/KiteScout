// GET HIGH Kite Camp Rhodes (Theologos): replays the page recorded 2026-10-19 (trimmed, review widget removed).
// Only July 2026 weeks are printed -> 0 slots on the recording day; packages are checked with an earlier today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getHighKiteCampTheologos, ghLines, parseGhWeeks, parseGhPackages, buildGhSlots, fetchGhSlots, parseGhContent,
} from '../../src/offers/adapters/get-high-kite-camp-theologos.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/get-high-kite-camp-theologos');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');
const lines = ghLines(html);

test('gh: dated weeks and package prices', () => {
  assert.deepEqual(parseGhWeeks(lines).map(w => [w.start, w.end]), [['2026-07-11', '2026-07-18'], ['2026-07-18', '2026-07-25']]);
  assert.deepEqual(parseGhPackages(lines).map(p => [p.key, p.price, p.nights]), [
    ['camp-only', 1090, null], ['complete', 1860, 7], ['windproof', 2800, 14], ['a-package', 1390, 7],
  ]);
});

test('gh: slots per week x package, windproof only over two listed weeks', async () => {
  const s = buildGhSlots(parseGhWeeks(lines), parseGhPackages(lines), '2026-06-01');
  assert.deepEqual(checkSlots(s).problems, []);
  assert.deepEqual(s.map(x => x.key), [
    'camp-only|2026-07-11', 'complete|2026-07-11', 'windproof|2026-07-11', 'a-package|2026-07-11',
    'camp-only|2026-07-18', 'complete|2026-07-18', 'a-package|2026-07-18',
  ]);
  const w = s.find(x => x.key === 'windproof|2026-07-11')!;
  assert.deepEqual([w.endDate, w.price, w.packageNights, w.occupancy], ['2026-07-25', 2800, 14, 1]);
  const c = s.find(x => x.key === 'camp-only|2026-07-11')!;
  assert.deepEqual([c.price, c.currency, c.priceUnit, c.priceBasis, c.availability, c.packageNights], [1090, 'EUR', 'package', 'person', 'on_request', undefined]);
  assert.deepEqual(await fetchGhSlots({ note: () => {}, incomplete: () => {} }, '2026-10-19'), []);
});

test('gh: content', async () => {
  const c = parseGhContent(html, '2026-10-19');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 8, 'Greece', 'Dodecanese', 'Theologos, Rhodes']);
  assert.equal(c.spotCoords, undefined);
  assert.match(c.summary, /starts at EUR 1,860 per person .* about EUR 1,090/);
  assert.match(c.summary, /next dates are not published yet \(2026: 11 July - 18 July, 18 July - 25 July\)/);
  assert.ok(c.imageUrls.length >= 10 && c.imageUrls.every(u => !/icon|logo|-150x150/.test(u)));
  assert.ok(!/Glutz|wp-google/.test(c.sourceText ?? ''));
  assert.equal((await getHighKiteCampTheologos.fetchContent({ note: () => {}, incomplete: () => {} })).title, c.title);
});
