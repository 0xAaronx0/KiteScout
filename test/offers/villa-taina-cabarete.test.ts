// Villa Taina (Cabarete): replays the home page and the JS bundle recorded 2026-10-12. The home page is trimmed
// of script/style bodies; the 725 KB bundle is cut down to the string-literal segments the adapter parses
// (asset paths, room objects, Water Club, FAQ, route meta, Windy embed). Content only: Clock PMS is robots-disallowed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  villaTainaCabarete, vtBundleUrl, vtCoords, vtFaq, vtNotice, vtRooms, vtRouteMeta, vtTeaserRooms, vtWaterClub,
} from '../../src/offers/adapters/villa-taina-cabarete.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/villa-taina-cabarete');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const home = read('villataina.com_.');
const bundle = read('villataina.com_assets_index-');

test('villa-taina: home page (bundle link, 2026 notice, teaser cards)', () => {
  assert.equal(vtBundleUrl(home), 'https://villataina.com/assets/index-hb45qqSh.js');
  assert.match(vtNotice(home)!, /^From September 28 to October 13, 2026, scheduled maintenance/);
  assert.deepEqual(vtTeaserRooms(home).map(r => r.name), ['Ocean View Premium', 'Ocean Side Room', 'Standard Room']);
});

test('villa-taina: room objects from the bundle with the shared feature list', () => {
  const rooms = vtRooms(bundle);
  assert.deepEqual(rooms.map(r => r.title), ['Premium Room', 'Superior Ocean Side Room', 'Ocean Side Room', 'Superior Room', 'Standard Room']);
  assert.deepEqual(rooms[0].features, ['Queen or King size bed', 'Air conditioning', 'Mini fridge', 'Ceiling ventilator',
    'Safe deposit box (fits up to 14" laptops)', 'Smart TV 43"', 'Telephone', 'Wifi', 'Shower', 'Hairdryer', 'Coffee maker']);
  assert.equal(rooms[3].features[3], 'Ceiling ventilator (most rooms)');
  assert.equal(rooms[0].images.length, 5);
  assert.ok(rooms.every(r => r.images.every(u => u.startsWith('https://villataina.com/assets/'))));
});

test('villa-taina: Water Club, FAQ, meta, Windy pin', () => {
  const kite = vtWaterClub(bundle).find(d => d.title === 'Kitesurf')!;
  assert.match(kite.desc, /IKO-certified instructors/);
  assert.deepEqual(kite.lessons, [{ duration: '2 Hours', price: 207 }, { duration: '6 Hours', price: 529 }, { duration: '12 Hours', price: 851 }]);
  assert.deepEqual(kite.rentals.map(r => r.price), [58, 109, 380]);
  const faq = vtFaq(bundle);
  assert.ok(faq.length >= 40);
  assert.match(faq.find(f => f.q === 'Do you offer kitesurfing lessons?')!.a, /on-site watersports center offers lessons for beginners/);
  assert.match(vtRouteMeta(bundle, '/about')!, /^Since 1993/);
  assert.deepEqual(vtCoords(bundle), { lat: 19.749, lng: -70.413 });
});

test('villa-taina: no slots (Clock PMS robots.txt, no rates on the site)', async () => {
  const notes: string[] = [];
  const slots = await villaTainaCabarete.fetchSlots({ note: n => notes.push(n), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.match(notes[0], /Clock PMS\+ engine robots\.txt/);
});

test('villa-taina: content', async () => {
  const c = await villaTainaCabarete.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Villa Taina');
  assert.equal(c.country, 'Dominican Republic');
  assert.equal(c.spot, 'Cabarete');
  assert.deepEqual(c.spotCoords, { lat: 19.749, lng: -70.413 });
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.equal(c.mealPlan, null);
  assert.match(c.summary, /since 1993/);
  assert.match(c.summary, /kite lessons with IKO-certified instructors, USD 207-851/);
  assert.equal(c.rooms.length, 5);
  assert.ok(c.optionalServices.some(s => /^Kitesurf: lessons 2 Hours USD 207/.test(s)));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /^https:\/\/villataina\.com\/assets\/[^/]+\.(jpe?g|JPG|webp)$/.test(u) && !/logo/i.test(u)));
});
