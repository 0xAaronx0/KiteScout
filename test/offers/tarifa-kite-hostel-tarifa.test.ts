// Tarifa Kite Hostel (Tarifa, Spain): replays the English pages recorded 2026-10-12. No prices on the site -> no slots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  tarifaKiteHostelTarifa, parseTkhCoords, parseTkhCourses, parseTkhDorms,
} from '../../src/offers/adapters/tarifa-kite-hostel-tarifa.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { requestsSoFar } from '../../src/offers/http.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/tarifa-kite-hostel-tarifa');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };

test('tkh: 7 mixed dorms with bed counts', () => {
  const dorms = parseTkhDorms(read('www.tarifakitehostel.com_en_rooms_.'));
  assert.deepEqual(dorms.map(d => [d.name, d.beds]), [
    ['Room 01', 8], ['Room 02', 6], ['Room 03', 10], ['Room 04', 4], ['Room 05', 6], ['Room 06', 6], ['Room 07', 6],
  ]);
});

test('tkh: kite course tables (cells joined without spaces in the DOM text)', () => {
  const c = parseTkhCourses(read('www.tarifakitehostel.com_en_kitesurfing-courses-in-tarifa_.'));
  assert.equal(c.length, 5);
  assert.equal(c[0].name, 'Private (1 Kite / 1 Person / 2 hours)');
  assert.deepEqual(c[0].options[0], '1 day / 2 h: EUR 150 per person');
  assert.ok(c.find(x => x.name.startsWith('Semi-Private B'))!.options.every(o => o.endsWith('(for 2 people)')));
  assert.equal(c.find(x => x.name.startsWith('Group'))!.options[3], '4 days / 12 h: EUR 320 per person');
});

test('tkh: map pin from the site\'s own Google Maps link', () => {
  assert.deepEqual(parseTkhCoords(read('www.tarifakitehostel.com_en_.')), { lat: 36.0150751, lng: -5.6036117 });
});

test('tkh: no slots (price on request), no request', async () => {
  const before = requestsSoFar();
  const slots = await tarifaKiteHostelTarifa.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(requestsSoFar(), before);
  assert.ok(notes.some(n => /price on request/.test(n)));
});

test('tkh: content', async () => {
  const c = await tarifaKiteHostelTarifa.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Tarifa Kite Hostel');
  assert.equal(c.country, 'Spain');
  assert.equal(c.mealPlan, 'self_catering');
  assert.match(c.summary, /7 shared mixed dorms of 4 to 10 beds \(46 beds in total\)/);
  assert.match(c.summary, /MYSFIT/);
  assert.equal(c.rooms.length, 7);
  assert.ok(c.optionalServices.some(s => s.startsWith('Kite course (MYSFIT) Private')));
  assert.ok(c.imageUrls.length >= 10);
  assert.ok(c.imageUrls.every(u => !/logo|qr-|\.png$/i.test(u)));
});
