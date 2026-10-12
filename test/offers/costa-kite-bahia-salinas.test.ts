// Costa Kite - Nandel Beach Resort (Bahia Salinas, Costa Rica): replays the pages recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  costaKiteBahiaSalinas, parseCkCourses, parseCkPackNote, parseCkPacks, parseCkRooms,
} from '../../src/offers/adapters/costa-kite-bahia-salinas.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/costa-kite-bahia-salinas');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('ck: room price line "Price per night for 2 people: 100$-150$"', () => {
  const rooms = parseCkRooms(read('costakite.com_accommodation-costa-rica-kiteboarding_.'));
  assert.deepEqual(rooms.map(r => [r.name, r.guests, r.min, r.max]), [['Private double room (incl breakfast)', 2, 100, 150]]);
  assert.match(rooms[0].text, /private bathroom TV and AC/);
});

test('ck: kite + lodging packs', () => {
  const html = read('costakite.com_packages_.');
  const packs = parseCkPacks(html);
  assert.deepEqual(packs.map(p => [p.name, p.nights, p.price, p.perPerson, p.minPersons]), [
    ['SOLO TRAVELLER PACK', 3, 999, true, null],
    ['PRIVATE DOUBLE ROOM PACK', 3, 799, true, 2],
  ]);
  assert.equal(parseCkPackNote(html), 'All Packages: Not available in Christmas and Easter');
});

test('ck: lesson and rental price cards per tab, USD note', () => {
  const { courses, currencyNote } = parseCkCourses(read('costakite.com_courses-and-rentals-costa-rica-kite_.'));
  assert.equal(courses.length, 11);
  assert.deepEqual(courses[0], { group: 'Group Courses', name: 'Zero to Hero', price: 405, detail: '9 hours / 3 days' });
  assert.deepEqual(courses.find(c => c.group === 'Private' && c.name === 'Zero to Hero')!.price, 595);
  assert.equal(currencyNote, 'All Prices are per person in USD.');
});

test('ck: slots = room (low end of the range) + two 3-night packs, USD, on request, no dates', async () => {
  const slots = await costaKiteBahiaSalinas.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.priceUnit, s.priceBasis, s.occupancy, s.packageNights ?? null]), [
    ['private-double-room|2p', 100, 'per_night', 'room', 2, null],
    ['solo-traveller-pack', 999, 'package', 'person', 1, 3],
    ['private-double-room-pack', 799, 'package', 'person', 2, 3],
  ]);
  assert.ok(slots.every(s => s.currency === 'USD' && s.availability === 'on_request' && s.startDate === null && s.endDate === null));
  assert.equal(slots[1].availabilityText, 'All Packages: Not available in Christmas and Easter');
});

test('ck: content', async () => {
  const c = await costaKiteBahiaSalinas.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Costa Kite - Nandel Beach Resort');
  assert.equal(c.country, 'Costa Rica');
  assert.equal(c.region, 'Guanacaste');
  assert.equal(c.spot, 'Bahia Salinas');
  assert.equal(c.spotCoords, null);
  assert.equal(c.mealPlan, 'breakfast');
  assert.match(c.summary, /Nandel Beach Resort/);
  assert.match(c.summary, /USD 100-150 per night for two/);
  assert.match(c.summary, /from Nov to May/);
  assert.equal(c.rooms.length, 1);
  assert.ok(c.optionalServices.includes('Private: Zero to Hero (9 hours / 3 days) USD 595 per person'));
  assert.match(c.sourceText ?? '', /packages \(dateModified 2026-07-11\)/);
  assert.match(c.sourceText ?? '', /family kite vacation \(posted 2026-01-26\)/);
  assert.ok(c.imageUrls.length >= 8);
  assert.ok(c.imageUrls.some(u => /nandel-pool\.jpg$/.test(u)));
  assert.ok(c.imageUrls.every(u => !/logo|\.svg|googleusercontent|trustindex/i.test(u)));
  assert.ok(!/[–—]/.test(c.summary));
});
