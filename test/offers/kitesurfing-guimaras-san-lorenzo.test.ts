// Kitesurfing Guimaras & Kite Resort (San Lorenzo, Guimaras): replays the Wix pages recorded 2026-10-12 (trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kitesurfingGuimarasSanLorenzo, buildGmSlots, gmCoords, gmImages, parseGmCourses, parseGmRental, parseGmRooms, parseGmStorageFee,
} from '../../src/offers/adapters/kitesurfing-guimaras-san-lorenzo.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitesurfing-guimaras-san-lorenzo');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const home = read('www.kitesurfing-guimaras.com_.');
const resort = read('www.kitesurfing-guimaras.com_kite-resort-guimaras-philippines.');

test('guimaras: room table = suite x (standard, single use, 7+ nights)', () => {
  const rooms = parseGmRooms(home);
  assert.deepEqual(rooms.map(r => [r.name, r.pax, r.nightly, r.single, r.longTermNights, r.longNightly, r.longSingle]), [
    ['Superior Suite', 2, 3500, 3300, 7, 3300, 3100],
    ['De Luxe Suite', 4, 4300, 4100, 7, 4100, 3900],
  ]);
  // the resort page repeats the identical table
  assert.deepEqual(parseGmRooms(resort).map(r => [r.name, r.nightly, r.single]), rooms.map(r => [r.name, r.nightly, r.single]));
  assert.ok(rooms[1].features.includes('2 x Queensize Bed'));
});

test('guimaras: slots = standard + single-use rate per suite, PHP per room night, on request', async () => {
  const slots = await kitesurfingGuimarasSanLorenzo.fetchSlots(ctx);
  assert.deepEqual(slots, buildGmSlots(parseGmRooms(home)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.occupancy]), [
    ['superior-suite', 'Superior Suite', 3500, 2], ['superior-suite-single', 'Superior Suite', 3300, 1],
    ['de-luxe-suite', 'De Luxe Suite', 4300, 4], ['de-luxe-suite-single', 'De Luxe Suite', 4100, 1],
  ]);
  assert.ok(slots.every(s => s.currency === 'PHP' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'on_request' && s.startDate === null && s.endDate === null));
});

test('guimaras: courses, rental, storage fee, coordinates, photos', () => {
  assert.deepEqual(parseGmCourses(home).map(c => [c.name, c.price, c.duration]), [
    ['Basic Kite Course', 11000, '3h (1Pax) / 4h (2Pax)'],
    ['Kite Control Course', 11000, '3h (1Pax) / 4h (2Pax)'],
    ['Board Riding Course', 11000, '3h (1Pax) / 4h (2Pax)'],
    ['Full Course', 32500, '9h (1Pax) / 12h (2Pax)'],
    ['Private Course', 3666, 'per 1h'],
  ]);
  assert.deepEqual(parseGmRental(home), { hour: 2000, day: 4000, week: 26000 });
  assert.equal(parseGmStorageFee(home), 100);
  assert.deepEqual(gmCoords(home), { lat: 10.642831, lng: 122.723057 });
  const imgs = gmImages(resort);
  assert.ok(imgs.length >= 15 && imgs.every(u => /^https:\/\/static\.wixstatic\.com\/media\/[0-9a-f_]+~mv2(?:_d_\d+_\d+_s_\d+)?\.(jpe?g|webp)$/i.test(u)));
});

test('guimaras: content', async () => {
  const c = await kitesurfingGuimarasSanLorenzo.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.country, 'Philippines');
  assert.equal(c.spot, 'Playa de Paraiso, San Lorenzo, Guimaras');
  assert.equal(c.mealPlan, 'breakfast');
  assert.deepEqual(c.languages, ['en', 'de']);
  assert.match(c.summary, /VDWS-approved kite centre operating since 2018 .* kite beach lies inside its own beach resort/);
  assert.match(c.summary, /suites cost from PHP 3,500 per night/);
  assert.match(c.summary, /open from November 1 to April 1/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Superior Suite', 'De Luxe Suite']);
  assert.ok(c.rooms[0].features.includes('Long term (7+ nights): PHP 3,300 per night (single use PHP 3,100)'));
  assert.ok(c.optionalServices.includes('Kitesurfing service / storage with own equipment: PHP 100 per day'));
  assert.ok(c.imageUrls.length >= 20 && c.imageUrls.every(u => !/\.png$/i.test(u)));
});
