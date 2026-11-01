// Campingplatz Loissin: replays the site pages recorded 2026-10-14 (scripts / styles / srcsets dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  campingplatzLoissin, buildCplCardSlots, buildCplTableSlots, cplRoomPhotos, fetchCplSlots, parseCplCards, parseCplTables, parseCplUnitPage,
} from '../../src/offers/adapters/campingplatz-loissin.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { planGallery } from '../../src/offers/gallery.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/campingplatz-loissin');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const prices = read('campingplatz-loissin.de_preise_.');

test('cpl: apartment / double-room tables with real season limits', () => {
  const t = parseCplTables(prices);
  assert.deepEqual(t.map(x => x.unit), ['Apartment', 'Doppelzimmer']);
  assert.deepEqual(t[0].columns.map(c => [c.season, c.price, c.from3rd]), [['winter', 60, 50], ['shoulder', 80, 70], ['high', 100, null]]);
  assert.deepEqual(t[1].columns.map(c => [c.season, c.price, c.from3rd]), [['winter', 55, 45], ['shoulder', 75, 65], ['high', 95, null]]);
  assert.deepEqual(t[0].columns[2].bands.map(b => [b.start, b.end, b.marks]), [['2026-05-13', '2026-05-24', '*'], ['2026-06-15', '2026-08-30', '**']]);
  assert.deepEqual(t[0].columns[0].bands.map(b => [b.start, b.end]), [[null, '2026-03-31'], ['2026-10-31', null]]);
  assert.equal(t[0].extraPerson, 5);
});

test('cpl: slots = table bands + undated card units', async () => {
  const slots = await fetchCplSlots('2026-10-14', ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.startDate, s.endDate, s.price, s.occupancy]), [
    ['apartment|2026-08-31', '2026-08-31', '2026-10-30', 80, 2],
    ['apartment|2026-10-31', '2026-10-31', null, 60, 2],
    ['double-room|2026-08-31', '2026-08-31', '2026-10-30', 75, 2],
    ['double-room|2026-10-31', '2026-10-31', null, 55, 2],
    ['mobile-home-boddentraum', null, null, 127, null],
    ['sleeping-barrel-schlaffass', null, null, 35, null],
    ['mobile-home-boddenglueck', null, null, 142, null],
  ]);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.availability === 'unknown'));
  const summer = buildCplTableSlots(parseCplTables(prices), '2026-06-01').find(s => s.key === 'apartment|2026-06-15');
  assert.deepEqual([summer?.price, summer?.minNights, summer?.availabilityText], [100, 7, 'Buchungen nur von Samstag bis Samstag möglich']);
  assert.deepEqual(buildCplCardSlots(parseCplCards(read('campingplatz-loissin.de_.'))).map(s => s.unit), ['Mobile home Boddentraum', 'Sleeping barrel (Schlaffass)', 'Mobile home Boddenglück']);
});

test('cpl: unit page details and content', async () => {
  const u = parseCplUnitPage(read('campingplatz-loissin.de_properties_mobilheim-boddenglueck_.'));
  assert.equal(u.details.find(d => d.label === 'Maximale Belegung')?.data, '4 Erwachsene, 2 Kinder');
  assert.ok(parseCplUnitPage(read('campingplatz-loissin.de_properties_apartments_.')).gallery.length >= 15);
  const c = await campingplatzLoissin.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.region, 'Loissin, Greifswald Bodden');
  assert.equal(c.spotCoords, undefined);
  assert.match(c.summary, /schools for kitesurfing and stand-up paddling/);
  assert.match(c.summary, /Kitesafe kite station and beach bar sit behind the tent meadow/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Apartment', 'Double room', 'Mobile home Boddentraum', 'Sleeping barrel (Schlaffass)', 'Mobile home Boddenglück']);
  assert.ok(c.rooms[0].features.includes('Low season (2026-04-01 to 2026-05-12, 2026-05-25 to 2026-06-14, 2026-08-31 to 2026-10-30): EUR 80 per night for 2 persons, from the 3rd night EUR 70'));
  assert.ok(c.rooms[4].features.includes('Maximum occupancy 4 adults, 2 children'));
  assert.ok(c.optionalServices.includes('Day ticket for surfers without overnight stay EUR 7 (low season) / EUR 14 (high season)'));
  assert.ok(c.imageUrls.length >= 20 && c.imageUrls.every(u => /\/wp-content\/uploads\//.test(u) && !/-\d+x\d+\.|Osterfeuer|Logo/i.test(u)));
});

test('cpl: own photos per unit from its /properties/ gallery (Boddentraum too: Aaron 2026-11-01 "echt")', async () => {
  const c = await campingplatzLoissin.fetchContent(ctx);
  const photos = (name: string) => c.rooms.find(r => r.name === name)!.imageUrls ?? [];
  assert.deepEqual(c.rooms.map(r => [r.name, photos(r.name).length]), [
    ['Apartment', 16], ['Double room', 15], ['Mobile home Boddentraum', 4], ['Sleeping barrel (Schlaffass)', 7], ['Mobile home Boddenglück', 9],
  ]);
  const UP = 'https://campingplatz-loissin.de/wp-content/uploads/';
  assert.equal(photos('Apartment')[0], `${UP}2022/04/IMG_0076-HDR-min.jpg`);
  assert.equal(photos('Double room')[0], `${UP}2022/04/IMG_0136-HDR-min.jpg`);
  assert.equal(photos('Sleeping barrel (Schlaffass)')[0], `${UP}2025/03/IMG_20250313_133205208.jpg`);
  assert.equal(photos('Mobile home Boddenglück')[0], `${UP}2026/05/boddenmobilheim-haus2-.jpg`);
  // Boddentraum: four files named like scene descriptions; checked by Aaron as real photos
  const traum = parseCplUnitPage(read('campingplatz-loissin.de_properties_mobilheim-boddentraum_.'));
  assert.equal(traum.gallery.length, 4);
  assert.deepEqual(cplRoomPhotos(traum), traum.gallery);
  assert.match(photos('Mobile home Boddentraum')[0], /Familie-verbringt-Urlaub-am-Bodden/);
  const all = c.rooms.flatMap(r => r.imageUrls ?? []);
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.every(u => u.startsWith(UP) && !/-\d+x\d+\./.test(u)));
  assert.equal(c.spotImageUrls, undefined); // no own kite photo on the pages read
  const first24 = planGallery(c).candidates.slice(0, 24);
  for (const r of c.rooms) if (r.imageUrls?.length) assert.ok(r.imageUrls.some(u => first24.includes(u)), r.name);
});
