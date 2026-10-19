// KiteGeneration Kite Camp EXperience (Punta Trettu): replays camp page, /prices/ and /kiteform/ recorded 2026-10-19 (trimmed).
// The only dated 2026 camp (23.-28.08.) is past on the recording day -> 0 slots; the parser is checked with an earlier today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kitegenerationKiteCampPuntaTrettu, parseKgDates, parseKgPrices, buildKgSlots, fetchKgSlots, parseKgContent, seasonMonths,
} from '../../src/offers/adapters/kitegeneration-kite-camp-punta-trettu.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitegeneration-kite-camp-punta-trettu');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (part: string) => readFileSync(join(DIR, files.find(f => f.includes(part))!), 'utf8');
const pages = { camp: read('kite-camp-sardinia'), prices: read('_prices_'), form: read('kiteform') };

test('kg: dates list, season months, price table', () => {
  const d = parseKgDates(pages.form);
  assert.deepEqual(d.dated.map(x => [x.start, x.end, x.high]), [['2026-08-23', '2026-08-28', true]]);
  assert.equal(d.undated.length, 5);
  assert.equal(d.minParticipants, 4);
  assert.deepEqual(seasonMonths('Low (from September to June)'), [9, 10, 11, 12, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(seasonMonths('High (July and August)'), [7, 8]);
  const rows = parseKgPrices(pages.prices);
  assert.deepEqual(rows.map(r => [r.code, r.nights, r.hours, r.prices.map(p => p.amount)]), [
    ['KCL-5', 5, 15, [1575, 1275, 975]], ['KCH-5', 5, 15, [1775, 1375, 1075]],
  ]);
});

test('kg: slots for a future date use the season row; past dates give []', async () => {
  const d = parseKgDates(pages.form);
  const s = buildKgSlots(d, parseKgPrices(pages.prices), '2026-08-01');
  assert.deepEqual(checkSlots(s).problems, []);
  assert.deepEqual(s.map(x => [x.key, x.price, x.occupancy]), [
    ['kch-5-private-single|2026-08-23', 1775, 1], ['kch-5-private-double|2026-08-23', 1375, 2], ['kch-5-semi-private-double|2026-08-23', 1075, 2],
  ]);
  assert.deepEqual([s[0].currency, s[0].priceUnit, s[0].priceBasis, s[0].availability, s[0].endDate], ['EUR', 'package', 'person', 'on_request', '2026-08-28']);
  const notes: string[] = [];
  assert.deepEqual(await fetchKgSlots({ note: t => notes.push(t), incomplete: () => {} }, '2026-10-19'), []);
  assert.match(notes.join(' '), /past camp date/);
});

test('kg: content', async () => {
  const c = parseKgContent(pages, '2026-10-19');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 6, 'Italy', 'Punta Trettu, Sardinia', 'Punta Trettu']);
  assert.match(c.summary, /EUR 975-1575 in low season .* EUR 1075-1775 in July and August/);
  assert.match(c.summary, /next dates are not published yet \(2026: May, June, July, 23 August - 28 August\)/);
  assert.equal(c.includedServices.length, 5);
  assert.ok(!c.includedServices.join(' ').includes('—'));
  assert.ok(c.imageUrls.length >= 3);
  assert.equal((await kitegenerationKiteCampPuntaTrettu.fetchContent({ note: () => {}, incomplete: () => {} })).title, c.title);
});
