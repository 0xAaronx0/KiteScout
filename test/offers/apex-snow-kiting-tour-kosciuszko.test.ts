// Apex Kitesurfing 5 Day Snow Kiting Tour, Kosciuszko: replays /snow-kiting-tours + the Wix service page recorded
// 2026-10-19 ("2027 dates releasing soon" -> no slots). The date parser is checked with a synthetic dated line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  APEX_ROUTE, apexSnowKitingTourKosciuszko, buildApexSlots, parseApexService, parseApexTour,
} from '../../src/offers/adapters/apex-snow-kiting-tour-kosciuszko.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/apex-snow-kiting-tour-kosciuszko');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (part: string) => readFileSync(join(DIR, files.find(f => f.includes(part))!), 'utf8');
const tours = read('snow-kiting-tours');
const service = read('service-page');
const ctx = { note: () => {}, incomplete: () => {} };

test('apex: itinerary days, no dates yet, service price A$9,850 booked out', () => {
  const t = parseApexTour(tours);
  assert.equal(t.days.length, 6);
  assert.equal(t.dates.length, 0);
  assert.equal(t.datesNote, '2027 dates releasing soon');
  const s = parseApexService(service);
  assert.deepEqual([s.price, s.currency, s.bookedOut], [9850, 'AUD', true]);
});

test('apex: no slots today; a printed future range becomes a priced slot without basis', async () => {
  assert.deepEqual(await apexSnowKitingTourKosciuszko.fetchSlots(ctx), []);
  const t = parseApexTour(tours.replace('2027 dates releasing soon', '2027 dates releasing soon</p><p>12th - 17th July 2027'));
  assert.deepEqual(t.dates.map(d => [d.start, d.end]), [['2027-07-12', '2027-07-17']]);
  const slots = buildApexSlots(t, parseApexService(service), '2026-10-19');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual([slots[0].price, slots[0].currency, slots[0].priceUnit, slots[0].priceBasis], [9850, 'AUD', 'package', null]);
});

test('apex: valid tour content with the Snowy Mountains route', async () => {
  const c = await apexSnowKitingTourKosciuszko.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'tour');
  assert.equal(c.durationDays, 6);
  assert.deepEqual(c.itinerarySpots.map(s => s.name), APEX_ROUTE.map(s => s.name));
  assert.ok(c.imageUrls.length >= 8 && c.imageUrls.every(u => /static\.wixstatic\.com\/media\/d444dc_/.test(u)));
  assert.match(c.summary, /2027 dates are not published yet/);
  assert.doesNotMatch(c.summary, /[–—]/);
});
