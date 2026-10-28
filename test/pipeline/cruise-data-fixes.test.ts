// Write-path fixes for the cruise layer (audit 2026-10-27): dates, continent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storedDepartures } from '../../src/pipeline/cruise-state.js';
import { continentForOffer } from '../../src/lib/continents.js';

const TODAY = '2026-10-27';

test('storedDepartures: drops rows without a start date, keeps the rest verbatim (Aaron 2026-10-28)', () => {
  assert.equal(storedDepartures([{ price: null, status: null, currency: null, start_date: null, end_date: null }]), null);
  const past = { price: 15950, status: 'available', currency: 'USD', start_date: '2024-01-02', end_date: '2024-01-23' };
  assert.deepEqual(storedDepartures([past]), [past]);
  // Los Roques: two prices on one start date (cabin types) both stay
  const a = { price: 3990, status: 'available', currency: 'USD', end_date: null, start_date: '2026-04-01' };
  const b = { price: 2590, status: 'available', currency: 'USD', end_date: null, start_date: '2026-04-01' };
  assert.deepEqual(storedDepartures([{ price: 1750, start_date: null }, a, b]), [a, b]);
  assert.equal(storedDepartures(null), null);
});

test('continentForOffer: own country first, else the one continent all countries share', () => {
  assert.equal(continentForOffer('Saint Vincent and the Grenadines', []), 'North America');
  assert.equal(continentForOffer('Antarctica', ['Argentina', 'Antarctica']), 'Antarctica');
  assert.equal(continentForOffer(null, ['Martinique', 'Saint Lucia', 'Grenada']), 'North America');
  assert.equal(continentForOffer(null, ['Greece', 'Croatia', 'Denmark', 'Caribbean']), null); // spans continents
  assert.equal(continentForOffer(null, []), null);
  assert.equal(continentForOffer('Turks and Caicos Islands', []), 'North America'); // live row 81319bc5 stayed null
});
