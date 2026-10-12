// Ikarus School & Hotel Boutique (Isla Blanca, Cancún): replays the pages recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildIkarusSlots, ikarusKiteboardMexicoIslaBlanca, parseIkarusRates } from '../../src/offers/adapters/ikarus-kiteboard-mexico-isla-blanca.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/ikarus-kiteboard-mexico-isla-blanca');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const rooms = read('kiteboardmexico.com_accommodations_.');

test('ikarus: price cards (rooms per occupancy, tents; own-gear pitch and day pass left out)', () => {
  assert.deepEqual(parseIkarusRates(rooms).map(r => [r.name, r.persons, r.price, r.camping]), [
    ['King Size Studio', 2, 2772, false],
    ['Triple Room', 3, 2244, false],
    ['Double Room Lagoon View', 2, 2244, false],
    ['Double Room', 2, 1980, false],
    ['Camping tent', 1, 600, true],
    ['Camping tent', 2, 840, true],
  ]);
});

test('ikarus: a card layout without the occupancy line yields nothing (no guessed occupancy)', () => {
  assert.deepEqual(parseIkarusRates('<main><h5>DOUBLE ROOM <br>$ 1,980 MXN</h5></main>'), []);
});

test('ikarus: slots = room / tent type, MXN per unit per night, no dates', async () => {
  const slots = await ikarusKiteboardMexicoIslaBlanca.fetchSlots(ctx);
  assert.deepEqual(slots, buildIkarusSlots(parseIkarusRates(rooms)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.occupancy]), [
    ['king-size-studio-2p', 'King Size Studio', 2772, 2],
    ['triple-room-3p', 'Triple Room', 2244, 3],
    ['double-room-lagoon-view-2p', 'Double Room Lagoon View', 2244, 2],
    ['double-room-2p', 'Double Room', 1980, 2],
    ['camping-tent-1p', 'Camping tent (1 person)', 600, 1],
    ['camping-tent-2p', 'Camping tent (2 persons)', 840, 2],
  ]);
  assert.ok(slots.every(s => s.currency === 'MXN' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'unknown' && s.startDate === null && s.endDate === null));
});

test('ikarus: content', async () => {
  const c = await ikarusKiteboardMexicoIslaBlanca.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Ikarus School & Hotel Boutique');
  assert.equal(c.country, 'Mexico');
  assert.equal(c.spot, 'Isla Blanca');
  assert.deepEqual(c.languages, ['en', 'es', 'de', 'it', 'fr']);
  assert.match(c.summary, /Chacmuchuch lagoon .* since 2002/);
  assert.match(c.summary, /10 solar-powered rooms .* from MXN 1,980 per night for two/);
  assert.equal(c.rooms.length, 6);
  assert.ok(c.rooms[0].features.includes('Extra person $ 250 MXN, child $ 120 MXN; max. capacity 4 persons per room.'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://kiteboardmexico.com/wp-content/uploads/') && !/logo|\.png$/i.test(u)));
});
