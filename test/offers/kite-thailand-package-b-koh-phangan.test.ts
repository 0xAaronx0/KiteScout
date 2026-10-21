// Kite Thailand Package B, Koh Phangan: replays the product + location pages recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildKtSlots, parseKtProduct } from '../../src/offers/adapters/kite-thailand-package-b-hua-hin.js';
import { kiteThailandPackageBKohPhangan } from '../../src/offers/adapters/kite-thailand-package-b-koh-phangan.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-thailand-package-b-koh-phangan');
process.env.OFFERS_FIXTURE_DIR = DIR;
const product = readFileSync(join(DIR, readdirSync(DIR).find(f => /_product_package-b-koh-phangan_/.test(f))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('kite thailand koh phangan: three undated slots, 7 nights', () => {
  const p = parseKtProduct(product);
  assert.equal(p.place, 'Koh Phangan');
  const { ok, problems } = checkSlots(buildKtSlots(p));
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => s.price).sort((a, b) => a! - b!), [32500, 50000, 57000]);
  assert.ok(ok.every(s => s.packageNights === 7 && s.currency === 'THB'));
});

test('kite thailand koh phangan: content drops the copied Hua Hin transfer line', async () => {
  const c = await kiteThailandPackageBKohPhangan.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.spot, 'Koh Phangan');
  assert.equal(c.region, 'Surat Thani');
  assert.deepEqual(c.optionalServices, []);
  assert.match(c.sourceText ?? '', /Transfer from BKK airport to Hua Hin/);
  assert.ok(c.imageUrls.includes('https://www.kitethailand.com/wp-content/uploads/2018/06/KOH-PHANGAN.jpg'));
  assert.ok(!/[–—]/.test(c.summary + c.title));
});

test('kite thailand koh phangan: fetchSlots replays', async () => {
  assert.equal(checkSlots(await kiteThailandPackageBKohPhangan.fetchSlots(ctx)).ok.length, 3);
});
