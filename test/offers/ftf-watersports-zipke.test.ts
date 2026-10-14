// FTF Watersports Kite Camp Base (Zipke): replays the camp page and the partner farm's home page recorded 2026-10-14
// (scripts / styles / Squarespace data attributes dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ftfWatersportsZipke, buildFtfSlots, parseFtfCampWeeks, parseFtfFarmPin, parseFtfUnits,
} from '../../src/offers/adapters/ftf-watersports-zipke.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/ftf-watersports-zipke');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const camp = read('www.ftf-watersports.com_kite-camps.');

test('ftf: rental units (pitches and tents skipped)', () => {
  assert.deepEqual(parseFtfUnits(camp).map(u => [u.name, u.persons, u.price]), [
    ['Holiday flat for 2', 2, 65], ["Shepherd's hut (Schäferwagen) for 2", 2, 34], ['Mobile home for up to 5', 5, 80], ['Construction trailer (Bauwagen) for 2', 2, 45],
  ]);
});

test('ftf: camp weeks 2027 and the partner farm pin', () => {
  const w = parseFtfCampWeeks(camp);
  assert.equal(w.length, 16);
  assert.deepEqual(w[0], { start: '2027-06-07', end: '2027-06-11', free: 8 });
  assert.deepEqual(w[1], { start: '2027-06-14', end: '2027-06-18', free: 8 }); // printed "18.06.2026" inside the 2027 list
  assert.deepEqual(parseFtfFarmPin(read('www.ritter-zipke.de_.')), { lat: 54.34136, lng: 12.77711 });
});

test('ftf: slots and content', async () => {
  const slots = await ftfWatersportsZipke.fetchSlots(ctx);
  assert.deepEqual(slots, buildFtfSlots(parseFtfUnits(camp)));
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.ok(slots.every(s => s.startDate === null && s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.availability === 'on_request'));
  assert.deepEqual(slots.map(s => s.price), [65, 34, 80, 45]);
  const c = await ftfWatersportsZipke.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.region, 'Zipke, Fischland-Darß');
  assert.deepEqual(c.spotCoords, { lat: 54.34136, lng: 12.77711 });
  assert.match(c.summary, /5-day kite camps .* EUR 599 .* run June to September 2027; accommodation is not included/);
  assert.ok(c.optionalServices.some(s => /^Camp weeks 2027: 07\.06\.-11\.06\. \(8 free\)/.test(s)));
  assert.ok(c.imageUrls.length >= 20 && c.imageUrls.every(u => u.startsWith('https://images.squarespace-cdn.com/')));
});
