// Valampuri Resort (Kalpitiya, Sri Lanka): replays the pages recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  valampuriResortKalpitiya, parseValPackages, parseValPriceCards, parseValRooms, valBasis,
} from '../../src/offers/adapters/valampuri-resort-kalpitiya.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { planGallery } from '../../src/offers/gallery.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/valampuri-resort-kalpitiya');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('valampuri: /stay/ lists 8 room types with their room pages', () => {
  const rooms = parseValRooms(read('www.valampuriresort.com_stay_.'));
  assert.equal(rooms.length, 8);
  assert.deepEqual(rooms.map(r => r.path).slice(0, 3), ['/poolside-comfort-chalet/', '/open-air-cabana/', '/garden-eco-chalet/']);
  const dorm = rooms.find(r => r.name === 'Wind Rider Dorm')!;
  assert.equal(dorm.fromPrice, '€25 p/p half board');
});

test('valampuri: room page price cards, supplements flagged', () => {
  const cards = parseValPriceCards(read('www.valampuriresort.com_poolside-comfort-chalet_.'));
  assert.deepEqual(cards.map(c => [c.label, c.amount, c.supplement]), [
    ['BB Single', 60, false], ['BB Double p/p', 35, false], ['Full Board', 16, true],
  ]);
  assert.deepEqual(valBasis(cards[1]), { basis: 'person', occupancy: 2 });
  assert.deepEqual(valBasis({ label: 'BB Triple p/p', amount: 20, note: 'Per person sharing', supplement: false, raw: '€20' }), { basis: 'person', occupancy: 3 });
  assert.deepEqual(valBasis({ label: 'Group Rate', amount: 90, note: 'Room for up to 6 guests', supplement: false, raw: '€90' }), { basis: 'room', occupancy: 6 });
});

test('valampuri: slots = room x price card, EUR per night, on request, no dates', async () => {
  const slots = await valampuriResortKalpitiya.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 16);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.availability === 'on_request'
    && s.startDate === null && s.endDate === null));
  const by = (k: string) => slots.find(s => s.key === k)!;
  assert.equal(by('essential-double|bb-double-p-p').price, 18);
  assert.equal(by('comfort-terrace-double|bb-triple-p-p').occupancy, 3);
  assert.deepEqual([by('garden-family-suite|group-rate').price, by('garden-family-suite|group-rate').priceBasis], [90, 'room']);
  assert.deepEqual([by('wind-rider-dorm|half-board').price, by('wind-rider-dorm|half-board').occupancy], [25, 1]);
  assert.ok(!slots.some(s => /full-board/.test(s.key)), 'full-board supplement is not a slot');
  assert.equal(Math.min(...slots.map(s => s.price!)), 15);
});

test('valampuri: package table', () => {
  const p = parseValPackages(read('www.valampuriresort.com_rates-offers_.'));
  assert.equal(p.length, 6);
  assert.deepEqual(p[2], { name: 'Learn Together Escape', nights: 3, accommodation: 'Couple accommodation', kite: '6-hour group lesson course', price: '€245 pp (2 sharing)' });
});

test('valampuri: content', async () => {
  const c = await valampuriResortKalpitiya.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Valampuri Resort');
  assert.equal(c.country, 'Sri Lanka');
  assert.equal(c.spot, 'Kalpitiya Lagoon');
  assert.deepEqual(c.spotCoords, { lat: 8.2489381, lng: 79.7579837 });
  assert.equal(c.rooms.length, 8);
  assert.match(c.summary, /IKO-affiliated kite school/);
  assert.match(c.summary, /May to October and December to March/);
  assert.ok(c.optionalServices.some(s => /Learn Together Escape: 3 nights/.test(s)));
  assert.match(c.sourceText ?? '', /dateModified 2026-07-17/);
  assert.ok(c.imageUrls.length >= 20);
  assert.ok(c.imageUrls.every(u => !/brand|logo|badge|\.svg/i.test(u)));
});

test('valampuri: own photos per room (/stay/ card, then the room page gallery), kite photos as the spot', async () => {
  const c = await valampuriResortKalpitiya.fetchContent(ctx);
  assert.deepEqual(c.rooms.map(r => [r.name, r.imageUrls?.length ?? 0]), [
    ['Poolside Comfort Chalet', 11], ['Open-Air Cabana', 10], ['Garden Eco Chalet', 17], ['Comfort Terrace Double', 10],
    ['Family Eco Chalet', 9], ['Garden Family Suite', 11], ['Essential Double', 11], ['Wind Rider Dorm', 9],
  ]);
  const photos = (name: string) => c.rooms.find(r => r.name === name)!.imageUrls!;
  assert.equal(photos('Poolside Comfort Chalet')[0], 'https://www.valampuriresort.com/images/rooms/poolside-comfort-chalet/poolside-comfort-chalet-exterior-front-view.webp');
  assert.match(photos('Open-Air Cabana')[0], /open-air-cabana-a03-terrace-exterior\.webp$/);
  assert.match(photos('Garden Eco Chalet')[1], /\/eco-wooden-cabana\/garden-eco-chalet-cozy-interior\.webp$/); // its folder has another name
  assert.match(photos('Comfort Terrace Double')[0], /comfort-terrace-double-terrace-garden-entrance\.webp$/);
  assert.match(photos('Family Eco Chalet')[0], /family-eco-chalet-front-view\.webp$/);
  assert.match(photos('Garden Family Suite')[0], /garden-family-suite-exterior-front\.webp$/);
  // the card shows a 600 px thumb; the room page has the full-size file of the same photo
  assert.equal(photos('Essential Double')[0], 'https://www.valampuriresort.com/images/rooms/essential-double/essential-double-garden-view-room.webp');
  assert.match(photos('Wind Rider Dorm')[0], /wind-rider-dorm-budget-kitesurf-stay\.webp$/);
  // each room only its own folder: the "other rooms" teasers on every room page stay out
  for (const r of c.rooms) {
    const folder = r.name === 'Garden Eco Chalet' ? 'eco-wooden-cabana' : r.name.toLowerCase().replace(/[^a-z]+/g, '-');
    assert.ok(r.imageUrls!.every(u => u.startsWith(`https://www.valampuriresort.com/images/rooms/${folder}/`) && !/-thumb|-\d+w\.webp$/.test(u)), r.name);
  }
  // a photo also in the general list keeps its URL there
  assert.ok(c.imageUrls.includes(photos('Garden Eco Chalet')[0]));
  assert.deepEqual(c.spotImageUrls!.map(u => u.split('/').pop()), [
    'valampuri-home-hero-kitesurfing-lesson-q40.webp', 'valampuri-kitesurfing-lesson-hero-opt.webp', 'valampuri-kitesurfing-lessons-hero.webp',
    'home-kite-trips-downwinders-card.webp', 'valampuri-kitesurfing-seasons-boat-sunset-hero.webp', 'valampuri-kitesurfing-rider-kalpitiya.webp',
    'valampuri-kitesurfing-waterstart-kalpitiya.webp', 'home-learn-to-kitesurf-card.webp',
  ]);
  const first24 = planGallery(c).candidates.slice(0, 24);
  for (const r of c.rooms) if (r.imageUrls?.length) assert.ok(r.imageUrls.some(u => first24.includes(u)), r.name);
  assert.ok(first24.includes(c.spotImageUrls![0]));
});
