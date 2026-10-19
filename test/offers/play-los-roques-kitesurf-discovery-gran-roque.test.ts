// Play Los Roques Kitesurfing Discovery (Gran Roque): replays /travel-with-us (+ the camp page for photos), 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { playLosRoquesKitesurfDiscoveryGranRoque, buildPlrDiscoverySlots, parsePlrDiscovery } from '../../src/offers/adapters/play-los-roques-kitesurf-discovery-gran-roque.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/play-los-roques-kitesurf-discovery-gran-roque');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const html = readFileSync(join(DIR, files.find(f => f.startsWith('www.playlosroques.com_travel-with-us'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('plr discovery: card', () => {
  assert.deepEqual(parsePlrDiscovery(html), { days: 3, nights: 2, hours: 6, weekday: 999, weekend: 1149, single: [1168, 1248], nonKiter: [398, 458] });
});

test('plr discovery: undated slots', async () => {
  const s = await playLosRoquesKitesurfDiscoveryGranRoque.fetchSlots(ctx);
  assert.deepEqual(checkSlots(s).problems, []);
  assert.deepEqual(s.map(x => [x.key, x.price, x.currency, x.occupancy, x.startDate, x.availability, x.packageNights]), [
    ['double-weekday', 999, 'USD', 2, null, 'on_request', 2],
    ['double-weekend', 1149, 'USD', 2, null, 'on_request', 2],
    ['single', 1168, 'USD', 1, null, 'on_request', 2],
  ]);
  assert.equal(buildPlrDiscoverySlots(parsePlrDiscovery(html)!, 'USD').length, 3);
});

test('plr discovery: content', async () => {
  const c = await playLosRoquesKitesurfDiscoveryGranRoque.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 3, 'Venezuela', 'Los Roques Archipelago', 'Gran Roque']);
  assert.match(c.summary, /USD 999 on weekdays, USD 1149 on weekends per person in a double room/);
  assert.ok(c.imageUrls.length >= 10);
});
