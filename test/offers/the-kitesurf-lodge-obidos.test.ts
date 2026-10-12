// The Kitesurf Lodge (Lagoa de Óbidos): replays home, /accommodation/ and /faq/ recorded 2026-10-12
// (scripts except JSON-LD, styles, SVGs and data URIs trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  theKitesurfLodgeObidos, parseTklRooms, parseTklWinter, tklVisiblePrices,
} from '../../src/offers/adapters/the-kitesurf-lodge-obidos.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/the-kitesurf-lodge-obidos');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };
const accommodation = read('thekitesurflodge.com_accommodation_.');

test('tkl: room cards', () => {
  const rooms = parseTklRooms(accommodation);
  assert.deepEqual(rooms.map(r => [r.name, r.features]), [
    ['Private Rooms', ['Double or twin beds', 'Shared bathrooms']],
    ['Dorm Room', ['Shared bathrooms']],
  ]);
  assert.match(rooms[0].description!, /Bathrooms are shared/);
});

test('tkl: winter notice = the 2026/27 off-season offer (no rates)', () => {
  assert.match(parseTklWinter(accommodation)!, /^From November the house stays open: stays from 2 nights or for 1 to 4 months, room only/);
});

test('tkl: no room price on the site -> [] (price on request), travel prices ignored', async () => {
  assert.deepEqual(tklVisiblePrices(accommodation), []);
  // the travel section prints rental-car and transfer prices; they must not count as room rates
  assert.match(accommodation, /120 total per vehicle/);
  const slots = await theKitesurfLodgeObidos.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
  // a price showing up on the page is reported
  assert.deepEqual(tklVisiblePrices('<main><h3>Private Rooms</h3><p>from €45 per night</p></main>'), ['€45']);
});

test('tkl: content', async () => {
  const c = await theKitesurfLodgeObidos.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'The Kitesurf Lodge');
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.country, 'Portugal');
  assert.equal(c.region, 'Leiria');
  assert.equal(c.spot, 'Lagoa de Óbidos');
  assert.deepEqual(c.spotCoords, { lat: 39.4125, lng: -9.2258 });
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /own IKO-certified school/);
  assert.match(c.summary, /From November the lodge stays open/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Private Rooms', 'Dorm Room']);
  assert.ok(c.optionalServices.includes('Private transfer from Lisbon Airport (approx. €120 per vehicle, 1-8 guests)'));
  assert.ok(c.imageUrls.length >= 15);
  assert.ok(c.imageUrls.every(u => /^https:\/\/thekitesurflodge\.com\/wp-content\/uploads\//.test(u) && !/logo|mega-menu|\.svg/i.test(u)));
  assert.match(c.sourceText!, /30% deposit is required/);
});
