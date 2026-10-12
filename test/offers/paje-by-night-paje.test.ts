// Paje by Night (Zanzibar): replays pajebynight.net pages and the Nightsbridge establishment record + 3 availgrid
// windows recorded 2026-10-12 (HTML fixtures trimmed: script/style bodies dropped; JSON kept as answered).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pajeByNightPaje, buildPbnSlots, decodeCfEmail, kiteOffers, parsePbnEstablishment, parsePbnGrid, pbnGridBody, pbnWindows,
} from '../../src/offers/adapters/paje-by-night-paje.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/paje-by-night-paje');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const TODAY = '2026-10-12';
const est = parsePbnEstablishment(read('www.nightsbridge.com_bridge_api_5.0_establishment_38607.'));
const days = files.filter(f => f.startsWith('www.nightsbridge.com_bridge_api_5.0_availgrid.'))
  .flatMap(f => parsePbnGrid(readFileSync(join(DIR, f), 'utf8')));

test('paje: grid windows = 3 x 62 days from today, body as the Nightsbridge app sends it', () => {
  assert.deepEqual(pbnWindows(TODAY), [
    { start: '2026-10-12', end: '2026-12-12' }, { start: '2026-12-13', end: '2027-02-12' }, { start: '2027-02-13', end: '2027-04-15' },
  ]);
  assert.deepEqual(JSON.parse(pbnGridBody(pbnWindows(TODAY)[0])), {
    bbid: 38607, extbbid: '', clientloginkey: null, startdate: '2026-10-12', enddate: '2026-12-12',
    nightsbridge: true, showroomcount: false, showrates: false, showextras: false,
  });
});

test('paje: establishment record (currency, 7 room types = 19 bungalows, map pin)', () => {
  assert.equal(est.currency, 'USD');
  assert.deepEqual(est.rooms.map(r => [r.id, r.name, r.maxOccupancy, r.roomCount]), [
    [1, 'Family Bungalow', 5, 1], [3, 'Standard Double/Triple', 3, 1], [6, 'Standard Double Bungalow', 2, 6],
    [7, 'Kingsize Double Bungalow', 3, 6], [8, 'Triple Bungalow', 3, 2], [4, 'Quadruple Bungalow', 4, 1], [9, 'Jungle Bungalow', 5, 2],
  ]);
  assert.equal(est.rooms.reduce((n, r) => n + (r.roomCount ?? 0), 0), 19);
  assert.deepEqual([est.lat, est.lng], [-6.268667, 39.535166]);
  assert.ok(est.gallery.length >= 20 && est.gallery.every(u => u.startsWith('https://')));
});

test('paje: grid days per room type (2026-10-12 .. 2027-04-13: the third window answered 60 of 62 days)', () => {
  assert.equal(days.filter(d => d.rtid === 6).length, 184);
  assert.equal(days.filter(d => d.rtid === 6).map(d => d.date).sort().at(-1), '2027-04-13');
  const d = days.find(x => x.rtid === 1 && x.date === '2026-10-12')!;
  assert.deepEqual([d.paxRates, d.roomRate, d.free, d.closed], [[117, 117, 117, 135, 153], 117, 1, false]);
});

test('paje: bands per room type with live availability, USD per room per night for 2 guests', () => {
  const slots = buildPbnSlots(est, days, TODAY);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 137);
  const std = slots.filter(s => s.unit === 'Standard Double Bungalow');
  assert.deepEqual(std.slice(0, 3).map(s => [s.startDate, s.endDate, s.price, s.availability]), [
    ['2026-10-12', '2026-10-12', 72, 'available'], ['2026-10-13', '2026-10-13', null, 'sold_out'], ['2026-10-14', '2026-12-14', 72, 'available'],
  ]);
  const xmas = std.find(s => s.startDate === '2026-12-26')!;
  assert.deepEqual([xmas.endDate, xmas.price, xmas.minNights, xmas.availabilityText], ['2026-12-27', 117, 5, '1 of 6 free per night; Bed & Breakfast per night: 1-2 guests USD 117']);
  const fam = slots.find(s => s.key === 'family-bungalow|2026-10-28')!;
  assert.deepEqual([fam.endDate, fam.price, fam.occupancy, fam.minNights], ['2026-12-14', 117, 2, 3]);
  assert.match(fam.availabilityText ?? '', /1-3 guests USD 117, 4 guests USD 135, 5 guests USD 153/);
  assert.equal(Math.min(...slots.filter(s => s.price !== null).map(s => s.price!)), 60);
  assert.ok(slots.every(s => s.priceBasis === 'room' && (s.price === null || (s.currency === 'USD' && s.priceUnit === 'per_night'))));
});

test('paje: kite school prices and the protected e-mail', () => {
  const kite = readFileSync(join(DIR, files.find(f => f.startsWith('pajebynight.net_paje-by-kite_.'))!), 'utf8');
  const offers = kiteOffers(kite.replace(/<[^>]+>/g, ' '));
  assert.ok(offers.includes('Base course: 6 hrs Private one-on-one kitesurfing lessons $300'));
  assert.ok(offers.includes('Rental (kite, bar, harness, twin-tip): per hour $20 half day $50 full day $80 3 days $200 6 days $330'));
  assert.equal(decodeCfEmail('d3a3b2b9b6b1aabdbab4bba7b1a6bdb4b2bfbca4a093b4beb2babffdb0bcbe'), 'pajebynightbungalows@gmail.com');
});

test('paje: content', async () => {
  const c = await pajeByNightPaje.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Paje by Night');
  assert.equal(c.country, 'Tanzania');
  assert.deepEqual(c.spotCoords, { lat: -6.268667, lng: 39.535166 });
  assert.equal(c.mealPlan, 'breakfast');
  assert.match(c.summary, /19 air-conditioned bungalows/);
  assert.match(c.summary, /Hakuna Matata Kiteschool \(since 2018\)/);
  assert.ok(c.includedServices.includes('Free kite locker (up to availability)'));
  assert.equal(c.rooms.length, 7);
  assert.ok(c.rooms[0].features.includes('37 m²'));
  assert.equal(c.imageUrls.length, 30);
});
