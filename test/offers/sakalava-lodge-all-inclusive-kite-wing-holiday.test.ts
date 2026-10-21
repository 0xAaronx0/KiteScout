// Sakalava Lodge all-inclusive kite & wing holiday: replays the offers + rates pages recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSkcSlots, parseSkcPackages, sakalavaLodgeAllInclusiveKiteWingHoliday, skcImages,
} from '../../src/offers/adapters/sakalava-lodge-all-inclusive-kite-wing-holiday.js';
import { parseSkSeason } from '../../src/offers/adapters/sakalava-lodge-diego-suarez.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/sakalava-lodge-all-inclusive-kite-wing-holiday');
process.env.OFFERS_FIXTURE_DIR = DIR;
const file = (re: RegExp) => readFileSync(join(DIR, readdirSync(DIR).find(f => re.test(f))!), 'utf8');
const offers = file(/nos-offres-all-included/);
const rates = file(/tarifs-sakalava/);
const ctx = { note: () => {}, incomplete: () => {} };

test('sakalava camp: three 2027 packages from the offers page', () => {
  assert.deepEqual(parseSkcPackages(offers).map(p => [p.nights, p.persons, p.amount, p.currency, p.year]), [
    [3, 1, 680, 'EUR', 2027], [7, 1, 1400, 'EUR', 2027], [7, 2, 2400, 'EUR', 2027],
  ]);
});

test('sakalava camp: slots dated to the 2027 season, on request', () => {
  const season = parseSkSeason(rates);
  assert.deepEqual(season, { start: '2027-04-01', end: '2027-11-30', minNights: 3 });
  const { ok, problems } = checkSlots(buildSkcSlots(parseSkcPackages(offers), season, '2026-10-21'));
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.priceBasis, s.occupancy, s.packageNights, s.startDate, s.endDate, s.availability]), [
    ['1p-3n|2027', 680, 'person', 1, 3, '2027-04-01', '2027-11-30', 'on_request'],
    ['1p-7n|2027', 1400, 'person', 1, 7, '2027-04-01', '2027-11-30', 'on_request'],
    ['2p-7n|2027', 2400, 'room', 2, 7, '2027-04-01', '2027-11-30', 'on_request'],
  ]);
});

test('sakalava camp: no season -> undated slots; season over -> no slots', () => {
  const pk = parseSkcPackages(offers);
  assert.ok(buildSkcSlots(pk, null, '2026-10-21').every(s => s.startDate === null && s.price !== null));
  assert.equal(buildSkcSlots(pk, parseSkSeason(rates), '2027-12-01').length, 0);
});

test('sakalava camp: photos without -scaled twins or logos', () => {
  const imgs = skcImages(offers);
  assert.ok(imgs.length >= 6);
  const stems = imgs.map(u => u.replace(/-scaled(?=\.[a-z]+$)/i, ''));
  assert.equal(new Set(stems).size, stems.length);
  assert.ok(!imgs.some(u => /logo|icon|cropped-/i.test(u)));
});

test('sakalava camp: content is a valid camp with the lodge coordinates', async () => {
  const c = await sakalavaLodgeAllInclusiveKiteWingHoliday.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 8);
  assert.equal(c.region, 'Diana (Diego Suarez)');
  assert.deepEqual(c.spotCoords, { lat: -12.27645, lng: 49.39364 });
  assert.match(c.summary, /EUR 1,400 for one week for one person/);
  assert.ok(!/[–—]/.test(c.summary + c.title));
  assert.equal(checkSlots(await sakalavaLodgeAllInclusiveKiteWingHoliday.fetchSlots(ctx)).ok.length, 3);
});
