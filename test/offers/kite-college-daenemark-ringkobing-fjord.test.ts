// Kitecollege Dänemark (Ringkøbing Fjord): replays the portfolio page recorded 2026-10-19 (three 2027 weeks, all "Freie Plätze").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kiteCollegeDaenemarkRingkobingFjord, buildKcdSlots, fetchKcdSlots, kcdAvailability, parseKcdContent, parseKcdPrices, parseKcdWeeks,
} from '../../src/offers/adapters/kite-college-daenemark-ringkobing-fjord.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-college-daenemark-ringkobing-fjord');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const html = read('www.kite-college.com_portfolio_kitecollege-daenemark_');

test('kcd: prices and dated weeks with status', () => {
  assert.deepEqual(parseKcdPrices(html), { eventOnly: 890, withStay: 1290 });
  const w = parseKcdWeeks(html);
  assert.deepEqual(w.map(x => [x.start, x.end, x.status, x.statusClass]), [
    ['2027-08-22', '2027-08-27', 'Freie Plätze', 'ampel1green'],
    ['2027-08-29', '2027-09-03', 'Freie Plätze', 'ampel1green'],
    ['2027-09-05', '2027-09-10', 'Freie Plätze', 'ampel1green'],
  ]);
  assert.equal(w[0].requestUrl, 'https://www.kite-college.com/upcoming-events/daenemark-rinkobing-fjord-2027-08-22/');
  assert.deepEqual(['Ausgebucht', 'Wenige Plätze', 'Warteliste', 'Freie Plätze', '?'].map(s => kcdAvailability(s, null)),
    ['sold_out', 'limited', 'waitlist', 'available', 'on_request']);
});

test('kcd: slots per future week, past weeks dropped', async () => {
  const slots = await fetchKcdSlots('2026-10-19', ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => s.key), ['2027-08-22', '2027-08-29', '2027-09-05']);
  const s = slots[0];
  assert.deepEqual([s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.packageNights, s.availability, s.endDate],
    [1290, 'EUR', 'package', 'person', 1, 7, 'available', '2027-08-27']);
  const notes: string[] = [];
  assert.deepEqual(await fetchKcdSlots('2027-09-06', { note: t => notes.push(t) }), []);
  assert.match(notes[0], /all listed weeks are past/);
  assert.equal(buildKcdSlots(parseKcdWeeks(html), parseKcdPrices(html), '2027-08-23').length, 2);
});

test('kcd: content (future weeks, and after the season)', async () => {
  const c = await kiteCollegeDaenemarkRingkobingFjord.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 8, 'Denmark', 'Hvide Sande, West Jutland', 'Hvide Sande']);
  const now = parseKcdContent(html, '2026-10-19');
  assert.match(now.summary, /From EUR 1,290 per person with accommodation .*Weeks 2027: 22 Aug - 27 Aug/);
  const later = parseKcdContent(html, '2027-10-01');
  assert.match(later.summary, /Runs every year in late summer; next dates not yet published \(2027: August and September\)/);
  assert.ok(c.imageUrls.length >= 15);
});
