import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotRoom, roomAvailability, roomsWithPrices } from '../../src/offers/ingest.js';
import type { OfferContent, Slot } from '../../src/offers/types.js';

const slot = (o: Partial<Slot>): Slot => ({
  key: o.unit ?? 'x', startDate: null, endDate: null, unit: null, price: null, currency: 'EUR',
  priceUnit: 'per_night', priceBasis: 'person', occupancy: 1, availability: 'available',
  availabilityText: null, spotsLeft: null, ...o,
});

test('slotRoom: exact, case-insensitive, qualifier prefix, explicit room', () => {
  const rooms = ['Mixed dorm', 'Girls dorm', 'Beach Bungalow', 'Wooden Bungalow', 'Wooden Bungalow in the forest', 'Double room'];
  assert.equal(slotRoom(rooms, { unit: 'Mixed dorm (bed)' }), 'Mixed dorm');
  assert.equal(slotRoom(rooms, { unit: 'Beach bungalow' }), 'Beach Bungalow');
  assert.equal(slotRoom(rooms, { unit: 'Wooden Bungalow in the forest, 2 people, full board (high season)' }), 'Wooden Bungalow in the forest');
  assert.equal(slotRoom(rooms, { unit: 'Female dorm (bed)', room: 'Girls dorm' }), 'Girls dorm');
  assert.equal(slotRoom(rooms, { unit: 'Female dorm (bed)', room: 'Nope' }), null);
  // packages and other wording stay unmatched (no borrowed package prices)
  assert.equal(slotRoom(rooms, { unit: 'Rider package, double room' }), null);
  assert.equal(slotRoom(rooms, { unit: 'Double room with extra bed (3 people)' }), null);
  assert.equal(slotRoom(rooms, { unit: null }), null);
});

test('roomAvailability merges adjacent ranges with the same status and price', () => {
  const r = roomAvailability([
    slot({ startDate: '2026-11-02', endDate: '2026-11-02', price: 33 }),
    slot({ startDate: '2026-10-19', endDate: '2026-11-01', price: 33 }),
    slot({ startDate: '2026-11-03', endDate: '2027-09-30', price: null, currency: null, availability: 'closed' }),
    slot({ startDate: null, endDate: null, price: 40 }),
  ]);
  assert.deepEqual(r, [
    { start_date: '2026-10-19', end_date: '2026-11-02', status: 'available', price: 33, currency: 'EUR' },
    { start_date: '2026-11-03', end_date: '2027-09-30', status: 'closed', price: null, currency: null },
  ]);
});

test('roomsWithPrices prices dorms whose slot unit carries a qualifier', () => {
  const content = { kind: 'accommodation', rooms: [
    { name: 'Mixed dorm', description: null, features: [] },
    { name: 'Girls dorm', description: null, features: [] },
  ] } as unknown as OfferContent;
  const rows = roomsWithPrices(content, [
    slot({ unit: 'Mixed dorm (bed)', startDate: '2026-10-19', endDate: '2026-11-01', price: 33 }),
    slot({ unit: 'Female dorm (bed)', room: 'Girls dorm', startDate: '2026-10-19', endDate: '2026-11-01', price: 36 }),
  ], '2026-10-19');
  assert.deepEqual(rows.map(r => [r.name, r.price_from, r.price_basis, r.availability.length]),
    [['Mixed dorm', 33, 'person', 1], ['Girls dorm', 36, 'person', 1]]);
});

test('roomsWithPrices: a waitlist-only or past room price is still the room price (Aaron 2026-10-30)', () => {
  const content = { kind: 'tour', rooms: [
    { name: 'Twin Room', description: null, features: [] },
    { name: 'Flex Room', description: null, features: [] },
    { name: 'Suite', description: null, features: [] },
    { name: 'Dorm', description: null, features: [] },
  ] } as unknown as OfferContent;
  const trip = (o: Partial<Slot>) => slot({ priceUnit: 'package', startDate: '2026-11-06', endDate: '2026-11-16', ...o });
  const rows = roomsWithPrices(content, [
    // only waitlist dates ahead -> their cheapest price
    trip({ unit: 'Twin Room', price: 2675, endDate: '2026-11-20', availability: 'waitlist' }),
    trip({ unit: 'Twin Room', price: 2025, availability: 'waitlist' }),
    // a bookable date always wins over a cheaper waitlist one
    trip({ unit: 'Flex Room', price: 1725, availability: 'waitlist' }),
    trip({ unit: 'Flex Room', price: 1900, startDate: '2026-12-01', endDate: '2026-12-11' }),
  ], '2026-10-30', [
    // dates that are over: only the latest year counts
    trip({ unit: 'Suite', price: 3100, startDate: '2026-03-01', endDate: '2026-03-11' }),
    trip({ unit: 'Suite', price: 2800, startDate: '2025-03-01', endDate: '2025-03-11' }),
  ]);
  assert.deepEqual(rows.map(r => [r.name, r.price_from, r.price_unit, r.price_basis]),
    [['Twin Room', 2025, 'package', 'person'], ['Flex Room', 1900, 'package', 'person'], ['Suite', 3100, 'package', 'person'], ['Dorm', null, null, null]]);
  // availability keeps only the upcoming dates; priced months only bookable ones
  assert.equal(rows[0].availability.length, 2);
  assert.deepEqual(rows[0].priced_months, []);
  assert.deepEqual(rows[1].priced_months, [12]);
});
