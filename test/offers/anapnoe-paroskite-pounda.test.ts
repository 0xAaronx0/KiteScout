// Anapnoe by ParosKite (Pounda, Paros): replays the pages recorded 2026-10-12 (content only, engine blocked).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  anapnoeParoskitePounda, anapnoeCoords, anapnoeGallery, parseAnapnoeUnits,
} from '../../src/offers/adapters/anapnoe-paroskite-pounda.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

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
