// 35 Knots Brazil (Praia de Macapá): replays /en, /en/chalets and /en/villa recorded 2026-10-12 (Wix; script
// bodies trimmed except the business-location fragment, CSS and SVGs trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  thirtyFiveKnotsMacapa, k35Coords, k35Lines, k35VisiblePrices, parseK35Facts,
} from '../../src/offers/adapters/35-knots-macapa.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/35-knots-macapa');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };
const home = read('www.35knots-brazil.com_en.');
const chalets = read('www.35knots-brazil.com_en_chalets.');
const villa = read('www.35knots-brazil.com_en_villa.');
const text = (h: string) => k35Lines(h).join(' ').replace(/\s+([,.;:!?])/g, '$1');

test('35k: facts from home and villa pages', () => {
  assert.deepEqual(parseK35Facts(text(home), text(villa)), {
    villaGuests: 11, chalets: 4, chaletGuests: 4, villaBedrooms: 4, villaBathrooms: 3,
    windFrom: 'July', windTo: 'January', windAvg: '20 to 24', windPeak: 35,
    breakfastHours: '8 am - 10 am', wifiMbps: 500,
  });
});

test('35k: map pin = the Wix site business location', () => {
  assert.deepEqual(k35Coords(home), { lat: -2.9118897, lng: -41.4475968 });
  assert.equal(k35Coords('<html></html>'), null);
});

test('35k: no price on the pages -> [] (Wix Hotels engine not used)', async () => {
  assert.deepEqual(k35VisiblePrices(chalets), []);
  const slots = await thirtyFiveKnotsMacapa.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, ['no slot source: rooms are bookable only in the Wix Hotels app (signed visitor-token handshake, not used)']);
});

test('35k: content', async () => {
  const c = await thirtyFiveKnotsMacapa.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, '35 Knots Brazil');
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.country, 'Brazil');
  assert.equal(c.region, 'Piauí');
  assert.equal(c.spot, 'Praia de Macapá');
  assert.deepEqual(c.spotCoords, { lat: -2.9118897, lng: -41.4475968 });
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /4-bedroom villa with private pool for groups of up to 11 guests and 4 air-conditioned chalets/);
  assert.match(c.summary, /July to January \(average 20-24 knots\)/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Kite Villa', 'Chalet']);
  assert.ok(c.rooms[0].features.includes('3 bathrooms'));
  assert.ok(c.includedServices.includes('Breakfast buffet (8 am-10 am)'));
  assert.ok(c.optionalServices.includes('Quad-bike shuttle to the kite spot'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /^https:\/\/static\.wixstatic\.com\/media\/[^/]+$/.test(u) && !/\.png$/i.test(u)));
  assert.equal(new Set(c.imageUrls).size, 30);
});
