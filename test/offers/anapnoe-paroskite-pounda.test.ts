// Anapnoe by ParosKite (Pounda, Paros): replays the pages recorded 2026-10-12 (content only, engine blocked).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  anapnoeParoskitePounda, anapnoeCoords, anapnoeGallery, parseAnapnoeUnits,
} from '../../src/offers/adapters/anapnoe-paroskite-pounda.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { planGallery } from '../../src/offers/gallery.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/anapnoe-paroskite-pounda');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const home = read('paroskiteanapnoe.com_.');

test('anapnoe: suite and room cards', () => {
  const units = parseAnapnoeUnits(home);
  assert.deepEqual(units.map(u => `${u.kind}:${u.name}`), [
    'suite:Orion', 'suite:Cassiopeia', 'suite:Andromeda', 'suite:Cetus',
    'room:Gaia', 'room:Aeolus', 'room:Aethra', 'room:Amphitrite', 'room:Aura', 'room:Doris', 'room:Nereus',
  ]);
  assert.deepEqual(units[4].amenities, ['2 Adults +1 child', '35m2', 'Sea View', 'Big Veranda']);
  assert.equal(units[0].image, 'https://paroskiteanapnoe.com/media-assets/2026-03-orion-featured-img-1200x900.jpg');
});

test('anapnoe: gallery full-size photos and map pin', () => {
  const g = anapnoeGallery(read('paroskiteanapnoe.com_gallery_.'));
  assert.ok(g.length >= 30);
  assert.ok(g.every(u => !/-\d+x\d+\.jpe?g$/.test(u)));
  assert.deepEqual(anapnoeCoords(home), { lat: 37.0317, lng: 25.09826 });
});

test('anapnoe: no slots (WebHotelier blocks us, no prices on the site)', async () => {
  const notes: string[] = [];
  const slots = await anapnoeParoskitePounda.fetchSlots({ note: n => notes.push(n), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.match(notes[0], /403/);
});

test('anapnoe: content', async () => {
  const c = await anapnoeParoskitePounda.fetchContent({ note: () => {}, incomplete: () => {} });
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Anapnoe by ParosKite');
  assert.equal(c.spot, 'Pounda, Paros');
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /7 rooms \(22-55 m2, most with sea view\) and 4 suites with private pools/);
  assert.match(c.summary, /Eleveight & North/);
  assert.equal(c.rooms.length, 11);
  assert.equal(c.rooms[0].name, 'Orion Suite');
  assert.deepEqual(c.includedServices, ['Wi-Fi', 'Breakfast buffet', 'Fitness center', 'Lounge', 'Open kitchen area and vegetable garden']);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://paroskiteanapnoe.com/media-assets/') && !/logo/i.test(u)));
});

test('anapnoe: own photos per unit (card image + gallery files that name the unit), ParosKite photos of /gallery/ as spot', async () => {
  const c = await anapnoeParoskitePounda.fetchContent({ note: () => {}, incomplete: () => {} });
  const photos = (name: string) => c.rooms.find(r => r.name === name)!.imageUrls ?? [];
  assert.deepEqual(c.rooms.map(r => [r.name, photos(r.name).length]), [
    ['Orion Suite', 1], ['Cassiopeia Suite', 1], ['Andromeda Suite', 1], ['Cetus Suite', 3],
    ['Gaia Room', 2], ['Aeolus Room', 2], ['Aethra Room', 2], ['Amphitrite Room', 1], ['Aura Room', 3], ['Doris Room', 2], ['Nereus Room', 2],
  ]);
  const MA = 'https://paroskiteanapnoe.com/media-assets/';
  assert.equal(photos('Orion Suite')[0], `${MA}2026-03-orion-featured-img-1200x900.jpg`);
  assert.equal(photos('Cassiopeia Suite')[0], `${MA}2026-04-29-cassiopeia-featured.jpg`);
  assert.equal(photos('Andromeda Suite')[0], `${MA}2026-04-29-andromeda-featured.jpg`);
  assert.deepEqual(photos('Cetus Suite'), [`${MA}2026-04-29-cetus-featured.jpg`, `${MA}cetus-gallery-image-4.jpg`, `${MA}cetus-gallery-image-5.jpg`]);
  assert.match(photos('Gaia Room')[1], /\/gaia-gallery-image-1\.jpg$/);
  assert.match(photos('Aeolus Room')[1], /\/aeolus-gallery-image-0\.jpg$/);
  assert.deepEqual(photos('Aethra Room'), [`${MA}2026-04-29-aethera-gallery-2.jpg`, `${MA}aethra-room-gallery-image-1.jpg`]);
  assert.equal(photos('Amphitrite Room')[0], `${MA}2026-04-29-amphitrite-featured.jpg`);
  assert.ok(photos('Aura Room').includes(`${MA}aura-room-hero-image-desktop.jpg`));
  assert.deepEqual(photos('Doris Room'), [`${MA}2026-04-29-dorida-featured.jpg`, `${MA}dorida-hero-image-desktop.jpg`]);
  assert.match(photos('Nereus Room')[1], /\/nereus-room-hero-desktop\.jpg$/);
  const all = c.rooms.flatMap(r => r.imageUrls ?? []);
  assert.equal(new Set(all).size, all.length); // the four identical suites each keep only their own card photo
  assert.ok(all.every(u => u.startsWith(MA)));
  assert.deepEqual(c.spotImageUrls, [3, 0, 1, 2, 4].map(n => `${MA}paroskite-surf-gallery-image-${n}.jpg`));
  const plan = planGallery(c);
  assert.deepEqual(plan.dropped, []);
  const first24 = plan.candidates.slice(0, 24);
  for (const r of c.rooms) if (r.imageUrls?.length) assert.ok(r.imageUrls.some(u => first24.includes(u)), r.name);
  assert.ok(first24.includes(c.spotImageUrls![0]));
});
