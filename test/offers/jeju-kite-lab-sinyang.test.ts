// Jeju Kite Lab beach guesthouse, Sinyang Beach: replays the guesthouse page, /kitesurfing/, the MPHB room-type
// sitemap and the five room pages recorded 2026-10-21 (scripts incl. the MPHB nonces, styles and svg trimmed).
// Slots are undated, so no "today" is involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildJklSlots, jejuKiteLabSinyang, parseJklKite, parseJklPrices, parseJklRoom, parseJklRoomUrls,
} from '../../src/offers/adapters/jeju-kite-lab-sinyang.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { roomsWithPrices } from '../../src/offers/ingest.js';
import { collapse, parse } from '../../src/offers/parse.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/jeju-kite-lab-sinyang');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('jeju: Elementor price list of the guesthouse page', () => {
  assert.deepEqual(parseJklPrices(read('jejukitelab.com_index.php_treat-yourself')).map(p => [p.title, p.amount]), [
    ['room per night', 70000], ['whole apartment 6 people', 300000], ['whole apartment 8 people', 340000],
  ]);
});

test('jeju: slots = room per night + whole floor for 6 / 8, undated, KRW, on request', async () => {
  const slots = await jejuKiteLabSinyang.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.startDate, s.availability]), [
    ['room|night', 70000, 'KRW', 'per_night', 'room', 2, null, 'on_request'],
    ['whole-floor-6p|night', 300000, 'KRW', 'per_night', 'room', 6, null, 'on_request'],
    ['whole-floor-8p|night', 340000, 'KRW', 'per_night', 'room', 8, null, 'on_request'],
  ]);
  assert.deepEqual(buildJklSlots([{ title: 'whole floor 10 people', amount: 400000, description: '' }]).map(s => s.key), ['whole-floor-10p|night']);
});

test('jeju: the room price holds for every private room, the floor prices for the whole-floor room (Aaron 2026-10-31)', async () => {
  const content = await jejuKiteLabSinyang.fetchContent(ctx);
  const rows = roomsWithPrices(content, await jejuKiteLabSinyang.fetchSlots(ctx), '2026-10-31');
  assert.deepEqual(rows.map(r => [r.name, r.price_from, r.price_currency, r.price_from_is_minimum]), [
    ['Coastal breeze room', 70000, 'KRW', false],
    ['Nomad room', 70000, 'KRW', false],
    ['Friends room', 70000, 'KRW', false],
    ['Coastal wave room', 70000, 'KRW', false],
    ['Whole Guesthouse, Family Stay', 300000, 'KRW', true],
  ]);
});

test('jeju: room sitemap and MPHB room pages', () => {
  const urls = parseJklRoomUrls(read('jejukitelab.com_mphb_room_type-sitemap'));
  assert.equal(urls.length, 5);
  assert.ok(urls.every(u => u.startsWith('https://jejukitelab.com/index.php/accommodation/')));
  const friends = parseJklRoom(read('jejukitelab.com_index.php_accommodation_friends-room'), urls[0]);
  assert.deepEqual([friends.name, friends.adults, friends.guests, friends.bed, friends.view, friends.firstCheckIn], ['Friends room', 2, null, '2 super single', 'Nature', '2026-11-02']);
  assert.ok(friends.amenities.includes('Free SUP'));
  assert.ok(friends.images.length > 3 && friends.images.every(u => /\/wp-content\/uploads\/.*\.jpe?g$/i.test(u) && !/-150x150/.test(u)));
  const whole = parseJklRoom(read('jejukitelab.com_index.php_accommodation_whole-guesthouse'), urls[0]);
  assert.deepEqual([whole.name, whole.adults, whole.guests, whole.view], ['Whole Guesthouse, Family Stay', null, 8, 'seaside, nature side']);
});

test('jeju: lesson and rental prices', () => {
  const html = read('jejukitelab.com_index.php_kitesurfing_');
  const text = collapse(parse(html).querySelector('main')?.text ?? parse(html).text);
  assert.deepEqual(parseJklKite(text), { course4: 1100000, oneDay: 325000, coachingHour: 100000, rentalHour: 70000, rentalDay: 130000 });
});

test('jeju: content', async () => {
  const c = await jejuKiteLabSinyang.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.country, c.continent, c.region, c.spot, c.spotCoords, c.durationDays], ['accommodation', 'South Korea', 'Asia', 'Seongsan, Jeju', 'Sinyang Beach', null, null]);
  assert.match(c.summary, /4 private rooms with their own bathroom for KRW 70,000 per night/);
  assert.match(c.summary, /the whole 2nd floor costs KRW 300,000 for 6 or KRW 340,000 for 8 guests/);
  assert.match(c.summary, /4-day beginner course for KRW 1,100,000/);
  assert.ok(!/[–—]/.test(c.summary));
  assert.deepEqual(c.rooms.map(r => r.name), ['Coastal breeze room', 'Nomad room', 'Friends room', 'Coastal wave room', 'Whole Guesthouse, Family Stay']);
  assert.ok(c.rooms[4].features.includes('Whole floor, 8 people: KRW 340,000 per night'));
  assert.ok(!c.rooms.some(r => /short description of the service/i.test(r.description ?? '')));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /^https:\/\/jejukitelab\.com\/wp-content\/uploads\/.*\.jpe?g$/i.test(u) && !/haenyeo|logo|\.png/i.test(u)));
  assert.ok(c.imageUrls.some(u => /IMG_7997/.test(u))); // kite photo from /kitesurfing/
  assert.match(c.sourceText ?? '', /first available check-in per the room calendars: Coastal breeze room: 2026-11-02/);
});
