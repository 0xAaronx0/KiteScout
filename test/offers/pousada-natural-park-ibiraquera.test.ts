// Pousada Natural Park (Ibiraquera, SC): replays pousadanaturalpark.com.br (/, /acomodacoes/, /experiencias/,
// /reservas/) recorded 2026-10-12 (scripts except JSON-LD, styles and SVGs trimmed). Content only, confidence
// 'low' (Aaron 2026-10-12: weak liveness - footer year only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pousadaNaturalParkIbiraquera, npFooterYear, npVisiblePrices, parseNpHouses, parseNpKite,
} from '../../src/offers/adapters/pousada-natural-park-ibiraquera.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/pousada-natural-park-ibiraquera');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };

test('natural park: houses, kite block and the footer year', () => {
  assert.deepEqual(parseNpHouses(read('pousadanaturalpark.com.br_acomodacoes_.')).map(h => h.name), [
    'Casa 01', 'Casa 02', 'Casa 03', 'Casa 04', 'Casa 04 - Anexo', 'Casa 05', 'Casa 06', 'Casa 07', 'Casa 08', 'Casa 09', 'Casa 10', 'Casa 11',
  ]);
  const kite = parseNpKite(read('pousadanaturalpark.com.br_experiencias_.'));
  assert.ok(kite.includes('Aulas de Kitesurf no Mar ou na Lagoa.'));
  assert.ok(kite.some(l => /perfeito para aulas com instrutores profissionais/.test(l)));
  assert.equal(npFooterYear(read('pousadanaturalpark.com.br_.')), 2026);
});

test('natural park: no price on the site -> [] (price on request)', async () => {
  assert.deepEqual(npVisiblePrices(read('pousadanaturalpark.com.br_reservas_.')), []);
  const slots = await pousadaNaturalParkIbiraquera.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
});

test('natural park: content', async () => {
  const c = await pousadaNaturalParkIbiraquera.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Pousada Natural Park');
  assert.deepEqual([c.country, c.region, c.spot, c.mealPlan, c.spotCoords], ['Brazil', 'Ibiraquera, Santa Catarina', 'Ibiraquera', 'self_catering', null]);
  assert.match(c.summary, /rents 12 fully equipped houses on the edge of the Ibiraquera lagoon/);
  assert.match(c.summary, /flat water on the lagoon for lessons with professional instructors/);
  assert.match(c.summary, /publishes no prices/);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.rooms.length, 12);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://pousadanaturalpark.com.br/wp-content/uploads/') && !/logo|thumb-mobile|\.png|-\d+x\d+\./i.test(u)));
  assert.equal(pousadaNaturalParkIbiraquera.confidence, 'low');
});
