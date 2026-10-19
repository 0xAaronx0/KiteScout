// Travel Active Club Madagascar kite trip: replays /copy-of-oman-18-26-july-2026 ("Madagascar - June 2026"), 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { travelActiveClubMadagascarKiteTrip, parseTacMadagascarContent, TAC_MADAGASCAR_URL } from '../../src/offers/adapters/travel-active-club-madagascar-kite-trip.js';
import { parseTacTrip, buildTacSlots, fetchTacSlots } from '../../src/offers/adapters/travel-active-club-oman-kite-trip.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/travel-active-club-madagascar-kite-trip');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('tac madagascar: June 2026 departure, two room prices, 9 days (8 nights)', () => {
  const t = parseTacTrip(html);
  assert.deepEqual(t.departures.map(d => [d.start, d.end]), [['2026-06-20', '2026-06-28']]);
  assert.deepEqual([t.days, t.nights], [9, 8]);
  assert.deepEqual(t.prices.map(p => [p.key, p.amount, p.currency, p.room]), [['double', 2190, 'EUR', 'double, shared room'], ['single', 2495, 'EUR', 'single room']]);
});

test('tac madagascar: past -> no slots; before the trip -> one slot per room', async () => {
  assert.deepEqual(await fetchTacSlots(TAC_MADAGASCAR_URL, '2026-10-19'), []);
  const early = buildTacSlots(parseTacTrip(html), '2026-05-01');
  assert.deepEqual(checkSlots(early).problems, []);
  assert.deepEqual(early.map(s => [s.key, s.price, s.occupancy]), [['double|2026-06-20', 2190, 2], ['single|2026-06-20', 2495, 1]]);
});

test('tac madagascar: content', async () => {
  const c = parseTacMadagascarContent(html, '2026-10-19');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.mealPlan], ['tour', 9, 'Madagascar', 'Diana (Diego Suarez)', 'full_board']);
  assert.deepEqual(c.itinerarySpots.map(s => s.name), ['Diego Suarez', 'Sakalava Bay', "Emerald Sea (Mer d'Emeraude), Babaomby"]);
  assert.match(c.summary, /last trip: 20-28 June 2026\)\. Price per person of the last trip \(2026\): EUR 2,190 in double, shared room, EUR 2,495 in single room/);
  assert.ok(c.imageUrls.length >= 5);
  assert.equal(contentProblem(await travelActiveClubMadagascarKiteTrip.fetchContent(ctx)), null);
});
