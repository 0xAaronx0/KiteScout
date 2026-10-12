// TAIGA Tarifa Valdevaqueros: replays the property page, the kite school page and the 12 Paraty Tech step-1 answers
// recorded 2026-10-12 (pages: scripts except JSON-LD, styles, SVGs, style attributes and <option> lists trimmed; engine
// answers reduced to their JSON-LD block). Slots are built with today pinned to the recording day, so the sample
// stays (and the POST bodies that name the fixtures) stay the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  taigaTarifaValdevaqueros, buildParatySlots, fetchTaigaValdevaquerosSlots, paratyBody, paratySamples, parseParatyResults,
  parseTgHotelGeo, parseTgPoolSeason, parseTgServices, parseTgUnits, tgLines, tgUnitName, valRules, VAL_SITE_UNITS,
} from '../../src/offers/adapters/taiga-tarifa-valdevaqueros.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/taiga-tarifa-valdevaqueros');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (name: string) => readFileSync(join(DIR, name), 'utf8');
const page = read(files.find(f => f.startsWith('www.taigaresorts.com_en_taiga-tarifa-valdevaqueros.html.'))!);
const engine = files.filter(f => f.startsWith('www.taigaresorts.com_booking1.')).map(read);
const notes: string[] = [];
const incomplete: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: (r: string) => { incomplete.push(r); } };
const TODAY = '2026-10-12';

test('taiga: sample stays and the form body', () => {
  const s = paratySamples(TODAY);
  assert.equal(s.length, 12);
  assert.deepEqual(s[0], { month: '2026-10', checkIn: '2026-10-17', checkOut: '2026-10-24' });
  assert.deepEqual(s[10], { month: '2027-08', checkIn: '2027-08-14', checkOut: '2027-08-21' });
  assert.ok(s.every(x => new Date(`${x.checkIn}T00:00:00Z`).getUTCDay() === 6));
  assert.equal(paratySamples('2026-10-31')[0].month, '2026-11'); // no Saturday left in October after tomorrow
  assert.equal(paratyBody('taiga-valdevaqueros', '2026-11-14', '2026-11-21'),
    'namespace=taiga-valdevaqueros&language=ENGLISH&startDate=14%2F11%2F2026&endDate=21%2F11%2F2026&numRooms=1&adultsRoom1=2&childrenRoom1=0&babiesRoom1=0');
});

test('taiga: engine answer -> units and rate plans', () => {
  const nov = engine.map(parseParatyResults).find(r => r.checkIn === '2026-11-14')!;
  assert.equal(nov.namespace, 'taiga-valdevaqueros');
  assert.equal(nov.checkOut, '2026-11-21');
  assert.equal(nov.rooms.length, 15);
  const b13 = nov.rooms.find(r => r.name === 'Bungalow 1-3')!;
  assert.deepEqual(b13.offers.map(o => [o.price, o.currency, o.inStock]), [[484.2, 'EUR', true], [536.4, 'EUR', true]]);
  assert.match(b13.offers[0].rate, /No Reembolsable/);
  assert.deepEqual(parseParatyResults('<html><body>no units</body></html>').rooms, []);
});

test('taiga: engine names -> site names, rentals only', () => {
  assert.equal(tgUnitName('Bungalow Superior 13', VAL_SITE_UNITS), 'Superior Bungalow 13');
  assert.equal(tgUnitName('Casa Vacacional', VAL_SITE_UNITS), 'Holiday House');
  assert.equal(tgUnitName('Glamping Kala', VAL_SITE_UNITS), 'Glamping Kala');
  assert.ok(valRules.isRental('Tiny Home Duna'));
  assert.ok(!valRules.isRental('Large with Water'));
  assert.ok(!valRules.isRental('Open camping area'));
  const sold = buildParatySlots([{ month: '2027-08', checkIn: '2027-08-14', checkOut: '2027-08-21', result: {
    namespace: 'taiga-valdevaqueros', checkIn: '2027-08-14', checkOut: '2027-08-21',
    rooms: [{ name: 'Bungalow 4', offers: [{ rate: 'Tarifa Flexible', price: 900, currency: 'EUR', inStock: false }] }, { name: 'Medium Sun', offers: [] }],
  } }], valRules);
  assert.deepEqual(sold.map(s => [s.key, s.price, s.availability]), [['bungalow-4|2027-08', null, 'sold_out']]);
});

