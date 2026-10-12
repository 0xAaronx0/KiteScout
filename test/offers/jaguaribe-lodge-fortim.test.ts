// Jaguaribe Lodge & Kite (Fortim): replays own-site + Omnibees fixtures recorded 2026-10-12 (HTML trimmed of
// script/style bodies; calendar JSON verbatim).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  jaguaribeLodgeFortim, JL_HOTEL, decodeTwice, fixOmnibeesUnits, mapsPlacePin, parseJlLodges, parseOmnibeesHotelPage,
} from '../../src/offers/adapters/jaguaribe-lodge-fortim.js';
import {
  buildRoomMonthSlots, buildRunSlots, calendarWindows, parseCalendar, parseResults, resultsUrl, sampleStay,
} from '../../src/offers/engines/omnibees.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import type { Slot } from '../../src/offers/types.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/jaguaribe-lodge-fortim');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const days = [
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_19604_16_2026-10-12')),
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_19604_16_2027-01-01')),
];
const results = (checkIn: string, checkOut: string) => {
  const u = new URL(resultsUrl(JL_HOTEL, checkIn, checkOut));
  return parseResults(read(`book.omnibees.com${(u.pathname + u.search).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)}`));
};
const ROOMS = ['Lodge Vista Piscina', 'Double Room', 'Lodge Família Vista Mar', 'Lodge Família Vista Rio', 'Lodge Família Oceano', 'Lodge Vista Jardim', 'Lodge Vista Mar', 'Lodge Vista Rio'];

test('jaguaribe: calendar windows and days', () => {
  assert.deepEqual(calendarWindows('2026-10-12', 6), [{ from: '2026-10-12', to: '2026-12-31' }, { from: '2027-01-01', to: '2027-03-31' }]);
  assert.equal(days.length, 81 + 90);
  assert.equal(Math.min(...days.filter(d => d.status === 'Open').map(d => d.price!)), 980);
  assert.deepEqual(days.find(d => d.date === '2026-12-30'), { date: '2026-12-30', status: 'Open', price: 3380, minStay: 5, closedArrival: true });
});

test('jaguaribe: sample stays and results (breakfast board, rooms left)', () => {
  assert.deepEqual(sampleStay(days, '2026-11'), { checkIn: '2026-11-02', checkOut: '2026-11-04', nights: 2 });
  const nov = results('2026-11-02', '2026-11-04');
  assert.deepEqual([...new Set(nov.map(r => r.room))], ['Lodge Vista Piscina', 'Double Room', 'Lodge Família Vista Mar', 'Lodge Família Vista Rio', 'Lodge Família Oceano']);
  assert.ok(nov.every(r => r.board === 'Breakfast'));
  assert.ok(nov.some(r => r.room === 'Lodge Vista Piscina' && r.roomsLeftText === 'There are 2 rooms left'));
});

test('jaguaribe: slots = calendar bands + lodge x month (2026-10-12)', () => {
  const yms = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];
  const months = yms.map(ym => {
    const stay = sampleStay(days, ym);
    return { ym, stay, results: stay ? results(stay.checkIn, stay.checkOut) : null };
  });
  const slots: Slot[] = fixOmnibeesUnits([...buildRunSlots(JL_HOTEL, days), ...buildRoomMonthSlots(JL_HOTEL, ROOMS, days, months)]);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 129);
  const pool = slots.find(s => s.key === 'lodge-vista-piscina|2026-11')!;
  assert.deepEqual([pool.unit, pool.price, pool.currency, pool.priceUnit, pool.priceBasis, pool.occupancy, pool.availability, pool.spotsLeft],
    ['Lodge Vista Piscina', 980, 'BRL', 'per_night', 'room', 2, 'limited', 2]);
  assert.equal(slots.find(s => s.key === 'lodge-vista-mar|2027-02')!.price, 1520);
  const nye = slots.find(s => s.key === 'lowest|2026-12-30')!;
  assert.deepEqual([nye.endDate, nye.price, nye.minNights, nye.availabilityText], ['2027-01-02', 3380, 5, 'Omnibees Open; min 5 nights; no arrival on these days']);
  assert.equal(slots.find(s => s.key === 'lowest|2026-10-16')!.availability, 'closed');
});

test('jaguaribe: live run over the fixtures (2026-10-12 only: the calendar window starts today)', { skip: new Date().toISOString().slice(0, 10) !== '2026-10-12' }, async () => {
  const slots = await jaguaribeLodgeFortim.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 129);
});

test('jaguaribe: shared helpers (double-encoded names, map pin)', () => {
  assert.equal(decodeTwice('Ocean &amp; Pool Bungalow'), 'Ocean & Pool Bungalow');
  assert.equal(decodeTwice('Lodge Vista Mar'), 'Lodge Vista Mar');
  const fixed = fixOmnibeesUnits([{ key: 'ocean-amp-pool-bungalow|2026-11', unit: 'Ocean &amp; Pool Bungalow' } as Slot]);
  assert.deepEqual([fixed[0].key, fixed[0].unit], ['ocean-pool-bungalow|2026-11', 'Ocean & Pool Bungalow']);
  assert.deepEqual(mapsPlacePin(read('jaguaribelodge.com_hotel_lang_en.')), { lat: -4.4203648, lng: -37.7689256 });
  const ob = parseOmnibeesHotelPage(read('book.omnibees.com_chain_10325_hotel_19604'), 19604);
  assert.deepEqual(ob.pin, { lat: -4.420352, lng: -37.768936 });
  assert.equal(ob.fromPrice, 'R$ 980.00 /night');
  assert.equal(ob.cards.length, 8);
});

test('jaguaribe: lodge types from the own site (desktop/mobile copies merged, English copy wins)', () => {
  const l = parseJlLodges(read('jaguaribelodge.com_lodges_lang_en.'));
  assert.deepEqual(l.map(x => x.name), ['Ocean Lodge', 'Sea View Lodge', 'Family Lodge', 'Garden View Lodge', 'River View Lodge', 'Pool View Lodge']);
  assert.ok(l.every(x => !/pessoas/.test(x.text)));
  assert.match(l[2].text, /^With 62 m² and an attached suite/);
});

test('jaguaribe: content', async () => {
  const c = await jaguaribeLodgeFortim.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Jaguaribe Lodge & Kite');
  assert.deepEqual([c.country, c.region, c.spot, c.mealPlan], ['Brazil', 'Fortim, Ceará', 'Fortim', 'breakfast']);
  assert.deepEqual(c.spotCoords, { lat: -4.4203648, lng: -37.7689256 });
  assert.match(c.summary, /23 eco-lodges built on stilts .* 130 km from Fortaleza, .* \(8 hectares with 1\.5 km of beach\)/);
  assert.match(c.summary, /The 45 m2 lodges \(62 m2 family lodges with an attached suite\)/);
  assert.match(c.summary, /Jaguaribe Kite center \(10 instructors with fluent English\)/);
  assert.equal(c.rooms.length, 6);
  assert.ok(c.rooms[0].features.includes('Up to 4 guests'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.some(u => u.startsWith('https://media.omnibees.com/Images/19604/')));
  assert.ok(c.imageUrls.every(u => !/logo|Vila-Selvagem|award|\d+x\d+\//i.test(u)));
  assert.match(c.sourceText!, /omnibees rooms: Double Room \(Up to 4 guests, Sea view\); Lodge Vista Mar/);
  assert.deepEqual(jaguaribeLodgeFortim.quote, { engine: 'omnibees', hotelId: 19604, chainId: 10325, currencyId: 16, currency: 'BRL' });
});
