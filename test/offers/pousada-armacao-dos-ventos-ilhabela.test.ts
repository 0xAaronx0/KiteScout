// Pousada Armação dos Ventos (Praia da Armação, Ilhabela): replays www.armacaodosventos.com.br (/,
// /bl3-escola-de-iatismo, /suites) recorded 2026-10-12 (Wix; scripts, styles and SVGs trimmed). Content only,
// confidence 'low' (Aaron 2026-10-12: liveness only on the sister site bl3.com.br).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pousadaArmacaoDosVentosIlhabela, avVisiblePrices, parseAvSchool, parseAvSuites,
} from '../../src/offers/adapters/pousada-armacao-dos-ventos-ilhabela.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/pousada-armacao-dos-ventos-ilhabela');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };
const suites = read('www.armacaodosventos.com.br_suites.');

test('armação dos ventos: BL3 school (kitesurf lessons, gear storage) and the three suite types', () => {
  const school = parseAvSchool(read('www.armacaodosventos.com.br_bl3-escola-de-iatismo.'));
  assert.match(school.intro!, /^Sediada em Ilhabela desde 1994.*aulas particulares do básico ao avançado de windsurf, veleiro e kitesurf\.$/);
  assert.ok(school.services.includes('KITE SURF'));
  assert.ok(school.services.includes('GUARDARIA'));
  assert.deepEqual(parseAvSuites(suites).map(s => s.name), ['Suíte Standard', 'Suíte Master', 'Suíte Família']);
  assert.match(parseAvSuites(suites)[2].text, /Acomoda até quatro pessoas/);
});

test('armação dos ventos: no price on the site -> [] (price on request)', async () => {
  assert.deepEqual(avVisiblePrices(suites), []);
  const slots = await pousadaArmacaoDosVentosIlhabela.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
});

test('armação dos ventos: content', async () => {
  const c = await pousadaArmacaoDosVentosIlhabela.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Pousada Armação dos Ventos');
  assert.deepEqual([c.country, c.region, c.spot, c.mealPlan, c.spotCoords], ['Brazil', 'Ilhabela, São Paulo', 'Praia da Armação, Ilhabela', 'breakfast', null]);
  assert.match(c.summary, /guest house of the BL3 Escola de Iatismo \(in Ilhabela since 1994\)/);
  assert.match(c.summary, /teaches kitesurf, windsurf and sailing from beginner to advanced and offers gear storage/);
  assert.match(c.summary, /chalets are let on annual contracts/);
  assert.deepEqual([c.kiteLessons, c.equipmentRental], [true, true]);
  assert.deepEqual(c.rooms.map(r => [r.name, r.features]), [
    ['Suíte Standard', ['Air conditioning', 'Safe']], ['Suíte Master', ['Air conditioning']], ['Suíte Família', ['Air conditioning', 'Up to 4 guests', 'Two bathrooms']],
  ]);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /^https:\/\/static\.wixstatic\.com\/media\/[^/]+~mv2\.(jpe?g|webp|avif)$/.test(u)));
  assert.equal(pousadaArmacaoDosVentosIlhabela.confidence, 'low');
});
