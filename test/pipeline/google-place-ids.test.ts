import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_MASK, OWN_REACH_KM, choosePlace, mapsPlace, ownDistanceKm, placeIdPatch, planApply, verdictFor, type PlaceIdResult } from '../../src/pipeline/google-place-ids.js';

test('reads place name, coordinates and zoom from a stored Maps place URL', () => {
  assert.deepEqual(mapsPlace('https://www.google.com/maps/place/Kite+Charters/@37.1008923,25.1603254,12z'),
    { name: 'Kite Charters', lat: 37.1008923, lng: 25.1603254, zoom: 12 });
  assert.deepEqual(mapsPlace('https://www.google.com/maps/place/Caf%C3%A9+Vent/@-4.3,39.5,17z'), { name: 'Café Vent', lat: -4.3, lng: 39.5, zoom: 17 });
  assert.equal(mapsPlace('https://www.google.com/maps/place//@52.5,13.4,13z'), null);
  assert.equal(mapsPlace('https://example.com/maps/place/X/@1,2,17z'), null);
  assert.equal(mapsPlace(null), null);
});

const provider = { name: 'Kite Charters', root_domain: 'kitecharters.com' };
const at = { name: 'Kite Charters', lat: 37.1, lng: 25.16, zoom: 17 };
const near = { id: 'ChIJ_near_place_id_123', displayName: 'Kite Charters Naxos', lat: 37.1009, lng: 25.1603 };
const far = { id: 'ChIJ_far_place_id_1234', displayName: 'Kite Charters', lat: 37.2, lng: 25.3 };
const other = { id: 'ChIJ_other_place_id_12', displayName: 'Mikri Vigla Beach', lat: 37.1001, lng: 25.1601 };
const idOf = (c: ReturnType<typeof choosePlace>) => c.kind === 'one' ? c.place.id : c.kind;

test('accepts only a candidate that shares a name token and lies near the stored Maps position', () => {
  assert.equal(idOf(choosePlace(provider, at, [other, far, near])), near.id);
  // Zoomed-out links only fix the area: a wider radius, but never a name mismatch.
  assert.equal(idOf(choosePlace(provider, { ...at, zoom: 12 }, [far])), far.id);
  assert.equal(idOf(choosePlace(provider, at, [far])), 'none');
  assert.equal(idOf(choosePlace(provider, at, [other])), 'none');
  // A shared generic word ("kite") is no identity.
  assert.equal(idOf(choosePlace(provider, at, [{ id: 'ChIJ_cafe_place_id_123', displayName: 'Kite Beach Cafe', lat: 37.1, lng: 25.16 }])), 'none');
  // Malformed IDs never pass.
  assert.equal(idOf(choosePlace(provider, at, [{ ...near, id: 'short' }])), 'none');
});

test('several different passing places are ambiguous unless exactly one carries the stored name', () => {
  const twin = { ...near, id: 'ChIJ_twin_place_id_123', displayName: 'Kite Charters Shop', lat: 37.1, lng: 25.16 };
  assert.equal(idOf(choosePlace(provider, at, [near, twin])), 'ambiguous');
  const exact = { ...near, id: 'ChIJ_exact_place_id_12', displayName: 'Kite  Charters', lat: 37.1002, lng: 25.1602 };
  assert.equal(idOf(choosePlace(provider, at, [near, twin, exact])), exact.id);
  // The same place twice is not ambiguous.
  assert.equal(idOf(choosePlace(provider, at, [near, { ...near }])), near.id);
});

test('verdict: written only when the place also lies near one of our own positions', () => {
  const one = choosePlace(provider, at, [near]);
  assert.equal(ownDistanceKm(near, []), null);
  assert.equal(ownDistanceKm(near, [{ lat: 37.1009, lng: 25.1603 }]), 0);
  assert.equal(verdictFor(one, 1.2).verdict, 'match');
  assert.equal(verdictFor(one, OWN_REACH_KM + 1).verdict, 'check-location');
  assert.equal(verdictFor(one, null).verdict, 'check-location');
  assert.equal(verdictFor({ kind: 'none' }, null).verdict, 'none');
  assert.match(verdictFor(choosePlace(provider, at, [near, { ...near, id: 'ChIJ_twin_place_id_123', displayName: 'Kite Charters Shop' }]), 0).note, /several places pass/);
});

const row = (domain: string, verdict: PlaceIdResult['verdict'], placeId: string | null): PlaceIdResult => ({ table: 'providers', id: `id-${domain}`, name: domain,
  domain, googleUrl: 'https://www.google.com/maps/place/X/@1,2,17z', placeId, displayName: null, address: null, distanceM: null, ownDistanceKm: null, verdict, note: '' });

test('apply plan: matches by default, check-location only when accepted, skips win, nothing else', () => {
  const file = [row('a.com', 'match', 'ChIJ_a_place_id_123456'), row('b.com', 'check-location', 'ChIJ_b_place_id_123456'),
    row('c.com', 'ambiguous', null), row('d.com', 'none', null), row('e.com', 'match', 'ChIJ_e_place_id_123456')];
  assert.deepEqual(planApply(file).map(r => r.domain), ['a.com', 'e.com']);
  assert.deepEqual(planApply(file, { accept: ['b.com'], skip: ['e.com'] }).map(r => r.domain), ['a.com', 'b.com']);
  assert.throws(() => planApply(file, { accept: ['c.com'] }), /no single place/);
  assert.throws(() => planApply(file, { accept: ['x.com'] }), /not in the file/);
  // A hand-edited file with a bad ID fails before anything is written.
  assert.throws(() => planApply([row('f.com', 'match', 'https://maps.google.com/x')]), /not a place ID/);
});

test('writes only the place ID and its match time, and never asks Google for a rating', () => {
  assert.deepEqual(placeIdPatch('ChIJ_near_place_id_123', '2026-10-31T12:00:00Z'),
    { google_place_id: 'ChIJ_near_place_id_123', google_place_matched_at: '2026-10-31T12:00:00Z' });
  assert.throws(() => placeIdPatch('https://maps.google.com/x', 'now'));
  assert.deepEqual(FIELD_MASK.split(','), ['places.id', 'places.displayName', 'places.location', 'places.formattedAddress']);
  assert.doesNotMatch(FIELD_MASK, /rating|review|userRatingCount|websiteUri/i);
});
