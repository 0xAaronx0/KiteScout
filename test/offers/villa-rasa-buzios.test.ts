// Villa Rasa (Praia Rasa, Búzios): replays villarasa.com.br (/home-en/, /experiencias/, /acomodacoes/) + Omnibees
// fixtures recorded 2026-10-12 (HTML trimmed of script/style/svg bodies; calendar JSON verbatim).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { villaRasaBuzios, parseVrRooms, vrCardNames, VR_HOTEL } from '../../src/offers/adapters/villa-rasa-buzios.js';
import { buildRoomMonthSlots, buildRunSlots, parseCalendar, parseResults, resultsUrl, sampleStay } from '../../src/offers/engines/omnibees.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/villa-rasa-buzios');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const days = [
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_21103_16_2026-10-12')),
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_21103_16_2027-01-01')),
];
const results = (checkIn: string, checkOut: string) => {
  const u = new URL(resultsUrl(VR_HOTEL, checkIn, checkOut));
  return parseResults(read(`book.omnibees.com${(u.pathname + u.search).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)}`));
};

test('villa rasa: slots = calendar bands + room x month', () => {
  const yms = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];
  const months = yms.map(ym => {
    const stay = sampleStay(days, ym);
    return { ym, stay, results: stay ? results(stay.checkIn, stay.checkOut) : null };
  });
  assert.deepEqual(months.map(m => m.stay?.checkIn), ['2026-10-18', '2026-11-03', '2026-12-01', '2027-01-24', '2027-02-01', '2027-03-01']);
  const roomNames = [...new Set(months.flatMap(m => (m.results ?? []).map(r => r.room)))];
  assert.equal(roomNames.length, 8);
  const slots = [...buildRunSlots(VR_HOTEL, days), ...buildRoomMonthSlots(VR_HOTEL, roomNames, days, months)];
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 132);
  const std = slots.find(s => s.key === 'standard-apartment-need-to-cross-the-street|2026-10')!;
  assert.deepEqual([std.price, std.currency, std.priceUnit, std.priceBasis, std.occupancy, std.availability, std.spotsLeft],
    [686.94, 'BRL', 'per_night', 'room', 2, 'limited', 2]);
  assert.equal(slots.find(s => s.key === 'villa-suite|2027-01')!.price, 4295.78);
  assert.equal(Math.min(...slots.filter(s => s.price !== null).map(s => s.price!)), 686.94);
});

test('villa rasa: live run over the fixtures (2026-10-12 only: the calendar window starts today)', { skip: new Date().toISOString().slice(0, 10) !== '2026-10-12' }, async () => {
  const slots = await villaRasaBuzios.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 132);
});

test('villa rasa: own-site room facts and full Omnibees card names', () => {
  const rooms = parseVrRooms(read('villarasa.com.br_acomodacoes_.'));
  assert.deepEqual(rooms.map(r => r.name), ['Suíte da Villa', 'Suíte Master', 'Suíte Master com Banheira', 'Suíte Luxo',
    'Apartamento Superior', 'Apartamento Superior com Varanda', 'Suíte Jardim', 'Apartamento Standard']);
  assert.deepEqual([rooms[0].units, rooms[0].size, rooms[0].maxGuests], [1, '90', 3]);
  assert.ok(rooms[0].amenities.includes('Hidro Ofurô'));
  assert.deepEqual([rooms[5].units, rooms[5].size], [10, '25-35']);
  assert.ok(rooms[7].amenities.some(a => /atravessar a rua/.test(a)));
  const names = vrCardNames(read('book.omnibees.com_chain_11108_hotel_21103_lang_en-US'));
  assert.ok(names.includes('Garden Suite - (Need to Cross the Street)'));
  assert.ok(names.every(n => !n.endsWith('...')));
});

test('villa rasa: content', async () => {
  const c = await villaRasaBuzios.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Villa Rasa');
  assert.deepEqual([c.country, c.region, c.spot, c.mealPlan], ['Brazil', 'Búzios, Rio de Janeiro', 'Praia Rasa', 'breakfast']);
  assert.deepEqual(c.spotCoords, { lat: -22.7607688, lng: -41.9412575 });
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /with 35 apartments and suites/);
  assert.match(c.summary, /Surf, kitesurf and wing foil lessons are booked directly at the reception/);
  assert.match(c.sourceText!, /KITESURF E WING FOIL|Kitesurf e Wing Foil/);
  assert.equal(c.rooms.length, 8);
  assert.equal(c.rooms.find(r => r.name === 'Villa Suite')!.description, '1 unit, 90 m2, up to 3 guests');
  assert.ok(c.rooms.find(r => r.name === 'Villa Suite')!.features.includes('Hot tub'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => !/selos|popup|logo|-\d+x\d+\./i.test(u)));
  assert.deepEqual(villaRasaBuzios.quote, { engine: 'omnibees', hotelId: 21103, chainId: 11108, currencyId: 16, currency: 'BRL' });
});
