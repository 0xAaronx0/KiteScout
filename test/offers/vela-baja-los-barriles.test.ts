// Vela Baja at Hotel Playa del Sol & Palmas de Cortez (Los Barriles): replays the pages recorded 2026-10-14.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  velaBajaLosBarriles, buildVbSlots, parseVbHotels, parseVbNotes, parseVbSeason, vbBands,
} from '../../src/offers/adapters/vela-baja-los-barriles.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { todayIso } from '../../src/offers/parse.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/vela-baja-los-barriles');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const acc = read('velabaja.com_accommodation_.');
const home = read('velabaja.com_.');

test('vela: two hotels with their rate tables', () => {
  const hotels = parseVbHotels(acc);
  assert.deepEqual(hotels.map(h => [h.name, h.tables.map(t => t.room)]), [
    ['Playa Del Sol', ['Garden Room', 'Poolside Ocean View Room', 'Ocean View Room']],
    ['Palmas de Cortez', ['Cabana Room', 'Garden Room', 'Poolside Room', 'Ocean View Room', 'Condo / Suite / Penthouse']],
  ]);
  assert.deepEqual(hotels[0].tables[0], {
    room: 'Garden Room', beds: '2 double beds', extraPerson: 20,
    rates: [{ unit: 'Garden Room', occupancy: 2, price: 150 }, { unit: 'Garden Room, 1 king bed', occupancy: 2, price: 210 }],
  });
  assert.deepEqual(hotels[1].tables[4].rates.map(r => [r.unit, r.occupancy, r.price]), [
    ['Two Bedroom Condo', 5, 520], ['One Bedroom Master Suite', 2, 300], ['Two Bedroom Presidential Suite', 6, 600],
    ['One Bedroom Deluxe Master Suite', 2, 350], ['Three Bedroom Penthouse', 10, 1000],
  ]);
});

test('vela: season Nov 15 - Mar 15, +USD 20 from 2027-01-01, taxes as a note', () => {
  const notes = parseVbNotes(acc);
  assert.deepEqual(notes, { increase: 20, increaseFrom: '2027-01-01', taxes: 'A 16% sales tax and 4% bed tax will be added to the room rates.' });
  const season = parseVbSeason(home);
  assert.deepEqual(season, { from: [11, 15], to: [3, 15] });
  assert.deepEqual(vbBands(season!, notes), [
    { start: '2026-11-15', end: '2026-12-31', add: 0 },
    { start: '2027-01-01', end: '2027-03-15', add: 20 },
  ]);
});

test('vela: slots = hotel x room x occupancy x band, USD per room per night, on request', async () => {
  const slots = buildVbSlots(parseVbHotels(acc), vbBands(parseVbSeason(home)!, parseVbNotes(acc)), '2026-10-14');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 52);   // 26 units (the repeated "King Garden" kept once) x 2 bands
  const by = (k: string) => ok.find(s => s.key === k)!;
  assert.deepEqual([by('playa-del-sol-garden-room-2p|2026-11-15').price, by('playa-del-sol-garden-room-2p|2027-01-01').price], [150, 170]);
  assert.equal(by('palmas-de-cortez-cabana-room-4p|2026-11-15').occupancy, 4);
  assert.equal(by('palmas-de-cortez-three-bedroom-penthouse-10p|2027-01-01').price, 1020);
  assert.equal(ok.filter(s => /king-garden/.test(s.key)).length, 2);
  assert.ok(ok.every(s => s.currency === 'USD' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.availability === 'on_request'));
  assert.equal(Math.min(...ok.map(s => s.price!)), 150);
  assert.deepEqual(await velaBajaLosBarriles.fetchSlots(ctx),
    buildVbSlots(parseVbHotels(acc), vbBands(parseVbSeason(home)!, parseVbNotes(acc)), todayIso()));
});

test('vela: content', async () => {
  const c = await velaBajaLosBarriles.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.country, 'Mexico');
  assert.equal(c.region, 'Los Barriles, Baja California Sur');
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /open daily from November 15 to March 15/);
  assert.match(c.summary, /from USD 150 per room per night plus 16% sales and 4% bed tax/);
  assert.equal(c.rooms.length, 8);
  assert.ok(c.rooms[0].features.includes('A 16% sales tax and 4% bed tax will be added to the room rates.'));
  assert.ok(c.optionalServices.includes('Palmas de Cortez: 9-hole golf course'));
  assert.ok(c.imageUrls.length >= 20);
  assert.ok(c.imageUrls.every(u => !/logo|velatransfer|socialThumbnail|-\d+x\d+\./i.test(u)));
});
