// Icarai Kite Village (Icaraí de Amontada): replays the English Wix pages recorded 2026-10-12 (script/style bodies
// trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  icaraiKiteVillageAmontada, ikvLines, ikvVisiblePrices, parseIkvUnits,
} from '../../src/offers/adapters/icarai-kite-village-amontada.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/icarai-kite-village-amontada');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const hub = read('www.icaraikitevillage.com_en_icarai-kite-village.');

test('icarai kite village: six accommodation options on the hub page', () => {
  assert.deepEqual(parseIkvUnits(hub), ['Coco Verde', 'Chill Kite', 'Casa Mandala', 'Pitico', 'Casa Lagoa', 'Chez Tata']);
  assert.deepEqual(ikvVisiblePrices(hub), []);
});

test('icarai kite village: text lines stop before the footer address', () => {
  const lines = ikvLines(read('www.icaraikitevillage.com_en_kite-wing-school.'));
  assert.ok(lines.some(l => /Recent equipment \(2025–2026\)/.test(l)));
  assert.ok(!lines.some(l => /José Alameda|infokitevillage/.test(l)));
});

test('icarai kite village: no published price -> no slots', async () => {
  const notes: string[] = [];
  const slots = await icaraiKiteVillageAmontada.fetchSlots({ note: n => notes.push(n), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
});

test('icarai kite village: content', async () => {
  const c = await icaraiKiteVillageAmontada.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Icarai Kite Village');
  assert.deepEqual([c.country, c.region, c.spot, c.spotCoords], ['Brazil', 'Icaraí de Amontada, Ceará', 'Icaraí de Amontada', null]);
  assert.match(c.summary, /250 m from the beach and about 190 km \(3 hours\) from Fortaleza airport, with its own kitesurf and wing foil school, Chill Kite & Wing\./);
  assert.match(c.summary, /\(Coco Verde, Chill Kite, Casa Mandala, Pitico, Casa Lagoa, Chez Tata\)/);
  assert.match(c.summary, /VHF radio coaching .* \(2025-2026 gear\) .* buggy transport to the spot, 10 minutes along the beach, is included/);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.equal(c.rooms.length, 6);
  assert.ok(c.imageUrls.length >= 15);
  assert.ok(c.imageUrls.every(u => /^https:\/\/static\.wixstatic\.com\/media\/2a45f3_[0-9a-f]+~mv2\.(?:jpe?g|webp)$/.test(u)));
  assert.equal(icaraiKiteVillageAmontada.confidence, 'low');
});
