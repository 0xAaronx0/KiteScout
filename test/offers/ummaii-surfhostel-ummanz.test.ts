// UMMAII Surfhostel (Ummanz, Rügen): replays the site pages and seven Sirvoy sample stays recorded 2026-10-14 (site pages
// trimmed of script/style bodies; the Sirvoy results pages cut down to room-type data, room cards, currency and the date notice).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ummaiiSurfhostelUmmanz, buildUmSlots, fetchUmContent, fetchUmSample, fetchUmSlots, parseUmKiteCourses, parseUmPriceList,
  parseUmResults, umCoords, umSampleStays, umUnitName, umWidgetBody,
} from '../../src/offers/adapters/ummaii-surfhostel-ummanz.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/ummaii-surfhostel-ummanz');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const TODAY = '2026-10-14';

test('ummaii: one 4-night sample per season month, widget body as the site sends it', () => {
  assert.deepEqual(umSampleStays(TODAY).map(s => s.checkIn), ['2026-10-15', '2027-04-15', '2027-05-15', '2027-06-15', '2027-07-15', '2027-08-15', '2027-09-15']);
  assert.equal(umSampleStays(TODAY)[0].checkOut, '2026-10-19');
  assert.equal(umSampleStays('2026-11-20')[0].checkIn, '2027-04-15'); // no winter samples
  assert.equal(umSampleStays('2026-10-31').length, 6); // tomorrow is in November
  const body = JSON.parse(umWidgetBody('2027-05-15', '2027-05-19'));
  assert.deepEqual([body.form_id, body.widget, body.adults, body.check_in, body.check_out, body.target],
    ['8f8fb088e5c371a1', 'normal', '2', '2027-05-15', '2027-05-19', 'results']);
});

test('ummaii: results pages -> room types (pitches dropped) or the date notice', async () => {
  const oct = await fetchUmSample('2026-10-15', '2026-10-19');
  assert.equal(oct.refused, null);
  assert.equal(oct.currency, 'EUR');
  assert.deepEqual(oct.types.map(t => [t.name, t.rates[2] ?? null, t.freeUnits]), [
    ['Zimmer 1-Bett Haupthaus', null, 1], ['Zimmer 2 Bett Haupthaus', 66, 1], ['Zimmer 3 Bett Haupthaus', 66, 1],
    ['Zimmer 4 Bett Haupthaus', 66, 2], ['Bungalow 6 Bett', 58, 5], ['Bungalow 8 Bett', 58, 5], ['Baumhaus', 94.1, 1], ['Tinyhaus 2', 160, 1],
  ]);
  const jun = await fetchUmSample('2027-06-15', '2027-06-19');
  assert.equal(jun.refused, "The selected dates can't be booked. Please make another selection or call to book.");
  assert.deepEqual(jun.types, []);
  assert.throws(() => parseUmResults('<html><body>nothing</body></html>'), /neither room types nor a date notice/);
  assert.deepEqual(['Zimmer 1-Bett Haupthaus', 'Zimmer 4 Bett Haupthaus', 'Bungalow 6 Bett', 'Baumhaus', 'Tinyhaus 1', 'Neu'].map(umUnitName),
    ['Main house single room', 'Main house 4-bed room', 'Bungalow 6-bed room', 'Tree house', 'Tiny House 1', 'Neu']);
});

test('ummaii: month bands per room type', async () => {
  const slots = await fetchUmSlots(ctx, TODAY);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 52);
  assert.ok(slots.every(s => !/stellplatz|camper/i.test(`${s.key} ${s.unit}`)));
  const t1 = slots.filter(s => s.unit === 'Tiny House 1');
  assert.deepEqual(t1.map(s => [s.startDate, s.endDate, s.price, s.availability, s.minNights]), [
    ['2026-10-14', '2026-10-31', null, 'unknown', 4], ['2027-04-01', '2027-05-31', 150, 'available', 4], ['2027-06-01', '2027-06-30', null, 'on_request', 4],
    ['2027-07-01', '2027-08-31', 150, 'available', 4], ['2027-09-01', '2027-09-30', null, 'on_request', 4],
  ]);
  const dbl = slots.find(s => s.key === 'zimmer-2-bett-haupthaus|2026-10-14')!;
  assert.deepEqual([dbl.unit, dbl.price, dbl.currency, dbl.priceUnit, dbl.priceBasis, dbl.occupancy, dbl.availability],
    ['Main house 2-bed room', 66, 'EUR', 'per_night', 'room', 2, 'available']);
  assert.match(dbl.availabilityText!, /1 unit\(s\) free for the sample stay 2026-10-15\.\.2026-10-19/);
  assert.match(slots.find(s => s.key === 'baumhaus|2027-06-01')!.availabilityText!, /^Sirvoy: "The selected dates can't be booked/);
  assert.equal(Math.min(...slots.filter(s => s.price !== null).map(s => s.price!)), 40); // single room, 1 guest
  assert.ok(!slots.some(s => s.availability === 'sold_out' || s.availability === 'closed'));
  assert.deepEqual(buildUmSlots([], TODAY), []);
});

test('ummaii: printed price list and kite courses', () => {
  const prices = parseUmPriceList(read('www.ummaii.de_unterkunft-tikibar_preise_.'));
  assert.deepEqual(prices.slice(0, 2).map(p => [p.amount, p.perPerson]), [[36.9, true], [41.9, true]]);
  assert.deepEqual(prices.filter(p => /Baumhaus|Tinyhaus/.test(p.label)).map(p => p.amount), [120, 140, 160]);
  const courses = parseUmKiteCourses(read('www.ummaii.de_kitesurfkurse_preise_.'));
  assert.deepEqual(courses.slice(0, 2), [{ name: 'Grundkurs', duration: '3 Tage', price: '359,- €' }, { name: '5 Tage Camp', duration: '5 Tage', price: 'ab 399,-€' }]);
  assert.equal(courses.length, 9);
});

test('ummaii: content', async () => {
  const c = await fetchUmContent(ctx, TODAY);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'UMMAII Surfhostel, Tiny Houses & Baumhaus');
  assert.equal(c.country, 'Germany');
  assert.equal(c.region, 'Suhrendorf, Rügen');
  assert.deepEqual(c.spotCoords, { lat: 54.47467, lng: 13.1477 });
  assert.deepEqual(umCoords(read('www.ummaii.de_.')), c.spotCoords);
  assert.match(c.summary, /own wind- and kitesurf school \(courses since 1994, VDWS licences\) runs the water sports centre/);
  assert.match(c.summary, /online rates for 2 guests run from EUR 58 to 160 per unit per night/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Main house room (1-4 beds)', 'Bungalow room (6 or 8 beds)', 'Tree house', 'Tiny House 1', 'Tiny House 2']);
  assert.ok(c.rooms[1].features.some(f => /Bungalow 6-bed room EUR 58 for 2 guests/.test(f)));
  assert.ok(c.rooms[2].features.includes('Online per night (Sirvoy, sample stay 2026-10-15..2026-10-19): Tree house EUR 94.10 for 2 guests'));
  assert.ok(c.optionalServices.includes('Kite school: Beginner course (3 days), EUR 359'));
  assert.ok(c.optionalServices.includes('VDWS kite licence incl. workbook EUR 40'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /^https:\/\/www\.ummaii\.de\/fileadmin\/(redaktion|_processed_)\//.test(u) && !/logo|Karte_|teaser-small/i.test(u)));
  assert.equal(ummaiiSurfhostelUmmanz.fetchBudget, 19);
});
