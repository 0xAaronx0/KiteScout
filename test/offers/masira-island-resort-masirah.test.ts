// Masira Island Resort (Masirah Island, Oman): replays masiraislandresort.com pages recorded 2026-10-12
// (fixtures trimmed: script/style bodies and HTML comments dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  masiraIslandResortMasirah, mirImages, parseMirAmenities, parseMirHome, parseMirKite, parseMirRooms,
} from '../../src/offers/adapters/masira-island-resort-masirah.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/masira-island-resort-masirah');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const roomsHtml = read('masiraislandresort.com_book-a-room_.');

test('mir: four room types with size, beds, floor, view', () => {
  assert.deepEqual(parseMirRooms(roomsHtml).map(r => [r.name, r.size, r.beds, r.floor, r.view]), [
    ['Chalet', '121 Sq.m', 'One King bed room and One Twin beds room', '1st floor', 'Pool and Sea View'],
    ['Executive Suite', '80 Sq.m', 'It is one King bed room and living room', '1st floor', 'Pool and Sea View'],
    ['Premier Room', '40 Sq.m', 'One King bed or two Twin beds', '1st floor', 'Pool and Sea View'],
    ['Deluxe Room', '40 sq.m', 'One King bed or two Twin beds', 'Ground floor', 'Poolside view'],
  ]);
  assert.equal(parseMirAmenities(roomsHtml).length, 7);
});

test('mir: kite section and Watersport Oman partner on /activities/', () => {
  const k = parseMirKite(read('masiraislandresort.com_activities_.'));
  assert.match(k.kite[0], /20 to 45 knots of wind day and night steady from south/);
  assert.match(k.kite[0], /www\.watersport-oman\.com$/);
  assert.match(k.partner ?? '', /kiteboarding and stand up paddling activities on international VDWS and IKO standards/);
  assert.equal(k.partnerEmail, 'masirah@watersport-oman.com');
});

test('mir: home page facts and photos', () => {
  const home = read('masiraislandresort.com_.');
  const h = parseMirHome(home);
  assert.match(h.roomsLine ?? '', /offers you 22 well-appointed rooms, suites and chalets/);
  assert.deepEqual(h.dining, ['The Dhow Restaurant', 'Sanctuary Bar', 'Oasis Bar']);
  assert.equal(h.facilities[0], 'Outdoor swimming pool and temperature controlled Jacuzzi');
  const imgs = mirImages(home, read('masiraislandresort.com_gallery_.'), read('masiraislandresort.com_activities_.'));
  assert.equal(imgs[0], 'https://masiraislandresort.com/wp-content/uploads/2019/02/room1.jpg');
  assert.ok(imgs.includes('https://masiraislandresort.com/wp-content/uploads/2019/02/KiteSurfing.jpg'));
  assert.ok(imgs.every(u => !/\/2019\/04\/|-\d+x\d+\.jpe?g$|logo/.test(u)));
});

test('mir: no rates, engine robots-disallowed -> no slots', async () => {
  const slots = await masiraIslandResortMasirah.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
});

test('mir: content', async () => {
  const c = await masiraIslandResortMasirah.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.title, 'Masira Island Resort');
  assert.equal(c.country, 'Oman');
  assert.equal(c.spot, 'Masirah Island');
  assert.match(c.summary, /22 rooms, suites and chalets/);
  assert.match(c.summary, /refers kiters to Watersport Oman/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Chalet', 'Executive Suite', 'Premier Room', 'Deluxe Room']);
  assert.ok(c.rooms[3].features.includes('View: Poolside view'));
  assert.equal(c.kiteLessons, true);
  assert.ok(c.optionalServices[0].startsWith('Kiteboarding and stand-up paddling with Watersport Oman'));
  assert.equal(c.imageUrls.length, 30);
  assert.equal(c.bookingUrl, 'https://be.synxis.com/?chain=31982&hotel=64798&level=hotel&locale=en-US');
});
