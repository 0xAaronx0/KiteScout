// Kite Republic Aitutaki Winter Escape 2027: replays the product page recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kiteRepublicAitutakiWinterEscape, parseKrAitutakiSlots, parseKrTour, parseWooVariations, wooCurrency,
} from '../../src/offers/adapters/kite-republic-aitutaki-winter-escape.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-republic-aitutaki-winter-escape');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith('www.kiterepublic.com.au'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('kite republic: WooCommerce variations, currency and tour dates', () => {
  const v = parseWooVariations(html);
  assert.equal(v.length, 4);
  assert.equal(wooCurrency(html), 'AUD');
  const t = parseKrTour(html);
  assert.deepEqual(t.dates.map(d => [d.start, d.end]), [['2027-07-16', '2027-07-29'], ['2027-07-30', '2027-08-12']]);
  assert.equal(t.soldPct.get(1), 30);
  assert.equal(t.soldPct.get(2), 100);
});

test('kite republic aitutaki: one early-bird slot per date, tour 2 sold out, deposit skipped', () => {
  const slots = parseKrAitutakiSlots(html, '2026-10-19');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 2);
  assert.deepEqual(ok.map(s => [s.startDate, s.price, s.currency, s.availability]), [
    ['2027-07-16', 5200, 'AUD', 'available'],
    ['2027-07-30', 5200, 'AUD', 'sold_out'],
  ]);
  for (const s of ok) {
    assert.equal(s.priceUnit, 'package');
    assert.equal(s.priceBasis, 'person');
  }
  assert.match(ok[1].availabilityText!, /regular AUD 5,500/);
});

test('kite republic aitutaki: past dates are dropped', () => {
  assert.equal(parseKrAitutakiSlots(html, '2027-07-20').length, 1);
  assert.equal(parseKrAitutakiSlots(html, '2027-09-01').length, 0);
});

test('kite republic aitutaki: content is a valid camp with Aitutaki photos only', async () => {
  const c = await kiteRepublicAitutakiWinterEscape.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.country, 'Cook Islands');
  assert.equal(c.durationDays, 14);
  assert.equal(c.spotCoords ?? null, null); // no coordinates on the own page
  assert.match(c.summary, /AUD 5,200 per person/);
  assert.match(c.summary, /standard AUD 5,500/);
  assert.ok(!/[–—]/.test(c.summary + c.title));
  assert.ok(c.imageUrls.length >= 10);
  assert.ok(!c.imageUrls.some(u => /Brazil|Mauritius|150x150|\.webp$/i.test(u)), c.imageUrls.join('\n'));
});
