// Lineup Kite & Surf House (Taíba): replays the English one-pager recorded 2026-10-12 (script bodies, SVGs
// and all CSS except the background-image declarations trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  lineupKiteSurfHouseTaiba, lineupImages, lineupText, lineupVisiblePrices, parseLineupFacts,
} from '../../src/offers/adapters/lineup-kite-surf-house-taiba.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/lineup-kite-surf-house-taiba');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };
const home = read('lineup-pousada.com_.');

test('lineup: facts from the one-pager', () => {
  assert.deepEqual(parseLineupFacts(lineupText(home)), {
    doubles: 8, triples: 1, dorms: 2, verandaM2: 30,
    windMonths: 7, windMin: 18, windMax: 32, windFrom: 'July', windTo: 'January',
    swellFrom: 'January', swellTo: 'April', kmFromFortaleza: 75,
  });
});

test('lineup: photos are the CSS background images, logos dropped', () => {
  const imgs = lineupImages(home);
  assert.equal(imgs.length, 8);
  assert.ok(imgs.includes('https://www.lineup-pousada.com/wp-content/uploads/2021/06/LINEUP_ROOM.jpeg'));
  assert.ok(imgs.every(u => !/logo|intragram/i.test(u)));
});

test('lineup: no price on the site -> [] (price on request)', async () => {
  assert.deepEqual(lineupVisiblePrices(home), []);
  const slots = await lineupKiteSurfHouseTaiba.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
  assert.deepEqual(lineupVisiblePrices('<p>Kite & Surf House</p><p>Double room R$ 280 per night</p><p>FACEBOOK</p>'), ['R$ 280']);
});

test('lineup: content', async () => {
  const c = await lineupKiteSurfHouseTaiba.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Lineup Kite & Surf House');
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.country, 'Brazil');
  assert.equal(c.region, 'Ceará');
  assert.equal(c.spot, 'Taíba');
  assert.equal(c.spotCoords, undefined);
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /8 double rooms, 1 triple room and 2 dormitories/);
  assert.match(c.summary, /18-32 knots from July to January/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Double room', 'Triple room', 'Dormitory']);
  assert.ok(c.includedServices.includes('Kite storage'));
  assert.equal(c.heroVideoUrl, 'https://www.lineup-pousada.com/wp-content/uploads/2021/06/LINEUP-Taiba-Kite-Surf-House.mp4');
  assert.equal(c.bookingUrl, 'https://api.whatsapp.com/send?phone=5585991431583');
  assert.match(c.sourceText!, /Kite storage is provided/);
});
