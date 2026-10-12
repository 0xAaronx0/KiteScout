// Villa Pefkakia (Agios Nikolaos, Lefkada): replays the Wix pages recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  villaPefkakiaAgiosNikolaos, buildVpSlots, parseVpCoords, parseVpRate, parseVpRooms,
} from '../../src/offers/adapters/villa-pefkakia-agios-nikolaos.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/villa-pefkakia-agios-nikolaos');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const rooms = read('www.kitesurfagiosnikolaos.com_rooms.');

test('vp: "from" rate + minimum stay', () => {
  assert.deepEqual(parseVpRate(rooms), {
    amount: 88, currency: 'EUR', guests: 2, minNights: 5,
    text: 'Rates start from 88 € per night for two guests, green tax included.',
  });
});

test('vp: wording variants', () => {
  const html = '<p>Rates from 95 € per night for three guests.</p><p>Minimum stay 7 nights</p>';
  assert.deepEqual(parseVpRate(html), { amount: 95, currency: 'EUR', guests: 3, minNights: 7, text: 'Rates from 95 € per night for three guests.' });
  assert.equal(parseVpRate('<p>Please contact us for rates.</p>'), null);
});

test('vp: slots = one undated "from" rate, on request', async () => {
  const slots = await villaPefkakiaAgiosNikolaos.fetchSlots(ctx);
  assert.deepEqual(slots, buildVpSlots(parseVpRate(rooms)!));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.availability, s.minNights]), [
    ['room-2p-from', null, 88, 'EUR', 'per_night', 'room', 2, 'on_request', 5],
  ]);
  assert.ok(slots.every(s => s.startDate === null && s.endDate === null));
});

test('vp: rooms and map pin', () => {
  assert.deepEqual(parseVpRooms(rooms).map(r => r.name), ['Double room, 2 single beds', 'Double room, 1 double bed', 'Triple room', 'Family / Triple room']);
  assert.deepEqual(parseVpCoords(rooms), { lat: 38.87671, lng: 20.79541 });
});

test('vp: content', async () => {
  const c = await villaPefkakiaAgiosNikolaos.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Villa Pefkakia');
  assert.equal(c.country, 'Greece');
  assert.equal(c.spot, 'Agios Nikolaos, Lefkada');
  assert.equal(c.kiteLessons, false);
  assert.match(c.summary, /about 2 minutes from the kite spot/);
  assert.match(c.summary, /minimum stay is 5 nights and rates start from EUR 88 per night for 2 guests/);
  assert.match(c.summary, /15-20 knots/);
  assert.equal(c.rooms.length, 4);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://static.wixstatic.com/media/') && !u.includes('/v1/')));
  assert.ok(!c.imageUrls.some(u => u.includes('c93757bd545849f1bae05286fdf26fc5')), 'business logo excluded');
  assert.match(c.sourceText ?? '', /No kite lessons, no pets allowed/);
});
