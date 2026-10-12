// The Wild House (Tarifa): replays the Matos Tarifa accommodation page and the Kite and Roll Tarifa page recorded
// 2026-10-12 (scripts and styles trimmed). Content only, no price.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wildHouseTarifa, parseKarWildHouse } from '../../src/offers/adapters/wild-house-tarifa.js';
import { matosHighlights, matosImages, matosSection } from '../../src/offers/adapters/matos-apartments-tarifa.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/wild-house-tarifa');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const matos = read('matos-tarifa.com_en_tarifa-guide_accommodation_.');
const kar = read('kiteandrolltarifa.com_en_kitesurfing-tarifa_.');

test('wild-house: Matos section (highlights, photos) and the Kite and Roll mention', () => {
  const sec = matosSection(matos, /Wild House/)!;
  assert.deepEqual(matosHighlights(sec.html), ['Guesthouse accommodating up to 26 guests', 'Wi-Fi / TV', 'Barbecue', 'Washing and storage area for kite equipment.']);
  assert.equal(matosImages(sec.html).length, 8);
  assert.match(parseKarWildHouse(kar)!, /accommodation in our mythical The Wild House/);
});

test('wild-house: no price on either page -> no slots', async () => {
  const slots = await wildHouseTarifa.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
});

test('wild-house: content', async () => {
  const c = await wildHouseTarifa.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'The Wild House');
  assert.equal(c.region, 'Los Lances, Tarifa');
  assert.match(c.summary, /between the kite spots of Los Lances and Valdevaqueros/);
  assert.match(c.summary, /for up to 26 guests/);
  assert.match(c.summary, /Matos Tarifa and Kite and Roll Tarifa/);
  assert.ok(c.includedServices.includes('Washing and storage area for kite equipment.'));
  assert.equal(c.imageUrls.length, 8);
  assert.ok(c.imageUrls.every(u => /matos-tarifa\.com\/wp-content\/uploads\/20(21|22)\//.test(u)));
  assert.equal(wildHouseTarifa.confidence, 'low');
});
