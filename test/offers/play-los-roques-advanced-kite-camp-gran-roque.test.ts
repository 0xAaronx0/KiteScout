// Play Los Roques ADVANCED Kite Camps (Gran Roque): replays the camp page recorded 2026-10-19 (2026 camps past).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { playLosRoquesAdvancedKiteCampGranRoque, buildPlrCampSlots, fetchPlrAdvancedSlots, parsePlrAdvancedContent, parsePlrCamps, plrCurrency } from '../../src/offers/adapters/play-los-roques-advanced-kite-camp-gran-roque.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/play-los-roques-advanced-kite-camp-gran-roque');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const html = readFileSync(join(DIR, files.find(f => f.startsWith('www.playlosroques.com_kite-camps-para-avanzados'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('plr advanced: two dated camps with room prices', () => {
  const c = parsePlrCamps(html);
  assert.deepEqual(c.map(x => [x.start, x.end, x.nights, x.prices.single, x.prices.double, x.prices.triple, x.nonKiter]), [
    ['2026-04-14', '2026-04-18', 4, 1830, 1650, 1570, 970],
    ['2026-04-27', '2026-05-03', 6, 2580, 2310, 2190, 1290],
  ]);
  assert.equal(plrCurrency(html), 'USD');
});

test('plr advanced: slots only for future camps', async () => {
  const early = buildPlrCampSlots(parsePlrCamps(html), 'USD', '2026-04-20');
  assert.deepEqual(checkSlots(early).problems, []);
  assert.deepEqual(early.map(s => [s.key, s.price, s.occupancy]), [['single|2026-04-27', 2580, 1], ['double|2026-04-27', 2310, 2], ['triple|2026-04-27', 2190, 3]]);
  const notes: string[] = [];
  assert.deepEqual(await fetchPlrAdvancedSlots('2026-10-19', { note: x => notes.push(x) }), []);
  assert.match(notes[0], /past/);
});

test('plr advanced: content', async () => {
  const c = parsePlrAdvancedContent(html, '2026-10-19');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 5, 'Venezuela', 'Los Roques Archipelago', 'Gran Roque']);
  assert.deepEqual(c.spotCoords, { lat: 11.84918995, lng: -66.7507701 });
  assert.match(c.summary, /The 2027 dates are not published yet \(2026: 14 April to 18 April and 27 April to 3 May\)/);
  assert.equal(contentProblem(await playLosRoquesAdvancedKiteCampGranRoque.fetchContent(ctx)), null);
});
