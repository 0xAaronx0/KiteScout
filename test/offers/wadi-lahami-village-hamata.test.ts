// Wadi Lahami Village (Red Sea Diving Safari): replays the village, accommodation and three € price-list
// pages recorded 2026-10-12 (fixtures trimmed: script/style bodies dropped, Google Maps key redacted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  wadiLahamiVillageHamata, buildWlSlots, parseWlKitePrices, parseWlPeriod, parseWlPeriodLinks, parseWlRooms,
  WL_KITE_CENTER_PHOTOS,
} from '../../src/offers/adapters/wadi-lahami-village-hamata.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { todayIso } from '../../src/offers/parse.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/wadi-lahami-village-hamata');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const prices = read('www.redsea-divingsafari.com_price-lists_wadi-lahami.');
const winter = read('www.redsea-divingsafari.com_price-lists_wadi-lahami_euro-winter-26-27.');
const summer27 = read('www.redsea-divingsafari.com_price-lists_wadi-lahami_euro-summer-27.');

test('wadi-lahami: price period shown on the default list + season months + rates', () => {
  const p = parseWlPeriod(prices)!;
  assert.deepEqual([p.label, p.start, p.end, p.currency], ['€ Summer 2026', '2026-05-01', '2026-10-31', 'EUR']);
  assert.deepEqual(p.highMonths, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(p.lowMonths, [1, 2]);
  assert.deepEqual(p.rates.map(r => [r.unit, r.occupancy, r.high, r.low]), [
    ['Royal Tent', 2, 74, 63], ['Royal Tent', 1, 96, 69], ['Deluxe Chalet', 2, 106, 96], ['Deluxe Chalet', 1, 138, 117],
  ]);
  const w = parseWlPeriod(winter)!;
  assert.deepEqual([w.label, w.start, w.end], ['€ Winter 26-27', '2026-11-01', '2027-04-30']);
});

test('wadi-lahami: dropdown links = the other € periods only (EGP resident lists skipped)', () => {
  assert.deepEqual(parseWlPeriodLinks(prices).map(l => [l.label, l.start, l.end, l.url]), [
    ['€ Winter 26-27', '2026-11-01', '2027-04-30', 'https://www.redsea-divingsafari.com/price-lists/wadi-lahami/euro-winter-26-27'],
    ['€ Summer 2027', '2027-05-01', '2027-10-31', 'https://www.redsea-divingsafari.com/price-lists/wadi-lahami/euro-summer-27'],
  ]);
});

test('wadi-lahami: periods split at the high/low months into bands with real limits', () => {
  const periods = [prices, winter, summer27].map(h => parseWlPeriod(h)!);
  const slots = buildWlSlots(periods, '2026-10-12');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 20);
  const tent2 = slots.filter(s => s.unit === 'Royal Tent' && s.occupancy === 2);
  assert.deepEqual(tent2.map(s => [s.key, s.startDate, s.endDate, s.price]), [
    ['royal-tent-2p|2026-05-01', '2026-05-01', '2026-10-31', 74],
    ['royal-tent-2p|2026-11-01', '2026-11-01', '2026-12-31', 74],
    ['royal-tent-2p|2027-01-01', '2027-01-01', '2027-02-28', 63],
    ['royal-tent-2p|2027-03-01', '2027-03-01', '2027-04-30', 74],
    ['royal-tent-2p|2027-05-01', '2027-05-01', '2027-10-31', 74],
  ]);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'person' && s.availability === 'unknown'));
  // bands that ended before today are dropped
  assert.equal(buildWlSlots(periods, '2026-11-15').length, 16);
});

test('wadi-lahami: fetchSlots replays the three € lists', async () => {
  const slots = await wadiLahamiVillageHamata.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.ok(slots.length >= 12);
  assert.ok(slots.every(s => s.endDate! >= todayIso()));
  assert.ok(slots.some(s => s.key === 'deluxe-chalet-1p|2027-01-01' && s.price === 117));
});

test('wadi-lahami: kite tab and room sections', () => {
  const kite = parseWlKitePrices(prices);
  assert.ok(kite.some(k => /staying at Wadi Lahami/.test(k.table) && k.item === 'Per day (up to 6 days)' && k.price === 17));
  assert.ok(kite.some(k => k.table === 'Kite Courses' && k.item === 'Basic Course - 8hrs - Private' && k.price === 429));
  const rooms = parseWlRooms(read('www.redsea-divingsafari.com_villages_wadi-lahami_accommodation_.'));
  assert.deepEqual(rooms.map(r => [r.name, r.features.length]), [['Royal Tent', 14], ['Deluxe Chalet', 12]]);
});

test('wadi-lahami: content', async () => {
  const c = await wadiLahamiVillageHamata.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Wadi Lahami Village');
  assert.equal(c.country, 'Egypt');
  assert.deepEqual(c.spotCoords, { lat: 24.2159799888946, lng: 35.4251146316528 });
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /Wadi Lahami Kitesurfing Center/);
  assert.match(c.summary, /from EUR 63 per person per night/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Royal Tent', 'Deluxe Chalet']);
  assert.ok(c.rooms[0].features.some(f => /EUR 74 \(high\) \/ 63 \(low season\)/.test(f)));
  assert.ok(c.optionalServices.some(s => /EUR 17 per day/.test(s)));
  assert.ok(c.imageUrls.length >= 15);
  assert.ok(c.imageUrls.every(u => !/banners|DJI_0263|DJI_0880/.test(u)));
});

test('wadi-lahami: kite-center photos after the operator ones, small operator twins dropped', async () => {
  const urls = (await wadiLahamiVillageHamata.fetchContent(ctx)).imageUrls;
  const op = urls.filter(u => u.startsWith('https://www.redsea-divingsafari.com/'));
  const kc = urls.filter(u => u.startsWith('https://wadilahamikitesurfing.com/'));
  assert.equal(op.length + kc.length, urls.length);
  assert.equal(op.length, 10);
  assert.deepEqual(kc, WL_KITE_CENTER_PHOTOS.map(p => p.url));
  assert.ok(urls.indexOf(kc[0]) > urls.indexOf(op[op.length - 1]));
  // the operator's 150-460 px copies of the same shots are gone (og square crop, tents, chalets, bar)
  assert.ok(op.every(u => !/DJI_0119|P1108666|P1108735|P1108843|P1108768|IMG_6862|P8091171|P1005648/.test(u)));
  assert.ok(op.some(u => /P1108681_28329_lg\.jpg$/.test(u)));
  // the 14 priority photos fit the ingest's 24-download cap
  const firstSpare = WL_KITE_CENTER_PHOTOS.findIndex(p => /DJI_0134/.test(p.url));
  assert.equal(firstSpare, 14);
  assert.ok(urls.indexOf(WL_KITE_CENTER_PHOTOS[13].url) < 24);
});
