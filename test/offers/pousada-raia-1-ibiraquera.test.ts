// Pousada Raia 1 (Praia de Ibiraquera, SC): replays www.pousadaraia1.com.br (/, /acomodacoes, /atividades)
// recorded 2026-10-12 (scripts, styles and SVGs trimmed). Content only: the site prints no prices and the HSystem
// booking engine is robots-disallowed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pousadaRaia1Ibiraquera, parseRaiaKite, parseRaiaUnits, raiaLines, raiaVisiblePrices,
} from '../../src/offers/adapters/pousada-raia-1-ibiraquera.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/pousada-raia-1-ibiraquera');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };
const rooms = read('www.pousadaraia1.com.br_acomodacoes.');

test('raia 1: kite evidence (gear storage, kite lessons) and liveness on the own site', () => {
  const home = raiaLines(read('www.pousadaraia1.com.br_.')).join(' ');
  assert.match(home, /Guarderia onde podem deixar seu equipamento de Windsurf, Kitesurf e SUP/);
  assert.match(home, /© 2026/);
  assert.match(parseRaiaKite(read('www.pousadaraia1.com.br_atividades.'))!, /^Praticado tanto no mar como na lagoa, agradando aos iniciantes .* Aulas com Ling/);
});

test('raia 1: the ten units of /acomodacoes', () => {
  const units = parseRaiaUnits(rooms);
  assert.deepEqual(units.map(u => `${u.type} (${u.numbers})`), [
    'SUPER LUXO (1)', 'LUXO (2 OU 3)', 'SUPER LUXO (4)', 'LUXO (5 e 6)', 'STANDARD (8)', 'STANDARD (9)', 'APTO FAMILIA (10)', 'LUXO (7)',
  ]);
  assert.ok(units[0].equipment.includes('Banheira de hidromassagem dupla'));
  assert.ok(units[1].equipment.includes('Cama King-size com roupas de cama e banho')); // repeated lines are kept per unit
  assert.match(units[6].text, /família de até 6 pessoas/);
});

test('raia 1: no price on the site -> [] (price on request)', async () => {
  assert.deepEqual(raiaVisiblePrices(rooms), []);
  const slots = await pousadaRaia1Ibiraquera.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
});

test('raia 1: content', async () => {
  const c = await pousadaRaia1Ibiraquera.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Pousada Raia 1');
  assert.deepEqual([c.country, c.region, c.spot, c.mealPlan, c.spotCoords], ['Brazil', 'Ibiraquera, Santa Catarina', 'Praia de Ibiraquera', 'breakfast', null]);
  assert.match(c.summary, /10 units on Praia de Ibiraquera/);
  assert.match(c.summary, /guarderia\) keeps guests' windsurf, kitesurf and SUP gear/);
  assert.match(c.summary, /publishes no prices/);
  assert.deepEqual(c.rooms.map(r => r.name), [
    'Super Luxo suite (1)', 'Luxo suite (2, 3)', 'Super Luxo suite (4)', 'Luxo suite (5, 6)', 'Standard suite (8)', 'Standard suite (9)', 'Family apartment (10)', 'Luxo suite (7)',
  ]);
  assert.ok(c.rooms[6].features.includes('Up to 6 guests'));
  assert.ok(c.includedServices.includes('Storage for windsurf, kitesurf and SUP gear'));
  assert.equal(c.imageUrls.length, 25);
  assert.ok(c.imageUrls.every(u => /cdn-website\.com\/05334b84\//.test(u) && !/\.png|seo-/.test(u)));
  assert.equal(pousadaRaia1Ibiraquera.confidence, 'low');
});
