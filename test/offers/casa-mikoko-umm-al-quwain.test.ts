// Casa Mikoko: replays the home shell + the app bundle recorded 2026-10-30, trimmed to the room, kite and image data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCmSlots, casaMikokoUmmAlQuwain, cmBundleUrl, parseCmCards, parseCmChalets, parseCmKite,
} from '../../src/offers/adapters/casa-mikoko-umm-al-quwain.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/casa-mikoko-umm-al-quwain');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const js = read('casamikoko.com_assets_index-');
const ctx = { note: () => {}, incomplete: () => {} };

test('casa mikoko: bundle URL from the home shell', () => {
  assert.equal(cmBundleUrl(read('casamikoko.com_.')), 'https://casamikoko.com/assets/index-DrsoDzrC.js');
  assert.equal(cmBundleUrl('<html></html>'), null);
});

test('casa mikoko: five chalets with price, capacity and photos', () => {
  const c = parseCmChalets(js);
  assert.deepEqual(c.map(x => [x.title, x.price]), [
    ['Chalet Moja 101', 2200], ['Chalet Mbili 102', 2200], ['Chalet Tatu 103', 1200], ['Chalet Nne 104', 1200], ['Chalet Tano 105', 4500],
  ]);
  assert.equal(c[4].capacity, '6 Guests (4 adults, 2 children 0-5)');
  assert.ok(c[0].features.includes('Private Pool'));
  assert.deepEqual(c[2].images, ['https://casamikoko.com/images/chalet-tatu-103.jpg', 'https://casamikoko.com/images/chalet-103-104-ext.jpg']);
  assert.equal(parseCmCards(js).length, 3);
});

test('casa mikoko: kite course', () => {
  const k = parseCmKite(js)!;
  assert.deepEqual([k.duration, k.min, k.max, k.capacity], ['1-10 hours', 300, 2500, '1-4 students per instructor']);
  assert.ok(k.features.includes('IKO certification available'));
  assert.equal(parseCmKite('nothing'), null);
});

test('casa mikoko: one undated slot per room type', async () => {
  const slots = await casaMikokoUmmAlQuwain.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.availability]), [
    ['room|bathtub', 1200, 'AED', 'per_night', 'room', 3, 'unknown'],
    ['room|pool', 2200, 'AED', 'per_night', 'room', 3, 'unknown'],
    ['room|family', 4500, 'AED', 'per_night', 'room', 6, 'unknown'],
  ]);
  assert.deepEqual(buildCmSlots([]), []);
});

test('casa mikoko: content', async () => {
  const c = await casaMikokoUmmAlQuwain.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.country, 'United Arab Emirates');
  assert.deepEqual(c.spotCoords, { lat: 25.5392061, lng: 55.6286385 });
  assert.equal(c.kiteLessons, true);
  assert.equal(c.rooms.length, 3);
  assert.match(c.summary, /Prices start at AED 1,200 per chalet and night/);
  assert.match(c.summary, /kitesurfing course of 1-10 hours \(AED 300 to 2,500\)/);
  assert.match(c.sourceText ?? '', /Bungalows Without Pool: AED 1,320/);
  assert.equal(c.imageUrls[0], 'https://casamikoko.com/images/chalet-moja-101.jpg');
  assert.ok(c.imageUrls.every(u => !/logo|dining/.test(u)));
});
