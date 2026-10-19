// Freeride Kitesurf Rio Grande do Norte downwind: replays the English route page + the downwind dates page recorded
// 2026-10-19 (scripts / styles trimmed, contact-form nonce redacted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FREERIDE_RGN_URL, RGN_MATCH, freerideKitesurfDownwindRioGrandeDoNorte,
} from '../../src/offers/adapters/freeride-kitesurf-downwind-rio-grande-do-norte.js';
import { fetchFreerideSlots, parseFreerideRoute } from '../../src/offers/adapters/freeride-kitesurf-downwind-wild-north.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/freeride-kitesurf-downwind-rio-grande-do-norte');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const routeHtml = readFileSync(join(DIR, files.find(f => f.includes('rio-grande-norte'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('freeride rgn: route page price and lists', () => {
  const r = parseFreerideRoute(routeHtml, FREERIDE_RGN_URL);
  assert.deepEqual([r.nights, r.days, r.price, r.singleSurchargePct], [10, 11, 1815, 20]);
  assert.equal(r.program.length, 11);
  assert.ok(r.included.includes('Transfer Icapuí - Natal or Fortaleza airport'));
});

test('freeride rgn: one future departure (11-21 Nov 2026), none after it', async () => {
  const slots = await fetchFreerideSlots(FREERIDE_RGN_URL, RGN_MATCH, '2026-10-19');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.endDate, s.price, s.currency, s.priceBasis, s.availability]),
    [['2026-11-11', '2026-11-21', 1815, 'EUR', 'person', 'on_request']]);
  assert.deepEqual(await fetchFreerideSlots(FREERIDE_RGN_URL, RGN_MATCH, '2026-11-12'), []);
});

test('freeride rgn: content', async () => {
  const c = await freerideKitesurfDownwindRioGrandeDoNorte.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.region, c.spot], ['tour', 11, 'São Miguel do Gostoso, Rio Grande do Norte', 'São Miguel do Gostoso']);
  assert.deepEqual(c.itinerarySpots.map(s => s.name), ['São Miguel do Gostoso', 'Galinhos', 'Macau', 'Ponta do Mel', 'Tremembé', 'Icapuí']);
  assert.match(c.summary, /is an 11-day guided downwind trip/);
  assert.ok(c.imageUrls.length >= 8);
});
