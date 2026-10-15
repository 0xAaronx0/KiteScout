import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterPoints, haversineKm, uniqueKeys, type SpotRow } from '../../src/pipeline/spot-conditions.js';

const p = (country: string, lat: number, lng: number, spot = 'x') => ({ offerId: spot + lat, title: '', country, region: null, spot, lat, lng, text: '' });

test('Tarifa places merge into one spot, Fuerteventura and Costa Brava stay separate', () => {
  const clusters = clusterPoints([
    p('Spain', 36.0143, -5.6044, 'Tarifa'),          // town
    p('Spain', 36.0850, -5.6770, 'Valdevaqueros'),   // ~10 km west
    p('Spain', 36.0500, -5.6500, 'Los Lances'),
    p('Spain', 28.7340, -13.8660, 'Corralejo'),
    p('Spain', 42.2400, 3.1100, 'Sant Pere Pescador'),
  ]);
  assert.equal(clusters.length, 3);
  assert.equal(clusters.find(c => c.points.some(x => x.spot === 'Tarifa'))!.points.length, 3);
});

test('a country boundary never merges clusters', () => {
  assert.equal(clusterPoints([p('A', 10, 10), p('B', 10.01, 10.01)]).length, 2);
});

test('radius covers the farthest member, at least 10 km', () => {
  const [c] = clusterPoints([p('Spain', 36.0143, -5.6044), p('Spain', 36.0850, -5.6770)]);
  const far = Math.max(...c.points.map(x => haversineKm(c.lat, c.lng, x.lat, x.lng)));
  assert.ok(c.radiusKm >= far && c.radiusKm >= 10);
});

test('duplicate spot keys get a numeric suffix', () => {
  const row = { spot_key: 'spain/tarifa' } as SpotRow;
  assert.deepEqual(uniqueKeys([row, row, row]).map(r => r.spot_key), ['spain/tarifa', 'spain/tarifa-2', 'spain/tarifa-3']);
});
