// Palapas Ventana (La Ventana Bay, Baja California Sur): replays the pages recorded 2026-10-12 (content only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  palapasVentanaLaVentana, parsePvCalendar, parsePvCasitas, parsePvPackages,
} from '../../src/offers/adapters/palapas-ventana-la-ventana.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/palapas-ventana-la-ventana');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');

test('palapas: casita types', () => {
  assert.deepEqual(parsePvCasitas(read('www.palapasventana.com_resort_.')).map(c => [c.name, c.guests]), [
    ['Specialty Casita', 4], ['Regular Casita', 2],
  ]);
});

test('palapas: kite package cards', () => {
  const p = parsePvPackages(read('www.palapasventana.com_activities_kiteboarding_.'));
  assert.deepEqual(p.map(x => x.title), ['Kiteboarding Lessons', 'Kiteboarding Liveaboard', 'Jetski Support Package', 'Learn to Kite Vacation']);
  assert.equal(p[2].fields.Price, '$1,395.00 CASH or $1,618.20 CARD/TRANSFER');
  assert.equal(p[3].fields.Duration, '5 nights and 6 days');
  assert.equal(p[1].fields.Available, 'February 2024');
});

test('palapas: 2026 trip calendar on the home page', () => {
  const cal = parsePvCalendar(read('www.palapasventana.com_.'));
  assert.equal(cal[0], 'January 2026: Winter Fun and Kiteboarding');
  assert.equal(cal[cal.length - 1], 'December 2026: Mag Bay Whale Season + Whale Sharks!');
});

test('palapas: no slots (casitas by inquiry, no rates on the site)', async () => {
  const notes: string[] = [];
  const slots = await palapasVentanaLaVentana.fetchSlots({ note: n => notes.push(n), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.match(notes[0], /booked by inquiry/);
});

test('palapas: content', async () => {
  const c = await palapasVentanaLaVentana.fetchContent({ note: () => {}, incomplete: () => {} });
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Palapas Ventana');
  assert.equal(c.spot, 'La Ventana');
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /Specialty casitas sleep up to 4 with a private bathroom, regular casitas up to 2/);
  assert.match(c.summary, /9-hour jet-ski-assisted lesson package costs USD 1,395 \(cash\)/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Specialty Casita', 'Regular Casita']);
  assert.ok(c.optionalServices.some(s => /^Learn to Kite Vacation .*: price on request$/.test(s)));
  assert.ok(!c.optionalServices.some(s => /Liveaboard/.test(s)), 'stale 2024 liveaboard card left out');
  assert.match(c.sourceText ?? '', /December 2026: Mag Bay Whale Season/);
  assert.equal(c.imageUrls.length, 15);
  assert.ok(c.imageUrls.every(u => u.includes('palapasventana.com/wp-content/uploads/') && !/fish|logo|-300\.jpg/i.test(u)));
});
