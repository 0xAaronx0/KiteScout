// Rancho do Peixe (Preá): replays own-site + Omnibees fixtures recorded 2026-10-12 (HTML trimmed of
// script/style/svg bodies, Google Maps API key redacted; calendar JSON verbatim).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ranchoDoPeixePrea, RP_HOTEL } from '../../src/offers/adapters/rancho-do-peixe-prea.js';
import {
  buildRoomMonthSlots, buildRunSlots, calendarWindows, parseCalendar, parseResults, resultsUrl, sampleStay,
} from '../../src/offers/engines/omnibees.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/rancho-do-peixe-prea');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const days = [
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_3088_16_2026-10-12')),
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_3088_16_2027-01-01')),
];
const results = (checkIn: string, checkOut: string) => {
  const u = new URL(resultsUrl(RP_HOTEL, checkIn, checkOut));
  return parseResults(read(`book.omnibees.com${(u.pathname + u.search).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)}`));
};

test('rancho: calendar windows and days', () => {
  assert.deepEqual(calendarWindows('2026-10-12', 6), [{ from: '2026-10-12', to: '2026-12-31' }, { from: '2027-01-01', to: '2027-03-31' }]);
  assert.equal(days.length, 81 + 90);
  assert.ok(days.filter(d => d.date.startsWith('2027-03')).every(d => d.status === 'Close'));
  assert.equal(Math.min(...days.filter(d => d.status === 'Open').map(d => d.price!)), 990);
});

test('rancho: sample stays and results', () => {
  assert.deepEqual(sampleStay(days, '2026-11'), { checkIn: '2026-11-03', checkOut: '2026-11-04', nights: 1 });
  assert.equal(sampleStay(days, '2027-03'), null);
  const nov = results('2026-11-03', '2026-11-04');
  assert.deepEqual([...new Set(nov.map(r => r.room))], ['Coqueiral bungalo', 'BEACH BUNGALOW']);
  assert.ok(nov.some(r => r.room === 'BEACH BUNGALOW' && r.roomsLeftText === 'There is 1 room left'));
});

test('rancho: slots = calendar bands + bungalow x month', () => {
  const yms = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];
  const months = yms.map(ym => {
    const stay = sampleStay(days, ym);
    return { ym, stay, results: stay ? results(stay.checkIn, stay.checkOut) : null };
  });
  const roomSlots = buildRoomMonthSlots(RP_HOTEL, ['Coqueiral bungalo', 'BEACH BUNGALOW'], days, months);
  const slots = [...buildRunSlots(RP_HOTEL, days), ...roomSlots];
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 45);
  const beachNov = slots.find(s => s.key === 'beach-bungalow|2026-11')!;
  assert.deepEqual([beachNov.unit, beachNov.price, beachNov.currency, beachNov.priceUnit, beachNov.priceBasis, beachNov.occupancy, beachNov.availability, beachNov.spotsLeft],
    ['BEACH BUNGALOW', 2860, 'BRL', 'per_night', 'room', 2, 'limited', 1]);
  assert.equal(slots.find(s => s.key === 'coqueiral-bungalo|2027-02')!.price, 990);
  assert.equal(slots.find(s => s.key === 'coqueiral-bungalo|2027-03')!.availability, 'closed'); // Omnibees "Close" = not selling, not booked up
  const first = slots.find(s => s.key === 'lowest|2026-10-12')!;
  assert.deepEqual([first.price, first.availability], [2860, 'available']);
});

test('rancho: live run over the fixtures (2026-10-12 only: the calendar window starts today)', { skip: new Date().toISOString().slice(0, 10) !== '2026-10-12' }, async () => {
  const slots = await ranchoDoPeixePrea.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 45);
});

test('rancho: content', async () => {
  const c = await ranchoDoPeixePrea.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Rancho do Peixe');
  assert.deepEqual([c.country, c.region, c.spot, c.mealPlan], ['Brazil', 'Ceará', 'Preá', 'breakfast']);
  assert.deepEqual(c.spotCoords, { lat: -2.8202136780718723, lng: -40.407735704291106 });
  assert.match(c.summary, /26 bungalows/);
  assert.match(c.summary, /12 facing the beach, 14 in a coconut grove/);
  assert.match(c.summary, /high season is July to January/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Coqueiral bungalo', 'BEACH BUNGALOW']);
  assert.match(c.rooms[0].description!, /80 m2/);
  assert.ok(c.rooms[1].features.includes('Sea view'));
  assert.match(c.sourceText!, /low season February-June; high season July-January/);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => !/mobile|PB\.|richards|cadastrur|selo|logo/i.test(u)));
  assert.ok(c.imageUrls.some(u => u.startsWith('https://media.omnibees.com/Images/3088/')));
  assert.deepEqual(ranchoDoPeixePrea.quote, { engine: 'omnibees', hotelId: 3088, chainId: 1881, currencyId: 16, currency: 'BRL' });
});
