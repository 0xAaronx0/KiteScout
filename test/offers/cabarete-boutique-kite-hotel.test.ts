// Cabarete Boutique Kite Hotel (Kite Buen Hombre, Cabarete): replays the page recorded 2026-10-12 (3.2 MB Wix page
// trimmed to markup + JSON-LD: script/style bodies, <link>s and class/style/data-* attributes dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cabareteBoutiqueKiteHotel, buildCbkSlots, parseCbkCards, parseCbkPrices,
} from '../../src/offers/adapters/cabarete-boutique-kite-hotel.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/cabarete-boutique-kite-hotel');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const html = read('www.kitebuenhombre.com_cabarete-boutique-kite-hotel.');

test('cabarete-boutique: room cards with booking codes', () => {
  const cards = parseCbkCards(html);
  assert.deepEqual(cards.map(c => [c.name, c.roomCode]), [
    ['King Loft', 'cab-king'], ['Queen Kite Loft', 'cab-queen'], ['Garden Green Loft', 'cab-garden'], ['Terrace Loft', 'cab-terrace'],
    ['Tropical House', 'cab-tropical-house'], ['Small Terrace Loft', 'cab-small-terrace'], ['The Luxury villa', 'cab-villa'],
  ]);
  assert.deepEqual(cards[2].attributes, ['2 Queen bed', 'Up to 4 Guests', 'Pool Access', 'Garden Views']);
  assert.equal(cards[2].audience, 'families');
});

test('cabarete-boutique: loft range and retreat price -> 2 on-request slots', async () => {
  assert.deepEqual(parseCbkPrices(html), { loftFrom: 60, loftTo: 150, retreatPp: 85, currency: 'USD' });
  const slots = await cabareteBoutiqueKiteHotel.fetchSlots(ctx);
  assert.deepEqual(slots, buildCbkSlots(parseCbkPrices(html)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.currency, s.priceUnit, s.priceBasis, s.availability]), [
    ['loft', 'Boutique loft', 60, 'USD', 'per_night', 'room', 'on_request'],
    ['whole-property', 'Whole property (retreat, up to 25 guests)', 85, 'USD', 'per_night', 'person', 'on_request'],
  ]);
  assert.ok(slots.every(s => s.startDate === null && s.endDate === null));
});

test('cabarete-boutique: content', async () => {
  const c = await cabareteBoutiqueKiteHotel.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Cabarete Boutique Kite Hotel (Kite Buen Hombre)');
  assert.equal(c.country, 'Dominican Republic');
  assert.equal(c.spot, 'Cabarete');
  assert.deepEqual(c.spotCoords, { lat: 19.74706, lng: -70.40588 });
  assert.equal(c.mealPlan, 'self_catering');
  assert.match(c.summary, /six boutique lofts, a Tropical House and a villa/);
  assert.match(c.summary, /Kite Beach is about 30 minutes on foot or 5 by moped/);
  assert.match(c.summary, /Lofts cost USD 60-150 per night/);
  assert.equal(c.rooms.length, 7);
  assert.match(c.rooms[4].description!, /^Three bedrooms/);
  assert.equal(c.rooms[5].description, null); // the page repeats the Tropical House text on the Small Terrace Loft card
  assert.ok(c.includedServices.includes('Secure kite gear storage and rinse stations'));
  assert.ok(c.includedServices.includes('Starlink internet'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /^https:\/\/static\.wixstatic\.com\/media\/[^/]+$/.test(u)));
});
