import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapsPlace, pickPlace, placeIdPatch } from '../../src/pipeline/google-place-ids.js';

test('reads place name, coordinates and zoom from a stored Maps place URL', () => {
  assert.deepEqual(mapsPlace('https://www.google.com/maps/place/Kite+Charters/@37.1008923,25.1603254,12z'),
    { name: 'Kite Charters', lat: 37.1008923, lng: 25.1603254, zoom: 12 });
  assert.deepEqual(mapsPlace('https://www.google.com/maps/place/Caf%C3%A9+Vent/@-4.3,39.5,17z'), { name: 'Café Vent', lat: -4.3, lng: 39.5, zoom: 17 });
  assert.equal(mapsPlace('https://www.google.com/maps/place//@52.5,13.4,13z'), null);
  assert.equal(mapsPlace('https://example.com/maps/place/X/@1,2,17z'), null);
  assert.equal(mapsPlace(null), null);
});

test('accepts only a candidate that shares a name token and lies near the known location', () => {
  const provider = { name: 'Kite Charters', root_domain: 'kitecharters.com' };
  const at = { name: 'Kite Charters', lat: 37.1, lng: 25.16, zoom: 17 };
  const near = { id: 'ChIJ_near_place_id_123', displayName: 'Kite Charters Naxos', lat: 37.1009, lng: 25.1603 };
  const far = { id: 'ChIJ_far_place_id_1234', displayName: 'Kite Charters', lat: 37.2, lng: 25.3 };
  const other = { id: 'ChIJ_other_place_id_12', displayName: 'Mikri Vigla Beach', lat: 37.1001, lng: 25.1601 };
  assert.equal(pickPlace(provider, at, [other, far, near])?.id, near.id);
  // Zoomed-out links only fix the area: a wider radius, but never a name mismatch.
  assert.equal(pickPlace(provider, { ...at, zoom: 12 }, [far])?.id, far.id);
  assert.equal(pickPlace(provider, at, [far]), null);
  assert.equal(pickPlace(provider, at, [other]), null);
  // A shared generic word ("kite") is no identity.
  assert.equal(pickPlace(provider, at, [{ id: 'ChIJ_cafe_place_id_123', displayName: 'Kite Beach Cafe', lat: 37.1, lng: 25.16 }]), null);
  // Two passing candidates: the nearer one.
  const nearer = { ...near, id: 'ChIJ_nearer_place_id_1', lat: 37.1, lng: 25.16 };
  assert.equal(pickPlace(provider, at, [near, nearer])?.id, nearer.id);
});

test('writes only the place ID and its match time, never a rating', () => {
  assert.deepEqual(placeIdPatch('ChIJ_near_place_id_123', '2026-10-31T12:00:00Z'),
    { google_place_id: 'ChIJ_near_place_id_123', google_place_matched_at: '2026-10-31T12:00:00Z' });
  assert.throws(() => placeIdPatch('https://maps.google.com/x', 'now'));
});
