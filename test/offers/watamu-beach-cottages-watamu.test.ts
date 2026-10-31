// Watamu Beach Cottages (Kenya): replays the home and contact pages recorded 2026-10-12 (fixtures trimmed: script/
// style bodies, srcset, lazy-load placeholders and 5,000 repeated review-platform icons dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  watamuBeachCottagesWatamu, buildWbcSlots, groupWbcTypes, parseWbcUnits, wbcLines, wbcReviewDates,
} from '../../src/offers/adapters/watamu-beach-cottages-watamu.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { planGallery } from '../../src/offers/gallery.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/watamu-beach-cottages-watamu');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const home = read('watamubeachcottages.com_.');

test('watamu: unit cards (26 listings incl. the own-tent pitch)', () => {
  const units = parseWbcUnits(home);
  assert.equal(units.length, 26);
  assert.deepEqual([units[0].name, units[0].price, units[0].currency, units[0].type, units[0].kind], ['Nomad – Coastal Cottage', 93, 'USD', '1 Bedroom Cottage', 'Entire Unit']);
  assert.ok(units.some(u => u.name === 'Bring a Tent or Overlander' && u.kind === 'Own Tent' && u.type === null));
});

test('watamu: slots = rental type, lowest nightly USD price, no dates, unknown availability', async () => {
  const slots = await watamuBeachCottagesWatamu.fetchSlots(ctx);
  assert.deepEqual(slots, buildWbcSlots(groupWbcTypes(parseWbcUnits(home))));
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.unit, s.price]), [
    ['1-bedroom-cottage', '1 Bedroom Cottage', 93], ['apartment', 'Apartment', 107], ['clubrooms', 'Club room (B&B)', 88],
    ['chalet', 'Chalet (B&B)', 79], ['2-bedroom-cottage', '2 Bedroom Cottage', 157], ['tent-hut', 'Tent Hut', 42],
    ['baobab-tent', 'Baobab Tent', 42], ['villa', 'Villa', 200], ['bamba-kofi-tent', 'Bamba Kofi Tent', 30],
  ]);
  assert.ok(slots.every(s => s.currency === 'USD' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'unknown' && s.startDate === null && s.occupancy === null));
});

test('watamu: dated guest reviews on the home page (operation in 2026)', () => {
  assert.deepEqual(wbcReviewDates(wbcLines(home)).slice(0, 3), ['2026-09-29', '2026-09-15', '2026-09-06']);
});

test('watamu: content', async () => {
  const c = await watamuBeachCottagesWatamu.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Watamu Beach Cottages');
  assert.equal(c.country, 'Kenya');
  assert.equal(c.spot, 'Watamu');
  assert.match(c.summary, /rents 25 units/);
  assert.match(c.summary, /JC Kiteschool operates from the property/);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.rooms.length, 9);
  assert.equal(c.rooms[2].name, 'Club room (B&B)');
  assert.ok(c.imageUrls.length >= 20);
  assert.ok(c.imageUrls.every(u => /watamubeachcottages\.com\/wp-content\/uploads\//.test(u) && !/-\d+x\d+\./.test(u)));
});

test('watamu: own photos per type = the card photo of each of its units on the home page', async () => {
  const c = await watamuBeachCottagesWatamu.fetchContent(ctx);
  const photos = (name: string) => c.rooms.find(r => r.name === name)!.imageUrls ?? [];
  assert.deepEqual(c.rooms.map(r => [r.name, photos(r.name).length]), [
    ['1 Bedroom Cottage', 3], ['Apartment', 3], ['Club room (B&B)', 4], ['Chalet (B&B)', 4], ['2 Bedroom Cottage', 3],
    ['Tent Hut', 2], ['Baobab Tent', 1], ['Villa', 1], ['Bamba Kofi Tent', 4],
  ]);
  const UP = 'https://watamubeachcottages.com/wp-content/uploads/';
  assert.equal(photos('1 Bedroom Cottage')[0], `${UP}2026/04/IMG_8394.jpg`); // Nomad, the type's first card
  assert.equal(photos('Apartment')[0], `${UP}2025/05/marine-livingmainroom-HD.jpg`);
  assert.equal(photos('Club room (B&B)')[0], `${UP}2025/03/20250205_141116-3.jpg`);
  assert.equal(photos('Chalet (B&B)')[0], `${UP}2024/03/4Z6A9923.jpg`);
  assert.equal(photos('2 Bedroom Cottage')[0], `${UP}2023/04/IMG-20250728-WA0047-1.jpg`);
  assert.equal(photos('Tent Hut')[0], `${UP}2023/02/20241002_125141.jpg`);
  assert.deepEqual(photos('Baobab Tent'), [`${UP}2022/09/BAOBAB-CAMP.jpg`]);
  assert.deepEqual(photos('Villa'), [`${UP}2022/05/Topaz-Villa.jpg`]);
  assert.equal(photos('Bamba Kofi Tent')[0], `${UP}2022/05/tent-4-image.jpg`);
  const all = c.rooms.flatMap(r => r.imageUrls ?? []);
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.every(u => u.startsWith(UP) && !/-\d+x\d+\./.test(u) && c.imageUrls.includes(u)));
  assert.equal(c.spotImageUrls, undefined); // no kite photo on the pages read
  const first24 = planGallery(c).candidates.slice(0, 24);
  for (const r of c.rooms) if (r.imageUrls?.length) assert.ok(r.imageUrls.some(u => first24.includes(u)), r.name);
});
