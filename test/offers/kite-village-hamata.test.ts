// Kite Village Hamata: replays fixtures recorded 2026-10-09 (bundle + station feed trimmed to the
// parts the parsers read; availability month checks verbatim).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kiteVillageHamata, buildKvSlots, kvBundleUrl, kvMonths, kvMonthWindow, parseJsLiteral, parseKvMonth,
  parseKvRoomProducts, KV_RESOURCES, type KvCategory, type KvMonthStatus,
} from '../../src/offers/adapters/kite-village-hamata.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-village-hamata');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const PARENTS: Record<KvCategory, number> = { bungalow: 34093, 'tiny-house': 44716 };
const monthFile = (c: KvCategory, y: number, m: number) => {
  const w = kvMonthWindow(y, m);
  return read(`www.myleao.com_api_product_available_${PARENTS[c]}_${KV_RESOURCES[c]}_${w.start}_${w.end}_en_0.`);
};

test('kite-village: JS literal parser handles minified i18n objects', () => {
  assert.deepEqual(parseJsLiteral('{a:"x\\"y",b:{c:`multi\nline`,d:[1,!0,\'q\']},"e f":2}'),
    { a: 'x"y', b: { c: 'multi\nline', d: [1, true, 'q'] }, 'e f': 2 });
});

test('kite-village: shell points at the bundle', () => {
  assert.equal(kvBundleUrl(read('kite-village.com_accommodation.')), 'https://kite-village.com/assets/index-DtXP41dD.js');
});

test('kite-village: 1-night room products from the Leão feed', () => {
  const rooms = parseKvRoomProducts(read('www.myleao.com_api_product_station_101.'));
  assert.deepEqual(rooms.map(r => [r.slug, r.unit, r.persons, r.nightly, r.currency, r.parentId]).sort(), [
    ['bungalow-double', 'Bungalow', 2, 110, 'EUR', 34093],
    ['bungalow-single', 'Bungalow', 1, 77, 'EUR', 33689],
    ['bungalow-triple', 'Bungalow', 3, 158, 'EUR', 34007],
    ['tiny-house-double', 'Tiny House', 2, 78, 'EUR', 44716],
    ['tiny-house-single', 'Tiny House', 1, 54, 'EUR', 44673],
  ]);
});

test('kite-village: month checks', () => {
  assert.deepEqual(parseKvMonth(monthFile('bungalow', 2026, 10), 2026, 10), { availability: 'available', text: null });
  const nov = parseKvMonth(monthFile('bungalow', 2026, 11), 2026, 11);
  assert.equal(nov.availability, 'limited');
  assert.match(nov.text!, /^14 of 30 nights free in one room \(taken 2026-11-01\.\.2026-11-16\)/);
  assert.equal(parseKvMonth(monthFile('tiny-house', 2026, 11), 2026, 11).availability, 'limited');
  assert.equal(parseKvMonth(monthFile('tiny-house', 2027, 1), 2027, 1).availability, 'available');
  // live answer for an unknown resource (seen 2026-10-09 with resource 0)
  const bookedOut = '{"data":{"error":"Not available for this time period. You could leave a remark in the next step of this booking form.","bookedOut":true}}';
  assert.equal(parseKvMonth(bookedOut, 2026, 11).availability, 'sold_out');
});

test('kite-village: slots = room x occupancy x month', () => {
  const rooms = parseKvRoomProducts(read('www.myleao.com_api_product_station_101.'));
  const months = kvMonths('2026-10-09').map(({ year, month }) => ({
    year, month,
    status: {
      bungalow: parseKvMonth(monthFile('bungalow', year, month), year, month),
      'tiny-house': parseKvMonth(monthFile('tiny-house', year, month), year, month),
    } as Record<KvCategory, KvMonthStatus>,
  }));
  assert.deepEqual(months.map(m => `${m.year}-${m.month}`), ['2026-10', '2026-11', '2026-12', '2027-1', '2027-2', '2027-3']);
  const slots = buildKvSlots(rooms, months);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 30);
  const s = slots.find(x => x.key === 'tiny-house-double|2026-12')!;
  assert.deepEqual([s.startDate, s.endDate, s.unit, s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.availability],
    ['2026-12-01', '2026-12-31', 'Tiny House', 78, 'EUR', 'per_night', 'room', 2, 'available']);
  assert.equal(slots.find(x => x.key === 'bungalow-triple|2026-11')!.availability, 'limited');
  assert.equal(slots.filter(x => x.availability === 'available').length, 25);
});

test('kite-village: content from the bundle', async () => {
  const c = await kiteVillageHamata.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kite Village Hamata');
  assert.equal(c.country, 'Egypt');
  assert.equal(c.spot, 'Hamata');
  assert.equal(c.mealPlan, 'half_board');
  assert.match(c.summary, /50 bungalows .* 32 tiny houses/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Bungalow', 'Tiny House']);
  assert.ok(c.rooms[1].features.includes('Single room from EUR 54 per night (half board)'));
  assert.deepEqual(c.includedServices, ['Breakfast', 'dinner', '2 water bottles', '2 soft drinks per day']);
  assert.ok(c.optionalServices.includes('Beginner Course (€590)'));
  assert.deepEqual(c.languages, ['en', 'de', 'it', 'fr', 'es', 'pl']);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls[0].endsWith('9a45850c7_DSC_5125.jpg'), 'bungalow photo of the image map first');
  assert.ok(c.imageUrls.every(u => !/logo|generated/i.test(u)));
  assert.match(c.sourceText!, /Valid from|KiteVillageHotelCamppricesfrom2082026/);
});