test('taiga: slots = rental unit x month from the 12 sample weeks', async () => {
  const slots = await fetchTaigaValdevaquerosSlots(ctx, TODAY);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 191);
  assert.deepEqual(incomplete, []);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'package' && s.packageNights === 7 && s.priceBasis === 'room'
    && s.occupancy === 2 && s.availability === 'available' && s.datePrecision === 'month'));
  assert.ok(slots.every(s => !/with water|terrace|median|sun|camping area/i.test(s.unit ?? '')));
  const b13 = slots.find(s => s.key === 'bungalow-1-3|2026-11')!;
  assert.deepEqual([b13.startDate, b13.endDate, b13.unit, b13.price], ['2026-11-01', '2026-11-30', 'Bungalow 1-3', 484.2]);
  assert.equal(b13.availabilityText, '7-night sample stay 14.11.-21.11.2026 for 2 adults: non-refundable rate; flexible rate EUR 536.4');
  assert.equal(slots.find(s => s.key === 'superior-bungalow-13|2027-03')!.price, 511.2);
  assert.equal(slots.find(s => s.key === 'glamping-kala|2027-07')!.price, 579);
  assert.equal(Math.min(...slots.map(s => s.price!)), 239.4); // Glamping Kala, March 2027
  assert.equal(new Set(slots.map(s => s.unit)).size, 19);
  assert.equal(slots.filter(s => s.key.endsWith('|2027-08')).length, 13);
});

test('taiga: unit cards, services, pool season, geo', () => {
  const units = parseTgUnits(page, 'taiga-valdevaqueros');
  assert.equal(units.length, 27); // 19 rental units + 8 pitch types
  const b = units.find(u => u.name === 'Bungalow 1-3')!;
  assert.deepEqual([b.size, b.bedrooms, b.capacity], ['25 m2', '2 rooms', 'Max. 4 people']);
  assert.ok(b.features.includes('Equipped kitchen'));
  assert.equal(b.images.length, 9);
  assert.equal(parseTgServices(page).length, 12);
  assert.equal(parseTgPoolSeason(tgLines(page)), 'June to September');
  assert.equal(parseTgPoolSeason(['Pool hours from 06/01 to 09/30:']), 'June to September');
  assert.deepEqual(parseTgHotelGeo(page), { lat: 36.06933063824887, lng: -5.680341029386476 });
});

test('taiga: content', async () => {
  const c = await taigaTarifaValdevaqueros.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'TAIGA Tarifa Valdevaqueros');
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.country, 'Spain');
  assert.equal(c.region, 'Valdevaqueros, Tarifa');
  assert.equal(c.spot, 'Valdevaqueros');
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /rents 11 bungalow types, 3 tiny homes, 4 glamping tents and a holiday house/);
  assert.match(c.summary, /own kite and wind foil school with equipment rental; a pool \(June to September\)/);
  assert.equal(c.rooms.length, 19);
  assert.deepEqual(c.rooms[0].features.slice(0, 3), ['25 m²', '2 bedroom(s)', 'Max. 4 people']);
  assert.ok(!c.includedServices.some(s => /restaurant|tennis/i.test(s))); // restaurant "Temporarily closed", tennis EUR 4/h
  assert.equal(c.imageUrls.length, 40);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://cdn2.paraty.es/taiga-valdevaqueros/images/')));
  assert.match(c.sourceText ?? '', /We have our own school at Taïga Valdevaqueros/);
});
