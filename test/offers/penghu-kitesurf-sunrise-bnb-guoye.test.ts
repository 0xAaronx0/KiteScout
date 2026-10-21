// Sunrise BnB at Penghu Kitesurf & Wing Foil Center: replays the Squarespace pages /about, /index and /services
// recorded 2026-10-21 (scripts, styles, svg sprites and bulky data attributes trimmed). Slots are undated, so no
// "today" is involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPenghuSlots, parsePenghuPin, parsePenghuRate, parsePenghuRooms, parsePenghuServices, penghuHomeImages,
  penghuKitesurfSunriseBnbGuoye,
} from '../../src/offers/adapters/penghu-kitesurf-sunrise-bnb-guoye.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/penghu-kitesurf-sunrise-bnb-guoye');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('penghu: rate lines (TWD and NT, with and without guest count)', () => {
  assert.deepEqual(parsePenghuRate('Room rate (for 3-4 people):  3600 TWD/day,  18,000 TWD/week,  54,000 TWD/month'),
    { persons: '3-4', occupancy: 4, night: 3600, week: 18000, month: 54000 });
  assert.deepEqual(parsePenghuRate('Room rate (for 1 person): 2000 NT/day, 10,000 TWD/week, 30,000 TWD/month.'),
    { persons: '1', occupancy: 1, night: 2000, week: 10000, month: 30000 });
  assert.deepEqual(parsePenghuRate('Room rate: 1400 TWD/day, 7000 TWD/week, 21,000 TWD/month'),
    { persons: null, occupancy: null, night: 1400, week: 7000, month: 21000 });
  assert.equal(parsePenghuRate('We take cash for payment on your arrival.'), null);
});

test('penghu: five rooms from /about, incl. the two that share one text block', () => {
  const rooms = parsePenghuRooms(read('jan-hou.squarespace.com_about.'));
  assert.deepEqual(rooms.map(r => [r.name, r.rates.map(x => [x.persons, x.occupancy, x.night, x.week, x.month])]), [
    ['Deluxe VIP Room', [['3-4', 4, 3600, 18000, 54000], ['2', 2, 3000, 15000, 45000]]],
    ['Deluxe Double Room', [['1', 1, 2000, 10000, 30000], ['2', 2, 2400, 12000, 36000]]],
    ['Standard Two-Queen-Bed Room', [['3-4', 4, 2800, 14000, 42000], ['2', 2, 2400, 12000, 36000]]],
    ['Standard One-Queen Bed Room', [[null, null, 1600, 8000, 24000]]],
    ['Economy Single Room', [[null, 1, 1400, 7000, 21000]]],
  ]);
});

test('penghu: slots = room x guests x {night, week}, undated, TWD per room, on request', async () => {
  const slots = await penghuKitesurfSunriseBnbGuoye.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 16);
  assert.ok(slots.every(s => s.startDate === null && s.endDate === null && s.currency === 'TWD' && s.priceBasis === 'room' && s.availability === 'on_request'));
  const vip = slots.find(s => s.key === 'deluxe-vip-room-3-4p|week')!;
  assert.deepEqual([vip.unit, vip.room, vip.price, vip.priceUnit, vip.occupancy], ['Deluxe VIP Room, 3-4 guests', 'Deluxe VIP Room', 18000, 'per_week', 4]);
  const single = slots.find(s => s.key === 'economy-single-room|night')!;
  assert.deepEqual([single.unit, single.room, single.price, single.priceUnit, single.occupancy], ['Economy Single Room', null, 1400, 'per_night', 1]);
  assert.equal(Math.min(...slots.filter(s => s.priceUnit === 'per_night').map(s => s.price!)), 1400);
  assert.deepEqual(slots, buildPenghuSlots(parsePenghuRooms(read('jan-hou.squarespace.com_about.'))));
});

test('penghu: services, pin and home photos', () => {
  const svc = parsePenghuServices(read('jan-hou.squarespace.com_services.'));
  assert.deepEqual(svc.lessons, [
    'Beginner Lesson TWD 5,000 per 2 hours', 'Advanced Lesson TWD 5,000 per 2 hours',
    'Kite Foiling Lesson TWD 5,000 per 2 hours', 'Wing Foiling Lesson TWD 5,000 per 2 hours',
  ]);
  assert.equal(svc.rentals[0], 'Kite complete set (kite, bar, board, harness) rental TWD 3,000 per day');
  assert.ok(svc.rentals.includes('Wing foil complete set rental TWD 4,000 per day'));
  assert.deepEqual(svc.extras, [
    'Scooter rental TWD 400 per day or TWD 2,000 per week', 'Trailer rental TWD 200 per day or TWD 1,000 per week',
    'Gear storage and shower in the garage TWD 200 per day',
  ]);
  assert.deepEqual(parsePenghuPin(read('jan-hou.squarespace.com_about.')), { lat: 23.5770625, lng: 119.6800625 });
  const home = penghuHomeImages(read('jan-hou.squarespace.com_index.'));
  assert.deepEqual(home.map(u => decodeURIComponent(u.split('/').pop()!.split('?')[0])), [
    '24210405_567146153627405_1873693345428281096_o.jpg', 'IMG_9626.JPG', '28795425_1705276142889227_2028572046753169204_n.jpg', 'IMG_8660.JPG', 'IMG_9456.JPG',
  ]);
});

test('penghu: content', async () => {
  const c = await penghuKitesurfSunriseBnbGuoye.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.country, c.continent, c.region, c.spot, c.durationDays, c.mealPlan], ['accommodation', 'Taiwan', 'Asia', 'Huxi, Penghu', 'Guoye', null, null]);
  assert.deepEqual(c.spotCoords, { lat: 23.5770625, lng: 119.6800625 });
  assert.match(c.summary, /5 room types .* cost TWD 1,400 to TWD 3,600 per night or TWD 7,000 to TWD 18,000 per week \(monthly rates too; prices as published on the site, undated\)/);
  assert.match(c.summary, /TWD 5,000 per 2 hours, 10% off for B&B guests/);
  assert.ok(!/[–—]/.test(c.summary));
  assert.equal(c.rooms.length, 5);
  assert.deepEqual(c.rooms[0].features, ['3-4 guests: TWD 3,600 per night, TWD 18,000 per week, TWD 54,000 per month', '2 guests: TWD 3,000 per night, TWD 15,000 per week, TWD 45,000 per month']);
  assert.ok(c.optionalServices.includes('Airport pick-up TWD 300 per trip'));
  assert.equal(c.imageUrls.length, 18);
  assert.ok(c.imageUrls.every(u => /^https:\/\/images\.squarespace-cdn\.com\//.test(u) && !/FireShot|qrcode|IMG_9622|IMG_9026|26734372/i.test(u)));
  assert.equal(c.bookingUrl, 'https://jan-hou.squarespace.com/reservation');
});
