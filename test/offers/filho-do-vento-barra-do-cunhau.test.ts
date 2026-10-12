// Filho do Vento Kite Lodge (Barra do Cunhaú, RN): replays filhodovento.com.br + Omnibees fixtures recorded
// 2026-10-12 (HTML trimmed of script/style/svg bodies; calendar JSON verbatim).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { filhoDoVentoBarraDoCunhau, parseFdvRooms, FDV_HOTEL } from '../../src/offers/adapters/filho-do-vento-barra-do-cunhau.js';
import { buildRoomMonthSlots, buildRunSlots, parseCalendar, parseResults, resultsUrl, sampleStay } from '../../src/offers/engines/omnibees.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/filho-do-vento-barra-do-cunhau');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const days = [
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_18650_16_2026-10-12')),
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_18650_16_2027-01-01')),
];
const results = (checkIn: string, checkOut: string) => {
  const u = new URL(resultsUrl(FDV_HOTEL, checkIn, checkOut));
  return parseResults(read(`book.omnibees.com${(u.pathname + u.search).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)}`));
};

test('fdv: calendar covers 2026-10-12..2027-03-31', () => {
  const dates = days.map(d => d.date).sort();
  assert.deepEqual([dates[0], dates[dates.length - 1]], ['2026-10-12', '2027-03-31']);
  assert.equal(resultsUrl(FDV_HOTEL, '2026-11-02', '2026-11-03'),
    'https://book.omnibees.com/hotelresults?q=18650&c=9873&lang=en-US&currencyId=16&version=4&CheckIn=02112026&CheckOut=03112026&ad=2&ch=0&ag=');
});

test('fdv: slots = calendar bands + room x month', () => {
  const yms = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];
  const months = yms.map(ym => {
    const stay = sampleStay(days, ym);
    return { ym, stay, results: stay ? results(stay.checkIn, stay.checkOut) : null };
  });
  assert.deepEqual(months.map(m => m.stay?.checkIn), ['2026-10-16', '2026-11-02', '2026-12-09', '2027-01-03', '2027-02-10', '2027-03-01']);
  const roomNames = [...new Set(months.flatMap(m => (m.results ?? []).map(r => r.room)))];
  assert.deepEqual(roomNames.sort(), ['Adapted Deluxe Apartment', 'Deluxe Ground Floor Apartment', 'Superior Deluxe Apartment']);
  const slots = [...buildRunSlots(FDV_HOTEL, days), ...buildRoomMonthSlots(FDV_HOTEL, roomNames, days, months)];
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 82);
  const sup = slots.find(s => s.key === 'superior-deluxe-apartment|2027-01')!;
  assert.deepEqual([sup.price, sup.currency, sup.priceUnit, sup.priceBasis, sup.occupancy, sup.availability], [1383.3, 'BRL', 'per_night', 'room', 2, 'available']);
  const adapted = slots.find(s => s.key === 'adapted-deluxe-apartment|2026-10')!;
  assert.deepEqual([adapted.price, adapted.availability, adapted.spotsLeft], [837.16, 'limited', 1]);
  assert.equal(slots.find(s => s.key === 'lowest|2026-10-15')!.availability, 'closed');
  assert.equal(slots.find(s => s.key === 'lowest|2026-10-16')!.minNights, 2);
  assert.equal(Math.min(...slots.filter(s => s.price !== null).map(s => s.price!)), 591.68);
});

test('fdv: live run over the fixtures (2026-10-12 only: the calendar window starts today)', { skip: new Date().toISOString().slice(0, 10) !== '2026-10-12' }, async () => {
  const slots = await filhoDoVentoBarraDoCunhau.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 82);
});

test('fdv: own-site room texts', () => {
  const rooms = parseFdvRooms(read('filhodovento.com.br_en_rooms.'));
  assert.deepEqual(rooms.map(r => r.name), ['Superior Deluxe Room', 'Deluxe Room', 'Accessible Double Room']);
  assert.match(rooms[0].text, /with 55 sqm/);
  assert.match(rooms[1].text, /^Our Deluxe Room is perfect/);
});

test('fdv: content', async () => {
  const c = await filhoDoVentoBarraDoCunhau.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Filho do Vento Kite Lodge');
  assert.deepEqual([c.country, c.region, c.spot, c.mealPlan], ['Brazil', 'Barra do Cunhaú, Rio Grande do Norte', 'Barra do Cunhaú', 'breakfast']);
  assert.deepEqual(c.spotCoords, { lat: -6.3093039, lng: -35.0364258 });
  assert.match(c.summary, /14 rooms in Barra do Cunhaú/);
  assert.match(c.summary, /Kitmaster School teaches kitesurfing; wing foiling, downwinders/);
  assert.equal(c.kiteLessons, true);
  assert.deepEqual(c.rooms.map(r => r.name), ['Superior Deluxe Apartment', 'Adapted Deluxe Apartment', 'Deluxe Ground Floor Apartment']);
  assert.match(c.rooms[2].description!, /^Our Deluxe Room is perfect/);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => !/\.png|logo/i.test(u)));
  assert.ok(c.imageUrls.includes('https://media.omnibees.com/Images/18650/Property/1395506.jpg'));
  assert.deepEqual(filhoDoVentoBarraDoCunhau.quote, { engine: 'omnibees', hotelId: 18650, chainId: 9873, currencyId: 16, currency: 'BRL' });
});
