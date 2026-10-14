// Hotel Todo Bien (El Sargento): replays the Duda pages recorded 2026-10-14. Content only, no rates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hotelTodoBienElSargento, parseTbUnits, parseTbWind, TB_MAPS_LINK } from '../../src/offers/adapters/hotel-todo-bien-el-sargento.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/hotel-todo-bien-el-sargento');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('todo-bien: units on /rooms and /villas', () => {
  const rooms = parseTbUnits(read('www.hoteltodobien.com_rooms.'));
  assert.equal(rooms.length, 12);
  assert.deepEqual(rooms.slice(0, 3).map(r => r.name), ['Casita Suite', 'Poseidon Suite', 'Room 1 - Oceanfront King Bed']);
  assert.equal(rooms[11].name, 'Room 10 - Pool Front & Oceanview 2 Queens');
  assert.match(rooms[2].text, /^First floor King room with oceanfront views/);
  const villas = parseTbUnits(read('www.hoteltodobien.com_villas.'));
  assert.deepEqual(villas.map(v => [v.name, v.facts.at(-1)]), [['Villa Cortez', 'Minimum Stay: 6 Nights'], ['Villa Tres Niños', 'Minimum Stay: 6 Nights']]);
});

test('todo-bien: wind section = beach launch + local instructors, no school', () => {
  const wind = parseTbWind(read('www.hoteltodobien.com_activities.'));
  assert.match(wind, /easy beach launch/);
  assert.match(wind, /connect you with trusted local instructors/);
  assert.match(wind, /November through April/);
});

test('todo-bien: no slots (Cloudbeds data calls blocked, no printed rates)', async () => {
  const slots = await hotelTodoBienElSargento.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
});

test('todo-bien: content describes the kite link honestly', async () => {
  const c = await hotelTodoBienElSargento.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.region, 'El Sargento, Baja California Sur');
  assert.ok(read('www.hoteltodobien.com_.').includes(TB_MAPS_LINK));
  assert.deepEqual(c.spotCoords, { lat: 24.0674522, lng: -109.9895713 });
  assert.match(c.summary, /10 rooms, 2 suites and 2 private villas/);
  assert.match(c.summary, /beachfront gear storage/);
  assert.match(c.summary, /no kite school on site/);
  assert.equal(c.kiteLessons, null);
  assert.ok(c.includedServices.includes('Beachfront gear storage'));
  assert.equal(c.rooms.length, 14);
  assert.ok(c.imageUrls.length >= 20 && c.imageUrls.every(u => !/instagram|logo|Background/i.test(u)));
});
