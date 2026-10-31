import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locateSpots } from '../../src/offers/ingest.js';
import type { OfferContent } from '../../src/offers/types.js';

// Only paths that never reach the geocoder (no network in tests).
const content = (over: Partial<OfferContent>) => ({
  country: 'Tunisia', region: 'Medenine', spot: null, itinerarySpots: [], ...over,
}) as OfferContent;

test('locateSpots: an adapter pin wins for a single-spot offer', async () => {
  const spots = await locateSpots(content({ spot: 'Djerba lagoon', spotCoords: { lat: 33.6802, lng: 10.9156 } }), []);
  assert.deepEqual(spots, [{ name: 'Djerba lagoon', country: 'Tunisia', region: 'Medenine', lat: 33.6802, lng: 10.9156, order: 1 }]);
});

test('locateSpots: stored coordinates are reused for route stops', async () => {
  const stored = [{ name: 'cumbuco', country: 'Brazil', region: 'Ceará', lat: -3.6259, lng: -38.7256, order: 1 }];
  const spots = await locateSpots(content({ country: 'Brazil', region: 'Ceará',
    itinerarySpots: [{ name: 'Cumbuco', country: 'Brazil', region: 'Ceará', order: 1 }] }), stored);
  assert.deepEqual(spots.map(s => [s.name, s.lat, s.lng]), [['Cumbuco', -3.6259, -38.7256]]);
});

test('locateSpots: no spot and no route gives no pin', async () => {
  assert.deepEqual(await locateSpots(content({}), null), []);
});

test('locateSpots: a known pin beats a wrong stored coordinate', async () => {
  const stored = [{ name: 'Lagouira', country: 'Morocco', region: 'Dakhla', lat: 23.6989, lng: -15.931, order: 1 }];
  const spots = await locateSpots(content({ country: 'Morocco', region: 'Dakhla',
    itinerarySpots: [{ name: 'Lagouira', country: 'Morocco', region: 'Dakhla', order: 1 }] }), stored);
  assert.deepEqual(spots.map(s => [s.lat, s.lng]), [[20.8333, -17.0833]]);
});

test('locateSpots: a precise adapter pin marks the spot precise', async () => {
  const spots = await locateSpots(content({ spot: 'Djerba lagoon', spotCoords: { lat: 33.6802, lng: 10.9156 }, spotCoordsPrecise: true }), []);
  assert.equal(spots[0].precise, true);
});

test('locateSpots: the precise flag needs the adapter pin itself', async () => {
  const stored = [{ name: 'Lagouira', country: 'Morocco', region: 'Dakhla', lat: 23.6989, lng: -15.931, order: 1 }];
  const spots = await locateSpots(content({ country: 'Morocco', region: 'Dakhla', spotCoordsPrecise: true,
    itinerarySpots: [{ name: 'Lagouira', country: 'Morocco', region: 'Dakhla', order: 1 }] }), stored);
  assert.equal(spots[0].precise, undefined);
});
