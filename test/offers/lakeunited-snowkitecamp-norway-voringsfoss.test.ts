// LakeUnited Snowkitecamp Norway (Vøringsfoss): replays /en/portfolio/snowkitecamp-norway recorded 2026-10-19
// (scripts except JSON-LD, styles and SVGs trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  lakeunitedSnowkitecampNorwayVoringsfoss, parseLunContent, parseLunPrice, parseLunSlots,
} from '../../src/offers/adapters/lakeunited-snowkitecamp-norway-voringsfoss.js';
import { todayIso } from '../../src/offers/parse.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/lakeunited-snowkitecamp-norway-voringsfoss');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith('www.lakeunited.com_en_portfolio_snowkitecamp-norway.'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('lakeunited norway: bestseller price', () => {
  const p = parseLunPrice('Bestseller Snowkite package in a double room € 1.730,- Including overnight stay in a double room, supervision, guiding and GPS tracker, excluding travel, meals and equipment rental After your request');
  assert.equal(p?.amount, 1730);
  assert.equal(p?.currency, 'EUR');
});

test('lakeunited norway: four dated weeks, EUR 1,730 per person in a double room, on request', () => {
  const { slots, weeks, hiddenWeeks } = parseLunSlots(html, '2026-10-19');
  assert.equal(weeks.length, 4);
  assert.deepEqual(hiddenWeeks, []);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.endDate, s.price]), [
    ['2027-02-20', '2027-02-27', 1730],
    ['2027-02-27', '2027-03-06', 1730],
    ['2027-03-06', '2027-03-13', 1730],
    ['2027-03-13', '2027-03-20', 1730],
  ]);
  assert.ok(ok.every(s => s.currency === 'EUR' && s.priceUnit === 'package' && s.priceBasis === 'person'
    && s.availability === 'on_request' && s.availabilityText === 'Send request (non-binding inquiry); Beginners and advanced kiters'));
  // past weeks never become slots
  assert.deepEqual(parseLunSlots(html, '2027-03-01').slots.map(s => s.key), ['2027-03-06', '2027-03-13']);
  assert.deepEqual(parseLunSlots(html, '2027-03-14').slots, []);
});

test('lakeunited norway: adapter slots match the parser for today', async () => {
  assert.deepEqual(await lakeunitedSnowkitecampNorwayVoringsfoss.fetchSlots(ctx), parseLunSlots(html, todayIso()).slots);
});

test('lakeunited norway: content', async () => {
  const c = await lakeunitedSnowkitecampNorwayVoringsfoss.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.spot, 'Vøringsfoss, Hardangervidda');
  assert.equal(c.durationDays, 8);
  assert.equal(c.kiteLessons, false);
  assert.equal(c.mealPlan, 'self_catering');
  assert.deepEqual(c.includedServices, ['7 nights in a cozy mountain hut (double room, electricity costs included)', 'Supervision', 'Guidance', 'GPS Tracker']);
  assert.match(c.summary, /EUR 1,730 in a double room/);
  assert.match(parseLunContent(html, '2026-10-19').summary, /Weeks 2027: 20 February to 27 February, 27 February to 6 March, 6 March to 13 March, 13 March to 20 March/);
  assert.match(parseLunContent(html, '2027-03-14').summary, /published weeks \(2027\) are over/);
  assert.equal(c.bookingUrl, 'https://www.lakeunited.com/en/portfolio/snowkitecamps-request/?snowkitecamp=no');
  assert.ok(c.imageUrls.length >= 20 && c.imageUrls.every(u => u.startsWith('https://www.lakeunited.com/wp-content/uploads/') && !/oesterreich|Podcast/.test(u)));
});
