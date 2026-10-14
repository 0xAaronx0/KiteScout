// WattLodge (Norden / Norddeich): replays the site pages recorded 2026-10-14 (script / style / svg bodies dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  wattlodgeNorden, buildWlSlots, parseWlNotes, parseWlPackages, parseWlRates,
} from '../../src/offers/adapters/wattlodge-norden.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/wattlodge-norden');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const prices = read('wattlodge.de_preise_.');

test('wattlodge: price cards (per person), the Bulli pitch flagged', () => {
  const rates = parseWlRates(prices);
  assert.deepEqual(rates.map(r => [r.name, r.price, r.occupancy, r.pitch]), [
    ['Surfer-Suite Basic', 62, 2, false], ['Surfer-Suite Classic', 65, 2, false], ["Surfer's Hostel", 51, 1, false],
    ['Hütten-Hostel', 39, 1, false], ['Hütten-Suite', 65, 2, false], ['Bulli-Stellplatz', 22, 1, true],
  ]);
  assert.equal(rates[4].meta, 'ab zwei Personen');
  assert.ok(rates[3].features.includes('Bettwäsche einmalig 15 Euro pro Person'));
  const notes = parseWlNotes(prices);
  assert.deepEqual(notes, { perPerson: true, kurtaxe: '3,50', checkIn: '15.00 Uhr und 19.00 Uhr', cancel: '14' });
});

test('wattlodge: kite packages on /sportangebot/', () => {
  assert.deepEqual(parseWlPackages(read('wattlodge.de_sportangebot_.')), { kiteWeekend: 307, kiteWeek: 755 });
});

test('wattlodge: slots = room types without dates, EUR per person per night', async () => {
  const slots = await wattlodgeNorden.fetchSlots(ctx);
  assert.deepEqual(slots, buildWlSlots(parseWlRates(prices)));
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.occupancy]), [
    ['surfer-suite-basic', 62, 2], ['surfer-suite-classic', 65, 2], ['surfer-s-hostel', 51, 1], ['hutten-hostel', 39, 1], ['hutten-suite', 65, 2],
  ]);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'person'
    && s.availability === 'unknown' && s.startDate === null && s.endDate === null));
});

test('wattlodge: content', async () => {
  const c = await wattlodgeNorden.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.region, 'Norden, East Frisia');
  assert.equal(c.spotCoords, undefined);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /from EUR 39 per person per night/);
  assert.match(c.summary, /kite weekends \(2 nights, 2 days of kitesurfing\) start at EUR 307 per person/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Surfer-Suite Basic', 'Surfer-Suite Classic', "Surfer's Hostel", 'Hütten-Hostel', 'Hütten-Suite']);
  assert.ok(c.optionalServices.includes('Breakfast EUR 14.50 per person (hostel rooms)'));
  assert.ok(c.optionalServices.some(s => /Kite week Monday-Friday: .* from EUR 755 per person/.test(s)));
  assert.match(c.sourceText ?? '', /In unserem Wassersportzentrum, der Surfschule Norddeich/);
  assert.ok(c.imageUrls.length >= 10 && c.imageUrls.every(u => u.startsWith('https://wattlodge.de/wp-content/uploads/') && !/logo|favicon/i.test(u)));
});
