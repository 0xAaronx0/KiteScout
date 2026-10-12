// Amagali Pousada (Galinhos, RN): replays amagali.com (/, room.html, passeios.html) + Omnibees fixtures recorded
// 2026-10-12 (HTML trimmed of script/style/svg bodies; calendar JSON verbatim). The Omnibees hotel page uses the
// new layout (parseOmnibeesPageV2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { amagaliPousadaGalinhos, parseAmgKite, parseAmgRooms, parseOmnibeesPageV2, AMG_HOTEL } from '../../src/offers/adapters/amagali-pousada-galinhos.js';
import { buildRoomMonthSlots, buildRunSlots, parseCalendar, parseResults, resultsUrl, sampleStay } from '../../src/offers/engines/omnibees.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/amagali-pousada-galinhos');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const days = [
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_18649_16_2026-10-12')),
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_18649_16_2027-01-01')),
];
const results = (checkIn: string, checkOut: string) => {
  const u = new URL(resultsUrl(AMG_HOTEL, checkIn, checkOut));
  return parseResults(read(`book.omnibees.com${(u.pathname + u.search).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)}`));
};

test('amagali: slots = calendar bands + room x month', () => {
  const yms = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];
  const months = yms.map(ym => {
    const stay = sampleStay(days, ym);
    return { ym, stay, results: stay ? results(stay.checkIn, stay.checkOut) : null };
  });
  assert.deepEqual(months.map(m => m.stay?.checkIn), ['2026-10-13', '2026-11-03', '2026-12-01', '2027-01-11', '2027-02-01', '2027-03-01']);
  const roomNames = [...new Set(months.flatMap(m => (m.results ?? []).map(r => r.room)))];
  assert.deepEqual(roomNames.sort(), ['Charming Chalet (2 Adults)', 'Charming Family Chalet with 2 Bedrooms (4 Adults)', 'Classic Apartment', 'Roof Top Apartment']);
  const slots = [...buildRunSlots(AMG_HOTEL, days), ...buildRoomMonthSlots(AMG_HOTEL, roomNames, days, months)];
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 66);
  assert.equal(slots.filter(s => s.unit === null).length, 42);
  const roof = slots.find(s => s.key === 'roof-top-apartment|2026-10')!;
  assert.deepEqual([roof.price, roof.currency, roof.priceUnit, roof.priceBasis, roof.occupancy, roof.availability, roof.spotsLeft],
    [726.75, 'BRL', 'per_night', 'room', 2, 'limited', 2]);
  assert.equal(slots.find(s => s.key === 'charming-family-chalet-with-2-bedrooms-4-adults|2027-02')!.price, 1410.75);
  assert.equal(slots.find(s => s.key === 'classic-apartment|2026-11')!.availability, 'unknown');
  assert.equal(Math.min(...slots.filter(s => s.price !== null).map(s => s.price!)), 513);
});

test('amagali: live run over the fixtures (2026-10-12 only: the calendar window starts today)', { skip: new Date().toISOString().slice(0, 10) !== '2026-10-12' }, async () => {
  const slots = await amagaliPousadaGalinhos.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 66);
});

test('amagali: new-layout Omnibees page (full room names from the photo alt, pax, map pin)', () => {
  const ob = parseOmnibeesPageV2(read('book.omnibees.com_chain_9872_hotel_18649_lang_en-US'), 18649);
  assert.deepEqual(ob.rooms.map(r => [r.name, r.maxGuests, r.view]), [
    ['Roof Top Apartment', 2, 'River View'], ['Charming Chalet (2 Adults)', 2, 'River View'],
    ['Classic Apartment', 3, 'River View'], ['Charming Family Chalet with 2 Bedrooms (4 Adults)', 4, 'River View'],
  ]);
  assert.deepEqual(ob.coords, { lat: -5.094279874437799, lng: -36.272312924050794 });
  assert.match(ob.description, /^Amagali is a guesthouse/);
  assert.ok(ob.amenities.some(a => a.items.includes("Pool's Bar")));
  assert.match(ob.hours, /Breakfast Hours: From 7:00 AM/);
  assert.ok(ob.photos.every(u => /^https:\/\/media\.omnibees\.com\/Images\/18649\/(Property|RoomTypes)\/\d+\.jpe?g$/.test(u)));
});

test('amagali: kite texts and room texts of the own site', () => {
  const kite = parseAmgKite(read('amagali.com_passeios.html.'), read('amagali.com_.'));
  assert.match(kite.intro!, /^1\. Kitesurf em Galinhos/);
  assert.ok(kite.spot.some(l => /navegar em 4 spots/.test(l)));
  assert.ok(kite.spot.some(l => /de outubro a março.*20 a 30 nós/.test(l)));
  assert.ok(kite.spot.every(l => !/@|^\+\d/.test(l)));
  assert.deepEqual(kite.seasons.map(s => s.months), ['Novembro a março', 'Julho a outubro']);
  assert.deepEqual(parseAmgRooms(read('amagali.com_room.html.')).map(r => r.name), ['Chalé Charme Casal', 'Apartamento Roof Top', 'Apartamento Classic']);
});

test('amagali: content', async () => {
  const c = await amagaliPousadaGalinhos.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Amagali Pousada');
  assert.deepEqual([c.country, c.region, c.spot, c.mealPlan], ['Brazil', 'Galinhos, Rio Grande do Norte', 'Galinhos', 'breakfast']);
  assert.deepEqual(c.spotCoords, { lat: -5.094279874437799, lng: -36.272312924050794 });
  assert.match(c.summary, /18 rooms, opened in 2009/);
  assert.match(c.summary, /4 spots for all levels, best from October to March with 20 to 30 knots/);
  assert.match(c.summary, /names no own kite school/);
  assert.deepEqual(c.rooms.map(r => r.description), [
    '25 m2, river view, in the main building', '30 m2, river view, next to the pool', '30 m2, river view, in the main building',
    'two bedrooms (one king-size bed, two single beds) sharing one bathroom, river view, next to the pool',
  ]);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => !/icon|logo|testimonial|wpp|\.png/i.test(u)));
  assert.deepEqual(amagaliPousadaGalinhos.quote, { engine: 'omnibees', hotelId: 18649, chainId: 9872, currencyId: 16, currency: 'BRL' });
});
