// Lion Hostel Tarifa by Rebels: replays the hostel and packs pages recorded 2026-10-12 (scripts and styles trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  lionHostelTarifa, buildLionSlots, lionCoords, lionLines, parseLionPacks, parseLionRooms,
} from '../../src/offers/adapters/lion-hostel-tarifa.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/lion-hostel-tarifa');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const hostel = read('rebelstarifa.com_tarifa-hostel_.');
const packs = read('rebelstarifa.com_packs-kitesurf-accommodation_.');

test('lion: pack cards (3/5/7 days, price per person by group size)', () => {
  const p = parseLionPacks(packs);
  assert.deepEqual(p.map(x => [x.days, x.from, x.options.map(o => [o.amount, o.persons, o.hoursPerDay])]), [
    [3, 199, [[199, 3, 3], [299, 2, 3], [345, 1, 2]]],
    [5, 330, [[330, 3, 3], [499, 2, 3], [570, 1, 2]]],
    [7, 470, [[470, 3, 3], [699, 2, 3], [799, 1, 2]]],
  ]);
  assert.equal(p[0].room, 'Shared room Accommodation');
  assert.deepEqual(p[2].includes, ['7 days Kitesurf Lessons', '7 days of Accommodation', 'Full Equipment', 'Rescue boat', 'Insurance']);
});

test('lion: slots = pack x lesson format, per person, no dates', async () => {
  const slots = await lionHostelTarifa.fetchSlots(ctx);
  assert.deepEqual(slots, buildLionSlots(parseLionPacks(packs)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 9);
  const s = (k: string) => slots.find(x => x.key === k)!;
  assert.deepEqual([s('pack-3-days|3p').price, s('pack-3-days|3p').occupancy, s('pack-3-days|3p').packageNights], [199, 3, 3]);
  assert.equal(s('pack-7-days|1p').unit, '7-day kite + accommodation pack, private lessons (min. 1 person, 2 h/day), shared room accommodation');
  assert.ok(slots.every(x => x.currency === 'EUR' && x.priceUnit === 'package' && x.priceBasis === 'person'
    && x.startDate === null && x.availability === 'on_request'));
});

test('lion: rooms and map pin', () => {
  assert.deepEqual(parseLionRooms(lionLines(hostel)).map(r => [r.name, r.description]), [
    ['Dorm for 10', '3 rooms of 10 guests each'],
    ['Room for 4', '2 rooms of 4 guests each, for more privacy (family option)'],
  ]);
  assert.deepEqual(lionCoords(hostel), { lat: 36.014333, lng: -5.603972 });
});

test('lion: content', async () => {
  const c = await lionHostelTarifa.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Lion Hostel Tarifa by Rebels');
  assert.equal(c.region, 'Tarifa town');
  assert.match(c.summary, /packs of 3, 5 or 7 days .* from EUR 199 per person in a shared room/);
  assert.ok(c.includedServices.includes('Free WIFI'));
  assert.ok(!c.includedServices.some(s => /Happy Hours/.test(s)));
  assert.equal(c.imageUrls.length, 21);
  assert.ok(c.imageUrls.every(u => /\.jpe?g$/.test(u)));
});
