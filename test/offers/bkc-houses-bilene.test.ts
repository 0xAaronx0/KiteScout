// Bilene Kite Center Houses (Praia do Bilene, Mozambique): replays the English lodging, kite centre and home pages
// recorded 2026-10-12 (fixtures trimmed). Slots = the BKC house rate table, EUR per night, on request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bkcHousesBilene, buildBkcSlots, parseBkcRates } from '../../src/offers/adapters/bkc-houses-bilene.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/bkc-houses-bilene');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const lodging = read('www.bilenekite.com_en_lodging-in-bilene-mozambique_.');

test('bkc: house rate table', () => {
  assert.deepEqual(parseBkcRates(lodging).map(r => [r.option, r.persons, r.amount, r.currency]), [
    ['Sea view room', '2', 70, 'EUR'], ['Standard room', '2', 50, 'EUR'], ['Whole house', '4-6', 100, 'EUR'],
  ]);
});

test('bkc: slots (no dates, on request)', async () => {
  const slots = await bkcHousesBilene.fetchSlots(ctx);
  assert.deepEqual(slots, buildBkcSlots(parseBkcRates(lodging)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.occupancy]), [
    ['sea-view-room', 'Sea view room (2 guests)', 70, 2],
    ['standard-room', 'Standard room (2 guests)', 50, 2],
    ['whole-house', 'Whole house (4-6 guests)', 100, null],
  ]);
  assert.ok(ok.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.availability === 'on_request' && s.startDate === null));
});

test('bkc: content (own houses only, partner hotels left out)', async () => {
  const c = await bkcHousesBilene.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Bilene Kite Center Houses');
  assert.equal(c.country, 'Mozambique');
  assert.equal(c.spot, 'Praia do Bilene');
  assert.match(c.summary, /two en-suite bedrooms/);
  assert.match(c.summary, /from September to March/);
  assert.doesNotMatch(c.summary, /San Martinho|Sunset/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Sea view room', 'Standard room', 'Whole house']);
  assert.ok(c.imageUrls[0].endsWith('/images/11-Accomodation/houses/1.jpg'));
  assert.ok(c.imageUrls.every(u => !/SanMart|Sun\d|partners|logo/.test(u)));
  assert.match(c.sourceText ?? '', /Google March 2026/);
});
