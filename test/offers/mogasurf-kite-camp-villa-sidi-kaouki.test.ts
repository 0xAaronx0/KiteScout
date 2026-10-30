// Mogasurf kite camp at the villa (Sidi Kaouki): replays the EN packs page (booking widget) + the home page, 2026-10-30.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mogasurfKiteCampVillaSidiKaouki, parseMogaWidget, buildMogaSlots, fetchMogaSlots } from '../../src/offers/adapters/mogasurf-kite-camp-villa-sidi-kaouki.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/mogasurf-kite-camp-villa-sidi-kaouki');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const packs = readFileSync(join(DIR, files.find(f => f.startsWith('www.mogasurf.com_en_kitesurf-packages_.'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('moga: widget data (var DATA weeks, rates, rate boundaries, yoga week, includes)', () => {
  const w = parseMogaWidget(packs);
  assert.deepEqual([w.special, w.regular, w.ref, w.lastMinuteBefore, w.regularFrom, w.modified], [750, 890, 890, '2027-02-01', '2027-03-01', '2026-10-29']);
  assert.equal(w.weeks.length, 34);
  assert.deepEqual(w.weeks[0], { start: '2026-11-07', end: '2026-11-14', label: 'Nov 7 → 14', off: false, yoga: false });
  assert.deepEqual(w.weeks.filter(x => x.off).map(x => x.start), ['2026-12-19', '2026-12-26']);
  assert.deepEqual(w.weeks.filter(x => x.yoga).map(x => x.start), ['2027-03-20']);
  assert.equal(w.includes.length, 8);
  assert.match(w.includes[2], /^12h of kitesurf lessons/);
});

test('moga: one slot per kite week, rate by arrival date, off weeks closed, yoga week left out', async () => {
  const slots = await fetchMogaSlots('2026-10-30');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 33);
  assert.deepEqual([slots[0].key, slots[0].endDate, slots[0].price, slots[0].currency, slots[0].priceBasis, slots[0].packageNights, slots[0].availability],
    ['2026-11-07', '2026-11-14', 750, 'EUR', 'person', 7, 'on_request']);
  const byKey = Object.fromEntries(slots.map(s => [s.key, s]));
  assert.equal(byKey['2026-12-19'].availability, 'closed');
  assert.equal(byKey['2026-12-26'].availability, 'closed');
  assert.equal(byKey['2027-03-20'], undefined);
  assert.deepEqual([byKey['2027-01-30'].price, byKey['2027-02-27'].price, byKey['2027-03-06'].price, byKey['2027-06-26'].endDate], [750, 750, 890, '2027-07-03']);
  assert.match(byKey['2027-01-30'].availabilityText!, /^Last-minute rate \(instead of EUR 890\)/);
  assert.match(byKey['2027-02-06'].availabilityText!, /^Special rate \(instead of EUR 890\)/);
  assert.match(byKey['2027-03-06'].availabilityText!, /^Regular rate;/);
  assert.ok(slots.every(s => new Date(`${s.startDate}T12:00:00Z`).getUTCDay() === 6));
});

test('moga: past weeks dropped', () => {
  const w = parseMogaWidget(packs);
  assert.deepEqual(buildMogaSlots(w, '2027-06-10').map(s => s.key), ['2027-06-12', '2027-06-19', '2027-06-26']);
});

test('moga: a page without the widget data parses to nothing', () => {
  const w = parseMogaWidget('<html><script>var MONTHS={};</script></html>');
  assert.deepEqual([w.weeks.length, w.special, w.regularFrom], [0, null, null]);
});

test('moga: content', async () => {
  const c = await mogasurfKiteCampVillaSidiKaouki.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.mealPlan], ['camp', 8, 'Morocco', 'Marrakech-Safi', 'Sidi Kaouki', 'full_board']);
  assert.match(c.summary, /Price per person EUR 750 \(special rate for arrivals before 2027-03-01, regular EUR 890\); weeks published from 2026-11-07 to 2027-06-26/);
  assert.equal(c.includedServices.length, 8);
  assert.ok(c.imageUrls.length >= 5);
});
