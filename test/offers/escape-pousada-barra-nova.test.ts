// Escape Kiteboarding Pousada (Barra Nova): replays the pages and the availability answer recorded 2026-10-12
// (script/style bodies trimmed, JSON-LD kept).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  escapePousadaBarraNova, buildEpSlots, epAvailUrl, parseEpBookings, parseEpRooms,
} from '../../src/offers/adapters/escape-pousada-barra-nova.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/escape-pousada-barra-nova');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const pousada = read('escape-kiteboarding.com.br_pousada.html.');
const avail = read('escape-disponibilidade.vercel.app_api_disponibilidade_inicio_2026-10-12_fim_2027-04-10.');

test('escape: 12 room cards, 7 suites + 5 family rooms', () => {
  const rooms = parseEpRooms(pousada);
  assert.equal(rooms.length, 12);
  assert.deepEqual(rooms.slice(0, 2).map(r => [r.code, r.name, r.category, r.maxGuests, r.view]),
    [['01', 'FAMÍLIA 1', 'family', 6, 'Lagoa / Mar'], ['02', 'SUÍTE 2', 'suite', 3, 'Lagoa / Mar']]);
  assert.equal(rooms.filter(r => r.category === 'suite').length, 7);
  assert.equal(rooms.filter(r => r.category === 'family').length, 5);
  assert.equal(rooms[0].photo, 'https://escape-kiteboarding.com.br/fotos/qut01.png');
});

test('escape: availability window URL', () => {
  assert.equal(epAvailUrl('2026-10-12'),
    'https://escape-disponibilidade.vercel.app/api/disponibilidade?inicio=2026-10-12&fim=2027-04-10');
});

test('escape: bands of free rooms per category (2026-10-12 answer)', () => {
  const bookings = parseEpBookings(avail);
  assert.equal(bookings.length, 24);
  const slots = buildEpSlots(parseEpRooms(pousada), bookings, '2026-10-12');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 21);
  // whole house booked on the night of 7 Nov 2026
  const full = slots.filter(s => s.startDate === '2026-11-07');
  assert.deepEqual(full.map(s => [s.key, s.endDate, s.availability, s.spotsLeft]),
    [['suite|2026-11-07', '2026-11-07', 'sold_out', 0], ['family|2026-11-07', '2026-11-07', 'sold_out', 0]]);
  const s = slots.find(x => x.key === 'suite|2026-11-20')!;
  assert.deepEqual([s.endDate, s.unit, s.availability, s.spotsLeft, s.availabilityText, s.minNights],
    ['2026-11-21', 'Suite', 'available', 4, '4 of 7 suites free', 2]);
  // checkout night is free again
  assert.equal(slots.find(x => x.key === 'suite|2026-11-22')!.spotsLeft, 7);
  assert.ok(slots.every(x => x.price === null && x.currency === null && x.priceBasis === 'room'));
  assert.equal(slots.at(-1)!.endDate, '2027-04-09');
});

test('escape: limited when 1-2 rooms are free', () => {
  const rooms = parseEpRooms(pousada).filter(r => r.category === 'family');
  const bookings = ['01', '04', '08'].map(room => ({ room, checkin: '2027-01-10', checkout: '2027-01-12' }));
  const slots = buildEpSlots(rooms, bookings, '2027-01-09', 5);
  assert.deepEqual(slots.map(s => [s.startDate, s.endDate, s.availability, s.spotsLeft]), [
    ['2027-01-09', '2027-01-09', 'available', 5],
    ['2027-01-10', '2027-01-11', 'limited', 2],
    ['2027-01-12', '2027-01-13', 'available', 5],
  ]);
});

test('escape: content from the own site', async () => {
  const c = await escapePousadaBarraNova.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Escape Kiteboarding Pousada');
  assert.equal(c.country, 'Brazil');
  assert.equal(c.spot, 'Barra Nova');
  assert.deepEqual(c.spotCoords, { lat: -4.1006, lng: -38.1539 });
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.kiteLessons, false); // FAQ: IKO instructor temporarily unavailable
  assert.equal(c.beginnerFriendly, true);
  assert.match(c.summary, /12 rooms .* since 2009/);
  assert.match(c.summary, /about 800 x 200 m and 1-1\.5 m deep, with 15-25 knots from July to December/);
  const sentences = c.summary.split(/(?<=\.)\s+(?=[A-Z])/);
  assert.ok(sentences.length >= 2 && sentences.length <= 4, `${sentences.length} sentences`);
  assert.deepEqual(c.rooms.map(r => r.name), ['Suite', 'Family room']);
  assert.ok(c.includedServices.includes('Kite gear storage (The Quiver, with air compressor)'));
  assert.ok(c.includedServices.includes('Breakfast'));
  assert.deepEqual(c.languages, ['pt', 'en', 'es', 'de']);
  assert.equal(c.imageUrls[0], 'https://escape-kiteboarding.com.br/og-cover.jpg');
  assert.ok(c.imageUrls.includes('https://escape-kiteboarding.com.br/fotos/qut01.png'));
  assert.ok(c.imageUrls.every(u => u.startsWith('https://escape-kiteboarding.com.br/') && !/logo|favicon/i.test(u)));
  assert.equal(c.sourceUrl, 'https://escape-kiteboarding.com.br/pousada.html');
});
