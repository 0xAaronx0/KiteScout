// Salty's Kitesurf Village (Kilifi, Kenya): replays the Squarespace pages recorded 2026-10-12 (fixtures trimmed:
// script/style bodies dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  saltysKitesurfVillageKilifi, buildSkvSlots, parseSkvPin, parseSkvRooms,
} from '../../src/offers/adapters/saltys-kitesurf-village-kilifi.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/saltys-kitesurf-village-kilifi');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const roomsHtml = read('saltyskitesurf.com_saltys-accommodation.');

test('saltys: room cards with single / double nightly prices', () => {
  assert.deepEqual(parseSkvRooms(roomsHtml).map(r => [r.name, r.single, r.double, r.currency, r.from]), [
    ['Cottage Superior Suite Top Floor', 110, 143, 'USD', true],
    ['Cottage Superior Suite', 110, 143, 'USD', true],
    ['Cottage Double Ensuite', 72, 94, 'USD', false],
    ['Cottage King Ensuite', 88, 116, 'USD', true],
    ['King Ensuite', 91, 121, 'USD', true],
    ['Superior Suite', 103, 140, 'USD', true],
    ['King Room', 53, 70, 'USD', true],
    ['Surfers Economy Room', 39, 50, 'USD', false],
  ]);
});

test('saltys: slots = room x 1/2 guests, USD per room per night, no dates, unknown availability', async () => {
  const slots = await saltysKitesurfVillageKilifi.fetchSlots(ctx);
  assert.deepEqual(slots, buildSkvSlots(parseSkvRooms(roomsHtml)));
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 16);
  assert.deepEqual(slots.slice(4, 6).map(s => [s.key, s.price, s.occupancy]), [['cottage-double-ensuite-1p', 72, 1], ['cottage-double-ensuite-2p', 94, 2]]);
  assert.ok(slots.every(s => s.currency === 'USD' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'unknown' && s.startDate === null && s.endDate === null));
});

test('saltys: map pin from the contact page', () => {
  assert.deepEqual(parseSkvPin(read('saltyskitesurf.com_contactus.')), { lat: -3.6052648, lng: 39.8817229 });
});

test('saltys: content', async () => {
  const c = await saltysKitesurfVillageKilifi.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, "Salty's Kitesurf Village");
  assert.equal(c.country, 'Kenya');
  assert.deepEqual(c.spotCoords, { lat: -3.6052648, lng: 39.8817229 });
  assert.match(c.summary, /from USD 50 per night for two \(Surfers Economy Room\)/);
  assert.match(c.summary, /Kaskazi \(December to March, 13-18 knots\) and Kuzi \(May to October, 17-31 knots\)/);
  assert.equal(c.rooms.length, 8);
  assert.ok(c.optionalServices.includes('Private kite 7h course: USD 460'));
  assert.ok(c.optionalServices.some(s => /^Classic Kite Getaway .*: 6 Days \/ 5 Nights, from USD 865 per person/.test(s)));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://images.squarespace-cdn.com/content/') && !u.includes('?')));
});
