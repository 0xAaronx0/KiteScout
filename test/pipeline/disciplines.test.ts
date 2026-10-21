// cruiseDisciplines: cruises are water trips; wingfoil when the trip itself offers wing (sessions, coaching, gear).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cruiseDisciplines } from '../../src/lib/disciplines.js';

test('cruiseDisciplines: wing mentions on the trip add wingfoil', () => {
  assert.deepEqual(cruiseDisciplines({ title: 'Grenadines Kite & Wingfoil Cruise' }), ['kitesurf', 'wingfoil']);
  assert.deepEqual(cruiseDisciplines({ title: 'Bahamas Exuma Cays Kite & Wing Cruise (Lagoon 52)' }), ['kitesurf', 'wingfoil']);
  assert.deepEqual(cruiseDisciplines({ title: 'Red Sea Kite Safari', optional_services: ['wing foil lessons'] }), ['kitesurf', 'wingfoil']);
  assert.deepEqual(cruiseDisciplines({ title: 'North Sardinia Cruise', summary: 'A kitesurfing and wingsurfing cruise.' }), ['kitesurf', 'wingfoil']);
  assert.deepEqual(cruiseDisciplines({ title: 'Kite Cruise', included_services: ['kite/wingfoil supervision'] }), ['kitesurf', 'wingfoil']);
});

test('cruiseDisciplines: plain kite cruises stay kitesurf, sub-wing is not wing foil', () => {
  assert.deepEqual(cruiseDisciplines({ title: 'Cyclades Kite Cruise', summary: 'Kiteboarding and snorkelling.' }), ['kitesurf']);
  assert.deepEqual(cruiseDisciplines({ title: 'Kite Safari', included_services: ['SUP board use', 'sub-wing use'] }), ['kitesurf']);
  assert.deepEqual(cruiseDisciplines({}), ['kitesurf']);
});
