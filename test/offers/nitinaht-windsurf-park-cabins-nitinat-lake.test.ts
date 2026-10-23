// Nitinaht Windsurf Park (Ditidaht Nation), Nitinat Lake: replays the three booking pages + /things-to-do/ recorded
// 2026-10-23. The 2026 campground season (Apr 27 - Oct 4) was already over that day, so the campsite slot is checked
// with an earlier "today".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildNwSlots, nitinahtWindsurfParkCabinsNitinatLake, nwBookingBanner, parseNwCabins, parseNwCampsite, parseNwContent, parseNwMotel,
} from '../../src/offers/adapters/nitinaht-windsurf-park-cabins-nitinat-lake.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/nitinaht-windsurf-park-cabins-nitinat-lake');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const cabins = read('visitnitinaht.com_book-your-cabin_');
const motel = read('visitnitinaht.com_book-your-room_');
const campsite = read('visitnitinaht.com_book-your-site_');
const things = read('visitnitinaht.com_things-to-do_');
const BANNER = 'Due to the local fires burning near China Creek, Port Alberni causing unsafe conditions and power outages, we are unable to accept bookings until further notice.';

test('nitinaht: cabin prices, minimum stay, occupancy', () => {
  const c = parseNwCabins(cabins);
  assert.deepEqual(c.units.map(u => [u.id, u.name, u.price, u.occupancy, u.minNights]), [
    ['cabin-no-pets', 'Caycuse Cabin, no pets', 220, 2, 2],
    ['cabin-pet-friendly', 'Caycuse Cabin, pet friendly', 245, 2, 2],
  ]);
  assert.deepEqual([c.minNights, c.maxPersons, c.yearRound], [2, 4, true]);
});

test('nitinaht: motel room types and per-room maxima', () => {
  const m = parseNwMotel(motel);
  assert.deepEqual(m.units.map(u => [u.id, u.name, u.price, u.occupancy]), [
    ['motel-rooms-1-5', 'Nitinaht Lake Motel, queen room (rooms 1-5)', 120, 2],
    ['motel-rooms-6-9', 'Nitinaht Lake Motel, 2-bedroom room with kitchenette (rooms 6-9)', 150, null],
  ]);
  assert.ok(m.units[1].features.includes('maximum 3 or 4 people'));
  assert.deepEqual([m.minNights, m.yearRound], [1, true]);
});

test('nitinaht: campsite season and price', () => {
  assert.deepEqual(parseNwCampsite(campsite), {
    start: '2026-04-27', end: '2026-10-04', price: 35, bookingFee: 5, gst: true, adults: 2, extraAdult: 10,
  });
});

test('nitinaht: slots (campsite only while its season has not ended)', () => {
  const notes: string[] = [];
  const now = buildNwSlots({ cabins, motel, campsite }, '2026-10-23', { note: t => notes.push(t) });
  assert.deepEqual(checkSlots(now).problems, []);
  assert.deepEqual(now.map(s => s.key), ['cabin-no-pets', 'cabin-pet-friendly', 'motel-rooms-1-5', 'motel-rooms-6-9']);
  const s = now[0];
  assert.deepEqual([s.price, s.currency, s.priceUnit, s.priceBasis, s.availability, s.startDate, s.minNights], [220, 'CAD', 'per_night', 'room', 'unknown', null, 2]);
  assert.match(notes.join(' '), /campground season 2026-04-27\.\.2026-10-04 has ended/);

  const summer = buildNwSlots({ cabins, motel, campsite }, '2026-06-01');
  assert.deepEqual(checkSlots(summer).problems, []);
  const camp = summer.find(x => x.key === 'campsite|2026-04-27')!;
  assert.deepEqual([camp.startDate, camp.endDate, camp.price, camp.occupancy, camp.priceUnit], ['2026-04-27', '2026-10-04', 35, 2, 'per_night']);
  assert.match(camp.availabilityText!, /CAD 35 per site per night plus CAD 5 online booking fee per booking plus GST/);
});

test('nitinaht: fire banner only on info pages; on a booking page it closes that page', () => {
  assert.equal(nwBookingBanner(cabins), null);
  assert.equal(nwBookingBanner(motel), null);
  assert.equal(nwBookingBanner(campsite), null);
  assert.equal(nwBookingBanner(things), BANNER);
  const notes: string[] = [];
  const withBanner = cabins.replace('<div id="main-content">', `<div id="main-content"><h3>${BANNER}</h3>`);
  const slots = buildNwSlots({ cabins: withBanner, motel, campsite }, '2026-10-23', { note: t => notes.push(t) });
  assert.deepEqual(slots.map(x => x.availability), ['closed', 'closed', 'unknown', 'unknown']);
  assert.equal(slots[0].availabilityText, BANNER);
  assert.match(notes[0], /cabin page shows/);
});

test('nitinaht: fetchSlots from fixtures', async () => {
  const slots = await nitinahtWindsurfParkCabinsNitinatLake.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 4); // the 2026 campsite season is past for any "today" after 2026-10-04
});

test('nitinaht: content', async () => {
  const c = parseNwContent({ cabins, motel, campsite, things }, '2026-10-23');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.country, c.region, c.spot, c.durationDays, c.kiteLessons], ['accommodation', 'Canada', 'Nitinat Lake, Vancouver Island', 'Nitinat Lake', null, null]);
  assert.match(c.summary, /Six 1-bedroom Caycuse Cabins .* at CAD 220 to 245 per night \(pet friendly cabins cost more\), minimum 2 nights, open year-round\./);
  assert.match(c.summary, /queen rooms \(CAD 120\) and 2-bedroom rooms with kitchenette \(CAD 150\) per night/);
  assert.match(c.summary, /the 2026 campground season ran April 27 to October 4 and the next season's dates are not published yet/);
  assert.ok(!/[–—]/.test(c.summary));
  assert.deepEqual(c.rooms.map(r => r.name), [
    'Caycuse Cabin, no pets', 'Caycuse Cabin, pet friendly',
    'Nitinaht Lake Motel, queen room (rooms 1-5)', 'Nitinaht Lake Motel, 2-bedroom room with kitchenette (rooms 6-9)',
    'Basic campsite (Windsurf Park campground)',
  ]);
  assert.equal(c.imageUrls.length, 8);
  assert.equal(c.imageUrls[0], 'https://visitnitinaht.com/wp-content/uploads/about-grid-2.jpg');
  assert.ok(c.imageUrls.every(u => !/-\d+x\d+\.|ZenSeekers-7\.|campground-map|\.png$/.test(u)));
  assert.match(c.sourceText!, /info-page banner \(not on the booking pages\)/);
  const live = await nitinahtWindsurfParkCabinsNitinatLake.fetchContent(ctx);
  assert.equal(contentProblem(live), null);
});
