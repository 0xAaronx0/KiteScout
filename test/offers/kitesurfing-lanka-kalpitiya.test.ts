// Kitesurfing Lanka (Kandakuliya, Kalpitiya, Sri Lanka): replays the pages recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kitesurfingLankaKalpitiya, buildKslSlots, kslRoomName, parseKslRates, parseKslRoomCards,
} from '../../src/offers/adapters/kitesurfing-lanka-kalpitiya.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { slotRoom } from '../../src/offers/ingest.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitesurfing-lanka-kalpitiya');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('ksl: rate table = room type x occupancy, "/" cells skipped', () => {
  const rates = parseKslRates(read('www.kitesurfinglanka.com_how-much_.'));
  assert.equal(rates.length, 25);
  assert.deepEqual(rates.filter(r => r.room.startsWith('Beach bungalow')).map(r => [r.occupancy, r.price]), [[1, 110], [2, 100], [3, 90], [4, 80]]);
  assert.deepEqual(rates.filter(r => r.room.startsWith('Premium')).map(r => r.occupancy), [1, 2]);
  assert.ok(rates.filter(r => r.room.startsWith('Double bedroom')).every(r => r.perRoomNote));
  assert.equal(kslRoomName('Double bedroom garden bungalow 1-6 pax (3 pax per room)'), 'Double bedroom garden bungalow');
  assert.equal(kslRoomName('Glamping tent ( 1-2 pax)'), 'Glamping tent');
});

test('ksl: slots EUR per person per night, full board, on request', async () => {
  const slots = await kitesurfingLankaKalpitiya.fetchSlots(ctx);
  assert.deepEqual(slots, buildKslSlots(parseKslRates(read('www.kitesurfinglanka.com_how-much_.'))));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 25);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'person'
    && s.availability === 'on_request' && s.startDate === null));
  const by = (k: string) => slots.find(s => s.key === k)!;
  assert.equal(by('luxury-beach-bungalow|1p').price, 145);
  assert.equal(by('glamping-tent|2p').price, 40);
  assert.deepEqual([by('ksl-villa|4p').unit, by('ksl-villa|4p').price], ['KSL Villa', 85]);
  assert.equal(Math.min(...slots.map(s => s.price!)), 40);
});

test('ksl: /stay/ room cards', () => {
  const cards = parseKslRoomCards(read('www.kitesurfinglanka.com_stay_.'));
  assert.equal(cards.length, 9);
  assert.deepEqual(cards[0], {
    name: 'Luxury Beach Bungalow',
    url: 'https://www.kitesurfinglanka.com/accommodations-in-kalpitiya/luxury-beach-bungalow/',
    text: 'Our luxury beach front bungalows provide an unforgettable experience at Kitesurfing Lanka.',
    prices: ['Single 145€/pp Full board', 'Double 120€/pp Full board'],
  });
});

test('ksl: content', async () => {
  const c = await kitesurfingLankaKalpitiya.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kitesurfing Lanka');
  assert.equal(c.country, 'Sri Lanka');
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /8-acre former coconut estate/);
  assert.match(c.summary, /mid-May to mid-October and mid-December to mid-March/);
  assert.ok(c.optionalServices.includes('Kite lessons (IKO): private EUR 65 / group EUR 50 per hour, gear and transfers included'));
  assert.match(c.sourceText ?? '', /dateModified 2026-06-09/);
  assert.ok(c.imageUrls.length >= 20);
  assert.ok(c.imageUrls.every(u => !/themes\/ksl\/assets|logo|\.svg/i.test(u)));
});

test('ksl: every rate-table unit prices its /stay/ card room', async () => {
  const c = await kitesurfingLankaKalpitiya.fetchContent(ctx);
  const slots = await kitesurfingLankaKalpitiya.fetchSlots(ctx);
  const names = c.rooms.map(r => r.name);
  const map = Object.fromEntries(slots.map(s => [s.unit, slotRoom(names, s)]));
  assert.deepEqual(map, {
    'Luxury Beach bungalow': 'Luxury Beach Bungalow',
    'Beach bungalow': 'Beach Bungalow',
    'Premium Bungalow': 'Premium Bungalows',
    'Lagoon view bungalow': 'Lagoon View Bungalows',
    'Garden view bungalow': 'Garden View Bungalows',
    'Double bedroom garden bungalow': 'Double Bedroom Garden Bungalow',
    'Glamping tent': 'Glamping',
    'KSL Villa': 'Four Bedroom Villa',
  });
});
