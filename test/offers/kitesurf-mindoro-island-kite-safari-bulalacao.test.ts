// Kitesurf Mindoro island kite safari: replays the safari, home and day-trip pages recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildMdsSlots, kitesurfMindoroIslandKiteSafariBulalacao, mdsStops, parseMdsContent, parseMdsDuration, parseMdsSafari,
} from '../../src/offers/adapters/kitesurf-mindoro-island-kite-safari-bulalacao.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitesurf-mindoro-island-kite-safari-bulalacao');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (part: string) => readFileSync(join(DIR, files.find(f => f.includes(part))!), 'utf8');
const safari = read('_safari_');
const home = read('www.kitesurf-mindoro.com_.');
const daytrip = read('_daytrip_');
const ctx = { note: () => {}, incomplete: () => {} };

test('mindoro-safari: price line, islands and inclusions', () => {
  const s = parseMdsSafari(safari);
  assert.deepEqual([s.price, s.currency, s.minPeople], [19900, 'PHP', 2]);
  assert.deepEqual(s.islands, ['Buyayao', 'Suguicay', 'Libagao', 'Nagubat', 'Semirara', 'Aslom', 'Target', 'Sibolo']);
  assert.ok(s.included.includes('Accommodation') && s.included.includes('Boat') && s.included.includes('Food and Drinks'));
});

test('mindoro-safari: one undated per-person slot, PHP', () => {
  const slots = buildMdsSlots(parseMdsSafari(safari));
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.startDate, s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.availability]),
    [['per-person', null, 19900, 'PHP', 'package', 'person', 2, 'on_request']]);
});

test('mindoro-safari: duration only from the home teaser; stops with spelling fix', () => {
  assert.deepEqual(parseMdsDuration(home)?.days, 3);
  assert.deepEqual(parseMdsDuration(home)?.nights, 2);
  assert.equal(parseMdsDuration(safari), null); // the safari page itself states no length
  const stops = mdsStops(['Libagao', 'Semirara', 'Aslom']);
  assert.deepEqual(stops.map(s => [s.name, s.region, s.order]), [['Liwagao Island', 'Antique', 1], ['Semirara Island', 'Antique', 2], ['Aslom Island', 'Oriental Mindoro', 3]]);
});

test('mindoro-safari: content', async () => {
  const c = await kitesurfMindoroIslandKiteSafariBulalacao.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.equipmentRental, c.beginnerFriendly], ['tour', 3, 'Philippines', 'MIMAROPA (Oriental Mindoro)', 'Bislig Beach, Bulalacao', false, false]);
  assert.equal(c.itinerarySpots.length, 8);
  assert.match(c.summary, /PHP 19,900 per person with a minimum of 2 people; the safari runs 3 days \/ 2 nights\. Guests/);
  assert.doesNotMatch(c.summary, /[–—]/);
  assert.equal(c.imageUrls.length, 6);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://image.jimcdn.com/')));
  // without the home teaser the duration stays null (and the ingest would reject the tour)
  assert.equal(parseMdsContent({ safari, home: '<html></html>', daytrip }).durationDays, null);
});
