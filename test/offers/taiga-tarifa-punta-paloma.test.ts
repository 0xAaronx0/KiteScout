// TAIGA Tarifa Punta Paloma: replays the property page, the kite experience page and the 12 Paraty Tech step-1 answers
// recorded 2026-10-12 (pages trimmed like the Valdevaqueros fixtures; engine answers reduced to their JSON-LD block -
// the six answers for October 2026 to March 2027 have none: no tent is offered then). Today is pinned to the
// recording day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  taigaTarifaPuntaPaloma, fetchTaigaPuntaPalomaSlots, tppRules,
} from '../../src/offers/adapters/taiga-tarifa-punta-paloma.js';
import { parseParatyResults, parseTgHotelGeo, parseTgUnits } from '../../src/offers/adapters/taiga-tarifa-valdevaqueros.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/taiga-tarifa-punta-paloma');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (name: string) => readFileSync(join(DIR, name), 'utf8');
const page = read(files.find(f => f.startsWith('www.taigaresorts.com_en_taiga-tarifa-punta-paloma.html.'))!);
const engine = files.filter(f => f.startsWith('www.taigaresorts.com_booking1.')).map(read);
const incomplete: string[] = [];
const ctx = { note: () => {}, incomplete: (r: string) => { incomplete.push(r); } };
const TODAY = '2026-10-12';

test('tpp: engine answers - tents only from April to September 2027', () => {
  const results = engine.map(parseParatyResults);
  assert.equal(results.filter(r => r.rooms.length === 0).length, 6);
  const jun = results.find(r => r.checkIn === '2027-06-12')!;
  assert.equal(jun.namespace, 'q10-teacampa');
  assert.deepEqual(jun.rooms.map(r => r.name), [
    'Glamping Tent Breña', 'Glamping Tent Janda', 'Glamping Tent Algaida', 'Glamping Tent Tamaral',
    'Glamping Tent Premium Sauceda', 'Glamping Tent Premium Cala',
  ]);
  assert.ok(jun.rooms.every(r => tppRules.isRental(r.name)));
});

test('tpp: slots = tent type x month', async () => {
  const slots = await fetchTaigaPuntaPalomaSlots(ctx, TODAY);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 36);
  assert.deepEqual(incomplete, []);
  assert.deepEqual([...new Set(slots.map(s => s.key.split('|')[1]))], ['2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09']);
  const brena = slots.find(s => s.key === 'glamping-tent-brena|2027-06')!;
  assert.deepEqual([brena.startDate, brena.endDate, brena.price, brena.currency, brena.priceUnit, brena.packageNights, brena.availability],
    ['2027-06-01', '2027-06-30', 515, 'EUR', 'package', 7, 'available']);
  assert.equal(brena.availabilityText, '7-night sample stay 12.06.-19.06.2027 for 2 adults: non-refundable rate; flexible rate EUR 583');
  assert.equal(slots.find(s => s.key === 'glamping-tent-premium-cala|2027-08')!.price, 2064);
  assert.equal(Math.min(...slots.map(s => s.price!)), 405); // Breña, April 2027
});

test('tpp: tent cards and the broken JSON-LD geo', () => {
  const units = parseTgUnits(page, 'q10-teacampa');
  assert.equal(units.length, 6);
  const cala = units.find(u => u.name === 'Glamping Tent Premium Cala')!;
  assert.deepEqual([cala.size, cala.capacity], ['45 m2', 'Max. 4 people']);
  assert.ok(cala.images.length > 0 && cala.images.every(u => u.startsWith('https://cdn2.paraty.es/q10-teacampa/images/')));
  assert.equal(parseTgHotelGeo(page), null); // Hotel block says 34.29,-17.41 (Atlantic)
});

test('tpp: content', async () => {
  const c = await taigaTarifaPuntaPaloma.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'TAIGA Tarifa Punta Paloma');
  assert.equal(c.country, 'Spain');
  assert.equal(c.region, 'Valdevaqueros, Tarifa');
  assert.equal(c.spot, 'Punta Paloma');
  assert.equal(c.spotCoords, undefined);
  assert.equal(c.kiteLessons, true);
  assert.deepEqual(c.skillLevels, ['beginner', 'intermediate', 'advanced']);
  assert.match(c.summary, /rents 6 glamping tent types for 2 to 4 guests: 2 premium tents/);
  assert.match(c.summary, /FAV and IKO certified instructors run from the Pata Negra boat/);
  assert.match(c.summary, /pool is open from June to September/);
  assert.deepEqual(c.rooms.map(r => r.name), [
    'Glamping Tent Premium Cala', 'Glamping Tent Premium Sauceda', 'Glamping Tent Algaida', 'Glamping Tent Breña',
    'Glamping Tent Janda', 'Glamping Tent Tamaral',
  ]);
  assert.ok(c.includedServices.includes('Outdoor pool (June to September)'));
  assert.equal(c.imageUrls.length, 40);
});
