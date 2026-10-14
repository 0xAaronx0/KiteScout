// Kite.pl caravans (Chałupy 6): replays the caravans and location pages recorded 2026-10-12 (scripts except JSON-LD,
// styles, SVGs and style attributes trimmed; the reCAPTCHA site key redacted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kitePlCaravansChalupy, buildKplSlots, parseKplCoords, parseKplPage, plRanges,
} from '../../src/offers/adapters/kite-pl-caravans-chalupy.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-pl-caravans-chalupy');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };
const caravans = read('kite.pl_przyczepy-chalupy-6_.');

test('kpl: Polish date ranges (numeric, month names, labels, open start month)', () => {
  assert.deepEqual(plRanges('Majówka 1-3.05, Boże Ciało 3-7.06, Hel Riders 19-21.06 , wakacje 26.06-30.08', 2026).map(r => [r.label, r.start, r.end]), [
    ['Majówka', '2026-05-01', '2026-05-03'], ['Boże Ciało', '2026-06-03', '2026-06-07'],
    ['Hel Riders', '2026-06-19', '2026-06-21'], ['wakacje', '2026-06-26', '2026-08-30'],
  ]);
  assert.deepEqual(plRanges('4 maja – 3 czerwca, 8-19 czerwca, 21-26.06, 31.08-13 września', 2026).map(r => [r.start, r.end]), [
    ['2026-05-04', '2026-06-03'], ['2026-06-08', '2026-06-19'], ['2026-06-21', '2026-06-26'], ['2026-08-31', '2026-09-13'],
  ]);
  assert.deepEqual(plRanges('28.06- 5.07, 05-12.07', 2026).map(r => [r.start, r.end]), [['2026-06-28', '2026-07-05'], ['2026-07-05', '2026-07-12']]);
});

test('kpl: season line and caravan cards', () => {
  const p = parseKplPage(caravans);
  assert.deepEqual(p.season, { year: 2026, start: '2026-04-24', end: '2026-09-13' });
  assert.equal(p.nextSeason, 2027);
  assert.equal(p.minNightsSummer, 6);
  assert.equal(p.parkingPerDay, 30);
  assert.equal(p.deposit, 1500);
  assert.deepEqual(p.caravans.map(c => [c.no, c.lengthM, c.airCon, c.maxGuests, c.lowPrice, c.highPrice, c.freeYear, c.freeText]), [
    [1, 7.2, false, 6, 400, 850, 2026, '29.08-13.09'],
    [2, 6.5, false, 6, 400, 850, 2026, '29.08-13.09'],
    [3, 6.5, false, 5, 400, 850, 2026, '16-18.08, 30.08-13.09'],
    [4, 7.2, false, 6, 400, 850, 2026, '23-24.08, 29.08-13.09'],
    [5, 6.2, true, 6, 400, 850, 2026, '12-13.09'],
    [6, 6.5, false, 6, 400, 850, 2026, '7-13.09'],
    [7, 6.5, false, 6, 400, 850, 2026, '12-13.09'],
  ]);
  assert.equal(p.caravans[0].highText, 'Majówka 1-3.05, Boże Ciało 3-7.06, Hel Riders 19-21.06 , wakacje 26.06-30.08');
  assert.ok(p.caravans.every(c => c.images.length > 0 && c.images.every(u => !/-\d+x\d+\.|mapka|stick-man/.test(u))));
});

test('kpl: slots = caravan x run of equal price class and free/taken days', async () => {
  const slots = await kitePlCaravansChalupy.fetchSlots(ctx);
  assert.deepEqual(slots, buildKplSlots(parseKplPage(caravans)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 74);
  assert.deepEqual(slots.filter(s => s.key.startsWith('przyczepa-3|')).map(s => [s.key, s.startDate, s.endDate, s.price, s.availability, s.minNights]), [
    ['przyczepa-3|2026-04-24', '2026-04-24', '2026-04-30', 400, 'sold_out', null],
    ['przyczepa-3|2026-05-01', '2026-05-01', '2026-05-03', 850, 'sold_out', null],
    ['przyczepa-3|2026-05-04', '2026-05-04', '2026-06-02', 400, 'sold_out', null],
    ['przyczepa-3|2026-06-03', '2026-06-03', '2026-06-07', 850, 'sold_out', null],
    ['przyczepa-3|2026-06-08', '2026-06-08', '2026-06-18', 400, 'sold_out', null],
    ['przyczepa-3|2026-06-19', '2026-06-19', '2026-06-21', 850, 'sold_out', null],
    ['przyczepa-3|2026-06-22', '2026-06-22', '2026-06-25', 400, 'sold_out', null],
    ['przyczepa-3|2026-06-26', '2026-06-26', '2026-08-15', 850, 'sold_out', 6],
    ['przyczepa-3|2026-08-16', '2026-08-16', '2026-08-18', 850, 'available', 6],
    ['przyczepa-3|2026-08-19', '2026-08-19', '2026-08-29', 850, 'sold_out', 6],
    ['przyczepa-3|2026-08-30', '2026-08-30', '2026-08-30', 850, 'available', 6],
    ['przyczepa-3|2026-08-31', '2026-08-31', '2026-09-13', 400, 'available', null],
  ]);
  assert.ok(slots.every(s => s.currency === 'PLN' && s.priceUnit === 'per_night' && s.priceBasis === 'room'));
  assert.equal(slots.find(s => s.key === 'przyczepa-3|2026-08-16')?.availabilityText, 'wolne terminy 2026: 16-18.08, 30.08-13.09');
  assert.equal(slots.find(s => s.key === 'przyczepa-5|2026-04-24')?.unit, 'Caravan #5 with awning (6.2 m, air conditioning)');
  assert.ok(notes.includes('bookings open for 2027, prices still the 2026 table'));
});

test('kpl: without a free-date line every day is on request', () => {
  const p = parseKplPage(caravans);
  p.caravans = p.caravans.slice(0, 1).map(c => ({ ...c, freeText: null, freeYear: null }));
  const slots = buildKplSlots(p);
  assert.equal(slots.length, 9);
  assert.ok(slots.every(s => s.availability === 'on_request' && s.availabilityText === null));
});

test('kpl: content', async () => {
  const c = await kitePlCaravansChalupy.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kite.pl caravans, Chałupy 6');
  assert.equal(c.country, 'Poland');
  assert.equal(c.region, 'Chałupy, Hel Peninsula');
  assert.equal(c.spot, 'Chałupy');
  assert.deepEqual(c.spotCoords, { lat: 54.762029, lng: 18.497241 });
  assert.deepEqual(parseKplCoords(read('kite.pl_szkola-kitesurfing_lokalizacja_.')), c.spotCoords);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.equal(c.mealPlan, 'self_catering');
  assert.match(c.summary, /rents out 7 caravans/);
  assert.match(c.summary, /from PLN 400 per caravan and night in low season and PLN 850/);
  assert.match(c.summary, /bookings for 2027 are open/);
  assert.equal(c.rooms.length, 7);
  assert.ok(c.rooms[4].features.includes('Air conditioning'));
  assert.ok(c.rooms[0].features.includes('U-shaped sofa with table, converts to a bed for 2-3'));
  assert.ok(c.optionalServices.includes('Car parking (PLN 30 per day)'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://kite.pl/app/uploads/') && !/logo|stick-man|mapka/.test(u)));
});
