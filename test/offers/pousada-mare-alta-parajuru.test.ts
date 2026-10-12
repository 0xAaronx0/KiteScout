// Pousada Maré Alta (KBC Parajuru): replays fixtures recorded 2026-10-12 (page without script/style
// bodies; Leão station feed trimmed to the apartment products + one 2-night variant + one kite course;
// availability month checks verbatim).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pousadaMareAltaParajuru, buildMaRunSlots, maMonths, maAvailableUrl, parseMaNights, parseMaPageRooms, parseMaPriceValidity,
  parseMaRoomProducts, parseMaVariation, MA_RESOURCES, type MaCategory, type MaNightState,
} from '../../src/offers/adapters/pousada-mare-alta-parajuru.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/pousada-mare-alta-parajuru');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const page = read('www.kiteboarding-club.com_en_pousada.');
const feed = read('www.myleao.com_api_product_station_4.');
const PARENTS: Record<MaCategory, number> = { 'tarifa-portugal': 13085, 'hindeloopen-brouwersdam': 13343, 'el-gouna': 14977, 'sal-sicily-dakhla': 13790 };
const monthFile = (c: MaCategory, y: number, m: number) => {
  const tail = new URL(maAvailableUrl(PARENTS[c], MA_RESOURCES[c], y, m)).pathname.replace(/[^A-Za-z0-9._-]+/g, '_');
  return read(`www.myleao.com${tail}.`);
};

test('mare-alta: page room table matches the Leão 1-night products', () => {
  const rooms = parseMaPageRooms(page);
  assert.deepEqual(rooms.map(r => [r.category, r.guests, r.rates.length]), [
    ['el-gouna', '3–6 guests', 6], ['hindeloopen-brouwersdam', '1–2 guests', 2], ['tarifa-portugal', '1–3 guests', 3], ['sal-sicily-dakhla', '1–3 guests', 3],
  ]);
  const products = parseMaRoomProducts(feed);
  assert.equal(products.length, 14); // the 2-night variant and the kite course in the trimmed feed are ignored
  for (const r of rooms.flatMap(x => x.rates)) {
    const p = products.find(x => x.parentId === r.productId);
    assert.ok(p, `product ${r.productId} in the feed`);
    assert.ok(Math.abs(p.nightly - r.price) <= 0.5, `${r.guests} ${r.price} vs ${p.nightly}`); // El Gouna 2+1: page 155, engine 154.5
  }
  assert.deepEqual(parseMaPriceValidity(page), { from: '2026-02-01', to: '2027-01-31' });
});

test('mare-alta: 1-night products', () => {
  const p = parseMaRoomProducts(feed);
  assert.deepEqual(p.filter(x => x.category === 'tarifa-portugal').map(x => [x.slug, x.unit, x.adults, x.nightly, x.currency, x.parentId]), [
    ['tarifa-portugal-1p', 'Tarifa / Portugal apartment', 1, 95, 'EUR', 13042],
    ['tarifa-portugal-2p', 'Tarifa / Portugal apartment', 2, 130, 'EUR', 13085],
    ['tarifa-portugal-3p', 'Tarifa / Portugal apartment', 3, 165, 'EUR', 13128],
  ]);
  const kid = p.find(x => x.slug === 'el-gouna-2p1c')!;
  assert.deepEqual([kid.adults, kid.children, kid.nightly, kid.parentId], [2, 1, 154.5, 39572]);
  assert.equal(Math.min(...p.map(x => x.nightly)), 95);
});

test('mare-alta: month checks -> night states', () => {
  const nov = parseMaNights(monthFile('tarifa-portugal', 2026, 11), 2026, 11);
  assert.equal(nov.filter(n => n.state === 'free').length, 8);   // 1-8 Nov free, 9-30 Nov taken
  assert.equal(nov.find(n => n.date === '2026-11-09')!.state, 'taken');
  // Dec: only 2027-01-01 listed (the window's last night) -> the engine error does not make December unknown
  assert.ok(parseMaNights(monthFile('sal-sicily-dakhla', 2026, 12), 2026, 12).every(n => n.state === 'free'));
  assert.ok(parseMaNights(monthFile('el-gouna', 2027, 3), 2027, 3).every(n => n.state === 'free'));
  const bookedOut = '{"data":{"error":"Not available for this time period.","bookedOut":true}}';
  assert.ok(parseMaNights(bookedOut, 2026, 11).every(n => n.state === 'booked_out'));
  // stay variations: <= 14 nights at the 1-night rate, longer stays with the long-stay discount
  assert.deepEqual(parseMaVariation(monthFile('tarifa-portugal', 2026, 11)), { nights: 7, nightly: 130 });
  assert.deepEqual(parseMaVariation(monthFile('sal-sicily-dakhla', 2026, 12)), { nights: 30, nightly: 135 });
});

