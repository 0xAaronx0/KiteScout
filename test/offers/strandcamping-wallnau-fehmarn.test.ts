// Strandcamping Wallnau (Fehmarn): replays the site pages and the campbuchung.de answers recorded 2026-10-14 (pages without
// scripts except JSON-LD and the RSC chunk with the price tabs, no class attributes; jsShare of onepage.php reduced to the
// rental categories and units). Slots are built with today pinned to the recording day (the POST body carries the date).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  strandcampingWallnauFehmarn, buildScwSlots, fetchScwSlots, parseScwBlocks, parseScwEngine, parseScwMinStay, parseScwTables, scwBeds, scwMatchKey, scwUnitName,
} from '../../src/offers/adapters/strandcamping-wallnau-fehmarn.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/strandcamping-wallnau-fehmarn');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };
const TODAY = '2026-10-14';
const prices = read('strandcamping.de_preise-saisonzeiten.');

test('wallnau: rental price tabs 2026 and 2027 from the RSC payload', () => {
  const t = parseScwTables(prices);
  assert.deepEqual(t.map(x => x.year), [2026, 2027]);
  const y27 = t[1];
  assert.deepEqual(y27.seasons.map(s => [s.label, s.high, s.ranges.length]), [['Nebensaison 27', false, 4], ['Hauptsaison 27', true, 3]]);
  assert.deepEqual(y27.seasons[1].ranges[2], { start: '2027-07-04', end: '2027-08-29' });
  assert.equal(y27.rows.length, 11);
  assert.deepEqual(y27.rows.find(r => r.label === 'Mobilheim Family & Friends')!.cells, [{ main: 80, first: 120 }, { main: 150, first: 190 }]);
  assert.deepEqual(parseScwMinStay(prices), { high: 7, low: 2 });
});

test('wallnau: engine categories, table matching, names', () => {
  const e = parseScwEngine(read('campbuchung.de_v2_10206_onepage.'));
  assert.equal(e.categories.size, 12);
  assert.equal(e.objects.get('30')!.length, 13);
  assert.equal(scwMatchKey('Wohnwagen Hund 560 UL'), scwMatchKey('Hundewohnwagen 560 UL'));
  assert.equal(scwMatchKey('Mobilheim Family & Friends'), scwMatchKey('Mobilheim Family & Friends (für 6 Personen)'));
  assert.notEqual(scwMatchKey('Mobilheim Family'), scwMatchKey('Mobilheim Family & Friends'));
  assert.equal(scwUnitName('Wohnwagen Luxus 650 UFF'), 'Luxury caravan Hobby 650 UFF (own shower)');
  assert.equal(scwBeds('Zwei Doppelbetten & Kinderbett'), 'two double beds and child bed');
});

test('wallnau: slots = table row x runs of (season band, availability), EUR per unit per night', async () => {
  const slots = await fetchScwSlots(TODAY, ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 181);
  assert.ok(notes.some(n => /Superiorwohnwagen 650 KMFE/.test(n)));
  const first = slots.find(s => s.key === 'wohnwagen-komfort-560-ul|2026-10-14')!;
  assert.deepEqual([first.endDate, first.price, first.currency, first.priceUnit, first.availability, first.spotsLeft, first.minNights], ['2026-10-24', 55, 'EUR', 'per_night', 'available', 3, 2]);
  const summer = slots.find(s => s.key === 'wohnwagen-komfort-560-ul|2027-07-04')!;
  assert.deepEqual([summer.endDate, summer.price, summer.minNights], ['2027-08-28', 110, 7]);
  const pentecost = slots.find(s => s.key === 'mobilheim-family|2027-05-14')!;
  assert.deepEqual([pentecost.price, pentecost.minNights, pentecost.availability], [125, 3, 'limited']);
  assert.equal(slots.find(s => s.key === 'mobilheim-family|2027-07-18')!.availability, 'sold_out');
  assert.equal(Math.min(...slots.map(s => s.price!)), 55);
  // nothing before today, nothing after the last printed departure day
  assert.ok(slots.every(s => s.startDate! >= TODAY && s.endDate! <= '2027-10-30'));
  // a pure table run (no engine data) is 'unknown'
  const e = parseScwEngine(read('campbuchung.de_v2_10206_onepage.'));
  const none = buildScwSlots(parseScwTables(prices), { ...e, categories: new Map() }, parseScwBlocks('{"rslt":true,"data":{}}'), TODAY, { high: 7, low: 2 });
  assert.ok(none.length > 0 && none.every(s => s.availability === 'unknown' && s.spotsLeft === null));
});

test('wallnau: content', async () => {
  const c = await strandcampingWallnauFehmarn.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Strandcamping Wallnau');
  assert.equal(c.region, 'Wallnau, Fehmarn');
  assert.deepEqual(c.spotCoords, { lat: 54.488, lng: 11.019 });
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /Two independent kite schools with VDWS-licensed instructors work on the campsite \(Kitesplash and Adventure Kite\)/);
  assert.match(c.summary, /from EUR 55 to EUR 150 per unit and night/);
  assert.equal(c.rooms.length, 11);
  assert.equal(c.rooms[1].description, 'two double beds');
  assert.equal(c.imageUrls[0], 'https://strandcamping.de/images/kitesurfen.jpg');
  assert.ok(c.imageUrls.every(u => /^https:\/\/strandcamping\.de\/images\/[^/]+\.jpe?g$/.test(u)));
});
