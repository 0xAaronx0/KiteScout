// Sol y Mar Surf Camp (Flag Beach, Corralejo): replays WP REST page 623, the /accommodation/ overview and the
// kite packages page recorded 2026-10-12 (HTML: scripts except JSON-LD, styles, SVGs and data URIs trimmed).
// Cloudbeds is not called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  solYMarSurfCampCorralejo, parseSymApi, parseSymCard, parseSymFacts, parseSymKitePackages, symUnPhoton,
} from '../../src/offers/adapters/sol-y-mar-surf-camp-corralejo.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/sol-y-mar-surf-camp-corralejo');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const api = read('www.flagbeach.com_wp-json_wp_v2_pages_623_');
const overview = read('www.flagbeach.com_accommodation_.');
const packages = read('www.flagbeach.com_kite-surfing_kite-surfing-packages_.');

test('sym: WP page 623 and the overview card', () => {
  const p = parseSymApi(api);
  assert.equal(p.id, 623);
  assert.equal(p.title, 'Sol y Mar surf camp');
  assert.equal(p.modified, '2026-04-17T06:26:51');
  assert.deepEqual(parseSymCard(overview), {
    distance: '4km to Flag Beach',
    blurb: 'The Flag Beach surf hostel Sol y Mar is the original hostel regarded as the best value surf hostel in Fuerteventura, a great place for single travelers or groups of surfers.',
  });
  assert.equal(parseSymCard('<h3>Surfer’s Retreat</h3><p>2km to Flag Beach</p>'), null);
});

test('sym: facts from the page text', () => {
  const f = parseSymFacts(parseSymApi(api).html);
  assert.equal(f.minNights, 3);
  assert.deepEqual([f.bedrooms, f.kitchens, f.bathrooms], [10, 2, 4]);
  assert.deepEqual(f.roomTypes, ['single', 'twin', 'double', 'triple', 'quad']);
  assert.equal(f.noBunkBeds, true);
  assert.equal(f.breakfast, true);
  assert.equal(f.facilities.length, 13);
  assert.equal(f.bookingUrl, 'https://hotels.cloudbeds.com/reservation/RGVfxl');
  assert.equal(f.imageUrls.length, 13);
  assert.ok(f.imageUrls.every(u => /^https:\/\/www\.flagbeach\.com\/wp-content\/uploads\/2021\/02\/2018-0109_\d+\.jpeg$/.test(u)));
  assert.equal(parseSymKitePackages(packages)[0].amount, 680);
  assert.equal(symUnPhoton('https://i0.wp.com/flagbeach.com/wp-content/uploads/2021/02/2018-0109_035617.jpeg?resize=640%2C440&ssl=1'),
    'https://www.flagbeach.com/wp-content/uploads/2021/02/2018-0109_035617.jpeg');
});

test('sym: no prices on the own site -> no slots, the card guard passes', async () => {
  const slots = await solYMarSurfCampCorralejo.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
});

test('sym: content', async () => {
  const c = await solYMarSurfCampCorralejo.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Sol y Mar Surf Camp');
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.country, 'Spain');
  assert.equal(c.spot, 'Corralejo, Fuerteventura');
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /old town of Corralejo, Fuerteventura, 4 km from Flag Beach/);
  assert.match(c.summary, /10 bedrooms \(single, twin, double, triple, quad, no bunk beds\)/);
  assert.match(c.summary, /minimum stay is 3 nights/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Single room', 'Twin room', 'Double room', 'Triple room', 'Quad room']);
  assert.equal(c.sourceUrl, 'https://www.flagbeach.com/accommodation/');
  assert.equal(solYMarSurfCampCorralejo.confidence, 'low');
});
