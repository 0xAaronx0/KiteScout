// Kite Fun Tarifa Surf House: replays the course + accommodation page recorded 2026-10-12 (scripts and styles trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kitefunSurfHouseTarifa, buildKfSlots, kfMonths, kfTableYear, parseKfTable,
} from '../../src/offers/adapters/kitefun-surf-house-tarifa.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitefun-surf-house-tarifa');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const html = read('kitefuntarifa.com_en_kitesurf-courses-tarifa_kitesurf-courses-accommodation-tarifa.html.');

test('kitefun: course + accommodation table, 3 nights for 2 people', () => {
  const t = parseKfTable(html)!;
  assert.deepEqual(t.columns, [
    { label: 'June / October', months: [6, 10] },
    { label: 'July / September', months: [7, 9] },
    { label: 'August', months: [8] },
  ]);
  assert.deepEqual(t.rows, [
    { course: '9h Kite Course', prices: [520, 640, null] },
    { course: '12h Kite Course', prices: [590, 700, null] },
    { course: 'Private Kite Course', prices: [650, 760, null] },
  ]);
  assert.equal(t.nights, 3);
  assert.equal(t.persons, 2);
  assert.deepEqual(kfMonths('July / September'), [7, 9]);
});

test('kitefun: table year = page article:modified_time', () => {
  assert.equal(kfTableYear(html), 2026);
  assert.equal(kfTableYear('<p>no date</p>'), null);
});

test('kitefun: slots = course x month, per person (total for 2 kept), August on request', async () => {
  const slots = await kitefunSurfHouseTarifa.fetchSlots(ctx);
  assert.deepEqual(slots, buildKfSlots(parseKfTable(html)!, 2026));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 15); // 3 courses x 5 months (June-October)
  const s = (k: string) => slots.find(x => x.key === k)!;
  assert.deepEqual([s('9h-kite-course|2026-10').price, s('9h-kite-course|2026-10').priceTotal, s('9h-kite-course|2026-10').startDate, s('9h-kite-course|2026-10').endDate],
    [260, 520, '2026-10-01', '2026-10-31']);
  assert.deepEqual([s('private-kite-course|2026-07').price, s('private-kite-course|2026-07').priceTotal], [380, 760]);
  assert.deepEqual([s('12h-kite-course|2026-08').price, s('12h-kite-course|2026-08').availabilityText], [null, 'Contact']);
  assert.ok(slots.every(x => x.priceBasis === 'person' && x.occupancy === 2 && x.packageNights === 3
    && x.datePrecision === 'month' && x.availability === 'on_request'));
  assert.ok(slots.filter(x => x.price !== null).every(x => x.currency === 'EUR' && x.priceUnit === 'package'));
});

test('kitefun: content (camp: stay only sold with a course)', async () => {
  const c = await kitefunSurfHouseTarifa.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 4);
  assert.equal(c.title, 'Kite Fun Tarifa Surf House');
  assert.equal(c.region, 'Tarifa town');
  assert.equal(c.spotCoords, undefined); // JSON-LD geo is the school's beach base, not the house
  assert.match(c.summary, /3 nights in a double room for 2 people, from EUR 520 to 760/);
  assert.match(c.summary, /North Kiteboarding, Ocean Rodeo and Mystic/);
  assert.equal(c.imageUrls[0], 'https://kitefuntarifa.com/images/cursos-kite-tarifa/PhotoByKiteFunTarifa.jpg');
  assert.ok(c.imageUrls.every(u => !/navigation-links|banderitas|logo|w1\.webp/.test(u)));
  assert.ok(c.rooms[0].features.includes('9h Kite Course: June / October EUR 520, July / September EUR 640, August on request (3 nights, 2 people)'));
});
