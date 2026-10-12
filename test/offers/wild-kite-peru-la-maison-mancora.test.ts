// La Maison by Wild Kite Peru (Mancora): replays the lodging + home pages recorded 2026-10-12 (trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  wildKitePeruLaMaisonMancora, buildWkpSlots, laMaisonSection, parseLaMaison, parseWkpRates,
} from '../../src/offers/adapters/wild-kite-peru-la-maison-mancora.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/wild-kite-peru-la-maison-mancora');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const lodging = read('wild-kitesurf-peru.com_best-place-to-stay-in-mancora_.');

test('wkp: La Maison price block = occupancy x price range (third-party options ignored)', () => {
  assert.deepEqual(parseWkpRates(lodging).map(r => [r.label, r.occupancy, r.min, r.max, r.currency]), [
    ['1 person', 1, 25, 90, 'USD'],
    ['2 persons', 2, 50, 90, 'USD'],
    ['Family (Triple)', 3, 55, 110, 'USD'],
  ]);
  // the 4-star partner hotel (USD 280-480) sits in its own section and must not leak in
  assert.ok(!laMaisonSection(lodging)!.includes('USD 280'));
});

test('wkp: slots = lowest price per occupancy, per room and night, on request, no dates', async () => {
  const slots = await wildKitePeruLaMaisonMancora.fetchSlots(ctx);
  assert.deepEqual(slots, buildWkpSlots(parseWkpRates(lodging)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.occupancy]), [
    ['la-maison-1p', 'La Maison room', 25, 1], ['la-maison-2p', 'La Maison room', 50, 2], ['la-maison-3p', 'La Maison room', 55, 3],
  ]);
  assert.ok(slots.every(s => s.currency === 'USD' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'on_request' && s.startDate === null && s.endDate === null));
});

test('wkp: price block parser on synthetic markup (layout of 2026-10-12)', () => {
  const html = `<div id="ourHotelClub"><div class="new-lodging-prices">
    <div class="price-for-person-col"><p>1 person:</p><span>Each room is different.</span><p class="price">From USD 30 to USD 95</p></div>
    <div class="price-for-person-col"><p>Family:</p><span>Triple</span><p class="price">USD 60</p></div>
  </div></div><div id="fiveStarsHotel"><div class="price-for-person-col"><p>1 person:</p><p class="price">USD 280</p></div></div>`;
  assert.deepEqual(parseWkpRates(html).map(r => [r.occupancy, r.min, r.max]), [[1, 30, 95], [3, 60, null]]);
});

test('wkp: La Maison section facts, features tab, inquiry link and photos', () => {
  const lm = parseLaMaison(lodging);
  assert.match(lm.paragraphs.join(' '), /tranquil 7-room guest house/);
  assert.ok(lm.features.includes('Hair dryer available'));
  assert.ok(!lm.features.includes('FEATURES'));
  assert.equal(lm.inquiryUrl, 'https://axel154.typeform.com/to/DKoTpS');
  assert.ok(lm.images.includes('https://wild-kitesurf-peru.com/wp-content/uploads/2022/08/IMG_8818-med.jpg'));
  assert.ok(lm.images.includes('https://wild-kitesurf-peru.com/wp-content/uploads/2024/02/4K3A5155-2.jpg'));
});

test('wkp: content', async () => {
  const c = await wildKitePeruLaMaisonMancora.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.title, 'La Maison by Wild Kite Peru');
  assert.equal(c.country, 'Peru');
  assert.equal(c.spot, 'Máncora');
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.spotCoords, undefined); // no map/geo on the site
  assert.match(c.summary, /7 rooms next to a palm grove, a 5-minute walk from the main kite and surf spot/);
  assert.match(c.summary, /IKO-certified school teaching kitesurfing since 2009/);
  assert.match(c.summary, /from USD 25 per night for one person/);
  assert.deepEqual(c.rooms.map(r => r.name), ['La Maison room']);
  assert.ok(c.rooms[0].features.includes('Family (Triple): USD 55 or USD 110'));
  assert.ok(c.imageUrls.length >= 10 && c.imageUrls.length <= 30);
  assert.ok(c.imageUrls.every(u => !/logo|picto|capture|\.svg|\.gif|\.png$/i.test(u)));
  assert.ok(c.imageUrls.slice(0, 5).every(u => /ambiance4|Suche-salon|salon-med|4K3A5155|IMG_8818/.test(u)), 'La Maison photos first');
});
