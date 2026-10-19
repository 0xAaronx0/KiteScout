// RIDE Kitesurfing Troubridge Island trip: replays /pages/troubridge-island + /pages/trips recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildRideSlots, mergeRideTrips, parseRideContent, parseRideDetailTrips, parseRidePrices, parseRideTrips,
  rideKitesurfingTroubridgeIslandTrip,
} from '../../src/offers/adapters/ride-kitesurfing-troubridge-island-trip.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/ride-kitesurfing-troubridge-island-trip');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (part: string) => readFileSync(join(DIR, files.find(f => f.includes(part))!), 'utf8');
const detail = read('pages_troubridge-island');
const trips = read('pages_trips');
const ctx = { note: () => {}, incomplete: () => {} };

test('ride: 2027 Troubridge dates from the trips page, 2026 dates from the detail page, Yorks trips ignored', () => {
  assert.deepEqual(parseRideTrips(trips).map(t => [t.start, t.end]), [['2027-01-15', '2027-01-20'], ['2027-02-15', '2027-02-20']]);
  assert.deepEqual(parseRideDetailTrips(detail).map(t => [t.start, t.end]), [['2026-01-11', '2026-01-16'], ['2026-02-08', '2026-02-13']]);
  assert.deepEqual(parseRidePrices(detail).map(p => [p.price, p.occupancy]), [[1999, 2], [1999, 3], [1799, null]]);
});

test('ride: one slot per future date x option, past 2026 trips dropped, price marked as last printed', () => {
  const all = mergeRideTrips(parseRideTrips(trips), parseRideDetailTrips(detail));
  const slots = buildRideSlots(all, parseRidePrices(detail), [2026], '2026-10-19');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 6);
  assert.ok(ok.every(s => s.startDate! >= '2027-01-01' && s.currency === 'AUD' && s.priceBasis === 'person' && s.availability === 'on_request'));
  assert.equal(Math.min(...ok.map(s => s.price!)), 1799);
  assert.match(ok[0].availabilityText!, /last printed .*2026 trips/);
  assert.equal(buildRideSlots(all, parseRidePrices(detail), [2026], '2027-03-01').length, 0);
});

test('ride: content is a valid camp with page photos', async () => {
  const c = await rideKitesurfingTroubridgeIslandTrip.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 6);
  assert.equal(c.imageUrls.length, 5);
  assert.ok(c.imageUrls.every(u => /^https:\/\/cdn\.shopify\.com\/s\/files\/.+_n\.jpg$/.test(u)), c.imageUrls.join('\n'));
  assert.match(parseRideContent({ detail, trips }, '2026-10-19').summary, /Trip dates: 2027-01-15 to 2027-01-20, 2027-02-15 to 2027-02-20/);
  assert.match(parseRideContent({ detail, trips }, '2027-03-01').summary, /next dates are not published yet/);
  assert.doesNotMatch(c.summary, /[–—]/);
});

test('ride: fetchSlots replays with 6 valid slots', async () => {
  const slots = await rideKitesurfingTroubridgeIslandTrip.fetchSlots(ctx);
  assert.ok(slots.every(s => s.startDate === null || s.startDate >= new Date().toISOString().slice(0, 10)));
  assert.deepEqual(checkSlots(slots).problems, []);
});
