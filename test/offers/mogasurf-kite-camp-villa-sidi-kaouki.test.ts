// Mogasurf kite camp at the villa (Sidi Kaouki): replays the home page (booking widget) + the EN packs page, 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mogasurfKiteCampVillaSidiKaouki, parseMogaWidget, datedMogaWeeks, buildMogaSlots, fetchMogaSlots } from '../../src/offers/adapters/mogasurf-kite-camp-villa-sidi-kaouki.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/mogasurf-kite-camp-villa-sidi-kaouki');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const home = readFileSync(join(DIR, files.find(f => f.startsWith('www.mogasurf.com_.'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('moga: widget data (prices, weeks, off weeks, regular-rate month)', () => {
  const w = parseMogaWidget(home);
  assert.deepEqual([w.price, w.full, w.promoEnd, w.modified], [750, 890, '2027-03-01', '2026-10-16']);
  assert.equal(w.weeks.length, 21);
  assert.deepEqual(w.buttons, ['nov', 'dec', 'jan']);
  assert.equal(w.weeks.filter(x => x.off).length, 2);
  assert.equal(w.includes.length, 7);
});

test('moga: Saturday weeks across the year end, special vs regular rate', async () => {
  const slots = await fetchMogaSlots('2026-10-19');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 21);
  assert.deepEqual([slots[0].key, slots[0].endDate, slots[0].price, slots[0].priceBasis, slots[0].packageNights], ['2026-11-07', '2026-11-14', 750, 'person', 7]);
  const byKey = Object.fromEntries(slots.map(s => [s.key, s]));
  assert.equal(byKey['2026-12-19'].availability, 'closed');
  assert.equal(byKey['2026-12-26'].availability, 'closed');
  assert.deepEqual([byKey['2027-02-27'].price, byKey['2027-03-06'].price, byKey['2027-03-27'].endDate], [750, 890, '2027-04-03']);
  assert.ok(slots.every(s => new Date(`${s.startDate}T12:00:00Z`).getUTCDay() === 6));
});

test('moga: past weeks dropped; a later season resolves to the next year', () => {
  const w = parseMogaWidget(home);
  assert.deepEqual(buildMogaSlots(w, '2027-03-15').map(s => s.key), ['2027-03-20', '2027-03-27']);
  // same widget republished in autumn 2027: Nov 6 2027 is a Saturday
  const w27 = { ...w, modified: '2027-10-10', weeks: [{ month: 'Nov', label: '6 → 13', off: false, full: false }, { month: 'Jan', label: '1 → 8', off: false, full: false }] };
  assert.deepEqual(datedMogaWeeks(w27, '2027-10-19').map(x => x.start), ['2027-11-06', '2028-01-01']);
});

test('moga: content', async () => {
  const c = await mogasurfKiteCampVillaSidiKaouki.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.mealPlan], ['camp', 8, 'Morocco', 'Marrakech-Safi', 'Sidi Kaouki', 'full_board']);
  assert.match(c.summary, /Price per person EUR 750 \(special rate for stays until the end of February 2027, regular EUR 890\)/);
  assert.ok(c.imageUrls.length >= 5);
});
