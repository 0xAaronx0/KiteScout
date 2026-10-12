// Dakhla Downwind Challenge: replays the page fixture recorded 2026-10-09.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dakhlaDownwindChallenge, parseDakhlaEvent, parseDakhlaSlots, parseDakhlaStages,
} from '../../src/offers/adapters/dakhla-downwind-challenge.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/dakhla-downwind-challenge');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith('dakhladownwindchallenge.com'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('dakhla: event dates and fee table', () => {
  const ev = parseDakhlaEvent(html)!;
  assert.equal(ev.start, '2027-08-14');
  assert.equal(ev.end, '2027-08-20');
  assert.equal(ev.regularPrice, 1700);
  assert.equal(ev.currentPrice, 1610);
  assert.equal(ev.currency, 'EUR');
  assert.equal(ev.discountUntil, '2027-05-31');
  assert.equal(ev.features.length, 6);
});

test('dakhla: early-bird price until the deadline, regular after', () => {
  const before = parseDakhlaSlots(html, '2026-10-09');
  assert.equal(before.length, 1);
  assert.equal(before[0].price, 1610);
  assert.equal(parseDakhlaSlots(html, '2027-05-31')[0].price, 1610);
  assert.equal(parseDakhlaSlots(html, '2027-06-01')[0].price, 1700);
  assert.equal(parseDakhlaSlots(html, '2027-06-01')[0].priceValidUntil, null);
  const { ok, problems } = checkSlots(before);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok[0], {
    key: '2027-08-14', startDate: '2027-08-14', endDate: '2027-08-20', unit: null,
    price: 1610, currency: 'EUR', priceUnit: 'package', priceBasis: 'person', occupancy: null,
    availability: 'on_request',
    availabilityText: 'Spots are limited and confirmed on a first-come, first-served basis.',
    spotsLeft: null,
    priceValidUntil: '2027-05-31',
  });
});

test('dakhla: adapter slots (live date) are structurally the same slot', async () => {
  const slots = await dakhlaDownwindChallenge.fetchSlots(ctx);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].key, '2027-08-14');
  assert.ok([1610, 1700].includes(slots[0].price!));
});

test('dakhla: stages and content', async () => {
  assert.deepEqual(parseDakhlaStages(html).map(s => `${s.from} > ${s.to}`), [
    'Dakhla > Puertito Beach', 'Puertito Beach > Shipwreck Beach', 'Shipwreck Beach > Ain Baida',
    'Ain Baida > Bir Guendouz', 'Bir Guendouz > Lagouira',
  ]);
  const c = await dakhlaDownwindChallenge.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Dakhla Downwind Challenge 2027');
  assert.equal(c.country, 'Morocco');
  assert.equal(c.durationDays, 7);
  assert.equal(c.itinerarySpots.length, 6);
  assert.equal(c.itinerarySpots.at(-1)!.name, 'Lagouira');
  assert.equal(c.mealPlan, 'full_board');
  assert.equal(c.beginnerFriendly, false);
  assert.ok(c.includedServices.includes('3 nights at New Spirit Dakhla'));
  assert.equal(c.optionalServices.length, 1);
  assert.ok(c.imageUrls.length >= 20, `images ${c.imageUrls.length}`);
  assert.ok(c.imageUrls.every(u => !/\.png$|Julien-Cachard|Tom-Court/i.test(u)), 'no logos or athlete portraits');
  assert.equal(c.heroVideoUrl, null);
  assert.match(c.summary, /EUR 1,610 per person until 2027-05-31, then EUR 1,700/);
  assert.ok(!/[—–]/.test(c.summary), 'summary has no em/en dashes');
});
