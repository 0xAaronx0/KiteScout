// Pallas Kiteweek (Kiteschool Lappis): replays /kiteweek/, /portfolio/ and the Lappis Johku shop page recorded 2026-10-19
// (scripts except JSON-LD, styles and SVGs trimmed; the shop's Nuxt state blob dropped, it is not read).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pallasKiteweekLappisPallas, buildPkwSlots, parsePkwContent, parseDotRange, parsePkwPlans,
} from '../../src/offers/adapters/pallas-kiteweek-lappis-pallas.js';
import { todayIso } from '../../src/offers/parse.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/pallas-kiteweek-lappis-pallas');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const kiteweek = read('www.pallaskiteweek.com_kiteweek_.');

test('pallas: dotted date ranges', () => {
  assert.deepEqual(parseDotRange('13.–20.2.2027'), { start: '2027-02-13', end: '2027-02-20' });
  assert.deepEqual(parseDotRange('Between 27.2.–6.3.2027'), { start: '2027-02-27', end: '2027-03-06' });
  assert.deepEqual(parseDotRange('28.12.-4.1.2027'), { start: '2026-12-28', end: '2027-01-04' });
});

test('pallas: price plans', () => {
  const plans = parsePkwPlans(kiteweek);
  assert.deepEqual(plans.map(p => p.title), ['Full Kiteweek (7 nights)', 'Custom duration', 'Inflatable kites', 'Foil kites', 'Other equipment', 'Lessons']);
  assert.deepEqual(plans.slice(0, 2).map(p => [p.title, p.subtitle, p.nights, p.perNight, p.rooms.map(r => [r.occupancy, r.price])]), [
    ['Full Kiteweek (7 nights)', '13.–20.2.2027', 7, false, [[1, 1395], [2, 895], [3, 850], [4, 840]]],
    ['Custom duration', 'Between 13.–20.2.2027', null, true, [[1, 210], [2, 139], [3, 129]]],
  ]);
});

test('pallas: one slot per room type for the dated week, EUR per person, 7 nights; past week = none', () => {
  const plans = parsePkwPlans(kiteweek);
  const { ok, problems } = checkSlots(buildPkwSlots(plans, '2026-10-19'));
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.occupancy]), [
    ['2027-02-13|1p', 1395, 1], ['2027-02-13|2p', 895, 2], ['2027-02-13|3p', 850, 3], ['2027-02-13|4p', 840, 4],
  ]);
  assert.ok(ok.every(s => s.endDate === '2027-02-20' && s.currency === 'EUR' && s.priceUnit === 'package'
    && s.priceBasis === 'person' && s.packageNights === 7 && s.availability === 'unknown'));
  assert.deepEqual(buildPkwSlots(plans, '2027-02-14'), []);
});

test('pallas: adapter slots match the pure builder for today', async () => {
  assert.deepEqual(await pallasKiteweekLappisPallas.fetchSlots(ctx), buildPkwSlots(parsePkwPlans(kiteweek), todayIso()));
});

test('pallas: content', async () => {
  const c = await pallasKiteweekLappisPallas.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.country, 'Finland');
  assert.equal(c.spot, 'Pallastunturi, Lapland');
  assert.equal(c.durationDays, 8);
  assert.equal(c.mealPlan, 'half_board');
  assert.equal(c.beginnerFriendly, true);
  assert.match(c.summary, /from EUR 840 in a shared room to EUR 1,395 in a single room/);
  const pages = { kiteweek, portfolio: read('www.pallaskiteweek.com_portfolio_.'), shop: read('lappis.johku.com_en_US_') };
  assert.match(parsePkwContent(pages, '2026-10-19').summary, /Next week: 13 February 2027 to 20 February 2027/);
  assert.match(parsePkwContent(pages, '2027-02-14').summary, /The 2027 week \(13 February 2027\) is over/);
  assert.ok(c.optionalServices.includes('Shorter stay within the week: 2-person room EUR 139 per person per night'));
  assert.ok(c.optionalServices.includes('Lessons: Full snowkite course including 2 hours of lessons 5 days 550 EUR'));
  assert.ok(c.optionalServices.includes('Inflatable kites: Three kites 450 EUR'));
  assert.equal(c.bookingUrl, 'https://lappis.johku.com/en_US/kurssit/pallas-kite-week');
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://www.pallaskiteweek.com/wp-content/uploads/') && !/og_image/.test(u)));
});
