// Rügen Kite Hostel (Martinshafen, Sagard): replays /unterkunft and /kurse/kitecamp-ruegen recorded 2026-10-14
// (scripts / styles / srcsets dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ruegenKiteHostelMartinshafen, buildRkSlots, parseRkCamp, parseRkCampForm, parseRkPriceList, rkCoords,
} from '../../src/offers/adapters/ruegen-kite-hostel-martinshafen.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/ruegen-kite-hostel-martinshafen');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const stay = read('www.ruegen-kite.de_unterkunft.');
const camp = read('www.ruegen-kite.de_kurse_kitecamp-ruegen.');

test('ruegen-kite: hostel price list and the camp form footnotes', () => {
  assert.deepEqual(parseRkPriceList(stay).map(x => [x.badge, x.title, x.price]), [
    ['Kitehostel', '6 Bett Zimmer', 25], ['Kitehostel', 'Doppelzimmer', 60], ['Stellplatz', 'Für Bullis bis zu 2 zwei Personen', 18],
  ]);
  const form = parseRkCampForm(camp);
  assert.deepEqual(form.options.map(o => [o.label, o.price, o.mark]), [
    ['Doppelzimmer', 60, '**'], ['Doppelzimmer mit Aufbettung für 3', 75, '**'], ['6-Bett Zimmer', 25, '*'], ['Camper Stellplatz', 18, ''],
  ]);
  assert.deepEqual(form.footnotes, { '*': 'Preise gelten inkl. MwSt. pro Nacht und Person.', '**': 'Preis pro Zimmer inkl. MwSt.' });
});

test('ruegen-kite: 3 undated slots, camper pitch dropped', async () => {
  const slots = await ruegenKiteHostelMartinshafen.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.unit, s.price, s.priceBasis, s.occupancy]), [
    ['bed-6-bed-room', 'Bed in a 6-bed room', 25, 'person', 1],
    ['double-room', 'Double room', 60, 'room', 2],
    ['double-room-3', 'Double room with extra bed (3 people)', 75, 'room', 3],
  ]);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.availability === 'on_request' && s.startDate === null && s.endDate === null));
  assert.deepEqual(buildRkSlots(parseRkPriceList(stay), { options: [], footnotes: {} }).map(s => s.key), ['bed-6-bed-room', 'double-room']);
});

test('ruegen-kite: camp 2026 prices and weeks', () => {
  const c = parseRkCamp(camp);
  assert.deepEqual([c.year, c.off, c.main, c.licence], [2026, 429, 449, 35]);
  assert.deepEqual(c.packages, [{ name: 'camper pitch', price: 521 }, { name: '6-bed room', price: 549 }, { name: 'double room', price: 689 }]);
  assert.equal(c.weeks.length, 17);
  assert.equal(c.weeks[16], '28. September – 02. Oktober 449€');
});

test('ruegen-kite: content', async () => {
  const c = await ruegenKiteHostelMartinshafen.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Rügen Kite Hostel');
  assert.equal(c.region, 'Sagard, Rügen');
  assert.deepEqual(c.spotCoords, { lat: 54.36497, lng: 13.71149 });
  assert.deepEqual(rkCoords(camp), c.spotCoords);
  assert.match(c.summary, /its own Kite Hostel \(16 beds\) is a few minutes' walk from the spot/);
  assert.match(c.summary, /A bed in a 6-bed room costs EUR 25 per night, a double room EUR 60 \(EUR 75 for 3\), bed linen EUR 10 once/);
  assert.match(c.summary, /in 2026 cost EUR 429-449/);
  assert.deepEqual(c.rooms.map(r => r.name), ['6-bed room (Hostel 1)', 'Double room (Hostel 2)']);
  assert.ok(c.optionalServices.includes('Kite camp (main season) incl. 4 nights, 6-bed room: EUR 549'));
  assert.ok(c.imageUrls.length >= 20 && c.imageUrls.every(u => !/-\d+x\d+\.|logo|Rund_Blau/i.test(u)));
  assert.match(c.imageUrls[0], /2020\/07\/wohnzimmerHostel\.jpg$/);
});
