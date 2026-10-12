// KitesurfMaroc (Essaouira): replays the French package page recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kitesurfmarocEssaouira, buildKsmSlots, englishIncludes, parseKsmPackages, weekLessons,
} from '../../src/offers/adapters/kitesurfmaroc-essaouira.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitesurfmaroc-essaouira');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const pack = read('www.kitesurfmaroc.com_pack-kitesurf-essaouira_.');

test('ksm: four package columns with nights, lesson hours and room prices', () => {
  assert.deepEqual(parseKsmPackages(pack).map(p => [p.name, p.nights, p.days, p.lessonHours, p.lessons, p.single, p.double]), [
    ['4 jours Cours Kite', 3, 4, 8, true, 465, 415],
    ['1 semaine Cours Kite', 6, 7, 14, true, 800, 690],
    ['4 jours loc Kite', 3, 4, null, false, 390, 335],
    ['1 semaine loc Kite', 6, 7, null, false, 550, 500],
  ]);
});

test('ksm: slots = 1-week lessons package per room type, EUR per person, on request', async () => {
  const slots = await kitesurfmarocEssaouira.fetchSlots(ctx);
  assert.deepEqual(slots, buildKsmSlots(weekLessons(parseKsmPackages(pack))!));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.occupancy, s.packageNights]), [
    ['week-lessons|single', 'Single room', 800, 1, 6],
    ['week-lessons|double', 'Double room (twin or double bed)', 690, 2, 6],
  ]);
  assert.ok(ok.every(s => s.currency === 'EUR' && s.priceUnit === 'package' && s.priceBasis === 'person'
    && s.availability === 'on_request' && s.startDate === null));
});

test('ksm: French inclusions -> English phrases', () => {
  assert.deepEqual(englishIncludes(['14 heures de cours de kite sur 7 jours.', 'Petit déjeuner traditionnel marocain.', 'Le vol aller / retour']),
    ['14 hours of kite lessons over 7 days', 'Moroccan breakfast']);
});

test('ksm: content', async () => {
  const c = await kitesurfmarocEssaouira.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 7);
  assert.equal(c.country, 'Morocco');
  assert.equal(c.spot, 'Essaouira');
  assert.equal(c.mealPlan, 'breakfast');
  assert.match(c.summary, /6 nights in a riad in the medina/);
  assert.match(c.summary, /EUR 800 in a single room and EUR 690 in a double room/);
  assert.ok(c.includedServices.includes('14 hours of kite lessons over 7 days'));
  assert.ok(c.optionalServices.includes('Taxi transfer Marrakech - Essaouira: EUR 70 (max. 4 persons)'));
  assert.ok(c.optionalServices[0].startsWith('Shorter package: 3 nights with 8 hours of kite lessons'));
  assert.equal(c.imageUrls[0], 'https://www.kitesurfmaroc.com/wp-content/uploads/2025/03/1-semaine-cours-Kite-Essaouira--scaled-e1741173129614.jpg');
});
