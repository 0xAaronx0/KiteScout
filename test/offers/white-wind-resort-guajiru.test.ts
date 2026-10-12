// White Wind Resort (Ilha do Guajiru): replays the static home, /booking.html and /kiteschool.html recorded
// 2026-10-12 (styles trimmed). Content only: the site prints no price (Aaron 2026-10-12: listed anyway).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  whiteWindResortGuajiru, parseWwHome, parseWwIncluded, parseWwKite, parseWwRooms, wwVisiblePrices,
} from '../../src/offers/adapters/white-wind-resort-guajiru.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/white-wind-resort-guajiru');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };
const booking = read('www.whitewindresort.com_booking.html.');

test('white-wind: room cards with chips and galleries', () => {
  const rooms = parseWwRooms(booking);
  assert.deepEqual(rooms.map(r => [r.name, r.chips.length, r.images.length]), [
    ['Deluxe Room', 7, 6],
    ['Ocean Front Suite', 9, 6],
  ]);
  assert.match(rooms[1].text, /direct lagoon view/);
  assert.equal(rooms[0].images[0], 'https://www.whitewindresort.com/images/modern/room1-hero.jpg');
});

test('white-wind: included services, kite school, home facts', () => {
  const inc = parseWwIncluded(booking);
  assert.equal(inc.length, 6);
  assert.equal(inc[0], 'Breakfast: Daily full breakfast from 08:00 to 10:00.');
  assert.ok(inc.includes('Kite support: Kite storage, compressor and beach boy service.'));
  const k = parseWwKite(read('www.whitewindresort.com_kiteschool.html.'));
  assert.equal(k.season, 'June to February');
  assert.deepEqual(k.languages, ['en', 'es', 'pt', 'de']);
  assert.ok(k.features.includes('Storage: Kite storage free for resort guests.'));
  const h = parseWwHome(read('www.whitewindresort.com_.'));
  assert.equal(h.rooms, 8);
  assert.equal(h.email, 'info@whitewind-resort.com');
  assert.equal(h.address, 'Ilha do Guajirú - Praia da Barra, 62.590-000 Itarema - Ceará - Brazil');
  assert.equal(h.video, 'https://www.whitewindresort.com/videos/whitewind-resort-hero.mp4');
});

test('white-wind: no price on the site -> [] (price on request)', async () => {
  assert.deepEqual(wwVisiblePrices(booking), []);
  const slots = await whiteWindResortGuajiru.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
  assert.deepEqual(wwVisiblePrices('<main><h3>Deluxe Room</h3><p>from R$ 690 per night</p></main>'), ['R$ 690']);
});

test('white-wind: content', async () => {
  const c = await whiteWindResortGuajiru.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'White Wind Resort');
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.country, 'Brazil');
  assert.equal(c.region, 'Ceará');
  assert.equal(c.spot, 'Ilha do Guajiru');
  assert.equal(c.spotCoords, undefined); // no map on the site
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /boutique hotel with 8 rooms at Praia da Barra on Ilha do Guajiru/);
  assert.match(c.summary, /June to February as the wind season/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Deluxe Room', 'Ocean Front Suite']);
  assert.equal(c.imageUrls.length, 19);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://www.whitewindresort.com/images/')), 'no wind widget');
  assert.equal(c.heroVideoUrl, 'https://www.whitewindresort.com/videos/whitewind-resort-hero.mp4');
  assert.equal(c.bookingUrl, 'https://www.whitewindresort.com/contact.html');
  assert.equal(whiteWindResortGuajiru.confidence, 'low');
});
