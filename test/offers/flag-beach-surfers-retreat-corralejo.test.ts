// Flag Beach Surfer's Retreat (Corralejo): replays the retreat page and the kite packages page recorded
// 2026-10-12 (scripts except JSON-LD, styles, SVGs and data URIs trimmed). Cloudbeds is not called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  flagBeachSurfersRetreatCorralejo, buildFbrSlots, parseFbrFacilities, parseFbrKitePackages, parseFbrMinNights, parseFbrRates, unPhoton,
} from '../../src/offers/adapters/flag-beach-surfers-retreat-corralejo.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/flag-beach-surfers-retreat-corralejo');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const retreat = read('www.flagbeach.com_accommodation_surfers-retreat_.');
const packages = read('www.flagbeach.com_kite-surfing_kite-surfing-packages_.');

test('fbr: price table rows -> per bed / per room occupancy', () => {
  assert.deepEqual(parseFbrRates(retreat).map(r => [r.unit, r.amount, r.currency, r.from, r.basis, r.occupancy]), [
    ['1 bed in dorm room', 23, 'EUR', true, 'person', 1],
    ['1 bed in twin room', 27, 'EUR', true, 'person', 1],
    ['Double bed single occupancy', 46, 'EUR', true, 'room', 1],
    ['Double bed double occupancy', 55, 'EUR', true, 'room', 2],
  ]);
  assert.equal(parseFbrMinNights(retreat), 3);
});

test('fbr: slots = undated rows, minimum stay 3 nights, no live availability', async () => {
  const slots = await flagBeachSurfersRetreatCorralejo.fetchSlots(ctx);
  assert.deepEqual(slots, buildFbrSlots(parseFbrRates(retreat), 3));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.priceBasis, s.occupancy]), [
    ['1-bed-in-dorm-room', 23, 'person', 1],
    ['1-bed-in-twin-room', 27, 'person', 1],
    ['double-bed-single-occupancy', 46, 'room', 1],
    ['double-bed-double-occupancy', 55, 'room', 2],
  ]);
  assert.ok(slots.every(s => s.startDate === null && s.endDate === null && s.currency === 'EUR' && s.priceUnit === 'per_night'
    && s.availability === 'unknown' && s.minNights === 3));
});

test('fbr: facilities and the school\'s hostel kite packages', () => {
  const f = parseFbrFacilities(retreat);
  assert.equal(f.length, 18);
  assert.ok(f.includes('Pool') && f.includes('All linen & towels'));
  const p = parseFbrKitePackages(packages);
  assert.equal(p.length, 8);
  assert.deepEqual(p[0], { name: 'Beginner kitesurfing camp 7 nights', details: '7 nights surf hostel stay, 4 day kitesurfing course', amount: 680 });
});

test('fbr: Jetpack CDN URLs unwrap to the site', () => {
  assert.equal(unPhoton('https://i0.wp.com/flagbeach.com/wp-content/uploads/2021/02/2018-0109_035729.jpeg?ssl=1'),
    'https://www.flagbeach.com/wp-content/uploads/2021/02/2018-0109_035729.jpeg');
  assert.equal(unPhoton('https://example.com/a.jpg'), 'https://example.com/a.jpg');
});

test('fbr: content', async () => {
  const c = await flagBeachSurfersRetreatCorralejo.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, "Surfer's Retreat");
  assert.equal(c.country, 'Spain');
  assert.equal(c.region, 'Canary Islands');
  assert.equal(c.spot, 'Corralejo, Fuerteventura');
  assert.equal(c.kiteLessons, true);
  assert.equal(c.mealPlan, null);
  assert.match(c.summary, /sleeps 14 in twin and double rooms and a dorm/);
  assert.match(c.summary, /beds start at €23 per night in the dorm and €55 for a double room for two, minimum stay 3 nights/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Dorm room', 'Twin room', 'Double room']);
  assert.equal(c.bookingUrl, 'https://hotels.cloudbeds.com/reservation/kn1mGC');
  assert.equal(c.imageUrls.length, 13);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://www.flagbeach.com/wp-content/uploads/') && !/Pastilla|logo/i.test(u)));
});
