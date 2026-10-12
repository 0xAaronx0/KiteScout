// Urla Surf House (Gülbahçe, Urla): replays home, /hotel/, /kitesurf/, the comfort and family room pages and
// /book-contact/ recorded 2026-10-12 (script bodies, SVGs and CSS except background images trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  urlaSurfHouseGulbahce, decodeCfEmail, parseUshRoomCards, parseUshRoomTypes, ushCoords, ushEmail, ushVisiblePrices,
} from '../../src/offers/adapters/urla-surf-house-gulbahce.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/urla-surf-house-gulbahce');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };
const hotel = read('urlasurfhouse.com_hotel_.');

test('ush: room types on /hotel/', () => {
  assert.deepEqual(parseUshRoomTypes(hotel).map(r => r.name), ['Family Room', 'Comfort Room', 'Bungalow Tent', 'Camping Area']);
});

test('ush: numbered room cards on the room-type pages', () => {
  const comfort = parseUshRoomCards(read('urlasurfhouse.com_hotel-comfort-room_.'));
  assert.equal(comfort.length, 10);
  assert.equal(comfort[0].name, 'Brazil Room');
  assert.match(comfort[0].text, /Comfort rooms have air conditioning and private bathroom\. Rooms are for one, two or three guests\./);
  const family = parseUshRoomCards(read('urlasurfhouse.com_hotel-family-room_.'));
  assert.deepEqual(family.map(r => r.name), ['Caribbean Room', 'Boracay Room']);
});

test('ush: map pin and Cloudflare-obfuscated e-mail', () => {
  assert.deepEqual(ushCoords(read('urlasurfhouse.com_kitesurf_.')), { lat: 38.3308094, lng: 26.6506071 });
  assert.equal(ushEmail(read('urlasurfhouse.com_.')), 'hello@urlasurfhouse.com');
  assert.equal(decodeCfEmail('81e9e4ededeec1f4f3ede0f2f4f3e7e9eef4f2e4afe2eeec'), 'hello@urlasurfhouse.com');
});

test('ush: no price on the site -> [] (price on request)', async () => {
  assert.deepEqual(ushVisiblePrices(hotel), []);
  const slots = await urlaSurfHouseGulbahce.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
});

test('ush: content', async () => {
  const c = await urlaSurfHouseGulbahce.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Urla Surf House');
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.country, 'Turkey');
  assert.equal(c.region, 'İzmir');
  assert.equal(c.spot, 'Gülbahçe, Urla');
  assert.deepEqual(c.spotCoords, { lat: 38.3308094, lng: 26.6506071 });
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.equal(c.mealPlan, null);
  assert.match(c.summary, /10 themed comfort rooms with air conditioning/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Family Room', 'Comfort Room', 'Bungalow Tent', 'Camping Area']);
  assert.ok(c.rooms[1].features.includes('For one, two or three guests'));
  assert.ok(c.optionalServices.includes('Kite equipment rental and storage'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /\/wp-content\/uploads\/202[12]\//.test(u) && !/team_|logo|\.png$/i.test(u)));
  assert.deepEqual(notes, []);
});
