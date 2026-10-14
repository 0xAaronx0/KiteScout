// Hotel Hondo (Wahoo Wind Co.), Los Barriles: replays the pages recorded 2026-10-14.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  wahooWindHotelHondoLosBarriles, buildWwSlots, parseHhCloudbeds, parseHhRooms, parseWwCamps,
} from '../../src/offers/adapters/wahoo-wind-hotel-hondo-los-barriles.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/wahoo-wind-hotel-hondo-los-barriles');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const camps = read('www.wahoowind.com_lessons-shop_camps-clinics.');

test('hondo: Squarespace camp products with USD prices, nights and hours', () => {
  assert.deepEqual(parseWwCamps(camps).map(c => [c.title, c.price, c.currency, c.soldOut, c.nights, c.hours, c.taxesIncluded]), [
    ['5-Day Kitesurf Camp', 1750, 'USD', false, 4, 9, true],
    ['5-Day Beginner Wingfoil Camp', 1375, 'USD', false, null, 6, true],
    ['7-Day Kitesurf Camp', 2150, 'USD', false, 6, 12, true],
    ['7-Day Beginner Wingfoil Camp', 1650, 'USD', false, null, 9, true],
  ]);
});

test('hondo: slots = the two kitesurf Learn & Stay camps, undated, per private room', async () => {
  const slots = await wahooWindHotelHondoLosBarriles.fetchSlots(ctx);
  assert.deepEqual(slots, buildWwSlots(parseWwCamps(camps)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.currency, s.priceUnit, s.priceBasis, s.packageNights, s.availability, s.startDate]), [
    ['5-day-kitesurf-camp', 1750, 'USD', 'package', 'room', 4, 'unknown', null],
    ['7-day-kitesurf-camp', 2150, 'USD', 'package', 'room', 6, 'unknown', null],
  ]);
  assert.equal(ok[0].unit, '5-Day Kitesurf Camp (4 nights at Hotel Hondo, 9 h lessons or coaching)');
  // a store "soldOut" flag becomes sold_out
  const soldOut = buildWwSlots([{ ...parseWwCamps(camps)[0], soldOut: true }]);
  assert.equal(soldOut[0].availability, 'sold_out');
});

test('hondo: map pin and photos from the hotel\'s own Cloudbeds reservation page (JSON-LD)', () => {
  const cb = parseHhCloudbeds(read('hotels.cloudbeds.com_reservation_AjW0nK.'));
  assert.deepEqual(cb.pin, { lat: 23.68866539, lng: -109.70078278 });
  assert.equal(cb.images.length, 16);
  assert.ok(cb.images.every(u => /^https:\/\/h-img\d\.cloudbeds\.com\/uploads\/186053\//.test(u) && !/logo/i.test(u)));
});

test('hondo: content', async () => {
  const c = await wahooWindHotelHondoLosBarriles.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Hotel Hondo (Wahoo Wind Co.)');
  assert.equal(c.region, 'Los Barriles, Baja California Sur');
  assert.deepEqual(c.spotCoords, { lat: 23.68866539, lng: -109.70078278 });
  assert.deepEqual(parseHhRooms(read('www.hotelhondo.com_rooms.')).map(r => r.name), ['Garden Room', 'Poolside Room', 'Patio Room']);
  assert.deepEqual(c.rooms.map(r => r.name), ['Garden Room', 'Poolside Room', 'Patio Room']);
  assert.match(c.summary, /sister company of the kite and wing school Wahoo Wind Co\./);
  assert.match(c.summary, /about 600 m from the beach/);
  assert.ok(c.optionalServices.includes('5-Day Beginner Wingfoil Camp: USD 1,375 incl. Hotel Hondo stay'));
  assert.ok(c.imageUrls.length >= 30);
  assert.ok(c.imageUrls.every(u => !/screenshot|map\b|\+map|logo|unsplash/i.test(u)));
});
