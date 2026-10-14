// Chilochill Glamping Resort and Kiteschool (La Ventana, BCS): replays the WordPress pages recorded 2026-10-14.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCcSlots, chilochillLaVentana, parseCcLessons, parseCcPackages, parseCcTents,
} from '../../src/offers/adapters/chilochill-la-ventana.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/chilochill-la-ventana');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };
const kite = read('chilochill.com_kitesurf.');

test('chilochill: packages, the inconsistent 4-day one is flagged', () => {
  const p = parseCcPackages(kite);
  assert.deepEqual(p.map(x => [x.headingDays, x.nights, x.days, x.guests, x.lessonHours, x.price, x.currency, x.consistent]), [
    [3, 2, 3, 2, 9, 25150, 'MXN', true],
    [4, 6, 7, 2, 12, 33500, 'MXN', false],
  ]);
});

test('chilochill: slots = consistent packages only', async () => {
  const slots = await chilochillLaVentana.fetchSlots(ctx);
  assert.deepEqual(slots, buildCcSlots(parseCcPackages(kite)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 1);
  const s = ok[0];
  assert.deepEqual([s.key, s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.packageNights, s.availability, s.startDate],
    ['kite-and-bed-3d', 25150, 'MXN', 'package', 'room', 2, 2, 'unknown', null]);
  assert.ok(notes.some(n => /4 DAY PACKAGE" left out/.test(n)));
});

test('chilochill: kite school price list', () => {
  assert.deepEqual(parseCcLessons(kite), [
    'Full course 12 h: MXN 19,200', 'Package 9 h: MXN 14,800', 'Package 6 h: MXN 9,700',
    'Package 3 h: 1 PAX MXN 4,800 / 2PAX MXN 5,800', 'Per hour: MXN 1,700',
  ]);
});

test('chilochill: tents', () => {
  assert.deepEqual(parseCcTents(read('chilochill.com_glamping.')).map(r => r.name), ['Glamping tent Single King', 'Glamping tent Double Queen']);
});

test('chilochill: content', async () => {
  const c = await chilochillLaVentana.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Chilochill Glamping Resort and Kiteschool');
  assert.equal(c.region, 'La Ventana, Baja California Sur');
  assert.equal(c.spotCoords, undefined);
  assert.match(c.summary, /IKO certified instructors teaching in English, Spanish, German and French/);
  assert.match(c.summary, /from MXN 25,150 for 2 nights for two people/);
  assert.deepEqual(c.languages, ['en', 'es', 'de', 'fr']);
  assert.ok(c.rooms[0].features.some(f => /MXN 25,150/.test(f)));
  assert.ok(!c.rooms.some(r => r.features.some(f => /33,500/.test(f))));
  assert.ok(c.imageUrls.length >= 10 && c.imageUrls.every(u => u.startsWith('https://') && !/Artboard|logo/i.test(u)));
});
