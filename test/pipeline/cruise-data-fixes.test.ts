// Write-path fixes for the cruise layer (audit 2026-10-27): dates, continent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upcomingDepartures } from '../../src/pipeline/cruise-state.js';
import { continentForOffer } from '../../src/lib/continents.js';

const TODAY = '2026-10-27';

test('upcomingDepartures: drops all-null rows and finished departures', () => {
  assert.equal(upcomingDepartures([{ price: null, status: null, currency: null, start_date: null, end_date: null }], TODAY), null);
  assert.equal(upcomingDepartures([{ price: 15950, status: 'available', currency: 'USD', start_date: '2024-01-02', end_date: '2024-01-23' }], TODAY), null);
  assert.deepEqual(upcomingDepartures([
    { price: 1750, status: null, currency: 'EUR', start_date: null, end_date: null },
    { price: 1600, status: 'available', currency: 'EUR', start_date: '2025-05-01', end_date: null },
    { price: 1600, status: 'available', currency: 'EUR', start_date: '2026-10-20', end_date: '2026-10-27' }, // ends today: still shown
    { price: 1650, status: 'few spots', currency: 'eur', start_date: '2027-05-01', end_date: '2027-05-08' },
  ], TODAY), [
    { start_date: '2026-10-20', end_date: '2026-10-27', price: 1600, currency: 'EUR', status: 'available' },
    { start_date: '2027-05-01', end_date: '2027-05-08', price: 1650, currency: 'EUR', status: 'few_spots' },
  ]);
  assert.equal(upcomingDepartures(null, TODAY), null);
});

test('continentForOffer: own country first, else the one continent all countries share', () => {
  assert.equal(continentForOffer('Saint Vincent and the Grenadines', []), 'North America');
  assert.equal(continentForOffer('Antarctica', ['Argentina', 'Antarctica']), 'Antarctica');
  assert.equal(continentForOffer(null, ['Martinique', 'Saint Lucia', 'Grenada']), 'North America');
  assert.equal(continentForOffer(null, ['Greece', 'Croatia', 'Denmark', 'Caribbean']), null); // spans continents
  assert.equal(continentForOffer(null, []), null);
  assert.equal(continentForOffer('Turks and Caicos Islands', []), 'North America'); // live row 81319bc5 stayed null
});
