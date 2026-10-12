// Boardrooms (Blouberg, Cape Town): replays the home and rooms pages recorded 2026-10-12 (fixtures trimmed: script /
// style bodies and the Airbnb review widget dropped). Slots = five rooms, ZAR per room per night, minimum 4 nights.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { boardroomsBlouberg, buildBrSlots, parseBrRooms } from '../../src/offers/adapters/boardrooms-blouberg.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/boardrooms-blouberg');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const rooms = read('boardrooms.capetown_rooms_.');

test('br: room cards', () => {
  assert.deepEqual(parseBrRooms(rooms).map(r => [r.type, r.room, r.amount, r.minNights]), [
    ['Deluxe Double', 'Room Six', 1600, 4], ['Standard Twin', 'Room Four', 1400, 4], ['Standard Double', 'Room Three', 1400, 4],
    ['Standard Double', 'Room Five', 1400, 4], ['Deluxe Double', 'Room Two', 1400, 4],
  ]);
});

test('br: slots', async () => {
  const slots = await boardroomsBlouberg.fetchSlots(ctx);
  assert.deepEqual(slots, buildBrSlots(parseBrRooms(rooms)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => s.key), ['room-six', 'room-four', 'room-three', 'room-five', 'room-two']);
  assert.ok(ok.every(s => s.currency === 'ZAR' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.minNights === 4
    && s.availability === 'on_request' && s.startDate === null));
});

test('br: content', async () => {
  const c = await boardroomsBlouberg.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Boardrooms Kite & Co-working Villa');
  assert.equal(c.country, 'South Africa');
  assert.equal(c.spot, 'Blouberg, Cape Town');
  assert.match(c.summary, /Five private en-suite/);
  assert.match(c.summary, /R1,400 to R1,600 per night with a minimum stay of 4 nights/);
  assert.ok(c.includedServices.includes('Gear storage') && c.includedServices.includes('Outdoor showers'));
  assert.equal(c.rooms.length, 5);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /^https:\/\/boardrooms\.capetown\/wp-content\/uploads\//.test(u) && !/-\d+x\d+\./.test(u)));
});
