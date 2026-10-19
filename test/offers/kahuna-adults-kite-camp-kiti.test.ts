// Kahuna Adults Kitesurf & Surf Camp (Kiti, Larnaca): replays the page recorded 2026-10-19 (trimmed, form token redacted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kahunaAdultsKiteCampKiti, parseKahunaDetails, parseKahunaDates, parseKahunaPrice, buildKahunaSlots, fetchKahunaSlots, parseKahunaContent,
} from '../../src/offers/adapters/kahuna-adults-kite-camp-kiti.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kahuna-adults-kite-camp-kiti');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');

test('kahuna: details, dates, price', () => {
  const d = parseKahunaDetails(html);
  assert.deepEqual(d.DATES, ['11-13.06.2026', '08-10.07.2026']);
  assert.ok(d.INFO.includes('3 Days | 2 Nights'));
  assert.ok(d.INCLUDED.includes('Accommodation'));
  assert.deepEqual(parseKahunaDates(d.DATES).map(c => [c.start, c.end]), [['2026-06-11', '2026-06-13'], ['2026-07-08', '2026-07-10']]);
  assert.deepEqual(parseKahunaDates(['30.06-02.07.2027']).map(c => [c.start, c.end]), [['2027-06-30', '2027-07-02']]);
  assert.deepEqual(parseKahunaPrice(html), { amount: 540, currency: 'EUR' });
});

test('kahuna: slots by pinned today', async () => {
  const d = parseKahunaDetails(html);
  const s = buildKahunaSlots(parseKahunaDates(d.DATES), parseKahunaPrice(html), d.INFO, '2026-07-01');
  assert.deepEqual(checkSlots(s).problems, []);
  assert.deepEqual(s.map(x => [x.key, x.endDate, x.price, x.currency, x.priceUnit, x.priceBasis, x.availability]), [
    ['2026-07-08', '2026-07-10', 540, 'EUR', 'package', 'person', 'on_request'],
  ]);
  assert.deepEqual(await fetchKahunaSlots({ note: () => {}, incomplete: () => {} }, '2026-10-19'), []);
});

test('kahuna: content', async () => {
  const c = parseKahunaContent(html, '2026-10-19');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 3, 'Cyprus', 'Kiti, Larnaca', 'Kiti']);
  assert.deepEqual(c.spotCoords, { lat: 34.8171, lng: 33.5469 });
  assert.match(c.summary, /next dates are not published yet \(2026: 11 June - 13 June, 8 July - 10 July\)/);
  assert.ok(c.imageUrls.length >= 1 && c.imageUrls.every(u => !/redbull|logo/i.test(u)));
  assert.equal((await kahunaAdultsKiteCampKiti.fetchContent({ note: () => {}, incomplete: () => {} })).title, c.title);
});
