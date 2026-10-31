// Hotel Todo Bien (El Sargento): replays the Duda pages recorded 2026-10-14. Content only, no rates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hotelTodoBienElSargento, parseTbUnits, parseTbWind, TB_MAPS_LINK } from '../../src/offers/adapters/hotel-todo-bien-el-sargento.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { planGallery } from '../../src/offers/gallery.js';

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

test('todo-bien: every unit has the gallery under its heading, the Wind gallery gives own kite photos, all inside the first 24', async () => {
  const c = await hotelTodoBienElSargento.fetchContent(ctx);
  const file = (u: string) => decodeURIComponent(u.split('/').pop()!);
  assert.deepEqual(c.rooms.map(r => [r.name, r.imageUrls?.length ?? 0, file(r.imageUrls![0])]), [
    ['Casita Suite', 14, 'Room+12+King+Bed+-1920w.jpg'],
    ['Poseidon Suite', 12, 'Room+11+Kitchenette-1920w.jpg'],
    ['Room 1 - Oceanfront King Bed', 9, 'Room+1+View-1920w.jpeg'],
    ['Room 2 - Oceanfront King & Daybed', 8, 'FV7A7605-1920w.jpg'],
    ['Room 3 - Oceanview 2 Queens & Daybed', 12, 'FV7A6157-1920w.jpeg'],
    ['Room 4 - Oceanfront King Bed', 25, 'Room+4+Exterior+Patio+View-1920w.jpg'],
    ['Room 5 - Mountain King Bed', 6, 'Room+5+View+2-1920w.jpeg'],
    ['Room 6 - Mountain King Bed', 10, 'DSC_7691-1920w.jpeg'],
    ['Room 7 - Oceanview 2 Queens & Daybed', 8, 'Room+7+View-1920w.jpeg'],
    ['Room 8 - Oceanfront King & Daybed', 22, 'FV7A9400-1920w.jpeg'],
    ['Room 9 - Pool Front & Oceanview 2 Queens', 9, 'Room+9+Queen+Beds+Looking+Outsidejpg-1920w.jpg'],
    ['Room 10 - Pool Front & Oceanview 2 Queens', 10, 'Room+10+Queen+Queen+Looking+out+to+Patiopg-1920w.jpg'],
    ['Villa Cortez', 26, 'Frontal-View-1920w.jpeg'],
    ['Villa Tres Niños', 17, 'Villa+1+-+Front-1920w.png'],
  ]);
  const room = (prefix: string) => c.rooms.find(r => r.name.startsWith(prefix))!.imageUrls!;
  // the "Room 3 Bathroom" file in Room 1's gallery is another room type's photo; Room 9 and 10 (same type) share one
  assert.ok(!room('Room 1 ').some(u => /Room\+3/.test(u)));
  assert.ok(room('Room 10 ').some(u => /Room\+9\+Exterior/.test(u)));
  // the same URLs as in the general list (Duda size variant), so the curation matches them
  const key = (u: string) => u.replace(/\/opt\//, '/').replace(/-\d+w(?=\.[a-z]+$)/i, '');
  const general = new Map(c.imageUrls.map(u => [key(u), u]));
  for (const u of [...c.rooms.flatMap(r => r.imageUrls!), ...c.spotImageUrls!]) assert.equal(general.get(key(u)) ?? u, u);
  assert.ok(c.rooms.filter(r => c.imageUrls.includes(r.imageUrls![0])).length >= 2);
  assert.ok(c.rooms.flatMap(r => r.imageUrls!).every(u => /cdn-website\.com\/fab44011\/dms3rep\/multi\//.test(u) && !/logo|instagram|fbcdn/i.test(u)));

  assert.deepEqual(c.spotImageUrls?.map(file), [
    'wind-5-1080-1920w.jpg', '3BE875A3-6789-4B36-9C11-D57F0694749A-1920w.png', 'IMG_6109-1920w.jpeg', 'wind-6-20180-1920w.jpg',
    'wind-2-1080-1920w.jpg', 'wind-3-1080-1920w.jpg', 'wind-10-1080-1920w.jpg', 'wind-9-1080-1920w.jpg', 'wind-11-1080-1920w.jpg',
  ]);
  assert.ok(!c.spotImageUrls!.some(u => /csm_|Parajuru|O--Wing|Replace|ventanafoil|scaled|baja-peninsula/i.test(u)));

  const first24 = planGallery(c).candidates.slice(0, 24);
  for (const r of c.rooms) assert.ok(r.imageUrls!.some(u => first24.includes(u)), r.name);
  assert.ok(first24.includes(c.spotImageUrls![0]));
});
