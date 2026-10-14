// LOGOS Beach Village (Theologos, Rhodes): replays the English pages recorded 2026-10-12 and the Leão form pages +
// availability answers recorded 2026-10-14 (form pages: script/style bodies dropped, session_id redacted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  logosBeachVillageTheologos, applyLogosSamples, buildLogosSlots, fetchLogosSamples, fetchLogosSlots, logosSampleStays,
  parseLogosAvailability, parseLogosForm, parseLogosNotes, parseLogosRanges, parseLogosRoom, parseLogosTable, parseLogosWeeklyRange,
  type LogosSample,
} from '../../src/offers/adapters/logos-beach-village-theologos.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/logos-beach-village-theologos');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const prices = read('www.logosbeachvillage.com_en_prices_.');
const TODAY = '2026-10-14';
const tableSlots = () => { const { seasons, rates } = parseLogosTable(prices); return buildLogosSlots(seasons, rates, parseLogosWeeklyRange(prices)); };

test('logos: date ranges with 2-digit and 4-digit years', () => {
  assert.deepEqual(parseLogosRanges('01.04. – 20.05.26 09.10. &#8211; 31.10.26'), [
    { start: '2026-04-01', end: '2026-05-20' }, { start: '2026-10-09', end: '2026-10-31' },
  ]);
  assert.deepEqual(parseLogosRanges('20.12. - 06.01.2027'), [{ start: '2026-12-20', end: '2027-01-06' }]);
});

test('logos: season table', () => {
  const { seasons, rates } = parseLogosTable(prices);
  assert.deepEqual(seasons.map(s => [s.label, s.ranges.map(r => `${r.start}..${r.end}`)]), [
    ['Season A', ['2026-04-01..2026-05-20', '2026-10-09..2026-10-31']],
    ['Season B', ['2026-05-21..2026-06-14', '2026-09-10..2026-10-08']],
    ['Season C', ['2026-06-15..2026-09-09']],
  ]);
  assert.equal(rates.length, 30);
  assert.deepEqual(rates.filter(r => r.unit === 'Beach Lodge XL').map(r => [r.persons, r.season, r.amount]), [
    [2, 'Season A', 66], [2, 'Season B', 85], [2, 'Season C', 115],
    [3, 'Season A', 55], [3, 'Season B', 69], [3, 'Season C', 92],
    [4, 'Season A', 45], [4, 'Season B', 62], [4, 'Season C', 82],
  ]);
  assert.deepEqual(rates.filter(r => r.onRequest).map(r => `${r.unit} ${r.persons}p ${r.season} ${r.amount}`), [
    'Beach Village Studio 1p Season C 146', 'Shared Beach Lodge 1p Season C 115', 'Shared Beach Lodge 2p Season C 85',
  ]);
  assert.deepEqual(parseLogosWeeklyRange(prices), { start: '2026-06-15', end: '2026-09-09' });
});

test('logos: table slots = unit x occupancy x season range, EUR per person per night', () => {
  const slots = tableSlots();
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 50);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'person'));
  const xl3 = slots.find(s => s.key === 'beach-lodge-xl-3p|2026-10-09')!;
  assert.deepEqual([xl3.startDate, xl3.endDate, xl3.price, xl3.occupancy, xl3.availability, xl3.minNights], ['2026-10-09', '2026-10-31', 55, 3, 'unknown', null]);
  const high = slots.find(s => s.key === 'beach-village-studio-1p|2026-06-15')!;
  assert.deepEqual([high.endDate, high.price, high.availability, high.minNights], ['2026-09-09', 146, 'on_request', 7]);
  assert.equal(Math.min(...slots.map(s => s.price!)), 45);
});

test('logos: Leão form window and one 7-night sample per loaded month', () => {
  const form = parseLogosForm(read('www.myleao.com_product_14305_en_style_logos.'));
  assert.deepEqual(form, { tag: 14305, lang: 'de', minDate: '2026-04-01', maxDate: '2026-10-31' });
  assert.deepEqual(logosSampleStays(TODAY, form!.minDate, form!.maxDate), [{ checkIn: '2026-10-17', checkOut: '2026-10-24' }]);
  assert.deepEqual(logosSampleStays('2026-10-25', '2026-04-01', '2026-10-31'), []); // no 7 nights left in the window
  assert.deepEqual(logosSampleStays(TODAY, '2027-04-01', '2027-10-31').map(s => s.checkIn),
    ['2027-04-10', '2027-05-08', '2027-06-12', '2027-07-10', '2027-08-14', '2027-09-11']);
});

test('logos: availability answers -> products; no price = "ausgebucht"', async () => {
  const r = parseLogosAvailability(read('www.myleao.com_api_product_availability_id_14305_start_2026-10-17'));
  assert.deepEqual(r, { status: 1, products: [{ id: 14312, name: 'Beach Lodge XL - 2 Personen 7 Nächte', persons: 2, nights: 7, price: null }] });
  const samples = await fetchLogosSamples(ctx, TODAY);
  assert.deepEqual(samples.map(s => [s.size, s.checkIn, s.products.map(p => [p.name, p.price])]), [
    ['Studio', '2026-10-17', [['Beach Village Studio - 1 Person 7 Nächte', null]]],
    ['XL', '2026-10-17', [['Beach Lodge XL - 2 Personen 7 Nächte', null]]],
    ['XXL', '2026-10-17', [['Beach Lodge XXL - 2 Personen 7 Nächte', null]]],
  ]);
  // shape the date picker reads when a product is bookable (price + priceLocale)
  assert.deepEqual(parseLogosAvailability('{"status":1,"data":[{"id":1,"name":"Beach Lodge XL - 3 Personen 7 N\\u00e4chte","price":"1155","priceLocale":"1.155,00"}]}').products,
    [{ id: 1, name: 'Beach Lodge XL - 3 Personen 7 Nächte', persons: 3, nights: 7, price: 1155 }]);
  assert.deepEqual(parseLogosAvailability('{"status":0}'), { status: 0, products: [] });
});

