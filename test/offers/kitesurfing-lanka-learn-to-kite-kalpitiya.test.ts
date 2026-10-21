// Kitesurfing Lanka "Learn to Kite" (7 nights): replays the deal page and /stay/ recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildKslLtkSlots, kitesurfingLankaLearnToKiteKalpitiya, parseKslLtkSeason, parseKslLtkTable,
} from '../../src/offers/adapters/kitesurfing-lanka-learn-to-kite-kalpitiya.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitesurfing-lanka-learn-to-kite-kalpitiya');
process.env.OFFERS_FIXTURE_DIR = DIR;
const deal = readFileSync(join(DIR, 'www.kitesurfinglanka.com_deals_learn-to-kite_.48db6edd.txt'), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('ksl learn to kite: table rows with small-caps EUR prices', () => {
  const rows = parseKslLtkTable(deal);
  assert.deepEqual(rows.map(r => [r.accommodation, r.price, r.currency, r.nights]), [
    ['Deluxe Tent', 545, 'EUR', 7], ['Non-AC Bungalow (shared)', 650, 'EUR', 7], ['AC Bungalow (shared)', 790, 'EUR', 7],
  ]);
  assert.equal(parseKslLtkSeason(deal), '15 May to 15 September and 15 December to 15 March');
});

test('ksl learn to kite: tolerant to a plain "EUR" cell and a new row', () => {
  const html = '<table><tr><th>Nights</th><th>Kite lessons/ hours</th><th>Accommodation Type</th><th>Price</th></tr>'
    + '<tr><td>7 nights / Full board</td><td>9 hours</td><td>Beach Bungalow</td><td>1,050 EUR</td></tr></table>';
  assert.deepEqual(parseKslLtkTable(html).map(r => [r.accommodation, r.price]), [['Beach Bungalow', 1050]]);
});

test('ksl learn to kite: 3 undated package slots, EUR per person, on request', async () => {
  const slots = await kitesurfingLankaLearnToKiteKalpitiya.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 3);
  assert.ok(ok.every(s => s.startDate === null && s.priceUnit === 'package' && s.packageNights === 7 && s.priceBasis === 'person' && s.availability === 'on_request'));
  assert.equal(Math.min(...ok.map(s => s.price!)), 545);
  assert.deepEqual(buildKslLtkSlots([], null), []);
});

test('ksl learn to kite: content is a valid 8-day camp with own photos', async () => {
  const c = await kitesurfingLankaLearnToKiteKalpitiya.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 8);
  assert.equal(c.spot, 'Kandakuliya, Kalpitiya');
  assert.ok(c.imageUrls.length >= 6 && c.imageUrls.length <= 12);
  assert.ok(!c.imageUrls.some(u => /\.svg$|Picture1-1|DSCN0946/i.test(u)), 'icons and the wing / dive deal cards are skipped');
  assert.ok(!/[–—]/.test(c.summary));
});
