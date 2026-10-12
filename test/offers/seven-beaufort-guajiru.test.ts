// 7 Beaufort Brasil (Ilha do Guajiru): replays the English pages recorded 2026-10-12 (script/style bodies trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  sevenBeaufortGuajiru, buildSbSlots, parseSbCoords, parseSbCourses, parseSbRooms, sbBands,
} from '../../src/offers/adapters/seven-beaufort-guajiru.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/seven-beaufort-guajiru');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const rooms = parseSbRooms(read('7beaufort.com_rooms.html.'));

test('7 beaufort: room price tables', () => {
  assert.deepEqual(rooms.map(r => [r.name, r.rates.length, r.images.length]), [
    ['Deluxe', 3, 12], ['Deluxe Family', 4, 13], ['Superior', 5, 23], ['Classic Plus', 3, 7],
    ['Classic', 4, 12], ['Gardenhouse', 3, 12], ['Dorm', 1, 6],
  ]);
  const deluxe = rooms[0];
  assert.deepEqual(deluxe.seasons.map(s => [s.name, s.ranges.map(x => x.label)]), [
    ['Low season 1', ['01.07 - 24.09']],
    ['Main season', ['25.09 - 05.12', '25.12 - 05.01']],
    ['Mid season', ['06.12 - 24.12']],
    ['Low season 2', ['06.01 - 31.01']],
  ]);
  assert.deepEqual(deluxe.rates.map(r => [r.persons, r.prices]), [[1, [125, 165, 155, 110]], [2, [140, 180, 170, 125]], [3, [180, 225, 215, 155]]]);
  // "??? €" in Low season 1 = not published
  assert.deepEqual(rooms.find(r => r.name === 'Classic Plus')!.rates.map(r => r.prices), [[null, 100, 95, 70], [null, 110, 105, 80], [115, 140, 135, 100]]);
  assert.deepEqual(rooms.find(r => r.name === 'Dorm')!.rates.map(r => [r.persons, r.prices]), [[1, [40, 40, 40, 40]]]);
  assert.match(deluxe.images[0], /^https:\/\/7beaufort\.com\/images\/rooms\/deluxe\/deluxe-01\.jpg$/);
});

test('7 beaufort: next occurrence of each season band (year inferred)', () => {
  assert.deepEqual(sbBands(rooms[0].seasons, '2026-10-12').map(b => [b.season, b.start, b.end]), [
    ['Main season', '2026-09-25', '2026-12-05'],
    ['Mid season', '2026-12-06', '2026-12-24'],
    ['Main season', '2026-12-25', '2027-01-05'],
    ['Low season 2', '2027-01-06', '2027-01-31'],
    ['Low season 1', '2027-07-01', '2027-09-24'],
  ]);
  // once the main season has ended, its next occurrence is the following year
  assert.deepEqual(sbBands(rooms[0].seasons, '2027-02-01').map(b => b.start), ['2027-07-01', '2027-09-25', '2027-12-06', '2027-12-25', '2028-01-06']);
});

test('7 beaufort: slots = room x occupancy x season band, EUR per night, unknown availability', async () => {
  const slots = buildSbSlots(rooms, '2026-10-12');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 113); // 23 occupancy rows x 5 bands - 2 unpublished Classic Plus cells
  const d2 = slots.find(s => s.key === 'deluxe-2p|2026-12-06')!;
  assert.deepEqual([d2.startDate, d2.endDate, d2.unit, d2.price, d2.currency, d2.priceUnit, d2.priceBasis, d2.occupancy, d2.availability],
    ['2026-12-06', '2026-12-24', 'Deluxe', 170, 'EUR', 'per_night', 'room', 2, 'unknown']);
  assert.match(d2.availabilityText!, /^Mid season \(06\.12 - 24\.12\)/);
  assert.equal(slots.find(s => s.key === 'dorm-1p|2027-01-06')!.priceBasis, 'person');
  assert.equal(slots.find(s => s.key === 'classic-plus-1p|2027-07-01'), undefined);
  assert.equal(Math.min(...slots.map(s => s.price!)), 40);
  assert.equal(Math.min(...slots.filter(s => s.priceBasis === 'room').map(s => s.price!)), 60);
  // fetchSlots replays rooms.html (dates follow today's calendar)
  const live = await sevenBeaufortGuajiru.fetchSlots(ctx);
  assert.deepEqual(checkSlots(live).problems, []);
  assert.ok(live.length > 0 && live.every(s => s.currency === 'EUR' && s.availability === 'unknown'));
});

test('7 beaufort: courses and map pin', () => {
  assert.deepEqual(parseSbCourses(read('7beaufort.com_kiteschool.html.')).map(c => [c.name, c.hours, c.individual, c.perStudentOfTwo]), [
    ['Beginner Basic', 6, 366, 264], ['Complete Beginner', 10, 560, 370], ['Refresher', 3, 189, 135],
    ['Advanced', 6, 366, 264], ['Advanced Complete', 10, 560, 370], ['Intensive Course', 6, 366, 264],
  ]);
  assert.deepEqual(parseSbCoords(read('7beaufort.com_contact.html.')), { lat: -2.88086, lng: -39.91218 });
});

test('7 beaufort: content', async () => {
  const c = await sevenBeaufortGuajiru.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, '7 Beaufort Brasil');
  assert.equal(c.country, 'Brazil');
  assert.equal(c.region, 'Ceará');
  assert.equal(c.spot, 'Ilha do Guajiru');
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /VDWS-certified kite school/);
  assert.match(c.summary, /from EUR 60 per room per night \(dorm bed EUR 40\)/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Deluxe', 'Deluxe Family', 'Superior', 'Classic Plus', 'Classic', 'Gardenhouse', 'Dorm']);
  assert.ok(c.rooms[3].features.includes('Low season 1 (01.07 - 24.09), 1 Bed, 1 Person: price not published'));
  assert.ok(c.optionalServices.includes('Intensive kite course, 6 h incl. equipment: EUR 366 individual, EUR 264 per student with 2 per teacher'));
  assert.equal(c.imageUrls.length, 30);
  assert.equal(new Set(c.imageUrls.filter(u => /\/rooms\//.test(u)).map(u => u.split('/')[5])).size, 7); // every room category
  assert.ok(c.imageUrls.every(u => /^https:\/\/7beaufort\.com\/images\/(homepage|rooms\/\w+|kiteschool)\/[\w-]+\.jpg$/.test(u)), c.imageUrls.join(' '));
});
