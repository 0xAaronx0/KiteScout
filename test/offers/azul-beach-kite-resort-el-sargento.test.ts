// Azul Beach Kite Resort (El Sargento): replays the Mirai-built pages recorded 2026-10-14.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  azulBeachKiteResortElSargento, azulCurrency, buildAzulSlots, parseAzulRoomDetail, parseAzulRooms,
} from '../../src/offers/adapters/azul-beach-kite-resort-el-sargento.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/azul-beach-kite-resort-el-sargento');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const roomsPage = read('www.azulbeachkiteresort.com_en_rooms_.');

test('azul: room cards with "From ... Mex $ per night"', () => {
  assert.deepEqual(parseAzulRooms(roomsPage).map(r => [r.name, r.price, r.currency, r.url.replace(/^.*\/rooms\//, '')]), [
    ['Standard 2 Queen Beds', 4275, 'MXN', 'standard-2-queen-beds-87466/'],
    ['Standard King Size', 4275, 'MXN', 'standard-king-size-87467/'],
    ['Premium King Size', 5025, 'MXN', 'premium-king-size-87468/'],
  ]);
  assert.equal(azulCurrency('From 4275Mex $ per night'), 'MXN');
  assert.equal(azulCurrency('From $ 120 per night'), null);
});

test('azul: slots = room type, MXN per room per night, no dates', async () => {
  const slots = await azulBeachKiteResortElSargento.fetchSlots(ctx);
  assert.deepEqual(slots, buildAzulSlots(parseAzulRooms(roomsPage)));
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price]), [['standard-2-queen-beds', 4275], ['standard-king-size', 4275], ['premium-king-size', 5025]]);
  assert.ok(slots.every(s => s.currency === 'MXN' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'unknown' && s.startDate === null && s.endDate === null));
  assert.match(slots[0].availabilityText!, /^From 4275Mex \$ per night/);
});

test('azul: room detail = English features + original photos', () => {
  const d = parseAzulRoomDetail(read('www.azulbeachkiteresort.com_en_rooms_standard-2-queen-beds-87466_.'));
  assert.ok(d.features.includes('Frontal sea views') && d.features.includes('Air conditioning'));
  assert.ok(d.images.length >= 5 && d.images.every(u => u.endsWith('_original.jpg')));
});

test('azul: content', async () => {
  const c = await azulBeachKiteResortElSargento.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.region, 'El Sargento, Baja California Sur');
  assert.deepEqual(c.spotCoords, { lat: 24.1032306, lng: -109.9941647 });
  assert.match(c.summary, /8 rooms on Playa Rasta/);
  assert.match(c.summary, /own kitesurf school/);
  assert.match(c.summary, /MXN 4,275/);
  assert.equal(c.kiteLessons, true);
  assert.deepEqual(c.rooms.map(r => r.name), ['Standard 2 Queen Beds', 'Standard King Size', 'Premium King Size']);
  assert.ok(c.rooms[2].features.includes('Palapa roof'));
  assert.ok(c.optionalServices.some(s => /-10% Exclusive Web Offer/.test(s)));
  assert.ok(c.imageUrls.length >= 10 && c.imageUrls.every(u => !/logo|favicon/i.test(u)));
});