test('mare-alta: slots = apartment x guests x run of nights', () => {
  const rooms = parseMaRoomProducts(feed);
  const nights: Partial<Record<MaCategory, Array<{ date: string; state: MaNightState }>>> = {};
  const months = maMonths('2026-10-12');
  assert.deepEqual(months.map(m => `${m.year}-${m.month}`), ['2026-10', '2026-11', '2026-12', '2027-1', '2027-2', '2027-3']);
  for (const c of Object.keys(PARENTS) as MaCategory[]) {
    for (const { year, month } of months) (nights[c] ??= []).push(...parseMaNights(monthFile(c, year, month), year, month));
  }
  const slots = buildMaRunSlots(rooms, nights, '2026-10-12');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 94);
  const t = slots.filter(s => s.key.startsWith('tarifa-portugal-2p|'));
  assert.deepEqual(t.map(s => [s.startDate, s.endDate, s.availability]), [
    ['2026-10-12', '2026-10-31', 'limited'], ['2026-11-01', '2026-11-08', 'available'], ['2026-11-09', '2026-11-30', 'limited'],
    ['2026-12-01', '2026-12-30', 'available'], ['2026-12-31', '2027-01-01', 'limited'], ['2027-01-02', '2027-03-31', 'available'],
  ]);
  assert.deepEqual([t[0].unit, t[0].price, t[0].currency, t[0].priceUnit, t[0].priceBasis, t[0].occupancy],
    ['Tarifa / Portugal apartment', 130, 'EUR', 'per_night', 'room', 2]);
  // El Gouna is a single apartment: "taken" = sold out
  const g = slots.find(s => s.key === 'el-gouna-3p|2026-10-12')!;
  assert.deepEqual([g.endDate, g.availability, g.price], ['2026-11-22', 'sold_out', 170]);
  assert.equal(slots.find(s => s.key === 'el-gouna-2p1c|2026-10-12')!.occupancy, 3);
});

test('mare-alta: live run over the fixtures (October 2026 only: the month windows follow today)', { skip: new Date().toISOString().slice(0, 7) !== '2026-10' }, async () => {
  const slots = await pousadaMareAltaParajuru.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.ok(slots.length > 50);
});

test('mare-alta: content', async () => {
  const c = await pousadaMareAltaParajuru.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Pousada Maré Alta');
  assert.deepEqual([c.country, c.region, c.spot, c.mealPlan], ['Brazil', 'Ceará', 'Parajuru', 'breakfast']);
  assert.deepEqual(c.spotCoords, { lat: -4.37862506055142, lng: -37.85485253201058 });
  assert.match(c.summary, /eight ground-floor apartments on the grounds of KBC Parajuru/);
  assert.match(c.summary, /from EUR 95 to 310 per apartment per night/);
  assert.match(c.summary, /trade winds from July to February/);
  assert.deepEqual(c.rooms.map(r => r.name), ['El Gouna two-bedroom apartment', 'Hindeloopen / Brouwersdam apartment', 'Tarifa / Portugal apartment', 'Sal / Sicily / Dakhla apartment']);
  assert.ok(c.rooms[2].features.includes('3 people: EUR 165 per night (breakfast included)'));
  assert.ok(c.rooms[0].features.some(f => /10% discount for more than 30 days/.test(f)));
  assert.ok(c.optionalServices.some(s => /EUR 104$/.test(s)));
  assert.deepEqual(c.languages, ['pt', 'pl', 'en']);
  assert.ok(c.imageUrls.length >= 20);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://www.kiteboarding-club.com/fileadmin/') && !/Plan_|Kontakt|Wedding/.test(u)));
  assert.equal(pousadaMareAltaParajuru.quote?.engine, 'leao');
});
