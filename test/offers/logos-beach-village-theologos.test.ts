// LOGOS Beach Village (Theologos, Rhodes): replays the English pages recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  logosBeachVillageTheologos, buildLogosSlots, parseLogosNotes, parseLogosRanges, parseLogosRoom,
  parseLogosTable, parseLogosWeeklyRange,
} from '../../src/offers/adapters/logos-beach-village-theologos.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/logos-beach-village-theologos');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const prices = read('www.logosbeachvillage.com_en_prices_.');

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

test('logos: slots = unit x occupancy x season range, EUR per person per night', async () => {
  const slots = await logosBeachVillageTheologos.fetchSlots(ctx);
  const { seasons, rates } = parseLogosTable(prices);
  assert.deepEqual(slots, buildLogosSlots(seasons, rates, parseLogosWeeklyRange(prices)));
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
