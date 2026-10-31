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

test('roomsWithPrices: priced_months counts every month a priced slot covers (Aaron 2026-10-31)', () => {
  const content = { kind: 'accommodation', rooms: [
    { name: 'Cult', description: null, features: [] },
    { name: 'Open', description: null, features: [] },
    { name: 'Long', description: null, features: [] },
  ] } as unknown as OfferContent;
  const rows = roomsWithPrices(content, [
    // Kenyaways "Cult" season ranges: Jan 18 - Feb 28 prices February too, Mar 1 - May 31 prices April and May
    ...[['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-30'], ['2026-12-01', '2026-12-17'], ['2026-12-18', '2027-01-17'],
      ['2027-01-18', '2027-02-28'], ['2027-03-01', '2027-05-31']].map(([startDate, endDate]) => slot({ unit: 'Cult', startDate, endDate, price: 45 })),
    // no end date: only its start month; a full sold-out month adds nothing
    slot({ unit: 'Open', startDate: '2026-11-05', price: 60 }),
    slot({ unit: 'Open', startDate: '2027-02-01', endDate: '2027-02-28', price: 60, availability: 'sold_out' }),
    // longer than a year: each month once
    slot({ unit: 'Long', startDate: '2026-11-01', endDate: '2028-01-31', price: 70 }),
  ], '2026-10-31');
  assert.deepEqual(rows.map(r => r.priced_months), [[1, 2, 3, 4, 5, 10, 11, 12], [11], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]]);
});

test('roomsWithPrices: price_from_is_minimum only when the price is a floor (Aaron 2026-10-31)', () => {
  const content = { kind: 'accommodation', rooms: [
    { name: 'Fixed', description: null, features: [] },
    { name: 'Seasons', description: null, features: [] },
    { name: 'Range', description: null, features: [] },
    { name: 'Same price twice', description: null, features: [] },
  ] } as unknown as OfferContent;
  const rows = roomsWithPrices(content, [
    // one price for the whole stated period: a real price, shown as it is
    slot({ unit: 'Fixed', startDate: null, endDate: null, price: 55 }),
    // several season prices: price_from is the cheapest season
    slot({ unit: 'Seasons', startDate: '2026-11-01', endDate: '2026-12-17', price: 189 }),
    slot({ unit: 'Seasons', startDate: '2026-12-18', endDate: '2026-12-26', price: 239 }),
    // "od 100 zł do 750 zł": the floor of a range the provider gives without dates
    slot({ unit: 'Range', startDate: null, endDate: null, price: 100, priceIsMinimum: true }),
    // two dated slots at one price are still one price
    slot({ unit: 'Same price twice', startDate: '2026-11-01', endDate: '2026-11-30', price: 70 }),
    slot({ unit: 'Same price twice', startDate: '2026-12-01', endDate: '2026-12-31', price: 70 }),
  ], '2026-10-31');
  assert.deepEqual(rows.map(r => [r.name, r.price_from, r.price_from_is_minimum]),
    [['Fixed', 55, false], ['Seasons', 189, true], ['Range', 100, true], ['Same price twice', 70, false]]);
});
