import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagRoomsWithoutSlots, repriceStoredRooms } from '../../src/offers/ingest.js';
import { csobRooms, HSC_ROOMS, hvideSandeCamping } from '../../src/offers/adapters/hvide-sande-camping.js';
import type { Slot } from '../../src/offers/types.js';

const slot = (o: Partial<Slot>): Slot => ({
  key: `${o.unit}|${o.startDate}`, startDate: '2027-05-01', endDate: '2027-05-08', unit: null, price: 4000, currency: 'DKK',
  priceUnit: 'per_week', priceBasis: 'room', occupancy: null, availability: 'available',
  availabilityText: null, spotsLeft: 2, ...o,
});
const harbour = 'The Harbour Cottage (Havnehytten)', beach = 'The Beach Cottage (Strandhytten)';
// stored rows as live on 2026-11-03: the harbour cabin has its card on the site but no engine dates
const stored = [
  { name: beach, price_from: 3900, price_currency: 'DKK', photos: [{ path: 'a.webp' }], features: ['4 beds'] },
  { name: harbour, price_from: null, price_currency: null, photos: [{ path: 'h.webp' }], features: ['6 beds'], availability: [] },
];

test('flagRoomsWithoutSlots: a room no engine slot names is hidden, the row stays whole', () => {
  const slots = csobRooms([slot({ unit: 'Beach Cabins' })], HSC_ROOMS);
  const f = flagRoomsWithoutSlots(stored, slots, stored, false);
  assert.deepEqual(f.hidden, [harbour]);
  assert.deepEqual(f.shown, []);
  assert.equal(f.rows[0].hidden, undefined);
  assert.deepEqual(f.rows[1], { ...stored[1], hidden: true });
});

test('flagRoomsWithoutSlots: back in the engine (also sold out) the flag goes and the room is shown again', () => {
  const wasHidden = [stored[0], { ...stored[1], hidden: true }];
  const slots = csobRooms([slot({ unit: 'Beach Cabins' }), slot({ unit: 'The Harbor Cabin', availability: 'sold_out', spotsLeft: 0 })], HSC_ROOMS);
  const f = flagRoomsWithoutSlots(wasHidden, slots, wasHidden, false);
  assert.deepEqual(f.shown, [harbour]);
  assert.deepEqual(f.hidden, []);
  assert.equal('hidden' in f.rows[1], false);
  // still missing: stays hidden, no note again
  const again = flagRoomsWithoutSlots(wasHidden, csobRooms([slot({ unit: 'Beach Cabins' })], HSC_ROOMS), wasHidden, false);
  assert.deepEqual([again.hidden, again.shown, again.rows[1].hidden], [[], [], true]);
});

test('flagRoomsWithoutSlots: a guarded or failed run keeps the stored flags (no evidence either way)', () => {
  const wasHidden = [stored[0], { ...stored[1], hidden: true }];
  const f = flagRoomsWithoutSlots(wasHidden, [], wasHidden, true);
  assert.deepEqual([f.rows[0].hidden, f.rows[1].hidden, f.hidden, f.shown], [undefined, true, [], []]);
  // a full run builds fresh rows without the field: the stored flag is carried over by name
  const fresh = stored.map(({ name, price_from }) => ({ name, price_from }));
  assert.equal(flagRoomsWithoutSlots(fresh, [], wasHidden, true).rows[1].hidden, true);
});

test('flagRoomsWithoutSlots: the slots run re-prices and flags the stored rows end to end', () => {
  const slots = csobRooms([slot({ unit: 'Beach Cabins', price: 4100 }), slot({ unit: 'The Harbor Cabin', price: 6100 })], HSC_ROOMS);
  const reprices = repriceStoredRooms('accommodation', [stored[0], { ...stored[1], hidden: true }], slots, '2026-11-03')! as Array<Record<string, unknown> & { name: string }>;
  const f = flagRoomsWithoutSlots(reprices, slots, [stored[0], { ...stored[1], hidden: true }], false);
  assert.deepEqual(f.shown, [harbour]);
  assert.equal(f.rows[1].price_from, 6100);
  assert.equal('hidden' in f.rows[1], false);
});

test('hvide-sande-camping opts in; the flag is per adapter', () => {
  assert.equal(hvideSandeCamping.hideRoomsWithoutSlots, true);
});
