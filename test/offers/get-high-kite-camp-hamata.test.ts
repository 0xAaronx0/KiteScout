// GET HIGH Kite Camp Egypt (Hamata): replays the page recorded 2026-10-21 (trimmed: scripts/styles and the Google
// review widget dropped). Three November/December 2026 weeks, one printed with a typo end date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getHighKiteCampHamata, parseGhxDateLine, parseGhxWeeks, buildGhxSlots, fetchGhxSlots, parseGhhContent, ghxOccupancy, ghxImages, GHH_URL,
} from '../../src/offers/adapters/get-high-kite-camp-hamata.js';
import { ghLines, parseGhPackages } from '../../src/offers/adapters/get-high-kite-camp-theologos.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/get-high-kite-camp-hamata');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');
const lines = ghLines(html);
const PLACE = { completeUnit: '7 nights', windproofUnit: '14 nights', flights: '(x)' };

test('ghh: date lines (long, short, typo) and packages', () => {
  assert.deepEqual(parseGhxDateLine('November 21, 2026 – November 28, 2026'), { start: '2026-11-21', end: '2026-11-28', raw: 'November 21, 2026 – November 28, 2026', fixed: false });
  assert.deepEqual(parseGhxDateLine('November 28, 2026 – November 5, 2026')?.end, '2026-12-05');
  assert.equal(parseGhxDateLine('November 28, 2026 – November 5, 2026')?.fixed, true);
  assert.deepEqual(parseGhxDateLine('December 26, 2026 – January 2, 2027')?.end, '2027-01-02');
  assert.deepEqual(parseGhxDateLine('April 25 – May 2, 2026'), { start: '2026-04-25', end: '2026-05-02', raw: 'April 25 – May 2, 2026', fixed: false });
  assert.equal(parseGhxDateLine('office@kitesurfing.at'), null);
  assert.deepEqual(parseGhxWeeks(lines).map(w => [w.start, w.end]), [['2026-11-21', '2026-11-28'], ['2026-11-28', '2026-12-05'], ['2026-12-05', '2026-12-12']]);
  assert.deepEqual(parseGhPackages(lines).map(p => [p.key, p.price, p.nights]), [
    ['complete', 2099, 7], ['camp-only', 1250, null], ['windproof', 3090, 14], ['a-package', 1700, 7],
  ]);
  assert.equal(ghxOccupancy('In a double room, starting at €2,099 per person'), 2);
  assert.equal(ghxOccupancy('Single occupancy in a double room starting at €3,090 per person'), 1);
});

test('ghh: slots per week (complete + camp-only), windproof over consecutive weeks, no A package', async () => {
  const s = buildGhxSlots(parseGhxWeeks(lines), parseGhPackages(lines), PLACE, '2026-10-21');
  assert.deepEqual(checkSlots(s).problems, []);
  assert.deepEqual(s.map(x => x.key), [
    'complete|2026-11-21', 'camp-only|2026-11-21', 'windproof|2026-11-21',
    'complete|2026-11-28', 'camp-only|2026-11-28', 'windproof|2026-11-28',
    'complete|2026-12-05', 'camp-only|2026-12-05',
  ]);
  const c = s.find(x => x.key === 'complete|2026-11-21')!;
  assert.deepEqual([c.price, c.currency, c.priceUnit, c.priceBasis, c.occupancy, c.packageNights, c.availability], [2099, 'EUR', 'package', 'person', 2, 7, 'on_request']);
  assert.match(c.availabilityText ?? '', /incl\. flights/);
  const o = s.find(x => x.key === 'camp-only|2026-11-21')!;
  assert.deepEqual([o.price, o.packageNights, o.occupancy], [1250, undefined, null]);
  assert.match(o.availabilityText ?? '', /camp only, no flights or accommodation/);
  const w = s.find(x => x.key === 'windproof|2026-11-28')!;
  assert.deepEqual([w.endDate, w.price, w.packageNights, w.occupancy], ['2026-12-12', 3090, 14, 1]);
  assert.equal(buildGhxSlots(parseGhxWeeks(lines), parseGhPackages(lines), PLACE, '2026-12-06').length, 0);
  const notes: string[] = [];
  const live = await fetchGhxSlots({ note: t => notes.push(t), incomplete: () => {} }, GHH_URL, PLACE, 'test', '2026-10-21');
  assert.equal(live.length, 8);
  assert.ok(notes.some(n => /implausible end/.test(n)));
});

test('ghh: content', async () => {
  const c = parseGhhContent(html, '2026-10-21');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.mealPlan], ['camp', 8, 'Egypt', 'Red Sea', 'Hamata', 'half_board']);
  assert.match(c.summary, /starts at EUR 2,099 per person in a double room; the camp alone costs about EUR 1,250/);
  assert.match(c.summary, /Camp weeks: 21 November 2026 - 28 November 2026, 28 November 2026 - 5 December 2026/);
  assert.ok(!/[–—]/.test(c.summary + c.includedServices.join() + c.optionalServices.join()));
  assert.ok(c.optionalServices.some(x => /^"A" Package: Starting at €1,700/.test(x)));
  const imgs = ghxImages(html);
  assert.ok(imgs.length >= 10 && imgs.every(u => !/icon|logo|-scaled\./.test(u)));
  assert.ok(!/Glutz|wp-google/.test(html));
  assert.equal((await getHighKiteCampHamata.fetchContent({ note: () => {}, incomplete: () => {} })).title, 'GET HIGH Kite Camp Egypt, Hamata');
  assert.equal(getHighKiteCampHamata.operator.rootDomain, 'kitesurfing.at');
});
