// Pousada BGK (Barra Grande, Piauí): replays bgk.com.br + Omnibees fixtures recorded 2026-10-12 (HTML
// trimmed of script/style/svg bodies, Google Maps API key redacted; calendar JSON verbatim - the
// Jan-Mar 2027 window was empty: rates loaded only until 2026-12-25).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pousadaBgkBarraGrande, parseBgkSiteRooms, BGK_HOTEL } from '../../src/offers/adapters/pousada-bgk-barra-grande.js';
import { buildRoomMonthSlots, buildRunSlots, parseCalendar, parseResults, resultsUrl, sampleStay } from '../../src/offers/engines/omnibees.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/pousada-bgk-barra-grande');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const days = [
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_17602_16_2026-10-12')),
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_17602_16_2027-01-01')),
];
const results = (checkIn: string, checkOut: string) => {
  const u = new URL(resultsUrl(BGK_HOTEL, checkIn, checkOut));
  return parseResults(read(`book.omnibees.com${(u.pathname + u.search).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)}`));
};

test('bgk: calendar runs until 2026-12-25, nothing loaded for 2027 yet', () => {
  const dates = days.map(d => d.date).sort();
  assert.deepEqual([dates[0], dates[dates.length - 1], dates.length], ['2026-10-12', '2026-12-25', 75]);
  assert.equal(days.filter(d => d.date >= '2027-01-01').length, 0);
  assert.equal(resultsUrl(BGK_HOTEL, '2026-11-02', '2026-11-03'),
    'https://book.omnibees.com/hotelresults?q=17602&c=9431&lang=en-US&currencyId=16&version=4&CheckIn=02112026&CheckOut=03112026&ad=2&ch=0&ag=');
});

test('bgk: slots = calendar bands + room x month', () => {
  const yms = ['2026-10', '2026-11', '2026-12'];
  const months = yms.map(ym => {
    const stay = sampleStay(days, ym);
    return { ym, stay, results: stay ? results(stay.checkIn, stay.checkOut) : null };
  });
  assert.deepEqual(months.map(m => m.stay?.checkIn), ['2026-10-14', '2026-11-02', '2026-12-02']);
  const roomNames = [...new Set(months.flatMap(m => (m.results ?? []).map(r => r.room)))];
  assert.deepEqual(roomNames, ['Standard Masonry Chalet', 'Coqueiral Bungalow', 'Bungalow Essence']);
  const slots = [...buildRunSlots(BGK_HOTEL, days), ...buildRoomMonthSlots(BGK_HOTEL, roomNames, days, months)];
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 58);
  const chalet = slots.find(s => s.key === 'standard-masonry-chalet|2026-12')!;
  assert.deepEqual([chalet.unit, chalet.price, chalet.currency, chalet.priceUnit, chalet.priceBasis, chalet.occupancy, chalet.availability, chalet.spotsLeft],
    ['Standard Masonry Chalet', 650, 'BRL', 'per_night', 'room', 2, 'limited', 1]);
  assert.equal(slots.find(s => s.key === 'bungalow-essence|2026-10')!.price, 1915.2);
  assert.equal(slots.find(s => s.key === 'bungalow-essence|2026-11')!.availability, 'unknown'); // not offered for the sample stay
  assert.equal(Math.min(...slots.filter(s => s.price !== null).map(s => s.price!)), 650);
});

test('bgk: live run over the fixtures (2026-10-12 only: the calendar window starts today)', { skip: new Date().toISOString().slice(0, 10) !== '2026-10-12' }, async () => {
  const slots = await pousadaBgkBarraGrande.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 58);
});

test('bgk: own-site room teasers', () => {
  assert.deepEqual(parseBgkSiteRooms(read('bgk.com.br_.')).map(r => r.title), ['Bangalô Essência', 'Bangalô Frente Mar', 'Bangalô Coqueiral', 'Chalé Standard']);
});

test('bgk: content', async () => {
  const c = await pousadaBgkBarraGrande.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Pousada BGK');
  assert.deepEqual([c.country, c.region, c.spot, c.mealPlan], ['Brazil', 'Piauí', 'Barra Grande', 'breakfast']);
  assert.deepEqual(c.spotCoords, { lat: -2.9088777, lng: -41.410503 });
  assert.match(c.summary, /own kite school/);
  assert.match(c.summary, /accredited by the Brazilian Kite Association \(ABK\)/);
  assert.match(c.summary, /best from August to November/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Standard Masonry Chalet', 'Coqueiral Bungalow', 'Bungalow - Beira-Mar', 'Bungalow Essence']);
  assert.match(c.rooms[3].description!, /jacuzzi/);
  assert.match(c.rooms[0].description!, /^3 masonry chalets/);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => !/logo|avatar|whatsapp|\.png/i.test(u)));
  assert.ok(c.imageUrls.includes('https://media.omnibees.com/Images/17602/Property/1056200.jpg'));
  assert.deepEqual(pousadaBgkBarraGrande.quote, { engine: 'omnibees', hotelId: 17602, chainId: 9431, currencyId: 16, currency: 'BRL' });
});
