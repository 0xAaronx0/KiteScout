// Watersport Oman Kitesurf Camp, Bar al Hikman (Oman): replays watersport-oman.com pages recorded 2026-10-12
// (fixtures trimmed: script/style bodies and class attributes dropped; the hero background rule of the camps
// page kept).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildWsoSlots, parseGdMenu, parseWsoAgenda, parseWsoTents, watersportOmanCampBarAlHikman, wsoImages,
} from '../../src/offers/adapters/watersport-oman-camp-bar-al-hikman.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/watersport-oman-camp-bar-al-hikman');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const camps = read('watersport-oman.com_camps.');

test('wso: GoDaddy price-list widget -> sections and items', () => {
  const menu = parseGdMenu(camps);
  assert.deepEqual(menu.map(s => s.title), ['Kitesurf Camps - Bar Al Hikman- Shrimpies- Hidden lagoon', 'Down Winders']);
  assert.match(menu[0].description, /Bedouin Tent fits 1 child up to 8 years for free/);
  assert.deepEqual(menu[0].items.slice(0, 3).map(i => [i.title, i.price]), [
    ['Bedouin Tent (4x4m) per night 1 person', '110 omr'],
    ['Bedouin Tent (4x4m) per night 2 persons', '140 omr'],
    ['Transfer from Muscat', '130 omr'],
  ]);
  assert.equal(parseGdMenu(read('watersport-oman.com_prices.')).length, 10);
});

test('wso: slots = tent per night by persons, OMR, on request, no dates', async () => {
  const slots = await watersportOmanCampBarAlHikman.fetchSlots(ctx);
  assert.deepEqual(slots, buildWsoSlots(parseWsoTents(parseGdMenu(camps))));
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.occupancy]), [['bedouin-tent-1p', 110, 1], ['bedouin-tent-2p', 140, 2]]);
  assert.ok(slots.every(s => s.currency === 'OMR' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'on_request' && s.startDate === null && s.endDate === null && s.unit === 'Bedouin tent (4x4 m), full board'));
});

test('wso: the published camp agenda is 2025 (kept as text only)', () => {
  const a = parseWsoAgenda(read('watersport-oman.com_tours.'));
  assert.equal(a.heading, '2025 Bar al Hikman Camp Agenda');
  assert.deepEqual(a.blocks, ['Bar al Hikman 28.3-5.4', 'Hidden lagoon 9.5-18.5', 'Bar al Hikman 30.5-14.6', 'Bar al Hikman 11.7-20.7', 'Bar al Hikman 8.8-23.8', 'Bar al Hikman 5.9-21.9']);
});

test('wso: original GoDaddy uploads, no logo', () => {
  const imgs = wsoImages(camps);
  assert.equal(imgs.length, 8);
  assert.equal(imgs[0], 'https://img1.wsimg.com/isteam/ip/50c1c36f-98c7-47d6-afa1-4976abb9a97a/DJI_0583.jpeg');
  assert.ok(imgs.every(u => !/\/:\/|Final_Blue|favicon|Home%20Page/.test(u)));
});

test('wso: content', async () => {
  const c = await watersportOmanCampBarAlHikman.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.title, 'Watersport Oman Kitesurf Camp, Bar al Hikman');
  assert.equal(c.country, 'Oman');
  assert.equal(c.spot, 'Bar al Hikman');
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /OMR 110 per night for one person and OMR 140 for two/);
  assert.deepEqual(c.rooms[0].features.slice(0, 3), ['1 person: OMR 110 per night, all meals included', '2 persons: OMR 140 per night, all meals included', 'Fits 1 child up to 8 years for free']);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.ok(c.optionalServices.includes('Transfer from Muscat: 130 OMR (one way transfer upto 4 people)'));
  assert.ok(c.optionalServices.some(s => /^Downwinders .*Bar al Hikman 15 OMR/.test(s)));
  assert.equal(c.imageUrls.length, 8);
  assert.match(c.sourceText ?? '', /agenda: 2025 Bar al Hikman Camp Agenda Bar al Hikman 28\.3-5\.4/);
});
