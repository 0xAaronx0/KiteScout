// Sol y Mar Surf Camp (Flag Beach, Corralejo): replays the WP REST stay 82, the /accommodation/sol-y-mar/ detail page,
// the /accommodation/ overview and the kite packages page recorded 2026-10-27 after Flag Beach's redesign (HTML:
// scripts except JSON-LD, styles and comments trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  solYMarSurfCampCorralejo, parseSymApi, parseSymCard, parseSymDetail, parseSymFacts, parseSymKitePackages, symUnPhoton,
} from '../../src/offers/adapters/sol-y-mar-surf-camp-corralejo.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/sol-y-mar-surf-camp-corralejo');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const api = read('www.flagbeach.com_wp-json_wp_v2_stay_82_');
const overview = read('www.flagbeach.com_accommodation_.');
const detail = read('www.flagbeach.com_accommodation_sol-y-mar_.');
const packages = read('www.flagbeach.com_kite-surfing_kite-surfing-packages_.');

test('sym: WP stay 82 and the overview tile (Oct 2026 layout)', () => {
  const p = parseSymApi(api.slice(api.indexOf('{')));
  assert.equal(p.id, 82);
  assert.equal(p.title, 'Sol y Mar surf camp');
  // the cron failed "card no longer on /accommodation/" on the tile layout: the house is still listed
  assert.deepEqual(parseSymCard(overview), { distance: '4 km to Flag Beach', blurb: 'Hostel' });
  const tile = '<a class="fb-stay" href="/accommodation/surfers-retreat/"><span class="fb-stay__top"><span class="fb-stay__name">Surfer’s Retreat</span><span class="fb-stay__km">2 km</span></span></a>';
  assert.equal(parseSymCard(tile), null);
});

test('sym: the older card layout still parses', () => {
  const old = '<h3>Sol y Mar</h3><p>4km to Flag Beach</p><p>The Flag Beach surf hostel Sol y Mar is the original hostel regarded as the best value surf hostel in Fuerteventura.</p>';
  assert.deepEqual(parseSymCard(old), {
    distance: '4km to Flag Beach',
    blurb: 'The Flag Beach surf hostel Sol y Mar is the original hostel regarded as the best value surf hostel in Fuerteventura.',
  });
  assert.equal(parseSymCard('<h3>Surfer’s Retreat</h3><p>2km to Flag Beach</p>'), null);
});

test('sym: facts from the stay text and the detail page', () => {
  const f = parseSymFacts(parseSymApi(api.slice(api.indexOf('{'))).html);
  assert.equal(f.minNights, 3);
  assert.deepEqual([f.bedrooms, f.kitchens, f.bathrooms], [10, 2, 4]);
  assert.deepEqual(f.roomTypes, ['single', 'twin', 'double', 'triple', 'quad']);
  assert.equal(f.noBunkBeds, true);
  assert.equal(f.breakfast, true);
  assert.equal(f.bookingUrl, null, 'Cloudbeds is gone since the redesign');
  const d = parseSymDetail(detail);
  assert.equal(d.heroImage, 'https://www.flagbeach.com/wp-content/uploads/2026/09/stay-solymar.jpg');
  assert.equal(d.priceOnRequest, true);
  assert.equal(d.formBooking, true);
  const kp = parseSymKitePackages(packages);
  assert.deepEqual(kp[0], { name: 'Beginner kitesurfing camp 7 nights', details: '7 nights, Beginner', amount: 735 });
  assert.ok(kp.every(k => /kite/i.test(k.name)), 'surf / yoga camps are not kite packages');
  assert.deepEqual(parseSymKitePackages('<table><tr><td>Kite course<sup>3 days</sup></td><td>€299</td></tr></table>'), [{ name: 'Kite course', details: '3 days', amount: 299 }]);
  assert.equal(symUnPhoton('https://i0.wp.com/flagbeach.com/wp-content/uploads/2021/02/2018-0109_035617.jpeg?resize=640%2C440&ssl=1'),
    'https://www.flagbeach.com/wp-content/uploads/2021/02/2018-0109_035617.jpeg');
});

test('sym: no prices on the own site -> no slots, the tile guard passes', async () => {
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
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /old town of Corralejo, Fuerteventura, 4 km from Flag Beach/);
  assert.match(c.summary, /10 bedrooms \(single, twin, double, triple, quad, no bunk beds\)/);
  assert.match(c.summary, /minimum stay is 3 nights/);
  assert.match(c.summary, /sending your dates through Flag Beach's form/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Single room', 'Twin room', 'Double room', 'Triple room', 'Quad room']);
  assert.equal(c.sourceUrl, 'https://www.flagbeach.com/accommodation/sol-y-mar/');
  assert.equal(c.bookingUrl, 'https://www.flagbeach.com/accommodation/sol-y-mar/');
  assert.deepEqual(c.imageUrls, ['https://www.flagbeach.com/wp-content/uploads/2026/09/stay-solymar.jpg']);
  assert.equal(solYMarSurfCampCorralejo.instantBooking, false);
  assert.ok(!/[–—]/.test(c.summary));
});
