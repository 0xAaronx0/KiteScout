// WestPoint Dakhla: replays the French lodge pages recorded 2026-10-12 (script/style trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  westpointDakhla, fetchWpSlots, parseWpTables, wpCfEmail, wpRange, wpTablesByUnit,
} from '../../src/offers/adapters/westpoint-dakhla.js';
import { dhgSlots } from '../../src/offers/adapters/dakhla-attitude-dakhla.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/westpoint-dakhla');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const TODAY = '2026-10-12';
const jungle = read('westpointdakhla.ma_jungle-lodge_.');
const ocean = read('westpointdakhla.ma_ocean-lodge_.');

test('westpoint: season ranges with and without the start year', () => {
  assert.deepEqual(wpRange('19/03 au 31/08/2026'), { start: '2026-03-19', end: '2026-08-31' });
  assert.deepEqual(wpRange('23/12/25 au 17/02/2026'), { start: '2025-12-23', end: '2026-02-17' });
  assert.deepEqual(wpRange('18/02 au 18/03/2026 (Ramadan)'), { start: '2026-02-18', end: '2026-03-18' });
  assert.deepEqual(wpRange('23/12/2027 au 04/01/2028'), { start: '2027-12-23', end: '2028-01-04' });
});

test('westpoint: Jungle Lodge = current grid + 2027 grid', () => {
  const [now, next] = parseWpTables(jungle, 'Jungle Lodge');
  assert.deepEqual(now.prices, { low: { 1: 1100, 2: 1540, 3: 1848, 4: 2112 }, high: { 1: 1386, 2: 1969, 3: 2431, 4: 2772 } });
  assert.deepEqual(next.prices, now.prices);
  assert.deepEqual(now.seasons.map(b => [b.level, b.start, b.end]), [
    ['high', '2025-12-23', '2026-02-17'], ['high', '2026-03-19', '2026-08-31'], ['high', '2026-09-15', '2026-11-30'],
    ['low', '2026-02-18', '2026-03-18'], ['low', '2026-09-01', '2026-09-14'], ['low', '2026-12-01', '2026-12-22'],
  ]);
  assert.equal(next.seasons.length, 8); // the repeated "18/02/2027 au 19/03/2027" is dropped
  assert.deepEqual(parseWpTables(ocean, 'Waves View Lodge')[1].prices.high, { 1: 1870, 2: 2420, 3: 2860, 4: 3190 });
});

test('westpoint: slots = lodge x band, MAD per bungalow per night for 2 guests', async () => {
  const slots = dhgSlots(wpTablesByUnit([{ unit: 'Jungle Lodge', html: jungle }, { unit: 'Waves View Lodge', html: ocean }]), TODAY);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 18);
  const j = slots.find(s => s.key === 'jungle-lodge-2p|2026-09-15')!;
  assert.deepEqual([j.startDate, j.endDate, j.price, j.currency, j.priceUnit, j.priceBasis, j.occupancy, j.availability],
    ['2026-09-15', '2026-11-30', 1969, 'MAD', 'per_night', 'room', 2, 'unknown']);
  assert.equal(slots.find(s => s.key === 'waves-view-lodge-2p|2027-02-18')!.price, 1936);
  assert.equal(Math.min(...slots.map(s => s.price!)), 1540);
  assert.deepEqual(await fetchWpSlots(TODAY), slots);
});

test('westpoint: content', async () => {
  const home = read('westpointdakhla.ma_.');
  assert.equal(wpCfEmail(home), 'booking@westpointdakhla.ma');
  const c = await westpointDakhla.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'WestPoint Dakhla');
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /40 two-storey bungalows/);
  assert.match(c.summary, /Dakhla Attitude and PK25/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Jungle Lodge', 'Waves View Lodge']);
  assert.ok(c.imageUrls.length >= 20 && c.imageUrls.every(u => !/logo|cropped|Capture|KITSURF|waves-\./i.test(u)));
});
