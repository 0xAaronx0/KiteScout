// Kitesurf Mindoro (Bislig Beach, Bulalacao): replays the Jimdo pages recorded 2026-10-12 (trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kitesurfMindoroBulalacao, buildMdSlots, mdConfirmed, mdImages, mdNewestYear, parseMdUnits, MD_CONFIRMED,
} from '../../src/offers/adapters/kitesurf-mindoro-bulalacao.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { roomsWithPrices, summarizePrice } from '../../src/offers/ingest.js';

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

// the resort confirmed these rates by e-mail on 2026-11-10 for 2026/27, season "November until mid April"
test('mindoro: the confirmed rates are season slots 2026-11-01..2027-04-15, no undated mark (resort 2026-11-10)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-10T05:00:00Z') });
  assert.equal(mdNewestYear(resort), null);
  const notes: string[] = [];
  const slots = await kitesurfMindoroBulalacao.fetchSlots({ note: t => notes.push(t), incomplete: () => {} });
  assert.deepEqual(slots.map(s => [s.key, s.price, s.undated, s.startDate, s.endDate, s.datePrecision]), [
    ['bungalows-double', 50, undefined, '2026-11-01', '2027-04-15', 'season'], ['bungalows-single', 75, undefined, '2026-11-01', '2027-04-15', 'season'],
    ['glamping-pods-double', 40, undefined, '2026-11-01', '2027-04-15', 'season'], ['glamping-pods-single', 55, undefined, '2026-11-01', '2027-04-15', 'season'],
    ['hammock-or-dorm', 30, undefined, '2026-11-01', '2027-04-15', 'season'],
  ]);
  assert.deepEqual(notes, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.ok(slots.every(s => /confirmed by the resort by e-mail on 2026-11-10/.test(s.availabilityText ?? '')));
  const price = summarizePrice('accommodation', slots, '2026-11-10');
  assert.equal(price.raw, 'From EUR 30 / night p.p.');
  assert.equal(price.note, 'From EUR 30 / night p.p. (cheapest bookable: Hammock or Dorm, until 2027-04-15; as of 2026-11-10)');
  const c = await kitesurfMindoroBulalacao.fetchContent({ note: () => {}, incomplete: () => {} });
  assert.deepEqual(roomsWithPrices(c, slots, '2026-11-10').map(r => [r.name, r.price_from, r.priced_months]), [
    ['Bungalows', 50, [1, 2, 3, 4, 11, 12]], ['Glamping Pods', 40, [1, 2, 3, 4, 11, 12]], ['Hammock or Dorm', 30, [1, 2, 3, 4, 11, 12]],
  ]);
  // after the season the same slots are the last published price, and a new run no longer applies the confirmation
  t.mock.timers.setTime(Date.parse('2027-04-16T05:00:00Z'));
  const later: string[] = [];
  const after = await kitesurfMindoroBulalacao.fetchSlots({ note: x => later.push(x), incomplete: () => {} });
  assert.ok(after.every(s => s.undated && s.startDate === null), 'falls back to the undated mark');
  assert.match(later[0], /undated/);
  assert.match(summarizePrice('accommodation', slots, '2027-04-16').note, /^From EUR 30 \/ night p\.p\. \(last published price/);
});

test('mindoro: a rate that differs from the confirmed ones falls back to undated, marked undated (Aaron 2026-11-02)', async () => {
  const changed = resort.replace('Price per night: 30 Euro', 'Price per night: 35 Euro');
  assert.notEqual(changed, resort, 'fixture still prints the dorm rate as "Price per night: 30 Euro"');
  const units = parseMdUnits(changed);
  assert.equal(mdConfirmed(buildMdSlots(units)), false);
  assert.ok(buildMdSlots(units).some(s => s.key === 'hammock-or-dorm' && s.price === 35));
  assert.equal(mdConfirmed(buildMdSlots(parseMdUnits(resort))), true);
  assert.equal(mdConfirmed(buildMdSlots(parseMdUnits(resort)).slice(1)), false, 'a missing unit is no confirmation');
  assert.equal(Object.keys(MD_CONFIRMED.rates).length, 5);
  // once the confirmed season is over the confirmation no longer applies
  assert.equal(mdConfirmed(buildMdSlots(parseMdUnits(resort)), '2027-04-16'), false);
  assert.equal(mdConfirmed(buildMdSlots(parseMdUnits(resort)), '2027-04-15'), true);
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
  assert.ok(ok.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'person' && s.availability === 'on_request' && !s.undated));
});

test('mindoro: photos skip the header logo and use 2048 px renditions', () => {
  const imgs = mdImages(resort);
  assert.equal(imgs.length, 9);
  assert.ok(imgs.every(u => /transf\/dimension=2048x2048:format=jpg\/path\/s3cfe8bfb422b28e3\/image\/i[0-9a-f]{16}\/version\/\d+\/image\.jpg$/.test(u)));
  assert.ok(!imgs.some(u => u.includes('i74e58e8fd6a68a26'))); // 890x309 logo banner
});

test('mindoro: content', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-10T05:00:00Z') });
  const c = await kitesurfMindoroBulalacao.fetchContent({ note: () => {}, incomplete: () => {} });
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.country, 'Philippines');
  assert.equal(c.spot, 'Bislig Beach, Bulalacao');
  assert.equal(c.spotCoords, undefined);
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /5 bungalows with ocean view .* 6 glamping pods/);
  assert.match(c.summary, /the resort confirmed the room rates for the 2026\/27 season/);
  assert.match(c.summary, /from November to mid-April/);
  assert.equal(c.title, 'Kitesurf Mindoro - Amansinaya Resort');
  assert.ok(!/Makani/.test(`${c.title} ${c.summary} ${kitesurfMindoroBulalacao.name}`));
  assert.deepEqual(c.rooms.map(r => r.name), ['Bungalows', 'Glamping Pods', 'Hammock or Dorm']);
  assert.ok(c.includedServices.includes('Kite gear storage'));
  assert.ok(c.includedServices.includes('Lunch buffet and dinner set meal (soup, main dish, dessert)'));
  assert.equal(c.imageUrls.length, 15);
  assert.equal(kitesurfMindoroBulalacao.confidence, 'low');
});
