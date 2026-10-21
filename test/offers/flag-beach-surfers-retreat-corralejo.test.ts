// Flag Beach Surfer's Retreat (Corralejo): replays the retreat page and the kite packages page recorded
// 2026-10-21 after the site redesign of 2026-10-19 (scripts except JSON-LD, styles, SVGs and data URIs trimmed);
// legacy-2026-10-12/ keeps the pages before it (price table, facilities list, Cloudbeds link).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  flagBeachSurfersRetreatCorralejo, buildFbrSlots, parseFbrFacilities, parseFbrKitePackages, parseFbrMinNights, parseFbrRates, unPhoton,
} from '../../src/offers/adapters/flag-beach-surfers-retreat-corralejo.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { slotRoom } from '../../src/offers/ingest.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/flag-beach-surfers-retreat-corralejo');
process.env.OFFERS_FIXTURE_DIR = DIR;
const read = (dir: string, prefix: string) => readFileSync(join(dir, readdirSync(dir).find(f => f.startsWith(prefix))!), 'utf8');
const LEGACY = join(DIR, 'legacy-2026-10-12');
const ctx = { note: () => {}, incomplete: () => {} };
const retreat = read(DIR, 'www.flagbeach.com_accommodation_surfers-retreat_.');
const packages = read(DIR, 'www.flagbeach.com_packages_kitesurf_.');
const legacyRetreat = read(LEGACY, 'www.flagbeach.com_accommodation_surfers-retreat_.');
const legacyPackages = read(LEGACY, 'www.flagbeach.com_kite-surfing_kite-surfing-packages_.');
const RATES = [
  ['1 bed in dorm room', 23, 'EUR', true, 'person', 1],
  ['1 bed in twin room', 27, 'EUR', true, 'person', 1],
  ['Double bed single occupancy', 46, 'EUR', true, 'room', 1],
  ['Double bed double occupancy', 55, 'EUR', true, 'room', 2],
];
const rateRows = (html: string) => parseFbrRates(html).map(r => [r.unit, r.amount, r.currency, r.from, r.basis, r.occupancy]);

test('fbr: redesigned page -> rates from the JSON-LD Offers, "Min. stay 3 nights"', () => {
  assert.deepEqual(rateRows(retreat), RATES);
  assert.equal(parseFbrMinNights(retreat), 3);
});

test('fbr: legacy price table rows -> the same rates (table path still read first)', () => {
  assert.deepEqual(rateRows(legacyRetreat), RATES);
  assert.equal(parseFbrMinNights(legacyRetreat), 3);
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

test('fbr: legacy facilities and hostel kite packages; the redesign has neither (kite cards no longer name the hostel)', () => {
  const f = parseFbrFacilities(legacyRetreat);
  assert.equal(f.length, 18);
  assert.ok(f.includes('Pool') && f.includes('All linen & towels'));
  const p = parseFbrKitePackages(legacyPackages);
  assert.equal(p.length, 8);
  assert.deepEqual(p[0], { name: 'Beginner kitesurfing camp 7 nights', details: '7 nights surf hostel stay, 4 day kitesurfing course', amount: 680 });
  assert.deepEqual(parseFbrFacilities(retreat), []);
  assert.deepEqual(parseFbrKitePackages(packages), []);
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
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /kite camps combine a 4-day course with 7 or 14 nights B&B in Corralejo\.$/);
  assert.equal(c.bookingUrl, 'https://www.flagbeach.com/contact-us/?fb_pkg=83#contact-form');
  assert.equal(flagBeachSurfersRetreatCorralejo.instantBooking, false);
  // only the retreat's own photo; the "Other stays" cards (other houses) are cut off
  assert.ok(c.imageUrls.length >= 1 && c.imageUrls.every(u => /\/stay-retreat[.-]/.test(u)), c.imageUrls.join(' '));
});

test('fbr: every price row prices one content room', async () => {
  const c = await flagBeachSurfersRetreatCorralejo.fetchContent(ctx);
  const slots = await flagBeachSurfersRetreatCorralejo.fetchSlots(ctx);
  const names = c.rooms.map(r => r.name);
  assert.deepEqual(slots.map(s => [s.unit, slotRoom(names, s)]), [
    ['1 bed in dorm room', 'Dorm room'],
    ['1 bed in twin room', 'Twin room'],
    ['Double bed single occupancy', 'Double room'],
    ['Double bed double occupancy', 'Double room'],
  ]);
});
