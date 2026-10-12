// Che Shale (Mambrui / Malindi, Kenya): replays the Wix pages recorded 2026-10-12 (fixtures trimmed: script/style
// bodies dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cheShaleMambrui, buildCsSlots, parseCsBandas } from '../../src/offers/adapters/che-shale-mambrui.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/che-shale-mambrui');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const bandasHtml = read('www.cheshale.com_bandas.');

test('che shale: banda sections (first of the two copies) with from prices', () => {
  assert.deepEqual(parseCsBandas(bandasHtml).map(b => [b.name, b.sleeps, b.single, b.double, b.groupFrom, b.minPax, b.extraPerPerson]), [
    ['Deluxe Banda', '2', 135, 185, null, null, null],
    ['Tewa Banda', '2', 110, 160, null, null, null],
    ['Suli Suli & Fulusi Banda', '3-4', 110, 160, null, null, null],
    ['Songoro Banda', '5', null, null, 225, 3, 65],
    ['Kole Kole Banda', '6', null, null, 290, 4, 65],
    ['Kajama Banda', '2', 90, 130, null, null, null],
  ]);
});

test('che shale: slots = banda x guests, USD per banda per night, no dates', async () => {
  const slots = await cheShaleMambrui.fetchSlots(ctx);
  assert.deepEqual(slots, buildCsSlots(parseCsBandas(bandasHtml)));
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.occupancy]), [
    ['deluxe-banda-1p', 135, 1], ['deluxe-banda-2p', 185, 2], ['tewa-banda-1p', 110, 1], ['tewa-banda-2p', 160, 2],
    ['suli-suli-fulusi-banda-1p', 110, 1], ['suli-suli-fulusi-banda-2p', 160, 2], ['songoro-banda-3p', 225, 3],
    ['kole-kole-banda-4p', 290, 4], ['kajama-banda-1p', 90, 1], ['kajama-banda-2p', 130, 2],
  ]);
  assert.ok(slots.every(s => s.currency === 'USD' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'unknown' && s.startDate === null));
});

test('che shale: content', async () => {
  const c = await cheShaleMambrui.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Che Shale');
  assert.equal(c.country, 'Kenya');
  assert.match(c.summary, /nine bandas/);
  assert.match(c.summary, /founded in 1999 as Kenya's first/);
  assert.match(c.summary, /from USD 130 per banda per night for two \(Kajama Banda\)/);
  assert.equal(c.rooms.length, 6);
  assert.ok(c.rooms[3].features.includes('Additional guests above 3: USD 65 per person per night'));
  assert.ok(c.optionalServices.includes('Beginner kite course, 8-10 h 1-2-1 over 3-4 days: USD 350 per person'));
  assert.ok(c.optionalServices.includes('Stay a little longer: 4 nights for the price of 3 (B&B, minimum 4 nights, stays until 15th December 2026)'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /^https:\/\/static\.wixstatic\.com\/media\/[^/]+$/.test(u)));
});
