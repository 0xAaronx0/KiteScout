// Kite Crew caravans (Chałupy 6): replays the /przyczepy/ page recorded 2026-10-12 (scripts except JSON-LD, styles,
// SVGs and style attributes trimmed; the bank account number in the footer redacted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kiteCrewCaravansChalupy, buildKcrSlots, parseKcrPage } from '../../src/offers/adapters/kite-crew-caravans-chalupy.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-crew-caravans-chalupy');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };
const page = read('www.kitecrew.pl_przyczepy_.');

test('kcr: Cennik 2026 - seasons, classes, caravans, fees', () => {
  const p = parseKcrPage(page);
  assert.equal(p.year, 2026);
  assert.deepEqual(p.high.map(r => [r.start, r.end]), [['2026-05-01', '2026-05-04'], ['2026-06-03', '2026-06-07'], ['2026-06-19', '2026-06-21'], ['2026-06-26', '2026-08-31']]);
  assert.deepEqual(p.low.map(r => [r.start, r.end]), [['2026-05-04', '2026-06-03'], ['2026-06-08', '2026-06-19'], ['2026-06-21', '2026-06-26'], ['2026-08-31', '2026-09-13']]);
  assert.deepEqual(p.unavailable.map(r => [r.raw, r.nights.start, r.nights.end]), [['16-23.08', '2026-08-16', '2026-08-22']]);
  assert.deepEqual(p.classes, [{ cls: 'Standard', high: 800, low: 400 }, { cls: 'Komfort', high: 850, low: 425 }]);
  assert.deepEqual(p.caravans.map(c => [c.no, c.name, c.cls, c.maxGuests]), [
    [1, 'Ocean', 'Standard', 4], [2, 'LMC', 'Standard', 5], [3, 'Fuerta', 'Komfort', 5],
    [4, 'Bali', 'Komfort', 5], [5, 'California', 'Komfort', 6], [6, 'Hawaii', 'Komfort', 6],
  ]);
  assert.ok(p.caravans.every(c => c.description && /Max ilość osób = \d/.test(c.description)));
  assert.deepEqual([p.campFeePerPerson, p.campFeePerCar, p.climateFee, p.deposit], [30, 30, 3.4, 1500]);
});

test('kcr: slots = caravan x price band, the unavailable week sold out, summer weeks min 7 nights', async () => {
  const slots = await kiteCrewCaravansChalupy.fetchSlots(ctx);
  assert.deepEqual(slots, buildKcrSlots(parseKcrPage(page)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 60);
  assert.deepEqual(slots.filter(s => s.key.startsWith('przyczepa-6|')).map(s => [s.key, s.startDate, s.endDate, s.price, s.availability, s.minNights]), [
    ['przyczepa-6|2026-05-01', '2026-05-01', '2026-05-04', 850, 'on_request', null],
    ['przyczepa-6|2026-05-05', '2026-05-05', '2026-06-02', 425, 'on_request', null],
    ['przyczepa-6|2026-06-03', '2026-06-03', '2026-06-07', 850, 'on_request', null],
    ['przyczepa-6|2026-06-08', '2026-06-08', '2026-06-18', 425, 'on_request', null],
    ['przyczepa-6|2026-06-19', '2026-06-19', '2026-06-21', 850, 'on_request', null],
    ['przyczepa-6|2026-06-22', '2026-06-22', '2026-06-25', 425, 'on_request', null],
    ['przyczepa-6|2026-06-26', '2026-06-26', '2026-08-15', 850, 'on_request', 7],
    ['przyczepa-6|2026-08-16', '2026-08-16', '2026-08-22', 850, 'sold_out', 7],
    ['przyczepa-6|2026-08-23', '2026-08-23', '2026-08-31', 850, 'on_request', 7],
    ['przyczepa-6|2026-09-01', '2026-09-01', '2026-09-13', 425, 'on_request', null],
  ]);
  assert.deepEqual(slots.filter(s => s.key.startsWith('przyczepa-1|')).map(s => s.price), [800, 400, 800, 400, 800, 400, 800, 800, 800, 400]);
  assert.equal(slots.find(s => s.key === 'przyczepa-1|2026-08-16')?.availabilityText, '16-23.08 niedostępny');
  assert.deepEqual([...new Set(slots.map(s => `${s.unit}|${s.occupancy}`))], [
    'Caravan 1 Ocean (Standard)|4', 'Caravan 2 LMC (Standard)|5', 'Caravan 3 Fuerta (Comfort)|5',
    'Caravan 4 Bali (Comfort)|5', 'Caravan 5 California (Comfort)|6', 'Caravan 6 Hawaii (Comfort)|6',
  ]);
  assert.ok(slots.every(s => s.currency === 'PLN' && s.priceUnit === 'per_night' && s.priceBasis === 'room'));
});

test('kcr: content', async () => {
  const c = await kiteCrewCaravansChalupy.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kite Crew caravans, Chałupy 6');
  assert.equal(c.region, 'Chałupy, Hel Peninsula');
  assert.equal(c.spot, 'Chałupy');
  assert.equal(c.spotCoords, undefined);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.beginnerFriendly, true);
  assert.match(c.summary, /rents out 6 caravans with equipped awnings right behind its school office/);
  assert.match(c.summary, /PLN 800 \(Standard\) or 850 \(Comfort\)/);
  assert.match(c.summary, /climate fee \(PLN 3\.40 per person and day\)/);
  assert.deepEqual(c.rooms.map(r => r.name), [
    'Caravan 1 Ocean (Standard)', 'Caravan 2 LMC (Standard)', 'Caravan 3 Fuerta (Comfort)',
    'Caravan 4 Bali (Comfort)', 'Caravan 5 California (Comfort)', 'Caravan 6 Hawaii (Comfort)',
  ]);
  assert.ok(c.rooms[0].features.includes('Kitchenette in the awning'));
  assert.ok(c.rooms[1].features.includes('Bunk bed'));
  assert.ok(c.rooms[5].features.includes('Low season PLN 425 per night plus campsite fees (PLN 30 per person and day, PLN 30 per car)'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /kitecrew\.pl\/wp-content\/uploads\//.test(u) && !/mapa/i.test(u)));
});
