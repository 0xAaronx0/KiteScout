// Floripa Yoga & Kitesurf House (Ispica, Sicily): replays the pages recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  floripaIspica, buildFloripaSlots, compactMinStay, floripaBedCount, parseFloripaBasic, parseFloripaBeds, parseFloripaKite, parseFloripaRooms,
} from '../../src/offers/adapters/floripa-ispica.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/floripa-ispica');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('floripa: basic package "From €62/night", minimum 3 nights', () => {
  assert.deepEqual(parseFloripaBasic(read('www.floripa.it_packages.')), { nightly: 62, currency: 'EUR', minNights: 3 });
  assert.equal(parseFloripaBasic('<p>Minimum stay 4 nights | From 1.050 €/night</p>')?.nightly, 1050);
  assert.equal(parseFloripaBasic('<p>Prices on request</p>'), null);
});

test('floripa: one undated slot per person per night, availability unknown', async () => {
  const slots = await floripaIspica.fetchSlots(ctx);
  assert.deepEqual(slots, buildFloripaSlots({ nightly: 62, currency: 'EUR', minNights: 3 }));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.minNights, s.availability]), [
    ['basic-package', 62, 'EUR', 'per_night', 'person', 1, 3, 'unknown'],
  ]);
  assert.ok(slots.every(s => s.startDate === null && s.endDate === null));
});

test('floripa: room cards per house', () => {
  const rooms = parseFloripaRooms(read('www.floripa.it_rooms.'));
  assert.equal(rooms.length, 15);
  assert.deepEqual(rooms[0], {
    name: 'Sunset Room', house: 'Surf House', type: 'Double Room', tagline: null, path: '/accomodations/sunset-room',
    image: 'https://cdn.prod.website-files.com/68395504db2760ef20b335df/69f7860f68a4806da00ba678_Surf%20House%20Sunset1.jpg',
  });
  assert.deepEqual([...new Set(rooms.map(r => r.house))], ['Surf House', 'Kite House', 'Beach House', 'Outside the centre']);
  assert.ok(rooms.some(r => r.name === 'Shipwreck Suite' && r.type === '4 Beds Room (shared or private use)'));
});

test('floripa: kite prices and minimum stay wording', () => {
  assert.deepEqual(parseFloripaKite(read('www.floripa.it_water-sports-kitesurf.')), { courseHourly: 80, courseHours: 6, rentalDay: 90, brands: ['F-One', 'RRD'] });
  assert.equal(compactMinStay('To create a community feeling where everyone has time to get to know each other, the minimum booking length is 3 nights. In August, the minimum booking length is 7 nights in a private room and 4 nights in a shared room.'),
    'Minimum stay 3 nights (August: 7 nights in a private room, 4 in a shared room)');
});

test('floripa: content', async () => {
  const c = await floripaIspica.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Floripa Yoga & Kitesurf House');
  assert.equal(c.country, 'Italy');
  assert.equal(c.region, 'Ragusa, Sicily');
  assert.equal(c.spot, 'Santa Maria del Focallo');
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.spotCoords, undefined);
  assert.match(c.summary, /open from late March to early November/);
  assert.match(c.summary, /from EUR 62 per night, minimum 3 nights/);
  assert.match(c.summary, /IKO-certified instructors .* EUR 80 per hour .* EUR 90 \(F-One and RRD\)/);
  assert.equal(c.rooms.length, 15);
  assert.ok(c.optionalServices.includes('Kitesurf lessons (EUR 80 per hour)'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => !/flag|logo|icon|\.svg|\.png|food|team|crew/i.test(decodeURIComponent(u))));
});

// Aaron 2026-11-02: Uluwatu and Shipwreck (double bed + two singles) show four guests; the card tagline is kept.
test('floripa: card taglines, bed layout and capacity of the private multi-bed rooms', async () => {
  const rooms = parseFloripaRooms(read('www.floripa.it_rooms.'));
  const card = (name: string) => rooms.find(r => r.name === name)!;
  assert.deepEqual([card('Ubatuba Room').tagline, card('Tarifa Room').tagline, card('Uluwatu Room').tagline], ['Mixed', 'Female Only', 'Perfect for families or friends']);
  assert.equal(card('Uluwatu Room').type, '4 beds');
  assert.deepEqual(['4 beds', '4 Beds Room (shared or private use)', 'Shared (4 beds)', 'Double Room'].map(floripaBedCount), [4, 4, null, null]);
  assert.equal(parseFloripaBeds(read('www.floripa.it_accomodations_uluwatu-room.')), 'a double bed and two single beds (or 4 singles)');
  const c = await floripaIspica.fetchContent(ctx);
  const room = (name: string) => c.rooms!.find(r => r.name === name)!;
  assert.deepEqual(room('Uluwatu Room').features!.slice(0, 3), ['Perfect for families or friends', 'Beds: a double bed and two single beds (or 4 singles)', 'Up to 4 guests']);
  assert.deepEqual(room('Shipwreck Suite').features!.slice(0, 2), ['Beds: a double bed and two single beds (or 4 singles)', 'Up to 4 guests']);
  assert.equal(room('Uluwatu Room').description, '4 beds, Surf House.');
  assert.ok(!room('Ubatuba Room').features!.some(f => /guests|^Beds:/.test(f)));
  assert.deepEqual(room('Sunset Room').features, ['Air conditioning', 'Wi-Fi', 'Fresh linens', 'Minimum stay 3 nights (August: 7 nights in a private room, 4 in a shared room)']);
});
