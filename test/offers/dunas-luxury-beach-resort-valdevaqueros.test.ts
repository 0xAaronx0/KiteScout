// Dunas Luxury Beach Resort (Valdevaqueros): replays the home, stay, activities and gallery pages recorded 2026-10-12
// (scripts except JSON-LD, styles, SVGs and comments trimmed). Slots are the printed undated "From €X per night"
// prices; SiteMinder direct-book is not called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dunasLuxuryBeachResortValdevaqueros, buildDunSlots, dunOriginal, parseDunGeo, parseDunUnits,
} from '../../src/offers/adapters/dunas-luxury-beach-resort-valdevaqueros.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/dunas-luxury-beach-resort-valdevaqueros');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('dunas: unit cards of /stay', () => {
  const units = parseDunUnits(read('dunastarifa.com_stay.'));
  assert.deepEqual(units.map(u => [u.name, u.sleeps, u.bedrooms, u.fromPrice, u.enquiry]), [
    ['Yala Comet Lodge', 2, 1, 160, false],
    ['Yala Comet Lodge — Two Bedrooms', 4, 2, 250, false],
    ['Bungalow — One Bedroom', 2, 1, 195, false],
    ['Bungalow — Two Bedrooms', 4, 2, 300, false],
    ['The Lodge House', 3, 2, 270, false],
    ['La Villa', 4, 2, 380, false],
    ['El Tropezón Farmhouse', 6, 3, null, true],
  ]);
  assert.deepEqual(units[1].chips, ['Step-free access']);
  assert.equal(units[5].size, '59 m²');
  assert.equal(units[0].image, 'https://dunastarifa.com/images/rooms/yala-comet-lodge-01.jpg');
  assert.equal(dunOriginal('/_next/image?url=%2Fimages%2Fsite%2Fa.webp&w=3840&q=75'), 'https://dunastarifa.com/images/site/a.webp');
  assert.equal(dunOriginal('https://example.com/x.jpg'), null);
});

test('dunas: slots = undated from-price per unit, the farmhouse on enquiry', async () => {
  const slots = await dunasLuxuryBeachResortValdevaqueros.fetchSlots(ctx);
  assert.deepEqual(slots, buildDunSlots(parseDunUnits(read('dunastarifa.com_stay.'))));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 7);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.availability]), [
    ['yala-comet-lodge', 160, 'unknown'], ['yala-comet-lodge-two-bedrooms', 250, 'unknown'], ['bungalow-one-bedroom', 195, 'unknown'],
    ['bungalow-two-bedrooms', 300, 'unknown'], ['the-lodge-house', 270, 'unknown'], ['la-villa', 380, 'unknown'],
    ['el-tropezon-farmhouse', null, 'on_request'],
  ]);
  assert.ok(slots.filter(s => s.price !== null).every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.startDate === null && s.endDate === null));
});

test('dunas: content', async () => {
  const c = await dunasLuxuryBeachResortValdevaqueros.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Dunas Luxury Beach Resort');
  assert.equal(c.country, 'Spain');
  assert.equal(c.region, 'Valdevaqueros, Tarifa');
  assert.equal(c.spot, 'Valdevaqueros');
  assert.deepEqual(c.spotCoords, { lat: 36.0704889, lng: -5.692933 });
  assert.deepEqual(parseDunGeo(read('dunastarifa.com_.')), { lat: 36.0704889, lng: -5.692933 });
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /behind the dune of Valdevaqueros beach/);
  assert.match(c.summary, /from EUR 160 to 380 per night including 10% VAT/);
  assert.match(c.summary, /reception books a school to suit your level/);
  assert.equal(c.rooms.length, 7);
  assert.deepEqual(c.rooms[4].features, ['Sleeps 3', '2 bedrooms', '2 bathrooms', 'Pet friendly', 'From EUR 270 per night']);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://dunastarifa.com/images/') && !/brand|logo/.test(u)));
  assert.equal(c.bookingUrl, 'https://direct-book.com/properties/DunasLuxuryBeachResortTarifaDIRECT');
});
