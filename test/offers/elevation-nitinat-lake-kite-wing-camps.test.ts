// Elevation Kite and Wing Center, Nitinat Lake camps: replays /pages/nitinaht-lake, /pages/womans-camps and
// /pages/wing-camps recorded 2026-10-23 (summer 2027 dates printed). "today" is pinned in the date-dependent tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildElSlots, elevationNitinatLakeKiteWingCamps, parseElCamps, parseElContent, parseElDays,
} from '../../src/offers/adapters/elevation-nitinat-lake-kite-wing-camps.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/elevation-nitinat-lake-kite-wing-camps');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const nitinat = read('elevationkiteboarding.com_pages_nitinaht-lake');
const women = read('elevationkiteboarding.com_pages_womans-camps');
const wing = read('elevationkiteboarding.com_pages_wing-camps');

test('elevation: 3-day date lines', () => {
  assert.deepEqual(parseElDays('July 5-6-7', 2027), { start: '2027-07-05', end: '2027-07-07' });
  assert.deepEqual(parseElDays('July19-20-21', 2027), { start: '2027-07-19', end: '2027-07-21' });
  assert.deepEqual(parseElDays('June 30-July 1-2', 2027), { start: '2027-06-30', end: '2027-07-02' });
  assert.deepEqual(parseElDays('June 29-30-1', 2027), { start: '2027-06-29', end: '2027-07-01' });
  assert.equal(parseElDays('dates to come', 2027), null);
});

test('elevation: camp blocks of the Nitinat page', () => {
  const camps = parseElCamps(nitinat);
  assert.deepEqual(camps.map(c => [c.type, c.year, c.price, c.currency, c.tax, c.dates.length]), [
    ["Women's Kite Camp", 2027, 1025, 'CAD', '+ tax (5% GST)', 2],
    ['Co-Ed Kiteboarding Camp', 2027, 1025, 'CAD', '+ tax (5% GST)', 2],
    ['Wing Foiling Camp (Co-ed)', 2027, 1025, 'CAD', '+ tax (5% GST)', 5],
    ['Kids Wing Foiling Camp', 2027, 995, 'CAD', '+ tax (5% GST)', 1],
    ['Kids Kiteboarding Camp', 2027, 995, 'CAD', '+ tax (5% GST)', 1],
  ]);
});

test('elevation: one slot per camp type x date, past dates dropped', () => {
  const camps = parseElCamps(nitinat);
  const all = buildElSlots(camps, '2026-10-23');
  assert.deepEqual(checkSlots(all).problems, []);
  assert.equal(all.length, 11);
  assert.deepEqual(all.map(s => s.key).slice(0, 5), [
    'womens-kite-camp|2027-07-05', 'womens-kite-camp|2027-07-19', 'co-ed-kiteboarding-camp|2027-06-14',
    'co-ed-kiteboarding-camp|2027-08-16', 'wing-foiling-camp-co-ed|2027-06-07',
  ]);
  const kids = all.filter(s => s.startDate === '2027-06-28').map(s => [s.key, s.unit, s.price]);
  assert.deepEqual(kids, [
    ['kids-wing-foiling-camp|2027-06-28', 'Kids Wing Foiling Camp, 3 days, lessons only', 995],
    ['kids-kiteboarding-camp|2027-06-28', 'Kids Kiteboarding Camp, 3 days, lessons only', 995],
  ]);
  const s = all[0];
  assert.deepEqual([s.endDate, s.price, s.currency, s.priceUnit, s.priceBasis, s.availability], ['2027-07-07', 1025, 'CAD', 'package', 'person', 'on_request']);
  assert.match(s.availabilityText!, /CAD 1025 \+ tax \(5% GST\) per person for the 3-day camp/);
  assert.match(s.availabilityText!, /accommodation not included/);

  const midSummer = buildElSlots(camps, '2027-07-01');
  assert.deepEqual(midSummer.map(x => x.startDate).sort(), ['2027-07-05', '2027-07-12', '2027-07-19', '2027-08-09', '2027-08-16', '2027-08-23']);
});

test('elevation: a "sold out" word on a date line overrides on_request', () => {
  const html = nitinat.replace('<li>July 5-6-7</li>', '<li>July 5-6-7 SOLD OUT</li>');
  const slots = buildElSlots(parseElCamps(html), '2026-10-23');
  assert.equal(slots.find(s => s.key === 'womens-kite-camp|2027-07-05')!.availability, 'sold_out');
  assert.equal(slots.find(s => s.key === 'womens-kite-camp|2027-07-19')!.availability, 'on_request');
});

test('elevation: fetchSlots from fixtures', async () => {
  const slots = await elevationNitinatLakeKiteWingCamps.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.ok(slots.every(s => s.startDate! > '2026-10-23'));
});

test('elevation: content', async () => {
  const c = parseElContent({ nitinat, women, wing }, '2026-10-23');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.accommodation, c.mealPlan], ['course', 3, 'Canada', 'Nitinat Lake, Vancouver Island', 'Nitinat Lake', null, null]);
  assert.deepEqual(c.skillLevels, ['beginner', 'intermediate']);
  assert.match(c.summary, /where the wind season runs May to September with winds of usually 15 to 25 knots/);
  assert.match(c.summary, /Summer 2027 camps: women's kite, co-ed kiteboarding, co-ed wing foiling, kids wing foiling and kids kiteboarding camps, at CAD 1,025 plus 5% GST per person \(kids CAD 995, ages 8 to 16\)\./);
  assert.match(c.summary, /Accommodation is not included: guests camp at the Nitinat Lake campground/);
  assert.ok(!/[–—]/.test(c.summary + c.title));
  assert.equal(c.imageUrls.length, 10);
  assert.equal(c.imageUrls[0], 'https://elevationkiteboarding.com/cdn/shop/files/wing3_1400x.jpg?v=1636470991');
  assert.ok(c.imageUrls.every(u => !/group_team|top_of_page|second_picture|foil02|kitecamp_img|\/camp_\d|map_|\.heic|\{width\}|%7B/.test(u)));
  assert.deepEqual(elevationNitinatLakeKiteWingCamps.disciplines, ['kitesurf', 'wingfoil']);
  const live = await elevationNitinatLakeKiteWingCamps.fetchContent(ctx);
  assert.equal(contentProblem(live), null);
});
