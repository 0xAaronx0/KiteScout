// Kitesurf Mindoro (Bislig Beach, Bulalacao): replays the Jimdo pages recorded 2026-10-12 (trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kitesurfMindoroBulalacao, buildMdSlots, mdImages, mdNewestYear, parseMdUnits,
} from '../../src/offers/adapters/kitesurf-mindoro-bulalacao.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitesurf-mindoro-bulalacao');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const resort = read('www.kitesurf-mindoro.com_resort_.');

test('mindoro: unit rates on /resort/ (EUR per person per night, full board)', () => {
  const units = parseMdUnits(resort);
  assert.deepEqual(units.map(u => [u.name, u.single, u.double, u.flat]), [
    ['Bungalows', 75, 50, null],
    ['Glamping Pods', 55, 40, null],
    ['Hammock or Dorm', null, null, 30],
  ]);
  assert.ok(units[0].included.includes('lunchbuffet and dinner set meal (soup, maindish, dessert)'));
  assert.ok(units[0].included.includes('kitegear storage'));
  assert.match(units[1].description, /25 sqm hut with 360 degree view/);
});

test('mindoro: undated rates -> no slots (price on request), with a note', async () => {
  assert.equal(mdNewestYear(resort), null);
  const notes: string[] = [];
  const slots = await kitesurfMindoroBulalacao.fetchSlots({ note: t => notes.push(t), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.match(notes[0], /undated/);
});

test('mindoro: the same rates become slots once the page names the current season', () => {
  const dated = resort.replace('Price per night: single occupation', 'Prices 2026/27 - Price per night: single occupation');
  assert.equal(mdNewestYear(dated), 2027); // season "2026/27" counts as 2027
  const slots = buildMdSlots(parseMdUnits(dated));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.occupancy]), [
    ['bungalows-double', 50, 2], ['bungalows-single', 75, 1],
    ['glamping-pods-double', 40, 2], ['glamping-pods-single', 55, 1],
    ['hammock-or-dorm', 30, 1],
  ]);
  assert.ok(ok.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'person' && s.availability === 'on_request'));
});

test('mindoro: photos skip the header logo and use 2048 px renditions', () => {
  const imgs = mdImages(resort);
  assert.equal(imgs.length, 9);
  assert.ok(imgs.every(u => /transf\/dimension=2048x2048:format=jpg\/path\/s3cfe8bfb422b28e3\/image\/i[0-9a-f]{16}\/version\/\d+\/image\.jpg$/.test(u)));
  assert.ok(!imgs.some(u => u.includes('i74e58e8fd6a68a26'))); // 890x309 logo banner
});

test('mindoro: content', async () => {
  const c = await kitesurfMindoroBulalacao.fetchContent({ note: () => {}, incomplete: () => {} });
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.country, 'Philippines');
  assert.equal(c.spot, 'Bislig Beach, Bulalacao');
  assert.equal(c.spotCoords, undefined);
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /5 bungalows with ocean view .* 6 glamping pods/);
  assert.match(c.summary, /prices are on request/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Bungalows', 'Glamping Pods', 'Hammock or Dorm']);
  assert.ok(c.includedServices.includes('Kite gear storage'));
  assert.ok(c.includedServices.includes('Lunch buffet and dinner set meal (soup, main dish, dessert)'));
  assert.equal(c.imageUrls.length, 15);
  assert.equal(kitesurfMindoroBulalacao.confidence, 'low');
});
