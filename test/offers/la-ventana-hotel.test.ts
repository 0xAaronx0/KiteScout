// La Ventana Hotel (ex La Ventana Hostel, La Ventana, BCS): replays the pages recorded 2026-10-14. No slots: rates
// only in Cloudbeds (availability blocked), the site prints none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { laVentanaHotel, parseLvhHotel, parseLvhRooms } from '../../src/offers/adapters/la-ventana-hotel.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/la-ventana-hotel');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };

test('lvh: JSON-LD hotel geo and amenities', () => {
  const h = parseLvhHotel(read('www.laventanahotel.mx_.'));
  assert.deepEqual(h.geo, { lat: 24.05159187, lng: -109.99124146 });
  assert.ok(h.amenities.includes('Kitesurfing access (5-min walk)'));
});

test('lvh: three room types with rate bands', () => {
  const rooms = parseLvhRooms(read('www.laventanahotel.mx_rooms.'));
  assert.deepEqual(rooms.map(r => [r.name, r.features[0]]), [
    ['Deluxe King Sea View', '1 king bed, 2 guests'], ['Queen Room', '1 queen bed, 2 guests'], ['Bunk Bed Dorm', 'Bunk bed (per-person rate), Shared room'],
  ]);
  assert.match(rooms[0].rateBand ?? '', /^\$\$/);
  assert.ok(rooms[2].features.includes('Privacy curtain on each bunk'));
});

test('lvh: no slots (price on request)', async () => {
  const slots = await laVentanaHotel.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.ok(notes.some(n => /Cloudbeds/.test(n)));
});

test('lvh: content', async () => {
  const c = await laVentanaHotel.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'La Ventana Hotel');
  assert.equal(c.region, 'La Ventana, Baja California Sur');
  assert.deepEqual(c.spotCoords, { lat: 24.05159187, lng: -109.99124146 });
  assert.match(c.summary, /10 private rooms and a shared bunk room with 8 beds/);
  assert.match(c.summary, /November to March/);
  assert.match(c.summary, /IKO-certified lessons/);
  assert.equal(c.mealPlan, 'self_catering');
  assert.equal(c.rooms.length, 3);
  assert.ok(c.rooms.every(r => r.features.every(f => !/[—–]/.test(f) || !/^Rate band/.test(f))));
  assert.ok(c.imageUrls.length >= 15 && c.imageUrls.every(u => !/_next\/image/.test(u)));
});
