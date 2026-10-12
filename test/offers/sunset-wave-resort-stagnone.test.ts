// Sunset Wave Resort (Lo Stagnone): replays the pages recorded 2026-10-12. Content only; no prices on the site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  sunsetWaveResortStagnone, octorateExpired, parseSwrEquipment, parseSwrRooms, parseSwrSeason,
} from '../../src/offers/adapters/sunset-wave-resort-stagnone.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/sunset-wave-resort-stagnone');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const page = read('www.stagnonekiteboarding.com_en_sunset-wave-resort_.');

test('swr: 5 rooms + equipment list', () => {
  const rooms = parseSwrRooms(page);
  assert.deepEqual(rooms.map(r => [r.name, r.maxGuests]), [['Nazarè', 4], ['One Eye', null], ['Watamu', 2], ['Jericoacoara', null], ['Cape Town', null]]);
  assert.deepEqual(parseSwrEquipment(page), [
    'Private bathroom', 'Full HD TV', 'Free Wi-Fi', 'Minibar', 'Laptop safe', 'Hair dryer', 'Fan', 'Air conditioning', 'Mountain bikes (subject to availability)',
  ]);
});

test('swr: 2026 season article names the linked accommodation', () => {
  const s = parseSwrSeason(read('www.stagnonekiteboarding.com_kitesurf-stagnone-apertura-stagione-2026_.'));
  assert.equal(s.year, 2026);
  assert.equal(s.hospitality, true);
});

test('swr: no slots while the Octorate engine is expired, with a run note', async () => {
  assert.equal(octorateExpired(read('book.octorate.com_')), true);
  assert.equal(octorateExpired('<html><table class="calendar">...</table></html>'), false);
  const notes: string[] = [];
  const slots = await sunsetWaveResortStagnone.fetchSlots({ note: t => notes.push(t), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.match(notes[0], /Expired License/);
});

test('swr: content', async () => {
  const c = await sunsetWaveResortStagnone.fetchContent({ note: () => {}, incomplete: () => {} });
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Sunset Wave Resort');
  assert.equal(c.country, 'Italy');
  assert.equal(c.region, 'Sicily');
  assert.equal(c.spot, 'Lo Stagnone');
  assert.equal(c.bookingUrl, null);
  assert.match(c.summary, /5 themed rooms \(the largest sleeps 4\) in Contrada Birgi/);
  assert.match(c.summary, /opened its 2026 season including stays at the resort/);
  assert.match(c.summary, /publishes no room prices/);
  assert.equal(c.rooms.length, 5);
  assert.equal(c.imageUrls.length, 16);
  assert.ok(c.imageUrls.every(u => /\/wp-content\/uploads\/2021\/06\/Sunset-Wave-Resort-/.test(u)));
});
