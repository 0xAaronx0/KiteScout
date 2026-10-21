import { EVERGREEN_PILOT_SUMMARIES } from '../../src/offers/evergreen-pilot-summaries.js';
// KiteMex Kite & Wingfoil Camp (La Ventana Beach Resort, BCS): replays the camp page recorded 2026-10-14.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildKmcSlots, kitemexCampLaVentana, parseKmcCamp } from '../../src/offers/adapters/kitemex-camp-la-ventana.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitemex-camp-la-ventana');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const campHtml = read('kitemex.com_kitesurf-and-wingfoil-camps_.');

test('kitemex camp: header, price, dates', () => {
  const c = parseKmcCamp(campHtml);
  assert.deepEqual([c.nights, c.coachingDays, c.hours, c.price, c.currency, c.perPerson], [6, 5, 15, 2799, 'USD', true]);
  assert.deepEqual(c.weeks.map(w => [w.start, w.end]), [
    ['2026-12-06', '2026-12-12'], ['2027-01-09', '2027-01-15'], ['2027-02-13', '2027-02-19'], ['2027-03-07', '2027-03-13'],
  ]);
  assert.equal(c.availabilityText, 'Limited availability for each camp.');
});

test('kitemex camp: slots per week, past weeks dropped', () => {
  const c = parseKmcCamp(campHtml);
  const slots = buildKmcSlots(c, '2026-10-14');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 4);
  assert.deepEqual(
    [slots[0].key, slots[0].price, slots[0].currency, slots[0].priceUnit, slots[0].priceBasis, slots[0].packageNights, slots[0].availability],
    ['2026-12-06', 2799, 'USD', 'package', 'person', 6, 'on_request'],
  );
  assert.deepEqual(buildKmcSlots(c, '2027-01-20').map(s => s.key), ['2027-02-13', '2027-03-07']);
});

test('kitemex camp: content', async () => {
  const c = await kitemexCampLaVentana.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 7);
  assert.equal(c.region, 'La Ventana, Baja California Sur');
  assert.deepEqual(c.spotCoords, { lat: 24.0467991, lng: -109.9883454 });
  assert.equal(c.summary, EVERGREEN_PILOT_SUMMARIES['kitemex-camp-la-ventana']);
  assert.ok(!/[–—]/.test(c.summary));
  assert.equal(c.mealPlan, 'breakfast and lunch');
  assert.ok(c.imageUrls.length >= 8 && c.imageUrls.every(u => !/removebg|IMAGOTIPO/i.test(u)));
});
