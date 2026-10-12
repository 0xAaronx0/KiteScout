// Babaomby Island Lodge (Madagascar): replays the French pages of www.babaomby.com recorded 2026-10-12
// (fixtures trimmed: script/style bodies dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  babaombyIslandLodgeDiegoSuarez, buildBbSlots, parseBbKiteRates, parseBbSeason, parseBbTable,
} from '../../src/offers/adapters/babaomby-island-lodge-diego-suarez.js';
import { todayIso } from '../../src/offers/parse.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/babaomby-island-lodge-diego-suarez');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const ratesHtml = read('www.babaomby.com_hebergements-a-babaomby_tarifs_.');

test('babaomby: opening period 2026 (French dates)', () => {
  assert.deepEqual(parseBbSeason(ratesHtml), { start: '2026-03-17', end: '2026-12-01' });
});

test('babaomby: lodge table = bungalow type x persons, EUR per person per day', () => {
  const t = parseBbTable(ratesHtml);
  assert.deepEqual(t.rates.map(r => [r.unitId, r.persons, r.amount]), [
    ['sea-view', 1, 110], ['sea-view', 2, 80], ['sea-view', 3, 70], ['sea-view', 4, 65],
    ['garden-view', 1, 85], ['garden-view', 2, 65], ['garden-view', 3, 55], ['garden-view', 4, 50],
  ]);
  assert.equal(t.childRate, 50);
  assert.match(t.touristTax ?? '', /1 euro par jour et par personne/);
  assert.equal(t.transfer, 'Return transfer Diego Suarez airport - lodge by car and boat, per person: 1 person EUR 80 / 2 persons EUR 50 / 3-4 persons EUR 30 / children free');
});

test('babaomby: slots for the 2026 period, on request; none once the period is over', async () => {
  const t = parseBbTable(ratesHtml);
  const season = parseBbSeason(ratesHtml)!;
  const slots = buildBbSlots(t, season, '2026-10-12');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 8);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.occupancy]).slice(0, 2), [['sea-view-1p|2026', 110, 1], ['sea-view-2p|2026', 80, 2]]);
  assert.ok(slots.every(s => s.startDate === '2026-03-17' && s.endDate === '2026-12-01' && s.currency === 'EUR'
    && s.priceUnit === 'per_day' && s.priceBasis === 'person' && s.availability === 'on_request'));
  assert.deepEqual(buildBbSlots(t, season, '2026-12-02'), []);
  assert.deepEqual(await babaombyIslandLodgeDiegoSuarez.fetchSlots(ctx), buildBbSlots(t, season, todayIso()));
});

test('babaomby: water-sports prices for lodge guests in English', () => {
  const rows = parseBbKiteRates(read('www.babaomby.com_ecole-de-kite-et-de-windsurf_tarifs-kite-wind-sup-kayaks_.'));
  assert.equal(rows[0], 'Kite, wingfoil and windsurf rental (per person): 1 h EUR 35 / half day EUR 55 / 1 day EUR 85 / 1 week EUR 520 (then EUR 60 per day) / 2 weeks EUR 880 (then EUR 50 per day)');
  assert.ok(rows.includes('Downwinder "Piscine": EUR 30 per person'));
  assert.ok(rows.includes('Private kite or windsurf lesson incl. gear and jet-ski assistance (per person): 1 h EUR 70 / 9 h EUR 540 / then EUR 50 per hour'));
});

test('babaomby: content', async () => {
  const c = await babaombyIslandLodgeDiegoSuarez.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Babaomby Island Lodge');
  assert.equal(c.country, 'Madagascar');
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /10 sea-view bungalows .* 6 garden-view doubles/);
  assert.match(c.summary, /from EUR 65 per person per day for two sharing \(open 2026-03-17 to 2026-12-01\)/);
  assert.match(c.summary, /4 IKO instructors/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Sea-view bungalow (Vue Mer)', 'Garden-view bungalow (Vue Jardin)']);
  assert.ok(c.rooms[0].features.includes('2 family bungalows with 3-4 beds'));
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.equal(c.beginnerFriendly, true);
  assert.ok(c.imageUrls.length >= 15);
  assert.ok(c.imageUrls.every(u => /babaomby\.com\/wp-content\/uploads\//.test(u) && !/logo|-\d+x\d+\./i.test(u)));
});
