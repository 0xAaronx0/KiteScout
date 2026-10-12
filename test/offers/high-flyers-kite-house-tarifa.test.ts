// High Flyers Kite House (Tarifa): replays the Duda pages and the room collection recorded 2026-10-12 (scripts except
// the SSR hydration blocks trimmed, Mapbox token dropped with them, Smoobu iframeHash redacted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  highFlyersKiteHouseTarifa, buildHfSlots, hfRange, hfSiteAlias, parseHfCamps, parseHfCollection,
} from '../../src/offers/adapters/high-flyers-kite-house-tarifa.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/high-flyers-kite-house-tarifa');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const camps = read('www.highflyerstarifa.com_kitesurfcamps.');

test('high-flyers: 2026 camp cards, prices and programme', () => {
  const info = parseHfCamps(camps);
  assert.equal(info.year, 2026);
  assert.deepEqual(info.camps.map(c => [c.start, c.end, c.availability]), [
    ['2026-04-18', '2026-04-25', 'available'],
    ['2026-05-16', '2026-05-23', 'available'],
    ['2026-05-30', '2026-06-06', 'sold_out'],
    ['2026-09-12', '2026-09-19', 'available'],
    ['2026-10-10', '2026-10-17', 'available'],
  ]);
  assert.deepEqual(info.prices, [
    { unit: 'Shared double/twin room', amount: 845, occupancy: 2 },
    { unit: 'Single room', amount: 995, occupancy: 1 },
  ]);
  assert.equal(info.nights, 7);
  assert.equal(info.days, 6);
  assert.equal(info.included.length, 6);
  assert.match(info.included[0], /^6 days of guided kitesurfing/);
});

test('high-flyers: date ranges', () => {
  assert.deepEqual(hfRange('18 - 25th | Places still available', 4, 2026), { start: '2026-04-18', end: '2026-04-25' });
  assert.deepEqual(hfRange('30th May - 6th JuneCAMP FULL', 6, 2026), { start: '2026-05-30', end: '2026-06-06' });
  assert.deepEqual(hfRange('27th Dec - 3rd Jan', 12, 2026), { start: '2026-12-27', end: '2027-01-03' });
});

test('high-flyers: slots = camp week x room type, per person', async () => {
  const slots = await highFlyersKiteHouseTarifa.fetchSlots(ctx);
  assert.deepEqual(slots, buildHfSlots(parseHfCamps(camps)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 10);
  const s = (k: string) => slots.find(x => x.key === k)!;
  assert.deepEqual([s('shared-double-twin-room|2026-10-10').price, s('shared-double-twin-room|2026-10-10').endDate, s('shared-double-twin-room|2026-10-10').occupancy], [845, '2026-10-17', 2]);
  assert.deepEqual([s('single-room|2026-05-30').price, s('single-room|2026-05-30').availability, s('single-room|2026-05-30').availabilityText], [995, 'sold_out', 'CAMP FULL']);
  assert.ok(slots.every(x => x.currency === 'EUR' && x.priceUnit === 'package' && x.priceBasis === 'person' && x.packageNights === 7));
});

test('high-flyers: room collection (Duda) and site alias', () => {
  const rooms = parseHfCollection(read('www.highflyerstarifa.com__dm_s_rt_actions_sites_'));
  assert.deepEqual(rooms.map(r => [r.name, r.maxGuests]), [
    ['Room 3: Los Lances', 2], ['Room 4: Balneario', 1], ['Room 5: Valdevaqueros', 2], ['Room 6: Bolonia', 1], ['Room 7: Caños de Meca', 2],
  ]);
  assert.deepEqual(rooms[0].geo, { lat: 36.011858, lng: -5.6036923 });
  assert.equal(hfSiteAlias(read('www.highflyerstarifa.com_guesthouse.')), '4dff6c3a885c43daaa7b1b9e6445a736');
});

test('high-flyers: content', async () => {
  const c = await highFlyersKiteHouseTarifa.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.title, 'High Flyers Kite House');
  assert.equal(c.region, 'Tarifa town');
  assert.deepEqual(c.spotCoords, { lat: 36.011858, lng: -5.6036923 });
  assert.match(c.summary, /Kevin Mitchem, who has taught in Tarifa since 2006/);
  assert.match(c.summary, /partner school KBC Tarifa/);
  assert.equal(c.rooms.length, 5);
  assert.ok(c.rooms[0].features.includes('16 m²'));
  assert.ok(c.includedServices.includes('Towels, bed sheets'));
  assert.ok(!c.includedServices.includes('Air conditioning')); // only Room 3 lists it
  assert.ok(c.imageUrls.length >= 15);
  assert.ok(c.imageUrls.every(u => /cdn-website\.com/.test(u) && !/logo|smoobu/i.test(u)));
});
