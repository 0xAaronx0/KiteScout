// Hotel Orkos Beach / Flisvos Kite Centre (Mikri Vigla, Naxos): replays the pages recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  hotelOrkosBeachMikriVigla, buildOrkosSlots, decodeCfEmail, orkosCoords, orkosPriceYear, parseOrkosBands,
  parseOrkosRooms,
} from '../../src/offers/adapters/hotel-orkos-beach-mikri-vigla.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/hotel-orkos-beach-mikri-vigla');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const acc = read('www.flisvos-kitecentre.com_accommodation_.');

test('orkos: price-list year from the linked PDF', () => {
  assert.equal(orkosPriceYear(acc), 2026);
  assert.equal(orkosPriceYear('<a href="/wp-content/uploads/2027/01/prices-Kite-Hotel-2027.pdf">Price List</a>'), 2027);
  assert.equal(orkosPriceYear('<p>no list</p>'), null);
});

test('orkos: season bands, boundary days read as changeover days', () => {
  assert.deepEqual(parseOrkosBands(acc, 2026).map(b => [b.column, b.start, b.end]), [
    [0, '2026-05-20', '2026-06-15'],
    [1, '2026-06-16', '2026-07-07'],
    [2, '2026-07-08', '2026-08-27'],
    [1, '2026-08-28', '2026-09-15'],
    [0, '2026-09-16', '2026-09-30'],
  ]);
});

test('orkos: room rows', () => {
  const rooms = parseOrkosRooms(acc);
  assert.deepEqual(rooms.map(r => [r.name, r.maxGuests, r.prices]), [
    ['Twin', 2, [68, 99, 149]],
    ['Triple', 3, [77, 108, 167]],
    ['Quadruple', 4, [86, 117, 176]],
    ['Family room', 4, [99, 149, 226]],
    ['Luxury double', 2, [95, 126, 162]],
    ['Luxury triple', 3, [113, 144, 180]],
    ['Luxury family', 3, [122, 171, 229]],
    ['Luxury split level', 5, [126, 180, 248]],
  ]);
  assert.deepEqual(rooms[7].features, ['2 rooms on 2 levels', '2 bathrooms', 'Fridge', 'Balcony', 'Terrace']);
});

test('orkos: slots = room x season band, EUR per room per night, on request', async () => {
  const slots = await hotelOrkosBeachMikriVigla.fetchSlots(ctx);
  assert.deepEqual(slots, buildOrkosSlots(parseOrkosRooms(acc), parseOrkosBands(acc, 2026)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 40);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.availability === 'on_request'));
  const twinHigh = slots.find(s => s.key === 'twin|2026-07-08')!;
  assert.deepEqual([twinHigh.startDate, twinHigh.endDate, twinHigh.price, twinHigh.occupancy], ['2026-07-08', '2026-08-27', 149, 2]);
  assert.equal(slots.find(s => s.key === 'luxury-split-level|2026-09-16')!.price, 126);
  assert.equal(Math.min(...slots.map(s => s.price!)), 68);
});

test('orkos: e-mail and map pin from the site', () => {
  assert.equal(decodeCfEmail('24494d474c4148416442484d57524b57094f4d504147414a5056410a474b49'), 'michele@flisvos-kitecentre.com');
  assert.deepEqual(orkosCoords(acc), { lat: 37.02811, lng: 25.37284 });
});

test('orkos: content', async () => {
  const c = await hotelOrkosBeachMikriVigla.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Hotel Orkos Beach');
  assert.equal(c.spot, 'Mikri Vigla, Naxos');
  assert.equal(c.mealPlan, 'breakfast');
  assert.match(c.summary, /about 50 m from the beach/);
  assert.match(c.summary, /EUR 68-248 per room per night/);
  assert.match(c.summary, /RRD/);
  assert.equal(c.rooms.length, 8);
  assert.ok(c.rooms[0].features.includes('08.07 – 28.08 2026: EUR 149 per room per night (breakfast included)'));
  assert.equal(c.imageUrls.length, 11);
  assert.match(c.sourceText ?? '', /Check-in time: 2:00 PM/);
});
