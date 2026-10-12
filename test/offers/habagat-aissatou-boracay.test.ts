// Habagat Kiteboarding Center & Aissatou Beach Resort (Boracay): replays the pages recorded 2026-10-12 (fixtures trimmed:
// script/style bodies dropped). The nd-booking price fields are empty on all room pages -> no slots (price on request).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  habagatAissatouBoracay, buildHkcSlots, parseHkcCourses, parseHkcRates, parseHkcRoom, HKC_ROOM_URLS,
} from '../../src/offers/adapters/habagat-aissatou-boracay.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/habagat-aissatou-boracay');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };

test('habagat: room pages (name, services, empty plugin price)', () => {
  const premium = parseHkcRoom(read('www.kiteboracay.com_rooms_premium_.'), HKC_ROOM_URLS[1]);
  assert.equal(premium.name, 'Premium Room');
  assert.deepEqual(premium.services, ['Air-conditioning', 'Private Bathroom', 'Television', 'Wifi', 'Sea View']);
  assert.match(premium.description ?? '', /^Our Premium Rooms each have their own private balcony/);
  assert.equal(premium.price, null);
  assert.ok(premium.images.length > 3);
  const pent = parseHkcRoom(read('www.kiteboracay.com_rooms_penthouse-apartment_.'), HKC_ROOM_URLS[0]);
  assert.equal(pent.name, 'Penthouse Apartment');
  assert.match(pent.description ?? '', /own bedroom, living room, and fully equipped kitchen/);
});

test('habagat: a filled plugin price becomes an undated per-night slot (synthetic), never with a guessed currency', () => {
  const html = read('www.kiteboracay.com_rooms_premium_.')
    .replace(/(<h1 class="nd_options_color_white nd_booking_font_size_50">)(<\/h1>)/, '$13,500$2')
    .replace(/(<h5 class="nd_options_second_font nd_options_color_white nd_booking_margin_top_7 nd_booking_font_size_14">)(<\/h5>)/, '$1PHP$2');
  const room = parseHkcRoom(html, HKC_ROOM_URLS[1]);
  assert.equal(room.price, 3500);
  assert.equal(room.currency, 'PHP');
  const { ok, problems } = checkSlots(buildHkcSlots([room]));
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.currency, s.priceUnit, s.priceBasis, s.availability]), [
    ['premium-room', 'Premium Room', 3500, 'PHP', 'per_night', 'room', 'on_request'],
  ]);
  const noCur = parseHkcRoom(read('www.kiteboracay.com_rooms_premium_.').replace(/(<h1 class="nd_options_color_white nd_booking_font_size_50">)(<\/h1>)/, '$13500$2'), HKC_ROOM_URLS[1]);
  assert.equal(noCur.price, 3500);
  assert.deepEqual(buildHkcSlots([noCur]), []);
});

test('habagat: no slots today (price on request), with a note', async () => {
  const slots = await habagatAissatouBoracay.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.ok(notes.some(n => /price fields are empty/.test(n)));
  assert.equal(habagatAissatouBoracay.confidence, 'low');
});

test('habagat: rental/storage and course price lines', () => {
  const rates = parseHkcRates(read('www.kiteboracay.com_kite-center_.'));
  assert.ok(rates.includes('Storage: php 350 / php 1,800 / php 6,000'));
  assert.ok(rates.includes('Full Set: php 3,000 / php 4,800 / php 19,000'));
  const courses = parseHkcCourses(read('www.kiteboracay.com_kiteboarding-courses_.'));
  assert.ok(courses.some(c => /^Full kite course: .*PHP 36,000/.test(c)));
  assert.ok(courses.some(c => /^Introduction to kiteboarding: .*PHP 6,000/.test(c)));
});

test('habagat: content', async () => {
  const c = await habagatAissatouBoracay.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Habagat Kiteboarding Center & Aissatou Beach Resort');
  assert.equal(c.country, 'Philippines');
  assert.equal(c.spot, 'Bulabog Beach, Boracay');
  assert.match(c.summary, /German-managed IKO kite centre on Bulabog Beach/);
  assert.match(c.summary, /home to kitesurfers since 2006/);
  assert.match(c.summary, /rents Core and North equipment/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Penthouse Apartment', 'Premium Room', 'Superior Room']);
  assert.ok(c.optionalServices.some(s => /Storage: php 350/.test(s)));
  assert.ok(c.imageUrls.length >= 10);
  assert.ok(c.imageUrls.every(u => /^https:\/\/www\.kiteboracay\.com\/wp-content\/uploads\//.test(u) && !/logo|icon|-\d+x\d+\./i.test(u)));
  assert.match(c.sourceText ?? '', /plugin price: empty/);
});
