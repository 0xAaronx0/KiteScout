// Airzone Kite/Wing Camp, Rangiputa: replays the camp page + the instructor-course page recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  airzoneKiteWingCampRangiputa, buildAirzoneSlots, fetchAirzoneSlots, parseAirzoneCamp, parseAirzoneContent, parseAirzoneCourseDates,
} from '../../src/offers/adapters/airzone-kite-wing-camp-rangiputa.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/airzone-kite-wing-camp-rangiputa');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const camp = read('www.kitesurfnz.com_kitesurf-in-new-zealand_');
const iko = read('www.kitesurfnz.com_become-an-iko-instructor_');
const ctx = { note: () => {}, incomplete: () => {} };

test('airzone: weekly price list and supplements', () => {
  const c = parseAirzoneCamp(camp);
  assert.deepEqual(c.prices, [{ weeks: 1, amount: 1495 }, { weeks: 2, amount: 2985 }, { weeks: 3, amount: 4200 }, { weeks: 4, amount: 5861 }]);
  assert.equal(c.peakSupplement?.amount, 50);
  assert.match(c.peakSupplement!.text, /20th December and 12th January/);
  assert.equal(c.singleSupplementPerWeek, 500);
});

test('airzone: instructor course dates (season evidence)', () => {
  assert.deepEqual(parseAirzoneCourseDates(iko).map(d => [d.start, d.end]), [
    ['2026-12-07', '2026-12-11'], ['2026-12-14', '2026-12-18'], ['2027-02-22', '2027-02-27'], ['2027-03-01', '2027-03-05'],
  ]);
});

test('airzone: undated NZD slots per stay length', async () => {
  const slots = buildAirzoneSlots(parseAirzoneCamp(camp));
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.packageNights]), [['1w', 1495, 7], ['2w', 2985, 14], ['3w', 4200, 21], ['4w', 5861, 28]]);
  const s = slots[0];
  assert.deepEqual([s.currency, s.priceUnit, s.priceBasis, s.availability, s.startDate], ['NZD', 'package', 'person', 'on_request', null]);
  assert.match(s.availabilityText!, /single supplement NZD 500 per week/);
  const notes: string[] = [];
  assert.equal((await fetchAirzoneSlots('2026-10-19', { note: t => notes.push(t) })).length, 4);
  assert.equal(notes.length, 0);
  await fetchAirzoneSlots('2027-06-01', { note: t => notes.push(t) });
  assert.match(notes[0], /no future dated instructor course/);
});

test('airzone: content', async (t) => {
  // pinned wall clock: the adapter reads the real date (todayIso / new Date) and the expectations are from 2026-10-21
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-21T12:00:00Z') });
  const c = await airzoneKiteWingCampRangiputa.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 8, 'New Zealand', 'Karikari Peninsula, Northland', 'Rangiputa']);
  assert.match(c.summary, /NZD 1,495 for one week up to NZD 5,861 for four weeks/);
  assert.match(c.summary, /\(2026-12 to 2027-03\) confirm the coming season/);
  assert.ok(!/[–—]/.test(c.summary));
  assert.ok(c.imageUrls.length >= 5);
  assert.ok(c.imageUrls.every(u => !/screenshot|water-nomads/i.test(u)));
  assert.doesNotMatch(parseAirzoneContent({ camp, iko }, '2027-06-01').summary, /confirm the coming season/);
});
