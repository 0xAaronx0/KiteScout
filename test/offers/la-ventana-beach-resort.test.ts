// La Ventana Beach Resort (La Ventana, BCS): replays the Squarespace pages, the Cloudbeds metadata JSON-LD and the
// KiteMex home page recorded 2026-10-14. No slots: Cloudbeds availability is blocked (403), the site prints no rates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  laVentanaBeachResort, mapsPin, parseLvbrEngine, parseLvbrHotelRooms, parseLvbrResidentials,
} from '../../src/offers/adapters/la-ventana-beach-resort.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/la-ventana-beach-resort');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };

test('lvbr: hotel rooms with occupancy', () => {
  const rooms = parseLvbrHotelRooms(read('www.laventanabeachresort.com_beachhotel.'));
  assert.deepEqual(rooms.map(r => [r.name, r.maxGuests]), [
    ['Beachfront Doubles', 4], ['King Suite #3', 2], ['Ocean View Suite #6', 2], ['Studio Suite #7', 2],
    ['Family Suite #8', 5], ['Double Queen Suite #9', 4], ['Terracota Suite #10', 2],
  ]);
  assert.equal(rooms[0].description, '2 Matrimonial Beds, Hot Water + Good Water Pressure, A/C, WIFI');
  assert.match(rooms[3].description, /1 king bed and a full kitchen/);
});

test('lvbr: residentials', () => {
  const r = parseLvbrResidentials(read('www.laventanabeachresort.com_residentials.'));
  assert.deepEqual(r.map(x => x.name), ['Residential A', 'Residential B']);
  assert.match(r[0].description, /2 bedroom apartment/);
});

test('lvbr: Cloudbeds metadata and map pin', () => {
  const e = parseLvbrEngine(JSON.parse(read('us2.cloudbeds.com_booking_metadata')));
  assert.equal(e.rooms.length, 11);
  assert.match(e.description, /kitesurfing|launching and landing/i);
  assert.deepEqual(mapsPin(read('www.laventanabeachresort.com_.')), { lat: 24.0467991, lng: -109.9883454 });
});

test('lvbr: no slots (price on request)', async () => {
  const slots = await laVentanaBeachResort.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.ok(notes.some(n => /403/.test(n)));
});

test('lvbr: content', async () => {
  const c = await laVentanaBeachResort.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'La Ventana Beach Resort');
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.region, 'La Ventana, Baja California Sur');
  assert.deepEqual(c.spotCoords, { lat: 24.0467991, lng: -109.9883454 });
  assert.equal(c.rooms.length, 9);
  assert.match(c.summary, /14 suites on three levels/);
  assert.match(c.summary, /KiteMex kitesurf and wing foil school works from the resort/);
  assert.match(c.summary, /November to April/);
  assert.equal(c.kiteLessons, true);
  assert.ok(c.imageUrls.length >= 15 && c.imageUrls.every(u => !/IMAGOTIPO|logo|static1\.squarespace/i.test(u)));
  assert.ok(!/[–—]/.test(c.summary));
});
