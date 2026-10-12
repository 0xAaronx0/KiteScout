// Oiti Beach Resort (Tutóia, MA): replays www.oitibeachresort.com + Omnibees fixtures recorded 2026-10-12 (HTML
// trimmed of script/style/svg bodies; calendar JSON verbatim). The Omnibees hotel page uses the new layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { oitiBeachResortTutoia, parseOitiKite, OITI_HOTEL } from '../../src/offers/adapters/oiti-beach-resort-tutoia.js';
import { buildRoomMonthSlots, buildRunSlots, parseCalendar, parseResults, resultsUrl, sampleStay } from '../../src/offers/engines/omnibees.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/oiti-beach-resort-tutoia');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const days = [
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_19145_16_2026-10-12')),
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_19145_16_2027-01-01')),
];
const results = (checkIn: string, checkOut: string) => {
  const u = new URL(resultsUrl(OITI_HOTEL, checkIn, checkOut));
  return parseResults(read(`book.omnibees.com${(u.pathname + u.search).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)}`));
};

test('oiti: slots = calendar bands + room x month', () => {
  const yms = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];
  const months = yms.map(ym => {
    const stay = sampleStay(days, ym);
    return { ym, stay, results: stay ? results(stay.checkIn, stay.checkOut) : null };
  });
  assert.deepEqual(months.map(m => m.stay?.checkIn), ['2026-10-19', '2026-11-02', '2026-12-01', '2027-01-04', '2027-02-01', '2027-03-01']);
  const roomNames = [...new Set(months.flatMap(m => (m.results ?? []).map(r => r.room)))];
  assert.equal(roomNames.length, 7);
  const slots = [...buildRunSlots(OITI_HOTEL, days), ...buildRoomMonthSlots(OITI_HOTEL, roomNames, days, months)];
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 136);
  assert.equal(slots.filter(s => s.unit === null).length, 94);
  const sea = slots.find(s => s.key === 'deluxe-double-sea-view|2026-11')!;
  assert.deepEqual([sea.unit, sea.price, sea.currency, sea.priceUnit, sea.priceBasis, sea.occupancy, sea.availability],
    ['Deluxe Double (Sea View)', 519.3, 'BRL', 'per_night', 'room', 2, 'available']);
  const twin = slots.find(s => s.key === 'classic-triple-twin|2026-10')!;
  assert.deepEqual([twin.price, twin.availability, twin.spotsLeft], [419.98, 'limited', 2]);
  assert.equal(Math.min(...slots.filter(s => s.price !== null).map(s => s.price!)), 399);
  assert.equal(slots.find(s => s.price === 399)!.key, 'lowest|2027-03-01');
});

test('oiti: live run over the fixtures (2026-10-12 only: the calendar window starts today)', { skip: new Date().toISOString().slice(0, 10) !== '2026-10-12' }, async () => {
  const slots = await oitiBeachResortTutoia.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 136);
});

test('oiti: Kitesurf Life block (school and shop inside the hotel)', () => {
  const kite = parseOitiKite(read('www.oitibeachresort.com_.'))!;
  assert.equal(kite.title, 'Kitesurf Life - Escola e Loja de Kitesurf');
  assert.deepEqual(kite.services, [
    'Aulas do zero ao avançado', 'Aulas de Downwind', 'Downwinders guiados (Delta, Arpoador, Paulino Neves e Atins)',
    'Aluguel de equipamentos', 'Aluguel supervisionado', 'Supervisão para praticantes independentes',
    'Transfers e suporte local (4x4 e quadriciclos em Tutóia e Arpoador)',
  ]);
  assert.equal(kite.shopSellsGear, true);
  assert.equal(parseOitiKite('<div><p>no kite here</p></div>'), null);
});

test('oiti: content', async () => {
  const c = await oitiBeachResortTutoia.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Oiti Beach Resort Tutóia');
  assert.deepEqual([c.country, c.region, c.spot, c.mealPlan], ['Brazil', 'Tutóia, Maranhão', 'Praia de São José, Tutóia', 'breakfast']);
  assert.deepEqual(c.spotCoords, { lat: -2.7547796, lng: -42.2749507 });
  assert.match(c.summary, /56 apartments on Praia de São José/);
  assert.match(c.summary, /Kitesurf Life kite school and shop is inside the hotel/);
  assert.deepEqual([c.kiteLessons, c.equipmentRental, c.beginnerFriendly], [true, true, true]);
  assert.ok(c.optionalServices.includes('Kitesurf Life: Transfers and local support (4x4 and quad bikes in Tutóia and Arpoador)'));
  assert.equal(c.rooms.length, 9);
  assert.ok(c.rooms.find(r => r.name === 'Deluxe Double (Sea View)')!.features.includes('Sea view'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => !/Artboard|unsplash|pexels|WhatsApp|\.png/i.test(u)));
  assert.deepEqual(oitiBeachResortTutoia.quote, { engine: 'omnibees', hotelId: 19145, chainId: 10117, currencyId: 16, currency: 'BRL' });
});
