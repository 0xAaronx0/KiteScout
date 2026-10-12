// KITEKAHUNAS Kite Villa (Sunset Beach, Cape Town): replays the guesthouse page recorded 2026-10-12 (fixture trimmed).
// Slots = the two TablePress tables (rooms, beach apartments): occupancy x low / high season, EUR per night, no dates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kitekahunasKiteVillaSunsetBeach, buildKkSlots, parseKkCards, parseKkRates,
} from '../../src/offers/adapters/kitekahunas-kite-villa-sunset-beach.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitekahunas-kite-villa-sunset-beach');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const html = readFileSync(join(DIR, files.find(f => f.startsWith('www.kitekahunas.com_kitesurfing_guesthouse_.'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('kk: price tables (occupancy lines x low / high season)', () => {
  const rates = parseKkRates(html);
  assert.equal(rates.length, 18);
  assert.deepEqual(rates.filter(r => r.unit === 'Room 1').map(r => [r.persons, r.season, r.amount]), [
    ['1 person', 'low', 95], ['1 person', 'high', 105], ['2 persons', 'low', 105], ['2 persons', 'high', 115],
  ]);
  assert.deepEqual(rates.filter(r => r.house === 'apartments').map(r => [r.unit, r.season, r.amount]), [
    ['Apartment 1 (Upper Floor)', 'low', 79], ['Apartment 1 (Upper Floor)', 'high', 89],
    ['Apartment 2 (Ground Floor)', 'low', 59], ['Apartment 2 (Ground Floor)', 'high', 79],
  ]);
  assert.ok(!rates.some(r => /storage/i.test(r.unit)));
});

test('kk: slots', async () => {
  const slots = await kitekahunasKiteVillaSunsetBeach.fetchSlots(ctx);
  assert.deepEqual(slots, buildKkSlots(parseKkRates(html)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  const room4 = ok.filter(s => s.key.startsWith('room-4-'));
  assert.deepEqual(room4.map(s => [s.key, s.price, s.priceBasis]), [['room-4-1p|low', 49, 'person'], ['room-4-1p|high', 59, 'person']]);
  assert.deepEqual(ok.find(s => s.key === 'apartment-2-2p|low')?.price, 59);
  assert.ok(ok.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.availability === 'on_request' && s.startDate === null));
});

test('kk: room cards', () => {
  assert.deepEqual(parseKkCards(html).map(c => [c.name, c.description]), [
    ['Kite Villa Room 1', 'Master Bedroom with large Ensuite Bathroom'],
    ['Kite Villa Room 2', 'Master Bedroom with large Ensuite Bathroom'],
    ['Kite Villa Room 3', 'private Bedroom with Shared Bathroom'],
    ['Kite Villa Room 4', 'Shared Bedroom with Shared Bathroom'],
    ['Beach House Apartment 1', 'one Bedroom Apartment with Bathroom (upper floor)'],
    ['Beach House Apartment 2', 'one Bedroom Apartment with bathroom (ground floor)'],
  ]);
});

test('kk: content', async () => {
  const c = await kitekahunasKiteVillaSunsetBeach.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'KITEKAHUNAS Kite Villa');
  assert.equal(c.spot, 'Sunset Beach, Cape Town');
  assert.match(c.summary, /private rooms cost 79 to 105 EUR per night in low season \(a bed in the shared room 49 EUR\)/);
  assert.match(c.summary, /15 April to 30 September/);
  assert.ok(c.includedServices.includes('Kite storage (free with any room or apartment)'));
  assert.equal(c.imageUrls.length, 26);
  assert.ok(c.imageUrls.every(u => /kitekahunas\.com\/wp-content\/uploads\//.test(u) && !/_kite\.jpe?g$/.test(u)));
  assert.ok(!/[–—]/.test(`${c.summary} ${c.rooms.map(r => r.description).join(' ')}`));
});
