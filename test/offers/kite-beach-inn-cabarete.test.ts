// Kite Beach Inn (Cabarete): replays the site pages and six Sirvoy sample stays recorded 2026-10-12 (site pages trimmed
// of script/style bodies; the Sirvoy results pages cut down to the room-type data attributes, room cards and currency).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kiteBeachInnCabarete, buildKbiSlots, fetchKbiContent, fetchKbiSample, fetchKbiSlots, kbiCoords, kbiResultsUrl, kbiSampleStays,
  kbiWidgetBody, parseKbiResults,
} from '../../src/offers/adapters/kite-beach-inn-cabarete.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-beach-inn-cabarete');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const TODAY = '2026-10-12';

test('kite-beach-inn: one 3-night sample stay per month, widget body as the site sends it', () => {
  assert.deepEqual(kbiSampleStays(TODAY).map(s => [s.checkIn, s.checkOut]), [
    ['2026-10-15', '2026-10-18'], ['2026-11-15', '2026-11-18'], ['2026-12-15', '2026-12-18'],
    ['2027-01-15', '2027-01-18'], ['2027-02-15', '2027-02-18'], ['2027-03-15', '2027-03-18'],
  ]);
  assert.deepEqual(kbiSampleStays('2026-10-20')[0], { checkIn: '2026-10-21', checkOut: '2026-10-24' });
  assert.equal(kbiSampleStays('2026-10-31')[0].checkIn, '2026-11-15'); // tomorrow is in the next month
  const body = JSON.parse(kbiWidgetBody('2026-11-15', '2026-11-18'));
  assert.deepEqual([body.form_id, body.widget, body.adults, body.check_in, body.check_out, body.target],
    ['ed212d53a23bbba9a952f18681213b7e', 'normal', '2', '2026-11-15', '2026-11-18', 'results']);
});

test('kite-beach-inn: widget answer -> results page -> room types', async () => {
  const url = kbiResultsUrl(read('secured.sirvoy.com_widget_book_widget_cors.js.'));
  assert.match(url!, /^https:\/\/secured\.sirvoy\.com\/engine\/book_results\?t=[\w-]+&id=ed212d53a23bbba9a952f18681213b7e&container_id=sbw_widget_1$/);
  const s = await fetchKbiSample('2026-10-15', '2026-10-18');
  assert.equal(s.currency, 'USD');
  assert.deepEqual(s.types.map(t => [t.name, t.rates[2] ?? null, t.freeUnits]), [
    ['Standard - with air conditioning', 59, 8], ['Ocean view - with air conditioning', 84, 2], ['Ground floor studio', 79, 3],
    ['Partial ocean view studio', 89, 5], ['Ocean view penthouse studio', 84, 1], ['Large ocean view penthouse studio', 99, 1],
    ['One bedroom partial ocean view apartment', 109, 1],
  ]);
  assert.equal(s.cards[0].description, 'Private bath, 2 singles, AC, digital cable TV.');
  assert.equal(s.cards[2].beds, '1, Extra bed spaces: 2');
  assert.throws(() => parseKbiResults('<html><body>nothing</body></html>'), /without a currency/);
});

test('kite-beach-inn: month bands per room type from the samples', async () => {
  const slots = await fetchKbiSlots(ctx, TODAY);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 19);
  const std = slots.filter(s => s.unit === 'Standard - with air conditioning');
  assert.deepEqual(std.map(s => [s.key, s.startDate, s.endDate, s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.availability]), [
    ['standard-with-air-conditioning|2026-10-12', '2026-10-12', '2027-03-31', 59, 'USD', 'per_night', 'room', 2, 'available'],
  ]);
  assert.match(std[0].availabilityText!, /8 unit\(s\) free for the sample stay 2026-10-15\.\.2026-10-18/);
  const ov = slots.filter(s => s.unit === 'Ocean view - with air conditioning');
  assert.deepEqual(ov.map(s => [s.startDate, s.endDate, s.price, s.availability, s.spotsLeft]), [
    ['2026-10-12', '2026-12-31', 84, 'limited', 2], ['2027-01-01', '2027-01-31', null, 'unknown', null], ['2027-02-01', '2027-03-31', 84, 'limited', 1],
  ]);
  assert.equal(Math.min(...slots.filter(s => s.price !== null).map(s => s.price!)), 59);
  // a type missing from a sample is 'unknown', never sold_out
  assert.ok(!slots.some(s => s.availability === 'sold_out'));
  assert.deepEqual(buildKbiSlots([], TODAY), []);
});

test('kite-beach-inn: content', async () => {
  const c = await fetchKbiContent(ctx, TODAY);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kite Beach Inn');
  assert.equal(c.country, 'Dominican Republic');
  assert.equal(c.spot, 'Kite Beach, Cabarete');
  assert.deepEqual(c.spotCoords, { lat: 19.76256, lng: -70.42241 });
  assert.deepEqual(kbiCoords(read('www.kitebeachinn.com_about-us_.')), c.spotCoords);
  assert.match(c.summary, /26-room budget beachfront hotel directly on Kite Beach/);
  assert.match(c.summary, /online from USD 59 to 109 per room per night/);
  assert.match(c.summary, /7 nights from USD 385/);
  assert.equal(c.rooms.length, 7);
  assert.ok(c.optionalServices.some(s => /IKO-certified school/.test(s)));
  assert.ok(c.imageUrls.length >= 15 && c.imageUrls.every(u => /kitebeachinn\.com\/wp-content\/uploads\/.*\.jpg$/.test(u) && !/logo|certificate/i.test(u)));
  assert.equal(kiteBeachInnCabarete.fetchBudget, 15);
});
