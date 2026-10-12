// Windchaser Villas (Long Bay, Providenciales): replays the two TKCA villa pages and TKCA's bstoked listing 6807
// recorded 2026-10-12 (scripts, styles, head, site header/footer trimmed; Maps key redacted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  windchaserVillasLongBay, buildWcSlots, parseWcKite, parseWcVilla, WC_VILLA_URLS,
} from '../../src/offers/adapters/windchaser-villas-long-bay.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/windchaser-villas-long-bay');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const alize = parseWcVilla(read('tkcavacationrentals.com_property_alize-villa_.'), WC_VILLA_URLS[0]);
const bora = parseWcVilla(read('tkcavacationrentals.com_property_bora-villa-4-br_.'), WC_VILLA_URLS[1]);

test('windchaser: villa facts from the own site', () => {
  assert.deepEqual([alize.name, alize.guests, alize.bedrooms, alize.beds, alize.bathrooms, alize.fromPrice, alize.currency],
    ['Alize Villa', 8, 4, 4, 4.5, 1000, 'USD']);
  assert.deepEqual([bora.name, bora.guests, bora.bedrooms, bora.beds, bora.fromPrice], ['Bora Villa', 10, 4, 7, 1260]);
  assert.deepEqual([alize.lat, alize.lng], [21.7912600417, -72.1540885573]);
  assert.match(alize.description, /Windchaser Villas community on Long Bay Beach/);
  assert.equal(alize.amenities.length, 50);
  assert.equal(alize.photos.length, 40);
  assert.ok(alize.photos.every(u => u.startsWith('https://tkcavacationrentals.com/wp-content/uploads/') && /guesty-/.test(u)));
  assert.match(alize.upgrades, /Pre-stocking grocery service/);
});

test('windchaser: kite facts from TKCA texts on bstoked', () => {
  const k = parseWcKite(read('bstoked.net_listings_6807_.'), read('bstoked.net_listings_services_id_6807.'));
  assert.match(k.conditions!, /mostly 15-17 knots 80% of the time/);
  assert.match(k.experience!, /lockable storage for your gear and we have rinse stations/);
  assert.deepEqual(k.kiteServices, ['gear storage', 'lessons or coaching', 'spot guidance']);
  assert.deepEqual(k.lessons, ['Kite Lessons with KiteSurf TCI']);
});

test('windchaser: one undated base-price slot per villa', () => {
  const slots = buildWcSlots([alize, bora]);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.currency, s.priceUnit, s.priceBasis, s.availability, s.startDate]), [
    ['alize-villa', 'Alize Villa', 1000, 'USD', 'per_night', 'room', 'unknown', null],
    ['bora-villa', 'Bora Villa', 1260, 'USD', 'per_night', 'room', 'unknown', null],
  ]);
});

test('windchaser: adapter replay (content + slots)', async () => {
  const c = await windchaserVillasLongBay.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Windchaser Villas');
  assert.equal(c.country, 'Turks and Caicos Islands');
  assert.equal(c.spot, 'Long Bay Beach');
  assert.equal(c.sourceUrl, 'https://tkcavacationrentals.com/property/alize-villa/');
  assert.match(c.summary, /^Alize and Bora are 4-bedroom villas for 8 and 10 guests with private pools/);
  assert.match(c.summary, /lockable kite gear storage by the pool and rinse stations, and lessons are arranged with KiteSurf TCI\.$/);
  const sentences = c.summary.split(/(?<=\.)\s+(?=[A-Z])/);
  assert.ok(sentences.length >= 2 && sentences.length <= 4, `${sentences.length} sentences`);
  assert.deepEqual(c.rooms.map(r => r.name), ['Alize Villa', 'Bora Villa']);
  assert.ok(c.includedServices.includes('Lockable kite gear storage by the pool'));
  assert.equal(c.kiteLessons, true);
  assert.equal(c.imageUrls.length, 40);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://tkcavacationrentals.com/')));
  const slots = await windchaserVillasLongBay.fetchSlots(ctx);
  assert.equal(slots.length, 2);
});
