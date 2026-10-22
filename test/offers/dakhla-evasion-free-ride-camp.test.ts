import { EVERGREEN_PILOT_SUMMARIES } from '../../src/offers/evergreen-pilot-summaries.js';
// Dakhla Evasion Free Ride & Bien-être camp: replays the offers page + the Logements page recorded 2026-10-19
// (fixtures trimmed: scripts / styles removed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDevSlots, dakhlaEvasionFreeRideCamp, fetchDevSlots, parseDevPage } from '../../src/offers/adapters/dakhla-evasion-free-ride-camp.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/dakhla-evasion-free-ride-camp');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.includes('offres-de-stage'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('dev: three kite offers, validity window, surf pack ignored', () => {
  const p = parseDevPage(html);
  assert.deepEqual([p.validFrom, p.validTo, p.missing], ['2026-11-21', '2027-03-13', []]);
  assert.deepEqual(p.offers.map(o => [o.id, o.price, o.nights, o.hours]), [
    ['free-ride', 1550, 7, 16], ['ride-evolution', 1500, 7, 12], ['freedom-ride', 990, 7, null],
  ]);
});

test('dev: season-band slots, gone after the window', async () => {
  const slots = await fetchDevSlots('2026-10-19', ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => s.key), ['free-ride|2026-11-21', 'ride-evolution|2026-11-21', 'freedom-ride|2026-11-21']);
  const s = slots[0];
  assert.deepEqual([s.startDate, s.endDate, s.price, s.currency, s.priceUnit, s.priceBasis, s.availability, s.datePrecision, s.packageNights],
    ['2026-11-21', '2027-03-13', 1550, 'EUR', 'package', 'person', 'on_request', 'season', 7]);
  assert.equal(buildDevSlots(parseDevPage(html), '2027-03-13').length, 3);
  const notes: string[] = [];
  assert.deepEqual(await fetchDevSlots('2027-03-14', { note: t => notes.push(t) }), []);
  assert.match(notes[0], /has ended/);
});

test('dev: content', async () => {
  const c = await dakhlaEvasionFreeRideCamp.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.mealPlan], ['camp', 8, 'Morocco', 'Dakhla-Oued Ed-Dahab', 'Dakhla Lagoon', 'full_board']);
  assert.equal(c.summary, EVERGREEN_PILOT_SUMMARIES['dakhla-evasion-free-ride-camp']);
  assert.equal(c.imageUrls.length, 26);
  assert.ok(!c.imageUrls.some(u => /logo|\.svg/i.test(u)));
  assert.deepEqual([dakhlaEvasionFreeRideCamp.liveAvailability, dakhlaEvasionFreeRideCamp.instantBooking], [false, undefined]);
});
