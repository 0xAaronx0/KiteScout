// Campingplatz Strandgut (Cuxhaven-Sahlenburg): replays the Joomla pages recorded 2026-10-14 (script / style / svg bodies,
// srcset and data-sources attributes dropped; the contact page's map JSON kept; the consent-manager apiKey REDACTED).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  campingplatzStrandgutCuxhaven, buildSgSlots, fetchSgSlots, parseSgCoords, parseSgPrices,
} from '../../src/offers/adapters/campingplatz-strandgut-cuxhaven.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/campingplatz-strandgut-cuxhaven');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const prices = parseSgPrices(read('www.campingplatz-strandgut.de_preise.'));

test('strandgut: season, HS / NS periods and the four rental unit cards', () => {
  assert.equal(prices.year, 2026);
  assert.deepEqual([prices.seasonStart, prices.seasonEnd], ['2026-03-15', '2026-10-31']);
  assert.deepEqual(prices.main, [
    { start: '2026-03-23', end: '2026-04-16' }, { start: '2026-05-15', end: '2026-05-26' },
    { start: '2026-07-02', end: '2026-08-23' }, { start: '2026-10-12', end: '2026-10-24' },
  ]);
  assert.equal(prices.low.length, 4);
  assert.deepEqual(prices.low[3], { start: '2026-10-25', end: '2026-10-31' });
  assert.deepEqual(prices.units.map(u => [u.name, u.maxPersons, u.minNights, u.included, u.weekday, u.weekend, u.extraPerson]), [
    ['Tiny Haus', 4, 3, 2, { hs: 120, ns: 90 }, { hs: 120, ns: 110 }, null],
    ['Strandgut-Kajüte', 2, 1, 1, { hs: 49, ns: 45 }, { hs: 49, ns: 49 }, 10],
    ['Strandgut-Koje', 2, 1, 1, { hs: 29, ns: 25 }, { hs: 29, ns: 29 }, 10],
    ['Sandbank2Go', 3, 3, 2, { hs: 70, ns: 63 }, { hs: 70, ns: 67 }, null],
  ]);
  assert.ok(prices.units[0].extras.includes('zzgl. Endreinigung 50,00 €'));
});

test('strandgut: slots = unit x future period x day type, EUR per unit per night', async () => {
  const slots = await fetchSgSlots('2026-10-14');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 16);
  assert.deepEqual(slots.slice(0, 4).map(s => [s.key, s.startDate, s.endDate, s.price, s.occupancy, s.minNights]), [
    ['tiny-house|mon-fri|2026-10-12', '2026-10-12', '2026-10-24', 120, 2, 3],
    ['tiny-house|sat-sun|2026-10-12', '2026-10-12', '2026-10-24', 120, 2, 3],
    ['tiny-house|mon-fri|2026-10-25', '2026-10-25', '2026-10-31', 90, 2, 3],
    ['tiny-house|sat-sun|2026-10-25', '2026-10-25', '2026-10-31', 110, 2, 3],
  ]);
  assert.deepEqual(slots.find(s => s.key === 'koje|mon-fri|2026-10-25')?.price, 25);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.availability === 'unknown'));
  assert.equal(buildSgSlots(prices, '2026-03-01').length, 4 * 8 * 2);
  assert.deepEqual(buildSgSlots(prices, '2026-11-01'), []);
});

test('strandgut: content', async () => {
  const c = await campingplatzStrandgutCuxhaven.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.region, 'Cuxhaven, North Sea Coast');
  assert.deepEqual(c.spotCoords, { lat: 53.8589332, lng: 8.5950373 });
  assert.deepEqual(parseSgCoords(read('www.campingplatz-strandgut.de_kontakt.')), { lat: 53.8589332, lng: 8.5950373 });
  assert.match(c.summary, /open from 15 March 2026 to 31 October 2026/);
  assert.match(c.summary, /from EUR 25 per night/);
  assert.match(c.summary, /own kite showroom and bookable kite-equipment lockers/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Tiny House', 'Strandgut-Kajüte (cabin)', 'Strandgut-Koje (covered outdoor bed)', 'Sandbank2Go caravan']);
  assert.ok(c.rooms[1].features.includes('2nd person +EUR 10 per night'));
  assert.match(c.sourceText ?? '', /Kite-Showroom und Kite-Storage/);
  assert.ok(c.imageUrls.length >= 10 && c.imageUrls.every(u => u.startsWith('https://www.campingplatz-strandgut.de/images/')));
});
