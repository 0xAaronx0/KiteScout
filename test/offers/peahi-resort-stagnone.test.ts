// Peahi Resort (Lo Stagnone): replays www.peahiresort.com and the ProKite Alby Rondina home + /lessons/
// recorded 2026-10-12 (scripts except the Kallyas map call, styles, SVGs and data URIs trimmed; Google Maps
// key redacted). Content only: no room price on either site, Beddy is behind Turnstile (Aaron 2026-10-12:
// listed anyway).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  peahiResortStagnone, parsePeahiRooms, parsePkCenter, parsePkCoords, parsePkLessons, peahiImages, peahiVisiblePrices,
} from '../../src/offers/adapters/peahi-resort-stagnone.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/peahi-resort-stagnone');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };
const peahi = read('www.peahiresort.com_.');
const pkHome = read('www.prokitealbyrondina.com_.');

test('peahi: 7 room/villa types with text and slider originals', () => {
  const rooms = parsePeahiRooms(peahi);
  assert.deepEqual(rooms.map(r => [r.name, r.images.length]), [
    ['Standard Room', 18],
    ['Comfort Triple / Double on the ground floor', 9],
    ['Deluxe with balcony', 10],
    ['Deluxe side sea view with balcony', 8],
    ['Deluxe sea view with balcony', 14],
    ['Comfort Villa Sea View', 21],
    ['Deluxe sea view villa with PRIVATE SAUNA', 9],
  ]);
  assert.match(rooms[0].text, /^Double\/twin room with private bathroom .* Buffet Breakfast included\.$/);
  assert.match(rooms[6].text, /PRIVATE FINNISH SAUNA/);
  assert.ok(rooms.flatMap(r => r.images).every(u => /^https:\/\/www\.peahiresort\.com\/wp-content\/uploads\/.+\.jpe?g$/.test(u)));
  const imgs = peahiImages(rooms);
  assert.equal(imgs.length, 30);
  assert.deepEqual(imgs.slice(0, 2), [
    'https://www.peahiresort.com/wp-content/uploads/2022/11/standard_room_01.jpg',
    'https://www.peahiresort.com/wp-content/uploads/2022/11/Comfort-Triple-Double-on-the-ground-floor-01.jpg',
  ]);
});

test('peahi: kite center facts, map pin, lesson prices', () => {
  const c = parsePkCenter(pkHome);
  assert.match(c.intro, /shallow and flat-water lagoon of Lo Stagnone/);
  assert.equal(c.email, 'info@prokitealbyrondina.com');
  assert.match(c.address, /Marsala/);
  assert.deepEqual(parsePkCoords(pkHome), { lat: 37.887818, lng: 12.471306 });
  const l = parsePkLessons(read('www.prokitealbyrondina.com_lessons_.'));
  assert.equal(l.prices.length, 6);
  assert.equal(l.prices[0], 'Beginner lessons 2 hr: 160€ (private course 1 student 1 instructor)');
  assert.ok(l.prices.includes('Semi-Private lessons 6 hr: 320€ (price per person with 1 instructor 2 students)'));
  assert.ok(l.facts.some(f => /max 2 students per instructor/i.test(f)));
});

test('peahi: no room price on the site -> [] (price on request)', async () => {
  assert.deepEqual(peahiVisiblePrices(peahi), []);
  const slots = await peahiResortStagnone.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
  assert.deepEqual(peahiVisiblePrices('<div class="zn_pb_wrapper"><p>Standard Room from 90 € per night</p></div>'), ['90 €']);
});

test('peahi: content', async () => {
  const c = await peahiResortStagnone.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Peahi Resort');
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.country, 'Italy');
  assert.equal(c.region, 'Sicily');
  assert.equal(c.spot, 'Lo Stagnone');
  assert.deepEqual(c.spotCoords, { lat: 37.887818, lng: 12.471306 });
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /directly at the kite spot/);
  assert.match(c.summary, /one type with a private Finnish sauna/);
  assert.equal(c.rooms.length, 7);
  assert.ok(c.rooms[6].features.includes('Private Finnish sauna'));
  assert.ok(c.optionalServices.includes('Kite lessons - Beginner Kitecourse 6 hr 0 level: 420€ (private course 1 student 1 instructor)'));
  assert.ok(c.optionalServices.includes('Wing foil rental'));
  assert.equal(c.bookingUrl, 'https://prokitealby.beddy.io/availability-request-form?widget-code=ec0e32e1443fd&lang=en');
  assert.equal(peahiResortStagnone.confidence, 'low');
});
