// Kite Thailand Package B, Hua Hin: replays the product + location pages recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  KT_HUA_HIN, buildKtSlots, kiteThailandPackageBHuaHin, ktImages, parseKtProduct,
} from '../../src/offers/adapters/kite-thailand-package-b-hua-hin.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-thailand-package-b-hua-hin');
process.env.OFFERS_FIXTURE_DIR = DIR;
const file = (re: RegExp) => readFileSync(join(DIR, readdirSync(DIR).find(f => re.test(f))!), 'utf8');
const product = file(/_product_package-b-hua-hin_/);
const place = file(/kiteboarding-hua-hin/);
const ctx = { note: () => {}, incomplete: () => {} };

test('kite thailand: product description, currency and WooCommerce variations', () => {
  const p = parseKtProduct(product);
  assert.equal(p.place, 'Hua Hin');
  assert.equal(p.nights, 7);
  assert.equal(p.lessonDays, 5);
  assert.equal(p.meals, 10);
  assert.equal(p.currency, 'THB');
  assert.deepEqual(p.variations.map(v => [v.label, v.price]), [
    ['With 2-4 Star Accomodation', 50000], ['With 5 Star Accomodation', 57000], ['With Basic Accomodation', 32500],
  ]);
  assert.deepEqual(p.optional, ['Transfer from BKK airport to Hua Hin THB 2,000 (one way)']);
});

test('kite thailand hua hin: three undated package slots in THB', () => {
  const { ok, problems } = checkSlots(buildKtSlots(parseKtProduct(product)));
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.currency, s.availability]), [
    ['with-2-4-star-accomodation', '2-4 star accommodation', 50000, 'THB', 'available'],
    ['with-5-star-accomodation', '5 star accommodation', 57000, 'THB', 'available'],
    ['with-basic-accomodation', 'basic accommodation', 32500, 'THB', 'available'],
  ]);
  for (const s of ok) {
    assert.equal(s.startDate, null);
    assert.equal(s.priceUnit, 'package');
    assert.equal(s.priceBasis, 'person');
    assert.equal(s.packageNights, 7);
  }
});

test('kite thailand: an out-of-stock variation becomes sold_out', () => {
  const p = parseKtProduct(product);
  p.variations[0] = { ...p.variations[0], inStock: false };
  assert.equal(buildKtSlots(p)[0].availability, 'sold_out');
});

test('kite thailand hua hin: photos from the gallery and the location page, no logos / kids / portraits', () => {
  const imgs = ktImages(product, place);
  assert.equal(imgs[0], 'https://www.kitethailand.com/wp-content/uploads/2018/03/2-2.jpg');
  assert.ok(imgs.includes('https://www.kitethailand.com/wp-content/uploads/2021/08/image8.jpeg'));
  assert.ok(!imgs.some(u => /logo|cropped-|kids|x-fred|rookie|sidhusoftwares|-\d+x\d+\./i.test(u)), imgs.join('\n'));
});

test('kite thailand hua hin: content is a valid camp', async () => {
  const c = await kiteThailandPackageBHuaHin.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.country, 'Thailand');
  assert.equal(c.region, KT_HUA_HIN.region);
  assert.equal(c.spot, 'Hua Hin');
  assert.equal(c.durationDays, 8);
  assert.match(c.summary, /THB 32,500 with basic accommodation/);
  assert.match(c.summary, /does not name the hotel/);
  assert.deepEqual(c.optionalServices, ['Transfer from BKK airport to Hua Hin THB 2,000 (one way)']);
  assert.ok(!/[–—]/.test(c.summary + c.title));
});

test('kite thailand hua hin: fetchSlots replays with valid slots', async () => {
  const slots = await kiteThailandPackageBHuaHin.fetchSlots(ctx);
  assert.equal(checkSlots(slots).ok.length, 3);
  assert.equal(kiteThailandPackageBHuaHin.instantBooking, true);
  assert.equal(kiteThailandPackageBHuaHin.liveAvailability, undefined);
});
