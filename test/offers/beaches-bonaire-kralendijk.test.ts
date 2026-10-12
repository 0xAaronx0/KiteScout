// BEACHES ocean view apartments (Bonaire): replays the four /en/ pages recorded 2026-10-12 (script/style bodies
// trimmed, the Google Maps API key redacted). Beds24 is not called (it answers "service unavailable" to our UA).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  beachesBonaireKralendijk, buildBchSlots, parseBchKiteTrip, parseBchRates, parseBchSeasons,
} from '../../src/offers/adapters/beaches-bonaire-kralendijk.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { todayIso } from '../../src/offers/parse.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/beaches-bonaire-kralendijk');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const ratesHtml = read('www.beaches-bonaire.com_en_rates_.');

test('beaches: season rates and dated seasons', () => {
  assert.deepEqual(parseBchRates(ratesHtml), { low: 115, high: 125, lastMinute: 103.5, currency: 'USD' });
  assert.deepEqual(parseBchSeasons(ratesHtml), [
    { season: 'low', start: '2025-05-05', end: '2025-10-31' },
    { season: 'low', start: '2026-05-04', end: '2026-10-31' },
    { season: 'high', start: '2025-11-01', end: '2026-05-03' },
    { season: 'high', start: '2026-11-01', end: '2027-05-03' },
  ]);
});

test('beaches: slots = current and future season bands, USD per studio per night', async () => {
  const slots = buildBchSlots(parseBchRates(ratesHtml), parseBchSeasons(ratesHtml), '2026-10-12');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.startDate, s.endDate, s.price]), [
    ['studio|2026-05-04', '2026-05-04', '2026-10-31', 115],
    ['studio|2026-11-01', '2026-11-01', '2027-05-03', 125],
  ]);
  assert.ok(slots.every(s => s.currency === 'USD' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.occupancy === 2 && s.availability === 'unknown'));
  assert.equal(buildBchSlots(parseBchRates(ratesHtml), parseBchSeasons(ratesHtml), '2027-06-01').length, 0);
  assert.deepEqual(await beachesBonaireKralendijk.fetchSlots(ctx), buildBchSlots(parseBchRates(ratesHtml), parseBchSeasons(ratesHtml), todayIso()));
});

test('beaches: kite trip package', () => {
  const trip = parseBchKiteTrip(read('www.beaches-bonaire.com_en_kite-or-dive-trip_.'));
  assert.equal(trip.price, 525);
  assert.equal(trip.basis, 'based on 4 persons');
  assert.ok(trip.includes.includes('10% discount on kite and dive courses'));
  assert.match(trip.season!, /^April - August, mid November - mid December/);
});

test('beaches: content', async () => {
  const c = await beachesBonaireKralendijk.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'BEACHES ocean view apartments');
  assert.equal(c.country, 'Bonaire');
  assert.equal(c.spot, 'Kralendijk');
  assert.equal(c.mealPlan, 'self_catering');
  assert.match(c.summary, /10 studio apartments for 2 persons/);
  assert.match(c.summary, /Atlantis kite beach/);
  assert.match(c.summary, /USD 115 in the low season and USD 125 in the high season/);
  assert.equal(c.rooms.length, 1);
  assert.ok(c.rooms[0].features.includes('Rinse bins'));
  assert.ok(c.optionalServices.some(s => /^Kite trip: .*USD 525 per person/.test(s)));
  assert.ok(c.includedServices.includes('Free airport transportation'));
  assert.ok(c.imageUrls.length >= 8 && c.imageUrls.every(u => /beaches-bonaire\.com\/wp-content\/uploads\//.test(u)));
  assert.ok(!/AIza/.test(files.map(f => readFileSync(join(DIR, f), 'utf8')).join('')));
});
