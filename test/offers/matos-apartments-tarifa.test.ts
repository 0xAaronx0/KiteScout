// Matos Tarifa apartments (Ático, C. Braille): replays the accommodation page recorded 2026-10-12 (scripts and styles
// trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  matosApartmentsTarifa, buildMatosSlots, matosBands, matosDateModified, matosSections, parseMatosApartments,
} from '../../src/offers/adapters/matos-apartments-tarifa.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/matos-apartments-tarifa');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const html = read('matos-tarifa.com_en_tarifa-guide_accommodation_.');

test('matos: page sections', () => {
  assert.deepEqual(matosSections(html).slice(0, 4).map(s => s.title), [
    'Ático Apartment in Tarifa Center', 'C.Braille Apartment - Ideal Kite Stay', 'The Wild House – Guest House', 'Kitesurf Road Trip in a Campervan',
  ]);
});

test('matos: two apartments with seasonal nightly rates and cleaning fee', () => {
  const apts = parseMatosApartments(html);
  assert.deepEqual(apts.map(a => [a.key, a.name, a.occupancy, a.cleaningFee, a.rates.map(r => [r.m1, r.m2, r.amount])]), [
    ['atico', 'Ático apartment', 2, 40, [[10, 2, 55], [3, 5, 75], [6, 9, 125]]],
    ['c-braille', 'C. Braille apartment', 4, 40, [[10, 2, 65], [3, 5, 85], [6, 9, 135]]],
  ]);
  assert.deepEqual(apts[0].highlights, ['1 to 4 People Max.', 'Wi-Fi / TV', 'Terrace', 'Quiet Neighborhood']);
  assert.equal(apts[0].images.length, 6);
  assert.equal(apts[1].images.length, 9);
});

test('matos: year-less seasons dated as one cycle from the page edit', () => {
  assert.equal(matosDateModified(html), '2026-03-06');
  const bands = matosBands(parseMatosApartments(html)[0].rates, '2026-03-06');
  assert.deepEqual(bands.map(b => [b.start, b.end, b.rate.amount]), [
    ['2026-03-01', '2026-05-31', 75], ['2026-06-01', '2026-09-30', 125], ['2026-10-01', '2027-02-28', 55],
  ]);
  // an edit in November starts the cycle in the low season that contains it
  assert.deepEqual(matosBands(parseMatosApartments(html)[0].rates, '2026-11-20').map(b => b.start), ['2026-10-01', '2027-03-01', '2027-06-01']);
});

test('matos: slots = apartment x season band, EUR per night for the apartment', async () => {
  const slots = await matosApartmentsTarifa.fetchSlots(ctx);
  assert.deepEqual(slots, buildMatosSlots(parseMatosApartments(html), '2026-03-06'));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 6);
  const s = (k: string) => slots.find(x => x.key === k)!;
  assert.deepEqual([s('atico|2026-10-01').price, s('atico|2026-10-01').endDate], [55, '2027-02-28']);
  assert.deepEqual([s('c-braille|2026-06-01').price, s('c-braille|2026-06-01').occupancy], [135, 4]);
  assert.match(s('atico|2026-10-01').availabilityText!, /Low Season \(October to February\).*cleaning fee 40 € per stay/);
  assert.ok(slots.every(x => x.currency === 'EUR' && x.priceUnit === 'per_night' && x.priceBasis === 'group' && x.availability === 'on_request'));
});

test('matos: content', async () => {
  const c = await matosApartmentsTarifa.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Matos Tarifa Apartments (Ático and C. Braille)');
  assert.equal(c.region, 'Tarifa town');
  assert.match(c.summary, /EUR 55 \/ 65 \(October-February\), 75 \/ 85 \(March-May\) and 125 \/ 135 \(June-September\)/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Ático apartment', 'C. Braille apartment']);
  assert.ok(c.rooms[0].features.includes('Cleaning fee: EUR 40 per stay'));
  assert.equal(c.imageUrls.length, 15);
  assert.ok(c.imageUrls.every(u => /\/2026\/02\//.test(u))); // apartment photos only, no Wild House / van / course photos
});
