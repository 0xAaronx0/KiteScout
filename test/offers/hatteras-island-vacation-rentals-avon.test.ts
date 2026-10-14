// Hatteras Island Vacation Rentals (Avon): replays the home page and the three soundfront property pages recorded
// 2026-10-14. No slots: rates and calendars are OwnerRez widgets on app.ownerrez.com, which robots.txt disallows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  hatterasIslandVacationRentalsAvon, hivrCoords, hivrImages, parseHivrHouse, HIVR_HOUSES,
} from '../../src/offers/adapters/hatteras-island-vacation-rentals-avon.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/hatteras-island-vacation-rentals-avon');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const houses = [
  parseHivrHouse(read('www.hatterasislandvacationrentals.com_seas-the-breeze-i-'), HIVR_HOUSES[0].url),
  parseHivrHouse(read('www.hatterasislandvacationrentals.com_seas-the-breeze-ii-'), HIVR_HOUSES[1].url),
  parseHivrHouse(read('www.hatterasislandvacationrentals.com_sounds-searious-'), HIVR_HOUSES[2].url),
];

test('hivr: property JSON-LD + page facts', () => {
  assert.deepEqual(houses.map(h => [h.name, h.number, h.bedrooms, h.sleeps, h.lat, h.lng]), [
    ['Seas the Breeze I', '101', 10, 24, 35.325055, -75.514661],
    ['Seas the Breeze II', '102', 10, 24, 35.324851, -75.514652],
    ["Sounds Sea'rious", '105', 10, 24, 35.3265249, -75.515922],
  ]);
  const ss = houses[2];
  assert.equal(ss.beds, '9 king, 2 double, 2 single');
  assert.equal(ss.poolSeason, 'April 1st - October 31st');
  assert.ok(ss.kiteLines.some(l => /uncrowded kite beaches is just steps away/.test(l)));
  assert.ok(ss.images.length >= 60);
  assert.ok(ss.images.some(i => /Kiteboarding Paradise/.test(i.alt)));
});

test('hivr: map pin = mean of the three houses, kite photos first', () => {
  assert.deepEqual(hivrCoords(houses), { lat: 35.32548, lng: -75.51508 });
  const imgs = hivrImages(houses);
  assert.equal(imgs.length, 40);
  assert.ok(imgs.every(u => /^https:\/\/uc\.orez\.io\/f\/[0-9a-f]+$/.test(u)));
  assert.equal(imgs[2], houses[2].images.find(i => /Kiteboarding Paradise/.test(i.alt))!.src);
});

test('hivr: slots = [] (OwnerRez rates robots-blocked)', async () => {
  const notes: string[] = [];
  const slots = await hatterasIslandVacationRentalsAvon.fetchSlots({ note: t => notes.push(t), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
});

test('hivr: content', async () => {
  const c = await hatterasIslandVacationRentalsAvon.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.country, c.region, c.spot], ['accommodation', 'United States', 'Hatteras Island, North Carolina', 'Avon']);
  assert.deepEqual(c.rooms.map(r => r.name), ['Seas the Breeze I', 'Seas the Breeze II', "Sounds Sea'rious"]);
  assert.ok(c.rooms[2].features.includes('Pool heating USD 600 per week (optional)'));
  assert.match(c.summary, /up to 72 guests/);
  assert.match(c.summary, /Canadian Hole and Kite Point/);
  assert.ok(c.includedServices.includes('Private heated pool'));
  assert.ok(c.includedServices.includes('Free WiFi'));
});
