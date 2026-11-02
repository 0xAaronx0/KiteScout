// Gnaraloo Station Homestead: replays /the-homestead/, /homestead-tariffs/ and /kitesurfing/ recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGnSlots, parseGnRooms, parseGnTariffs } from '../../src/offers/adapters/gnaraloo-station-3-mile-camp.js';
import { ghsRoomOf, ghsRoomPhotos, gnaralooStationHomestead } from '../../src/offers/adapters/gnaraloo-station-homestead.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { planGallery } from '../../src/offers/gallery.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/gnaraloo-station-homestead');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (part: string) => readFileSync(join(DIR, files.find(f => f.includes(part))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('gnaraloo homestead: 2026 tariffs, 6 units x 3 periods, extras', () => {
  const t = parseGnTariffs(read('homestead-tariffs'));
  assert.equal(t.year, 2026);
  assert.equal(t.rates.length, 18);
  const cabinPeak = t.rates.find(r => r.unit === 'One Bedroom Cabin' && r.period === 'peak')!;
  assert.deepEqual([cabinPeak.pax, cabinPeak.base, cabinPeak.addAdult], [3, 240, 40]);
  assert.match(t.periods.standard!, /15th December/);
  assert.ok(t.extras.some(e => /1-2 Night Surcharge/.test(e)));
});

test('gnaraloo homestead: slots link to the content rooms', async () => {
  const rooms = parseGnRooms(read('the-homestead')).map(r => r.name);
  assert.deepEqual(rooms, ['1 Bedroom Cabins', '2 Bedroom Cabins', 'Fishing Lodge 1', 'Fishing Lodge 2', 'Shearing Shed', 'Shearers Quarters']);
  const slots = buildGnSlots(parseGnTariffs(read('homestead-tariffs')), u => ghsRoomOf(u, rooms));
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.ok(slots.every(s => s.room && rooms.includes(s.room)));
  assert.equal(Math.min(...slots.map(s => s.price!)), 100);
  const live = await gnaralooStationHomestead.fetchSlots(ctx);
  assert.deepEqual(live.map(s => s.room), slots.map(s => s.room));
});

test('gnaraloo homestead: valid accommodation content', async () => {
  const c = await gnaralooStationHomestead.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.rooms.length, 6);
  assert.match(c.summary, /AUD 140 to 310 per night/);
  assert.ok(c.imageUrls.length >= 10);
  assert.doesNotMatch(c.summary, /[–—]/);
});

test('gnaraloo homestead: own photos per accommodation block and kite spot photos', async () => {
  const c = await gnaralooStationHomestead.fetchContent(ctx);
  const file = (u: string) => u.split('/').pop()!;
  assert.deepEqual(c.rooms.map(r => [r.name, r.imageUrls?.length ?? 0, file(r.imageUrls![0])]), [
    ['1 Bedroom Cabins', 4, 'accommodation-gnaraloohomestead-stonecabins-livingroom.jpg'],
    ['2 Bedroom Cabins', 2, 'accommodation-gnaraloohomestead-stonecabins-2bedroomcabin-room1.jpg'],
    ['Fishing Lodge 1', 5, 'accommodation-gnaraloohomestead-fishinglodge-section1-patio.jpg'],
    ['Fishing Lodge 2', 3, 'accommodation-gnaraloohomestead-fishinglodge-section2-patio.jpg'],
    ['Shearing Shed', 3, 'accommodation-gnaraloohomestead-shearingshed.jpg'],
    ['Shearers Quarters', 3, 'accommodation-gnaraloohomestead-shearersquarters-patio.jpg'],
  ]);
  assert.ok(c.rooms[0].imageUrls!.every(u => /-stonecabins-(?!2bedroom)/.test(u)));
  assert.ok(c.rooms[2].imageUrls!.every(u => /-fishinglodge-section1-/.test(u)));
  assert.ok(c.rooms[3].imageUrls!.every(u => /-fishinglodge-section2-/.test(u)));
  assert.ok(c.rooms.flatMap(r => r.imageUrls!).every(u => /^https:\/\/gnaraloostation\.com\/wp-content\/uploads\/20\d\d\/\d\d\/accommodation-gnaraloohomestead-[a-z0-9-]+\.jpg$/.test(u)));
  assert.deepEqual(ghsRoomPhotos('<h2>Other</h2><img src="https://gnaraloostation.com/wp-content/uploads/2021/04/x.jpg">', '1 Bedroom Cabins'), []);
  assert.deepEqual(c.spotImageUrls?.map(file), ['kitesurf-gbay.jpg', 'kitesurf-3mile.jpg', 'gnaraloo-homestead-gnaraloo-bay.jpg']);
  const plan = planGallery(c);
  assert.deepEqual(plan.dropped, []);
  const first24 = plan.candidates.slice(0, 24);
  for (const r of c.rooms) assert.ok(r.imageUrls!.some(u => first24.includes(u)), r.name);
  assert.ok(first24.includes(c.spotImageUrls![0]));
});
