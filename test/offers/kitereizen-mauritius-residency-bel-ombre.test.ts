// Kitereizen The Mauritius Residency: replays the camp page + store list recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildKrmSlots, kitereizenMauritiusResidencyBelOmbre, krmImages, mergeKrmWeeks, parseKrmPageWeeks, parseKrmPartner,
  parseKrmPrice, parseKrmStoreWeeks,
} from '../../src/offers/adapters/kitereizen-mauritius-residency-bel-ombre.js';
import { krLines } from '../../src/offers/adapters/kitereizen-kite-camp-my-hoa-phan-rang.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitereizen-mauritius-residency-bel-ombre');
process.env.OFFERS_FIXTURE_DIR = DIR;
const file = (re: RegExp) => readFileSync(join(DIR, readdirSync(DIR).find(f => re.test(f))!), 'utf8');
const camp = file(/en_mauritius/);
const store = file(/product-list/);
const ctx = { note: () => {}, incomplete: () => {} };

test('kitereizen mauritius: page dates (year from the header), price and partner price', () => {
  const lines = krLines(camp);
  assert.deepEqual(parseKrmPageWeeks(lines).map(w => [w.start, w.end]), [['2026-09-26', '2026-10-03'], ['2026-10-03', '2026-10-10']]);
  assert.equal(parseKrmPrice(lines), 4950);
  assert.equal(parseKrmPartner(lines), 1295);
});

test('kitereizen mauritius: store section lists the 3-10 Oct week at EUR 4950', () => {
  assert.deepEqual(parseKrmStoreWeeks(store).map(w => [w.start, w.end, w.price]), [['2026-10-03', '2026-10-10', 4950]]);
});

test('kitereizen mauritius: all 2026 weeks are past on 2026-10-21 -> no slots', () => {
  assert.deepEqual(buildKrmSlots(mergeKrmWeeks(camp, store), '2026-10-21'), []);
});

test('kitereizen mauritius: before the weeks, one slot per week (store week available, page-only week on request)', () => {
  const { ok, problems } = checkSlots(buildKrmSlots(mergeKrmWeeks(camp, store), '2026-09-01'));
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.endDate, s.price, s.currency, s.priceBasis, s.packageNights, s.availability]), [
    ['2026-09-26', '2026-10-03', 4950, 'EUR', 'person', 7, 'on_request'],
    ['2026-10-03', '2026-10-10', 4950, 'EUR', 'person', 7, 'available'],
  ]);
});

test('kitereizen mauritius: new 2027 dates on the page are picked up', () => {
  const next = camp.replace(/ 26 sept\. \u2013 03 oct\. \| 03 - 10 oct\./, ' 25 sept. - 02 oct. 2027 | 02 - 09 oct. 2027');
  assert.notEqual(next, camp);
  const slots = buildKrmSlots(mergeKrmWeeks(next, store), '2026-10-21');
  assert.deepEqual(slots.map(s => [s.startDate, s.endDate, s.price]), [['2027-09-25', '2027-10-02', 4950], ['2027-10-02', '2027-10-09', 4950]]);
});

test('kitereizen mauritius: only the Le Morne aerial photo (no coach portraits, no Europe gallery)', () => {
  assert.deepEqual(krmImages(camp), ['https://assets.cdn.filesafe.space/Mo5UIGTDRtGKY7wBLf07/media/69878e892dd9858345c35139.png']);
});

test('kitereizen mauritius: content is a valid camp that says the next dates are not published', async () => {
  const c = await kitereizenMauritiusResidencyBelOmbre.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.country, 'Mauritius');
  assert.equal(c.durationDays, 8);
  assert.match(c.summary, /next dates are not published yet/);
  assert.match(c.summary, /EUR 4,950 per rider/);
  assert.ok(!/[–—]/.test(c.summary + c.title));
  assert.equal((await kitereizenMauritiusResidencyBelOmbre.fetchSlots(ctx)).length, 0);
});
