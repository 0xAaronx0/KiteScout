// Blue Dream Kiteboarding Resort (Bahía Salinas): replays the home, /hotel/, /kitesurfingcostarica/ and
// /kitesurfingcostarica/lessons/ pages recorded 2026-10-12 (scripts except JSON-LD, styles, SVGs trimmed).
// Content only: no room rates on the site, Cloudbeds is not called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  blueDreamKiteboardingResortBahiaSalinas, bdImages, bdMapPin, parseBdLessons, parseBdRooms,
} from '../../src/offers/adapters/blue-dream-kiteboarding-resort-bahia-salinas.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/blue-dream-kiteboarding-resort-bahia-salinas');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const home = read('bluedreamhotel.com_.');
const hotel = read('bluedreamhotel.com_hotel_.');
const lessons = read('bluedreamhotel.com_kitesurfingcostarica_lessons_.');

test('bd: room list from /hotel/', () => {
  const rooms = parseBdRooms(hotel);
  assert.deepEqual(rooms.map(r => r.name), [
    'Suite', 'Junior suite', 'Wooden bungalow for 4', 'Wooden bungalow for 2', 'Single/double private standard room', 'Dorm', 'Apartment', 'House with 2 bedrooms',
  ]);
  assert.deepEqual(rooms[4].features, ['9 units', 'Fan', 'Balcony or terrace']);
  assert.deepEqual(rooms[6].features, ['Up to 7 people', 'Fan', 'Kitchen']);
});

test('bd: lesson and rental prices (USD) and languages', () => {
  assert.deepEqual(parseBdLessons(lessons), {
    groupHour: 60, group3h: 150, group9h: 405,
    privateHour: 80, private3h: 210, private9h: 595,
    rentalDay: 95, rental3d: 270, rental6d: 480,
    languages: ['en', 'es', 'fr', 'it'],
  });
});

test('bd: map pin and photos', () => {
  assert.deepEqual(bdMapPin(home), { lat: 11.0328028, lng: -85.6728357 });
  const imgs = bdImages(hotel, home);
  assert.ok(imgs.length >= 30);
  assert.equal(imgs[0], 'https://bluedreamhotel.com/wp-content/uploads/2025/05/IMG_9943-scaled.jpg');
  assert.ok(imgs.every(u => !/Captura-de-pantalla|logo|favi|yout\d/i.test(u)));
  assert.ok(!imgs.includes('https://bluedreamhotel.com/wp-content/uploads/2025/05/IMG_9950.jpg')); // the -scaled copy wins
});

test('bd: no room rates -> no slots', async () => {
  const slots = await blueDreamKiteboardingResortBahiaSalinas.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
});

test('bd: content', async () => {
  const c = await blueDreamKiteboardingResortBahiaSalinas.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Blue Dream Kiteboarding Resort');
  assert.equal(c.country, 'Costa Rica');
  assert.equal(c.region, 'Guanacaste');
  assert.equal(c.spot, 'Bahia Salinas');
  assert.deepEqual(c.spotCoords, { lat: 11.0328028, lng: -85.6728357 });
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /USD 60 per hour for group lessons; it is open from early November to the end of July/);
  assert.ok(c.includedServices.includes('Free shuttle to the kite school at Copal beach'));
  assert.equal(c.bookingUrl, 'https://hotels.cloudbeds.com/reservation/XG3P9p');
  assert.equal(c.imageUrls.length, 30);
  assert.equal(blueDreamKiteboardingResortBahiaSalinas.confidence, 'low');
});