test('logos: engine samples split the table bands of their unit size (fixture: all booked out 17-24 Oct)', async () => {
  const slots = await fetchLogosSlots(ctx, TODAY);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 66);
  assert.deepEqual(slots.filter(s => s.unit === 'Beach Lodge XL' && s.occupancy === 3 && s.endDate! >= TODAY)
    .map(s => [s.key, s.startDate, s.endDate, s.price, s.availability]), [
    ['beach-lodge-xl-3p|2026-10-09', '2026-10-09', '2026-10-16', 55, 'unknown'],
    ['beach-lodge-xl-3p|2026-10-17', '2026-10-17', '2026-10-23', 55, 'sold_out'],
    ['beach-lodge-xl-3p|2026-10-24', '2026-10-24', '2026-10-31', 55, 'unknown'],
  ]);
  assert.equal(slots.find(s => s.key === 'beach-village-studio-2p|2026-10-17')!.availabilityText,
    'Leão: "ausgebucht" for the sample stay 2026-10-17..2026-10-24 (Beach Village Studio - 1 Person 7 Nächte)');
  // the shared lodge has no own form: its band stays whole
  const shared = slots.find(s => s.key === 'shared-beach-lodge-1p|2026-10-09')!;
  assert.deepEqual([shared.endDate, shared.availability], ['2026-10-31', 'unknown']);
  assert.equal(slots.filter(s => s.availability === 'sold_out').length, 8);
  assert.equal(logosBeachVillageTheologos.liveAvailability, true);
});

test('logos: an engine price replaces the table rate for that unit + occupancy in the sample week (synthetic sample)', () => {
  const sample: LogosSample = { size: 'XL', tag: 14305, checkIn: '2026-10-17', checkOut: '2026-10-24', status: 1,
    products: [{ id: 1, name: 'Beach Lodge XL - 2 Personen 7 Nächte', persons: 2, nights: 7, price: 924 }] };
  const later: LogosSample = { ...sample, checkIn: '2027-05-08', checkOut: '2027-05-15' };
  const slots = applyLogosSamples(tableSlots(), [sample, later]);
  assert.deepEqual(checkSlots(slots).problems, []);
  const xl2 = slots.find(s => s.key === 'beach-lodge-xl-2p|2026-10-17')!;
  assert.deepEqual([xl2.endDate, xl2.price, xl2.priceUnit, xl2.priceBasis, xl2.packageNights, xl2.availability], ['2026-10-23', 924, 'package', 'room', 7, 'available']);
  const xl3 = slots.find(s => s.key === 'beach-lodge-xl-3p|2026-10-17')!;
  assert.deepEqual([xl3.price, xl3.priceUnit, xl3.availability], [55, 'per_night', 'available']);
  // a sample week outside every table band becomes an engine-only slot
  const only = slots.find(s => s.key === 'beach-lodge-xl-2p|2027-05-08')!;
  assert.deepEqual([only.unit, only.endDate, only.price, only.currency, only.priceUnit, only.packageNights, only.availability],
    ['Beach Lodge XL', '2027-05-14', 924, 'EUR', 'package', 7, 'available']);
});

test('logos: notes and room pages', () => {
  const notes = parseLogosNotes(prices);
  assert.deepEqual(notes.included, ['Breakfast buffet', 'Daily room cleaning', 'Air conditioner']);
  assert.ok(notes.children.includes('Children (2-11 years): 26 € per night (price p.p.)'));
  assert.match(notes.sections['Specials'] ?? '', /5% discount/);
  const xxl = parseLogosRoom(read('www.logosbeachvillage.com_en_accommodation_beach-village-lodge-xxl_.'))!;
  assert.equal(xxl.name, 'Beach Village Lodge XXL');
  assert.match(xxl.description, /approx\. 76 sqm XXL Lodges/);
  assert.ok(xxl.features.includes('Total area: about 76 sqm'));
  assert.equal(xxl.images.length, 9); // the XXL gallery also shows two XL photos
});

test('logos: content', async () => {
  const c = await logosBeachVillageTheologos.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'LOGOS Beach Village');
  assert.equal(c.spot, 'Theologos, Rhodes');
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /13 XL and XXL safari lodges and 4 studios/);
  assert.match(c.summary, /90 kites and 45 boards/);
  assert.match(c.summary, /from EUR 45 to 146 per person per night/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Beach Village Studio', 'Beach Village Lodge XL', 'Beach Village Lodge XXL', 'Shared Beach Lodge']);
  assert.ok(c.rooms[1].features.includes('Beach Lodge XL, 3 persons, Season A: EUR 55 per person per night'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /\/wp-content\/uploads\/logos-beach-village-.*\.jpg$/.test(u)));
  assert.match(c.sourceText ?? '', /contact: info@logos-rhodos\.com/);
});
