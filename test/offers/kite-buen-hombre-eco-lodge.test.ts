// Kite Buen Hombre Eco-Lodge: replays the Wix pages recorded 2026-10-12 (trimmed to text + JSON-LD).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kiteBuenHombreEcoLodge, buildKbhSlots, parseKbhFlex, parseKbhPackages, parseKbhRooms, parseKbhSpecial, KBH_FLEX_UNIT,
} from '../../src/offers/adapters/kite-buen-hombre-eco-lodge.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-buen-hombre-eco-lodge');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const flexHtml = read('www.kitebuenhombre.com_flexible-kitesurfing-stay');
const packagesHtml = read('www.kitebuenhombre.com_kite-stay-packages');
const hotelHtml = read('www.kitebuenhombre.com_buen-hombre-hotel');
const specialHtml = read('www.kitebuenhombre.com_product-page_season-special');

test('kbh: Flexible Stay nightly offer from the JSON-LD Product', () => {
  assert.deepEqual(parseKbhFlex(flexHtml), { price: 85, currency: 'USD', minNights: 4 });
  // text fallback when the JSON-LD is gone
  assert.deepEqual(parseKbhFlex('<p>From</p><p>$85/night</p><p>Minimum</p><p>4 nights</p>'), { price: 85, currency: 'USD', minNights: 4 });
  assert.equal(parseKbhFlex('<p>Contact us</p>'), null);
});

test('kbh: slots = one nightly from-price, min 4 nights, on request', async () => {
  const slots = await kiteBuenHombreEcoLodge.fetchSlots(ctx);
  assert.deepEqual(slots, buildKbhSlots(parseKbhFlex(flexHtml)!));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 1);
  const s = ok[0];
  assert.deepEqual([s.key, s.unit, s.price, s.currency, s.priceUnit, s.priceBasis, s.minNights, s.availability, s.startDate, s.endDate],
    ['flexible-stay', KBH_FLEX_UNIT, 85, 'USD', 'per_night', 'room', 4, 'on_request', null, null]);
});

test('kbh: kite stay packages (per person) from the JSON-LD offers', () => {
  assert.deepEqual(parseKbhPackages(packagesHtml).map(p => [p.name, p.nights, p.price, p.currency]), [
    ['Weekend Special', 1, 555, 'USD'],
    ['7-Day Special', 6, 1333, 'USD'],
    ['10-Day Special', 9, 2222, 'USD'],
    ['14-Day Special', 13, 2795, 'USD'],
  ]);
});

test('kbh: season special product (stay window, total, deposit deadline)', () => {
  assert.deepEqual(parseKbhSpecial(specialHtml), {
    name: 'Season Special: 10-Hour Kite Course + 6 Nights Free in Buen Hombre, DR',
    total: 1235, currency: 'USD', start: '2026-11-01', end: '2026-12-15', depositBy: '2026-11-01', placesPerWeek: 10,
  });
});

test('kbh: room cards on the hotel page', () => {
  const rooms = parseKbhRooms(hotelHtml);
  assert.deepEqual(rooms.map(r => r.name), ['Beach Lofts', 'Beach Bungalows', 'The Mansion', 'The Palace']);
  assert.deepEqual(rooms[1].features, ['Beachfront location - steps from the kite launch', 'AC & fans', 'Nature-inspired bathrooms']);
  assert.equal(rooms[3].description, "The very best view. The most space. The closest you'll get to the sea.");
});

test('kbh: content', async () => {
  const c = await kiteBuenHombreEcoLodge.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.country, 'Dominican Republic');
  assert.equal(c.spot, 'Playa Buen Hombre');
  assert.deepEqual(c.spotCoords, { lat: 19.87004, lng: -71.40395 }); // JSON-LD LodgingBusiness.geo
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /established in 2013 next to the school's own IKO kite center/);
  assert.match(c.summary, /Flexible Stay from USD 85 per night \(minimum 4 nights/);
  assert.match(c.summary, /from USD 555 \(1 night\) to USD 2,795 \(13 nights\)/);
  assert.ok(!/[—–]/.test(c.summary));
  assert.ok(c.optionalServices.includes('Season Special: 10-Hour Kite Course + 6 Nights Free in Buen Hombre, DR: USD 1,235 per person, stays 2026-11-01 to 2026-12-15, deposit by 2026-11-01, 10 places a week'));
  assert.ok(c.optionalServices.some(s => s.startsWith('7-Day Special: USD 1,333 per person (6 nights')));
  assert.ok(c.includedServices.includes('Three meals a day (breakfast, lunch, dinner)'));
  assert.ok(c.includedServices.includes('Secure kite and equipment storage'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /^https:\/\/static\.wixstatic\.com\/media\/[^/]+$/.test(u)), 'Wix originals, no /v1/ transforms');
  assert.ok(!c.imageUrls.some(u => u.includes('89a4d659d6804cd1a161387952931e0a')), 'logo dropped');
});

test('kbh: content survives a missing season special page', async () => {
  const { parseKiteBuenHombreContent } = await import('../../src/offers/adapters/kite-buen-hombre-eco-lodge.js');
  const c = parseKiteBuenHombreContent({ hotel: hotelHtml, packages: packagesHtml, flex: flexHtml, special: null });
  assert.equal(contentProblem(c), null);
  assert.ok(!c.optionalServices.some(s => s.startsWith('Season Special')));
});
