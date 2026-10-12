import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeItinerarySpots, type StoredSpot } from '../../src/lib/itinerary-spots.js';

const spot = (name: string, lat: number | null = null, lng: number | null = null, order = 0): StoredSpot =>
  ({ name, country: 'Egypt', region: 'Red Sea', lat, lng, order });

test('mergeItinerarySpots: an empty re-run keeps the stored located spots', () => {
  const stored = [spot('Hurghada', 27.2226, 33.8307)];
  const r = mergeItinerarySpots([], stored);
  assert.deepEqual(r.spots, stored);
  assert.match(r.note!, /kept 1 stored spot/);
});

test('mergeItinerarySpots: un-geocoded fresh spots do not replace a located stored list', () => {
  const stored = [spot('Hurghada', 27.2226, 33.8307), spot('Northern Red Sea Islands', null, null, 1)];
  const r = mergeItinerarySpots([spot('Giftun Islands')], stored);
  assert.deepEqual(r.spots, stored);
});

test('mergeItinerarySpots: a same-named fresh spot takes the stored coordinates', () => {
  const r = mergeItinerarySpots(
    [spot('Ashrafi Islands'), spot('Hurghada', 27.22, 33.83, 1)],
    [spot('ashrafi islands', 27.78, 33.71)],
  );
  assert.deepEqual(r.spots.map(s => [s.name, s.lat, s.lng]), [['Ashrafi Islands', 27.78, 33.71], ['Hurghada', 27.22, 33.83]]);
  assert.match(r.note!, /kept stored coords for 1 spot/);
});

test('mergeItinerarySpots: a located fresh route replaces the stored one', () => {
  const fresh = [spot('El Gouna', 27.3989, 33.6742)];
  const r = mergeItinerarySpots(fresh, [spot('Hurghada', 27.2226, 33.8307)]);
  assert.deepEqual(r.spots, fresh);
  assert.equal(r.note, null);
});

test('mergeItinerarySpots: nothing located anywhere keeps the fresh names', () => {
  const fresh = [spot('Cyclades islands')];
  const r = mergeItinerarySpots(fresh, [spot('Old name')]);
  assert.deepEqual(r.spots, fresh);
  assert.equal(r.note, null);
  assert.deepEqual(mergeItinerarySpots([], null).spots, []);
});
