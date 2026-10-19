// Kiteforce Tyrol Kite Trip (snowkite motorhome trip): replays /en/kite-trips/tyrol-kite-trip/ recorded 2026-10-19
// (scripts except JSON-LD, styles and SVGs trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kiteforceTyrolSnowkiteTrip, buildKftSlots, dottedRanges, parseKftContent, parseKftFacts,
} from '../../src/offers/adapters/kiteforce-tyrol-snowkite-trip.js';
import { todayIso } from '../../src/offers/parse.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kiteforce-tyrol-snowkite-trip');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith('kiteforce.cz_en_kite-trips_tyrol-kite-trip_.'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('kiteforce: dotted ranges', () => {
  assert.deepEqual(dottedRanges('DATE: 18.-25.1.2026').map(d => [d.start, d.end]), [['2026-01-18', '2026-01-25']]);
  assert.deepEqual(dottedRanges('DATE: 17.-24.1.2027, 29.1.-5.2.2027; 28.12.-4.1.2027').map(d => [d.start, d.end]), [
    ['2027-01-17', '2027-01-24'], ['2027-01-29', '2027-02-05'], ['2026-12-28', '2027-01-04'],
  ]);
});

test('kiteforce: facts from the trip page', () => {
  const f = parseKftFacts(html);
  assert.equal(f.dateLine, 'DATE: 18.-25.1.2026');
  assert.equal(f.location, 'Reschensee / Bernina / Silvaplana');
  assert.equal(f.price, 19500);
  assert.equal(f.currency, 'CZK');
  assert.equal(f.nights, 5);
  assert.deepEqual(f.courses, [{ days: 1, price: 2500 }, { days: 2, price: 4800 }, { days: 3, price: 6900 }]);
  assert.ok(f.included.includes('5 nights accommodation in a caravan'));
});

test('kiteforce: the only date (January 2026) is past -> no slots; a future window becomes one CZK slot', () => {
  const f = parseKftFacts(html);
  assert.deepEqual(buildKftSlots(f, '2026-10-19'), []);
  const future = { ...f, dates: dottedRanges('DATE: 17.-24.1.2027') };
  const { ok, problems } = checkSlots(buildKftSlots(future, '2026-10-19'));
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.endDate, s.price, s.currency, s.priceBasis, s.packageNights, s.availability]), [
    ['2027-01-17', '2027-01-24', 19500, 'CZK', 'person', 5, 'on_request'],
  ]);
});

test('kiteforce: adapter slots match the builder for today', async () => {
  assert.deepEqual(await kiteforceTyrolSnowkiteTrip.fetchSlots(ctx), buildKftSlots(parseKftFacts(html), todayIso()));
});

test('kiteforce: content (pinned date)', async () => {
  const c = parseKftContent(html, '2026-10-19');
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'tour');
  assert.equal(c.durationDays, 6);
  assert.deepEqual(c.itinerarySpots.map(s => [s.name, s.country]), [
    ['Reschensee', 'Italy'], ['Haidersee', 'Italy'], ['Lago Bianco, Bernina Pass', 'Switzerland'], ['Silvaplana', 'Switzerland'],
  ]);
  assert.match(c.summary, /The trip costs CZK 19,500/);
  assert.match(c.summary, /Runs every winter; 2027 dates not yet published \(2026: 18 January to 25 January 2026\)\./);
  assert.ok(c.optionalServices.includes('Not included: entry to the swimming pool (EUR 6)'));
  assert.equal(c.imageUrls.length, 24);
  assert.ok(c.imageUrls.every(u => /^https:\/\/kiteforce\.cz\/wp-content\/uploads\/2019\/09\/tyrolsko_\d+\.jpg$/.test(u)));
  assert.equal(contentProblem(await kiteforceTyrolSnowkiteTrip.fetchContent(ctx)), null);
});
