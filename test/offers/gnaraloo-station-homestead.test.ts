// Gnaraloo Station Homestead: replays /the-homestead/, /homestead-tariffs/ and /kitesurfing/ recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGnSlots, parseGnRooms, parseGnTariffs } from '../../src/offers/adapters/gnaraloo-station-3-mile-camp.js';
import { ghsRoomOf, gnaralooStationHomestead } from '../../src/offers/adapters/gnaraloo-station-homestead.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

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
