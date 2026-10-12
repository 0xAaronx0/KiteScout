// Amigos do Vento Chalés & Kitepoint (Touros, RN): replays amigosdovento.com (/, /sobre/, /contact/) recorded
// 2026-10-12 (scripts, styles and SVGs trimmed). Content only: the site prints no prices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  amigosDoVentoTouros, advReviewDates, advVisiblePrices, parseAdvFacilities, parseAdvFaq,
} from '../../src/offers/adapters/amigos-do-vento-touros.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/amigos-do-vento-touros');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };
const home = read('amigosdovento.com_.');

test('amigos do vento: liveness and kite evidence on the own site', () => {
  assert.deepEqual(advReviewDates(home), ['2023-12-10', '2024-04-03', '2026-01-25', '2026-02-26']);
  const faq = parseAdvFaq(read('amigosdovento.com_contact_.'));
  const kite = faq.find(f => /kitepoint/i.test(f.q))!;
  assert.match(kite.a, /kitepoint estruturado em frente à pousada\. Oferecemos aulas com instrutores/);
  assert.match(faq.find(f => /incluso/.test(f.q))!.a, /café da manhã/);
  assert.deepEqual(parseAdvFacilities(read('amigosdovento.com_sobre_.')), [
    'Chalés completos', 'Acesso a praia', 'Ar-condicionado nos quartos', 'Banheiro privativo', 'Varanda', 'Wi-Fi',
    'Café da manhã', 'Piscina ao ar livre', 'Restaurante no local', 'Kitepoint estruturado',
  ]);
});

test('amigos do vento: no price on the site -> [] (price on request)', async () => {
  assert.deepEqual(advVisiblePrices(home), []);
  const slots = await amigosDoVentoTouros.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
  assert.deepEqual(advVisiblePrices('<div><p>Diária a partir de R$ 450</p></div>'), ['R$ 450']);
});

test('amigos do vento: content', async () => {
  const c = await amigosDoVentoTouros.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Amigos do Vento Chalés & Kitepoint');
  assert.deepEqual([c.country, c.region, c.spot, c.mealPlan, c.spotCoords], ['Brazil', 'Touros, Rio Grande do Norte', 'Touros', 'breakfast', null]);
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /own kitepoint in front of the pousada offers lessons with instructors/);
  assert.match(c.summary, /about 10 months a year/);
  assert.match(c.summary, /publishes no prices/);
  assert.equal(c.imageUrls.length, 26);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://amigosdovento.com/wp-content/uploads/') && !/-\d+x\d+\./.test(u)));
  assert.equal(amigosDoVentoTouros.confidence, 'low');
});
