// Cabarete Boutique Kite Hotel (Kite Buen Hombre, Cabarete): replays the page recorded 2026-10-12 (3.2 MB Wix page
// trimmed to markup + JSON-LD: script/style bodies, <link>s and class/style/data-* attributes dropped) and the Cabarete
// block of /book recorded 2026-11-02 (7.0 MB page, trimmed the same way).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cabareteBoutiqueKiteHotel, buildCbkSlots, buildCbkUnitSlots, cbkImgInfo, cbkNotOwn, parseCbkBookPrices, parseCbkCards, parseCbkPrices,
} from '../../src/offers/adapters/cabarete-boutique-kite-hotel.js';
import { planGallery } from '../../src/offers/gallery.js';
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

test('cabarete-boutique: /book prices every unit, mapped to the card names', () => {
  const units = parseCbkBookPrices(read('www.kitebuenhombre.com_book.'));
  assert.deepEqual(units.map(u => [u.name, u.price, u.guests]), [
    ['King Loft', 95, 1], ['Queen Loft', 90, 1], ['Lux Garden Loft', 95, 1], ['Terrace Loft', 85, 1],
    ['Small Terrace Loft', 65, 1], ['Tropical House', 150, 1], ['Cabarete Villa', 250, 5],
  ]);
  // every unit lands on one of the hotel page's cards
  const cards = new Set(parseCbkCards(html).map(c => c.name));
  assert.ok(buildCbkUnitSlots(units).every(s => cards.has(s.room!)));
  assert.deepEqual(parseCbkBookPrices('<p>no Cabarete block</p>'), []);
});

test('cabarete-boutique: loft range, retreat price and the /book unit prices -> 9 on-request slots', async () => {
  assert.deepEqual(parseCbkPrices(html), { loftFrom: 60, loftTo: 150, retreatPp: 85, currency: 'USD' });
  const slots = await cabareteBoutiqueKiteHotel.fetchSlots(ctx);
  assert.deepEqual(slots, [...buildCbkSlots(parseCbkPrices(html)), ...buildCbkUnitSlots(parseCbkBookPrices(read('www.kitebuenhombre.com_book.')))]);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.room ?? null, s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.availability]), [
    ['loft', 'Boutique loft', null, 60, 'USD', 'per_night', 'room', null, 'on_request'],
    ['whole-property', 'Whole property (retreat, up to 25 guests)', null, 85, 'USD', 'per_night', 'person', null, 'on_request'],
    ['unit-king-loft', 'King Loft', 'King Loft', 95, 'USD', 'per_night', 'room', 1, 'on_request'],
    ['unit-queen-loft', 'Queen Loft', 'Queen Kite Loft', 90, 'USD', 'per_night', 'room', 1, 'on_request'],
    ['unit-lux-garden-loft', 'Lux Garden Loft', 'Garden Green Loft', 95, 'USD', 'per_night', 'room', 1, 'on_request'],
    ['unit-terrace-loft', 'Terrace Loft', 'Terrace Loft', 85, 'USD', 'per_night', 'room', 1, 'on_request'],
    ['unit-small-terrace-loft', 'Small Terrace Loft', 'Small Terrace Loft', 65, 'USD', 'per_night', 'room', 1, 'on_request'],
    ['unit-tropical-house', 'Tropical House', 'Tropical House', 150, 'USD', 'per_night', 'room', 1, 'on_request'],
    ['unit-cabarete-villa', 'Cabarete Villa', 'The Luxury villa', 250, 'USD', 'per_night', 'room', 5, 'on_request'],
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

test('cabarete-boutique: each card gets its own photo, the Cabarete kiting photo as spot, Wix stock and press logos out', async () => {
  const c = await cabareteBoutiqueKiteHotel.fetchContent(ctx);
  const info = cbkImgInfo(html);
  const fileOf = (u: string) => info.get(u.match(/\/media\/([^/~.]+)/)![1])!.file;
  assert.deepEqual(c.rooms.map(r => [r.name, r.imageUrls?.length ?? 0, fileOf(r.imageUrls![0])]), [
    ['King Loft', 1, 'Cabarete Boutique Kite Hotel King Loft.jpg'],
    ['Queen Kite Loft', 1, 'Cabarete Boutique Hotel Queen Loft bedroom_edited.jpg'],
    ['Garden Green Loft', 1, 'Cabarete Bouique Kite Hotel Garden Loft.jpg'],
    ['Terrace Loft', 1, '2M7A2622_edited.jpg'],
    // "Upstairs area" file name, alt "Tropical House wooden balcony ..." (another upload than the common-area photo)
    ['Tropical House', 1, 'Cabarete Boutique kite Hotel Upstairs area.jpg'],
    ['Small Terrace Loft', 1, 'terrace loft 2_edited.jpg'],
    ['The Luxury villa', 1, 'villa living room kitchen entrance_edited.jpg'],
  ]);
  const all = c.rooms.flatMap(r => r.imageUrls!);
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.every(u => c.imageUrls.includes(u)));
  assert.match(info.get(c.rooms[4].imageUrls![0].match(/\/media\/([^/~.]+)/)![1])!.alt, /^Tropical House/);

  // the page's other kite photos are Buen Hombre (Davisito, the flag at sunset) and El Morro (hydrofoil)
  assert.deepEqual(c.spotImageUrls, ['https://static.wixstatic.com/media/d76113_af71d16781474c3ba341a2dcd8fb7866~mv2.jpg']);
  assert.match(info.get('d76113_af71d16781474c3ba341a2dcd8fb7866')!.alt, /kitesurfing .* in Cabarete/);

  // "Image by Jared Rice.jpg" / "Image by Preet Patel.jpg" (Wix stock) and the Lonely Planet logo: in no list
  const notOwn = cbkNotOwn(html);
  assert.ok(['d76113_8107e8f67b504cb9bcecb1ba64246c78', 'd76113_bbecbfb7a0304c679e6093eebd9dd716', 'dd80b9_6dba5531395a4a05bab2b33d2c8d6516'].every(id => notOwn.has(id)));
  assert.ok(![...c.imageUrls, ...all, ...c.spotImageUrls!].some(u => notOwn.has(u.match(/\/media\/([^/~.]+)/)![1])));

  const first24 = planGallery(c).candidates.slice(0, 24);
  for (const r of c.rooms) assert.ok(r.imageUrls!.some(u => first24.includes(u)), r.name);
  assert.ok(first24.includes(c.spotImageUrls![0]));
});
