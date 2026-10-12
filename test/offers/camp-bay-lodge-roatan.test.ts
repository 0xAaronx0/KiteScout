// Camp Bay Lodge (Roatán, Honduras): replays the pages recorded 2026-10-12 (room pages with "Price: $N/night").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { campBayLodgeRoatan, cblRoomUrls, parseCblRoom } from '../../src/offers/adapters/camp-bay-lodge-roatan.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/camp-bay-lodge-roatan');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('camp bay: 12 room pages linked from /rooms', () => {
  const urls = cblRoomUrls(read('www.campbaylodgeroatan.com_rooms.'));
  assert.equal(urls.length, 12);
  assert.ok(urls.includes('https://www.campbaylodgeroatan.com/rooms/kitesurf-room'));
});

test('camp bay: room page labels (Kitesurf Room, h3 heading; Coco, h2 heading)', () => {
  const kite = parseCblRoom(read('www.campbaylodgeroatan.com_rooms_kitesurf-room.'), 'https://www.campbaylodgeroatan.com/rooms/kitesurf-room');
  assert.equal(kite.name, 'Kitesurf Room');
  assert.equal(kite.tagline, 'Freshly Renovated • Private Deck • Ideal for Water Enthusiasts');
  assert.match(kite.description, /^The Kitesurf Room is a comfortable, fully renovated space .*Roatán Kite School/);
  assert.deepEqual([kite.accommodates, kite.price, kite.currency, kite.priceText, kite.includes, kite.extraCost],
    [2, 200, 'USD', '$200/night', 'Breakfast; Room service at your convenience', 'Government Tax 19%']);
  const coco = parseCblRoom(read('www.campbaylodgeroatan.com_rooms_coco.'), 'https://www.campbaylodgeroatan.com/rooms/coco');
  assert.equal(coco.name, 'Coco Room');
  assert.equal(coco.price, 200);
  const sunrise = parseCblRoom(read('www.campbaylodgeroatan.com_rooms_sunrise-cabana.'), 'https://www.campbaylodgeroatan.com/rooms/sunrise-cabana');
  assert.deepEqual([sunrise.name, sunrise.accommodates, sunrise.price], ['Sunrise Cabana', 4, 300]);
});

test('camp bay: slots = one per room, USD per room per night, no dates', async () => {
  const slots = await campBayLodgeRoatan.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 12);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.occupancy]), [
    ['sunrise-cabana', 300, 4], ['coco-room', 200, 2], ['palm-room', 200, 2], ['sunset-cabana', 300, 4],
    ['seagrape-room', 200, 2], ['kitesurf-room', 200, 2], ['garden-suite', 250, 2], ['almond-tree-studio', 180, 2],
    ['mangrove-studio', 180, 2], ['surf-studio', 180, 2], ['areca-tree-room', 150, 2], ['noni-tree-room', 150, 2],
  ]);
  assert.ok(slots.every(s => s.currency === 'USD' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'unknown' && s.startDate === null && s.endDate === null));
});

test('camp bay: content', async () => {
  const c = await campBayLodgeRoatan.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Camp Bay Lodge');
  assert.equal(c.country, 'Honduras');
  assert.equal(c.spot, 'Camp Bay, Roatán');
  assert.deepEqual(c.spotCoords, { lat: 16.42897224, lng: -86.29253387 });
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /on-site kite launching and landing areas/);
  assert.match(c.summary, /from USD 150 to 300 per night plus 19% government tax/);
  assert.equal(c.rooms.length, 12);
  assert.ok(c.rooms.find(r => r.name === 'Kitesurf Room')!.features.includes('Price: $200/night'));
  assert.equal(c.imageUrls.length, 30);
  assert.match(c.imageUrls[2], /Kitesurf02/);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://images.squarespace-cdn.com/content/') && !/\.png/i.test(u)));
});
