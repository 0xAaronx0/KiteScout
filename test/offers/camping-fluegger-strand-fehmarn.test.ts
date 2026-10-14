// Camping Flügger Strand (Flügge, Fehmarn): replays the Contao pages recorded 2026-10-14 (scripts, styles and srcsets
// stripped). Slots are built with a pinned "today": the 2026 price lists are mostly past on the recording day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  campingFlueggerStrandFehmarn, buildCfsSlots, fetchCfsSlots, parseCfsPrices, type CfsTable,
} from '../../src/offers/adapters/camping-fluegger-strand-fehmarn.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/camping-fluegger-strand-fehmarn');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const caravans = parseCfsPrices(read('www.fluegger-strand.de_preise-mietwohnwagen.'))!;
const cottages = parseCfsPrices(read('www.fluegger-strand.de_preise-ferienhaeuschen.'))!;

test('fluegger: price pages = tier ranges x unit prices, booked-out range and exceptions', () => {
  assert.equal(caravans.year, 2026);
  assert.equal(caravans.prices.length, 12);
  assert.deepEqual(caravans.prices.find(p => p.unit === 'Kategorie 2-A' && p.tier === 'high')!.ranges, [
    { start: '2026-05-09', end: '2026-05-27' }, { start: '2026-06-27', end: '2026-09-06' },
  ]);
  assert.deepEqual(caravans.bookedOut, { start: '2026-07-06', end: '2026-08-22' });
  assert.deepEqual(cottages.prices.map(p => [p.unit, p.tier, p.price]), [
    ['Typ B', 'low', 95], ['Typ B', 'mid', 115], ['Typ B', 'high', 135], ['Typ E', 'low', 115], ['Typ E', 'mid', 135], ['Typ E', 'high', 159],
  ]);
  assert.equal(cottages.free.length, 2);
  assert.equal(cottages.free[0].unit, 'Typ E');
});

test('fluegger: whole 2026 season as bands (today = 2026-01-01)', () => {
  const slots = buildCfsSlots([caravans, cottages] as CfsTable[], '2026-01-01');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 77);
  const peak = slots.find(s => s.key === 'caravan-1-a|2026-07-06')!;
  assert.deepEqual([peak.endDate, peak.price, peak.availability, peak.minNights], ['2026-08-21', 95, 'sold_out', 7]);
  const exc = slots.find(s => s.key === 'cottage-e|2026-09-06')!;
  assert.deepEqual([exc.endDate, exc.availability], ['2026-09-10', 'limited']);
  assert.match(exc.availabilityText ?? '', /^Typ E, 2\. Reihe, frei vom 06\.09\. bis 11\.09\.2026/);
  assert.equal(slots.find(s => s.key === 'caravan-1-a|2026-10-04')!.endDate, '2026-10-10'); // departure 11.10. = closing day
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.occupancy === 4));
});

test('fluegger: on the recording day only the cottages\' last band is left', async () => {
  const slots = await fetchCfsSlots('2026-10-14');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.startDate, s.endDate, s.price, s.availability]), [
    ['cottage-b|2026-09-27', '2026-09-27', '2026-10-17', 115, 'on_request'],
    ['cottage-e|2026-09-27', '2026-09-27', '2026-10-17', 135, 'on_request'],
  ]);
  assert.deepEqual(await fetchCfsSlots('2026-10-18'), []);
});

test('fluegger: content describes the kite link as printed', async () => {
  const c = await campingFlueggerStrandFehmarn.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Camping Flügger Strand');
  assert.equal(c.region, 'Flügge, Fehmarn');
  assert.deepEqual(c.spotCoords, { lat: 54.4517, lng: 11.0069 });
  assert.equal(c.kiteLessons, null);
  assert.deepEqual(c.skillLevels, ['advanced']);
  assert.match(c.summary, /\(open 27 March to 18 October 2026\)/);
  assert.match(c.summary, /There is no kite school on the campsite: kiters launch at the end of the site/);
  assert.match(c.sourceText ?? '', /Am Platzende können die Kiter/);
  assert.match(c.sourceText ?? '', /Foil-Kurse und individuelle Trainingsformen/);
  assert.equal(c.rooms.length, 6);
  assert.deepEqual(c.rooms[2].features.slice(0, 2), ['Units M6', '2026: EUR 82-105 per night (low to high season, up to 4 persons)']);
  assert.ok(c.imageUrls.length >= 12 && c.imageUrls.every(u => u.startsWith('https://www.fluegger-strand.de/')));
});
