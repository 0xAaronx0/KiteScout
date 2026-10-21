// Kite Thailand Package A, Pranburi: replays the product + location pages recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildKtSlots, parseKtProduct } from '../../src/offers/adapters/kite-thailand-package-b-hua-hin.js';
import { kiteThailandPackageAPranburi } from '../../src/offers/adapters/kite-thailand-package-a-pranburi.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-thailand-package-a-pranburi');
process.env.OFFERS_FIXTURE_DIR = DIR;
const product = readFileSync(join(DIR, readdirSync(DIR).find(f => /_product_package-a-pranburi_/.test(f))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('kite thailand pranburi: one 2-4 star variation, 5 nights, THB 29,000 (shop, not the location page 26,500)', () => {
  const p = parseKtProduct(product);
  assert.equal(p.place, 'Pranburi');
  assert.equal(p.nights, 5);
  assert.equal(p.lessonDays, 3);
  const { ok, problems } = checkSlots(buildKtSlots(p));
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.unit, s.price, s.currency, s.packageNights, s.availability]), [
    ['2-4 star accommodation', 29000, 'THB', 5, 'available'],
  ]);
});

test('kite thailand pranburi: content is a valid camp at Pak Nam Pran', async () => {
  const c = await kiteThailandPackageAPranburi.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 6);
  assert.equal(c.region, 'Prachuap Khiri Khan');
  assert.equal(c.spot, 'Pak Nam Pran, Pranburi');
  assert.match(c.summary, /It costs THB 29,000 with 2-4 star accommodation/);
  assert.match(c.sourceText ?? '', /26,500/); // the location page's older table is kept for audits
  assert.ok(c.imageUrls.length >= 3);
  assert.ok(!/[–—]/.test(c.summary + c.title));
});

test('kite thailand pranburi: fetchSlots replays', async () => {
  assert.equal(checkSlots(await kiteThailandPackageAPranburi.fetchSlots(ctx)).ok.length, 1);
});
