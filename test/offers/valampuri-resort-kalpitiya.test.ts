// Valampuri Resort (Kalpitiya, Sri Lanka): replays the pages recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  valampuriResortKalpitiya, parseValPackages, parseValPriceCards, parseValRooms, valBasis,
} from '../../src/offers/adapters/valampuri-resort-kalpitiya.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

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
