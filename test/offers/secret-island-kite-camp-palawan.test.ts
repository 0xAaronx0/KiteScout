// Secret Island Kite Camp: replays fixtures recorded 2026-10-12 (shell without inline script bodies;
// bundle trimmed to the slices the parsers read: hero/spot, tour list + rooms + courses + FAQ, invoice
// logo, booking form + estimator, one drink poster, gallery arrays).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  secretIslandKiteCampPalawan, buildSikSlots, parseSikCardFormula, parseSikPricing, parseSikRoomCards,
  parseSikStays, sikBundleUrl, sikCardPrice, sikImages, sikLogoName, sikTotal, SIK_COORDS,
} from '../../src/offers/adapters/secret-island-kite-camp-palawan.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/secret-island-kite-camp-palawan');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const shell = read('secretislandkitecamp.com_.');
const bundle = read('secretislandkitecamp.com_assets_index-');
const ctx = { note: () => {}, incomplete: () => {} };

test('secret-island: shell points at the bundle; logo name from the favicon', () => {
  assert.equal(sikBundleUrl(shell), 'https://secretislandkitecamp.com/assets/index-4OEm5eU_.js');
  assert.equal(sikLogoName(shell), '469066337_1021590079986005_2338025878783493218_n.jpg');
});

test('secret-island: dated joiner tours from the bundle', () => {
  const stays = parseSikStays(bundle);
  assert.deepEqual(stays.map(s => [s.code, s.arrival, s.departure, s.nights]), [
    ['dec-14', '2026-12-14', '2026-12-21', 7],
    ['dec-22', '2026-12-22', '2026-12-29', 7],
    ['dec-30', '2026-12-30', '2027-01-09', 10],
    ['jan-02', '2027-01-02', '2027-01-09', 7],
    ['jan-16-short', '2027-01-16', '2027-01-24', 8],
    ['jan-25', '2027-01-25', '2027-01-30', 5],
    ['feb-27', '2027-02-27', '2027-03-06', 7],
    ['mar-7', '2027-03-07', '2027-03-14', 7],
    ['mar-12', '2027-03-12', '2027-03-19', 7],
  ]);
  // the enquiry form's tour select lists the same stays with the same night counts
  const form = [...bundle.matchAll(/\{value:"([\w-]+)",label:"[^"]+",days:(\d+)\}/g)].map(m => [m[1], Number(m[2])]);
  assert.deepEqual(form, stays.map(s => [s.code, s.nights]));
});

test('secret-island: estimator prices (USD) reproduce the tour-card price', () => {
  const p = parseSikPricing(bundle)!;
  assert.deepEqual([p.currency, p.transfer, p.meals, p.envFee], ['USD', 150, 30, 20]);
  assert.deepEqual(p.rooms.map(r => [r.code, r.name, r.price, r.perPerson]), [
    ['dorm', 'Dormitory Dome', 30, true],
    ['private', 'Private Dome', 80, false],
    ['lux', 'Lux Dome', 120, false],
    ['ahut', 'A-Bamboo Hut', 50, false],
  ]);
  const card = parseSikCardFormula(bundle)!;
  assert.deepEqual(card, { base: 150, perNight: 60, perWeek: 20 });
  const dorm = p.rooms.find(r => r.code === 'dorm')!;
  for (const n of [5, 7, 8, 10]) assert.equal(sikTotal(p, dorm, n, 1), sikCardPrice(card, n));
  assert.equal(sikCardPrice(card, 7), 590);
  // Private Dome, 7 nights, 2 guests: 2 x (150 + 210 + 20) + 7 x 80
  assert.equal(sikTotal(p, p.rooms.find(r => r.code === 'private')!, 7, 2), 1320);
});

test('secret-island: slots = tour x accommodation, per person, on request', () => {
  const slots = buildSikSlots(parseSikStays(bundle), parseSikPricing(bundle)!, '2026-10-12', 'enquiry');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 36);
  const dorm = slots.find(s => s.key === 'dorm|2026-12-30')!;
  assert.deepEqual([dorm.startDate, dorm.endDate, dorm.unit, dorm.price, dorm.currency, dorm.priceUnit, dorm.priceBasis, dorm.occupancy, dorm.packageNights, dorm.priceTotal],
    ['2026-12-30', '2027-01-09', 'Dormitory Dome', 790, 'USD', 'package', 'person', 1, 10, null]);
  const lux = slots.find(s => s.key === 'lux|2027-01-02')!;
  assert.deepEqual([lux.unit, lux.price, lux.occupancy, lux.priceTotal], ['Lux Dome', 800, 2, 1600]);
  assert.ok(slots.every(s => s.availability === 'on_request' && s.availabilityText === 'enquiry'));
  const cheapest = [...slots].sort((a, b) => a.price! - b.price!)[0];
  assert.deepEqual([cheapest.key, cheapest.price, cheapest.priceTotal], ['ahut|2027-01-25', 445, 890]);
  // past tours are dropped
  assert.equal(buildSikSlots(parseSikStays(bundle), parseSikPricing(bundle)!, '2027-03-10', null).length, 8);
});

test('secret-island: room cards, images without logo and drink posters', () => {
  const rooms = parseSikRoomCards(bundle);
  assert.deepEqual(rooms.map(r => [r.name, r.price, r.unit, r.capacity]), [
    ['Dormitory Dome', 30, 'person/day', 'Up to 6 people'],
    ['A-Bamboo Hut', 50, 'hut/day', 'Up to 2 people'],
    ['Private Dome', 80, 'dome/day', 'Up to 2 people'],
    ['Lux Dome', 120, 'dome/day', 'Up to 4 people'],
  ]);
  assert.ok(rooms.every(r => r.image?.startsWith('https://media.base44.com/images/public/')));
  const imgs = sikImages(bundle, sikLogoName(shell));
  assert.equal(imgs.length, 16);
  assert.match(imgs[0], /7e5abd1bf_forside\.jpg$/);
  assert.ok(!imgs.some(u => /469066337_1021590079986005|Screenshot|846e7d99f_image\.png/.test(u)));
});

test('secret-island: adapter end to end on fixtures', async () => {
  const c = await secretIslandKiteCampPalawan.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.title, 'Secret Island Kite Camp');
  assert.deepEqual([c.country, c.region, c.spot, c.durationDays, c.mealPlan], ['Philippines', 'Palawan', 'Secret Island', 8, 'full_board']);
  assert.deepEqual(c.spotCoords, SIK_COORDS);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.ok(c.includedServices.includes('3 meals a day (breakfast, lunch and dinner)'));
  assert.ok(c.includedServices.includes('Return speedboat transfer between Coron and Secret Island'));
  assert.ok(c.optionalServices.includes('Beginner Course (USD 400 / person)'));
  assert.deepEqual(c.rooms.map(r => r.name), ['Dormitory Dome', 'A-Bamboo Hut', 'Private Dome', 'Lux Dome']);
  assert.ok(!/[–—]/.test(c.summary));
  const slots = await secretIslandKiteCampPalawan.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  // all tours lie before 2027-03-20; after that the live list is empty until the camp publishes new dates
  if (slots.length) assert.match(slots[0].availabilityText!, /^Send an inquiry, and we will get back to you regarding availability/);
});
