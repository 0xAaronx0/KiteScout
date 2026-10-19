// Swiss Kitesurf Kite Camp Sicily (Lo Stagnone): replays the camp page + request form recorded 2026-10-19 (trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  swissKitesurfCampLoStagnone, parseSkRange, parseSkStatus, parseSkFormWeeks, parseSkVariants, parseSkSlots, parseSkSicilyContent, skAvailability,
} from '../../src/offers/adapters/swiss-kitesurf-camp-lo-stagnone.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/swiss-kitesurf-camp-lo-stagnone');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (part: string) => readFileSync(join(DIR, files.find(f => f.includes(part))!), 'utf8');
const pages = { camp: read('kite-camp-sicily'), request: read('booking-request') };
const TODAY = '2026-10-19';

test('sk: date forms on the site', () => {
  assert.deepEqual(parseSkRange('10.04.2027 to 17.04.2027'), { d1: 10, m1: 4, y1: 2027, d2: 17, m2: 4, y2: 2027 });
  assert.deepEqual(parseSkRange('15.05- 22.05.2027'), { d1: 15, m1: 5, y1: null, d2: 22, m2: 5, y2: 2027 });
  assert.deepEqual(parseSkRange('3. - 10.10'), { d1: 3, m1: 10, y1: null, d2: 10, m2: 10, y2: null });
  assert.deepEqual(parseSkRange('31.10 - 7.11'), { d1: 31, m1: 10, y1: null, d2: 7, m2: 11, y2: null });
  assert.equal(skAvailability('Fully Booked').availability, 'sold_out');
  assert.equal(skAvailability('Confirmed!').availability, 'on_request');
});

test('sk sicily: status table, form weeks and variants', () => {
  const form = parseSkFormWeeks(pages.request, 'Sicily');
  assert.equal(form.size, 6);
  const { weeks, unresolved } = parseSkStatus(pages.camp, form);
  assert.deepEqual(unresolved, []);
  assert.deepEqual(weeks.map(w => [w.start, w.end, w.status]), [
    ['2027-04-10', '2027-04-17', 'Not yet confirmed'], ['2027-04-17', '2027-04-24', 'Not yet confirmed'],
    ['2027-04-24', '2027-05-01', 'Confirmed!'], ['2027-05-01', '2027-05-08', 'Not yet confirmed'],
    ['2027-05-08', '2027-05-15', 'Confirmed!'], ['2027-05-15', '2027-05-22', 'Confirmed!'],
  ]);
  assert.deepEqual(parseSkVariants(pages.camp).map(v => [v.key, v.price, v.occupancy]), [
    ['lessons-package-standard-room', 1700, 1], ['lessons-package-couple', 1400, 2],
  ]);
});

test('sk sicily: slots (pinned today) and past weeks dropped', () => {
  const { slots } = parseSkSlots(pages, 'Sicily', TODAY);
  assert.equal(slots.length, 12);
  assert.deepEqual(checkSlots(slots).problems, []);
  const s = slots.find(x => x.key === 'lessons-package-couple|2027-04-24')!;
  assert.deepEqual([s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.availability, s.endDate], [1400, 'CHF', 'package', 'person', 2, 'on_request', '2027-05-01']);
  assert.match(s.availabilityText!, /^Confirmed!/);
  assert.equal(parseSkSlots(pages, 'Sicily', '2027-05-09').slots.length, 2);
});

test('sk sicily: content', async () => {
  const c = parseSkSicilyContent(pages, TODAY);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.mealPlan], ['camp', 8, 'Italy', 'Lo Stagnone, Sicily', 'Lo Stagnone', 'breakfast']);
  assert.match(c.summary, /CHF 1700 per person alone .* CHF 1400 per person for a couple/);
  assert.match(c.summary, /Camp weeks 2027: 10 Apr - 17 Apr/);
  assert.ok(c.includedServices.length >= 5);
  assert.ok(c.imageUrls.length >= 15 && c.imageUrls.every(u => !/teambilder/.test(u)));
  assert.ok(!/[—–]/.test(c.summary));
  const live = await swissKitesurfCampLoStagnone.fetchContent({ note: () => {}, incomplete: () => {} });
  assert.equal(live.title, c.title);
});
