// Beekite Village (Praia do Macapá): replays the pousada, about, spot, booking-request and map pages of
// www.kitesurf-brasil.eu recorded 2026-10-12 (scripts except the map coordinates, styles and SVGs trimmed;
// Google Maps key redacted). Content only: the site prints no chalet price (Aaron 2026-10-12: listed anyway).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  beekiteVillageMacapa, bkvImages, bkvVisiblePrices, parseBkvChalets, parseBkvCoords, parseBkvOptions,
} from '../../src/offers/adapters/beekite-village-macapa.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/beekite-village-macapa');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };
const pousada = read('www.kitesurf-brasil.eu_en_pousada-beekite-village-2_.');

test('beekite: chalets from the pousada page', () => {
  const c = parseBkvChalets(pousada);
  assert.equal(c.count, 11);
  assert.equal(c.built, 2023);
  assert.match(c.text, /on the premises of the Beekite Village kitesurfing Station/);
  assert.deepEqual(c.features, [
    'Up to 3-4 guests', 'On stilts', 'Private bathroom', 'King-size bed', 'Outdoor shower', 'Own terrace',
    'Air conditioning', 'Hot shower', 'Refrigerator',
  ]);
});

test('beekite: request-form options (courses, rental, tours, member) as printed, dashes normalized', () => {
  const o = parseBkvOptions(read('www.kitesurf-brasil.eu_en_booking-request_.'));
  assert.deepEqual(Object.keys(o), ['Tours', 'Kite courses', 'Rental', 'Member']);
  assert.equal(o['Kite courses'].length, 12);
  assert.ok(o['Kite courses'].includes('Base Course - 420,00 €'));
  assert.ok(o['Kite courses'].includes('Basic course - Learning to jump - 420,00 €'));
  assert.ok(o.Rental.includes('Completely equipment (1 week) - 490,00 €'));
  assert.ok(o.Member.includes('Service Fee Member 1 Week - 85 €'));
  assert.ok(Object.values(o).flat().every(s => !/[–—]/.test(s)));
});

test('beekite: map pin from the Google Maps embed', () => {
  assert.deepEqual(parseBkvCoords(read('www.kitesurf-brasil.eu_en_map-beekite-village_.')), { lat: -2.9078027, lng: -41.4505481 });
  assert.equal(parseBkvCoords('<html></html>'), null);
});

test('beekite: gallery originals first, no theme logo, no size duplicates', () => {
  const imgs = bkvImages(pousada);
  assert.equal(imgs.length, 20);
  assert.equal(imgs[0], 'https://www.kitesurf-brasil.eu/wp-content/uploads/2021/12/Hospedagem_BeeKite-2.jpg');
  assert.ok(imgs.every(u => /\/wp-content\/uploads\//.test(u) && !/\/themes\/|-\d+x\d+\./.test(u)));
});

test('beekite: no chalet price on the site -> [] (price on request)', async () => {
  assert.deepEqual(bkvVisiblePrices(pousada), []);
  const slots = await beekiteVillageMacapa.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
  // a price showing up on the page is reported
  assert.deepEqual(bkvVisiblePrices('<div class="pagecontent"><p>Chalet from R$ 450 per night</p></div>'), ['R$ 450']);
});

test('beekite: content', async () => {
  const c = await beekiteVillageMacapa.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Beekite Village');
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.country, 'Brazil');
  assert.equal(c.region, 'Piauí');
  assert.equal(c.spot, 'Praia do Macapá');
  assert.deepEqual(c.spotCoords, { lat: -2.9078027, lng: -41.4505481 });
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.equal(c.beginnerFriendly, true);
  assert.match(c.summary, /11 beach chalets on its grounds at Praia do Macapá/);
  assert.match(c.summary, /publishes no chalet prices/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Beach chalet']);
  assert.ok(c.optionalServices.some(s => s.startsWith('Kite courses: ') && s.includes('Base Course - 420,00 €')));
  assert.equal(c.bookingUrl, 'https://www.kitesurf-brasil.eu/en/pousada-beekite-village-2/#booking');
  assert.match(c.sourceText!, /Duotone/);
  assert.equal(beekiteVillageMacapa.confidence, 'low');
});
