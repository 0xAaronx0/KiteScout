// Numero Uno Beach House (Ocean Park, San Juan): replays the pages recorded 2026-10-12 (content only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  numeroUnoBeachHouseOceanPark, parseNuAmenities, parseNuApartments, parseNuRooms, parseNuWatersports,
} from '../../src/offers/adapters/numero-uno-beach-house-ocean-park.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/numero-uno-beach-house-ocean-park');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const hotel = read('numerounopr.com_hotel_.');

test('numero uno: room cards and amenities on /hotel/', () => {
  assert.deepEqual(parseNuRooms(hotel).map(r => [r.name, r.features]), [
    ['Garden View', ['2 Adults', 'Queen Bed', 'Garden View']],
    ['Deluxe Room', ['King Bed', 'Sitting Area', 'Courtyard']],
    ['Deluxe Ocean View', ['Ocean View', 'Spacious', 'Beachside']],
  ]);
  const a = parseNuAmenities(hotel);
  assert.equal(a.length, 8);
  assert.ok(a.includes('Air Conditioning'));
});

test('numero uno: apartments and watersports', () => {
  const apt = parseNuApartments(read('numerounopr.com_hotel_apartments_beach-apartments_.'));
  assert.equal(apt.capacity, 4);
  assert.match(apt.text, /1 or 2 bedrooms, a futon, bathroom, and a kitchenette/);
  assert.deepEqual(parseNuWatersports(read('numerounopr.com_watersports_.')),
    ['Kiteboarding', 'Efoiling', 'Wakeboarding', 'Tow-in surfing', 'Downwinding', 'Beach rentals and local guidance']);
});

test('numero uno: no slots (no rates on the site, OpenHotel answers 403)', async () => {
  const notes: string[] = [];
  const slots = await numeroUnoBeachHouseOceanPark.fetchSlots({ note: n => notes.push(n), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.match(notes[0], /OpenHotel/);
});

test('numero uno: content', async () => {
  const c = await numeroUnoBeachHouseOceanPark.fetchContent({ note: () => {}, incomplete: () => {} });
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Numero Uno Beach House');
  assert.equal(c.country, 'Puerto Rico');
  assert.equal(c.spot, 'Ocean Park, San Juan');
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /garden-view, deluxe and deluxe ocean-view rooms/);
  assert.match(c.summary, /Kite Puerto Rico school/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Garden View', 'Deluxe Room', 'Deluxe Ocean View', 'Beach Apartment']);
  assert.equal(c.imageUrls.length, 18);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://numerounopr.com/wp-content/uploads/') && !/logo|food/i.test(u)));
});
