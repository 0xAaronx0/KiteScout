// Global Kite Trips Kite Safari Colombia: replays the safari page recorded 2026-10-19 ("March 2027", no days).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globalKiteTripsKiteSafariColombia, buildGktSafariSlots, parseGktColombiaContent, parseGktSafari } from '../../src/offers/adapters/global-kite-trips-kite-safari-colombia.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/global-kite-trips-kite-safari-colombia');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const html = readFileSync(join(DIR, files.find(f => f.startsWith('www.globalkitetrips.com_kite-safari-colombia'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('gkt colombia: month, length, price, route', () => {
  const s = parseGktSafari(html);
  assert.deepEqual([s.month, s.days, s.priceFrom, s.currency, s.sessions.length], [{ year: 2027, month: 3 }, 10, 2500, 'USD', 0]);
  assert.deepEqual(s.route, ['Riohacha', 'Mayapo', 'Cabo de la Vela', 'Punta Gallinas', 'Palomino']);
});

test('gkt colombia: one month-precision slot', () => {
  const slots = buildGktSafariSlots(parseGktSafari(html), '2026-10-19');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(x => [x.key, x.startDate, x.endDate, x.datePrecision, x.price, x.availability]),
    [['2027-03', '2027-03-01', '2027-03-31', 'month', 2500, 'on_request']]);
  assert.deepEqual(buildGktSafariSlots(parseGktSafari(html), '2027-04-01'), []);
});

test('gkt colombia: tour content with route pins', async () => {
  const c = parseGktColombiaContent(html, '2026-10-19');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['tour', 10, 'Colombia', 'La Guajira', 'Riohacha']);
  assert.deepEqual(c.itinerarySpots.map(x => [x.order, x.name]), [[1, 'Riohacha'], [2, 'Mayapo'], [3, 'Cabo de la Vela'], [4, 'Punta Gallinas'], [5, 'Palomino']]);
  assert.match(c.summary, /March 2027 .* from USD 2,500 per person/);
  assert.equal(contentProblem(await globalKiteTripsKiteSafariColombia.fetchContent(ctx)), null);
});
