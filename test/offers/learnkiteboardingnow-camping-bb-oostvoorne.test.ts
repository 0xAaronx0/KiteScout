// LearnKiteboardingNow Camping Deluxe B&B (Oostvoorne): replays the German pages recorded 2026-10-12
// (wpbs calendar of October 2026 server-rendered in /camping-bb/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  learnkiteboardingnowCampingBbOostvoorne as lkn, buildLknSlots, lknAvailability, parseLknCalendar, parseLknPrices, LKN_UNIT,
} from '../../src/offers/adapters/learnkiteboardingnow-camping-bb-oostvoorne.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/learnkiteboardingnow-camping-bb-oostvoorne');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const camp = read('www.learnkiteboardingnow.de_camping-bb_.');

test('lkn: printed price boxes', () => {
  assert.deepEqual(parseLknPrices(camp), { bnb: 36, breakfast: 9, dinner: 15.5 });
});

test('lkn: wpbs calendar of the current month', () => {
  const cal = parseLknCalendar(camp)!;
  assert.equal(cal.title, 'Sheddie Deluxe-Einzelbetten');
  assert.equal(cal.currency, 'EUR');
  assert.deepEqual(cal.legends, { 1: 'Verfügbar', 2: 'Gebucht' });
  assert.equal(cal.months[0], 'Juli 2026');
  assert.equal(cal.months[cal.months.length - 1], 'Oktober 2027');
  assert.equal(cal.days.length, 31);
  assert.equal(cal.days.filter(d => d.legend === null).length, 11); // 1-11 Oct: past, hidden
  assert.ok(cal.days.every(d => d.price === 36));
});

test('lkn: slots = runs of equal price and status, EUR per bed per night', async () => {
  const slots = await lkn.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots, [{
    key: 'shed-bed|2026-10-12', startDate: '2026-10-12', endDate: '2026-10-31', unit: LKN_UNIT, price: 36, currency: 'EUR',
    priceUnit: 'per_night', priceBasis: 'person', occupancy: 1, availability: 'available', availabilityText: 'Verfügbar', spotsLeft: null,
  }]);
});

test('lkn: booked days split the band and become sold_out', () => {
  const cal = parseLknCalendar(camp)!;
  const days = cal.days.map(d => (d.date >= '2026-10-20' && d.date <= '2026-10-22' ? { ...d, legend: '2', bookable: false } : d));
  const slots = buildLknSlots({ ...cal, days });
  assert.deepEqual(slots.map(s => [s.key, s.endDate, s.availability, s.availabilityText]), [
    ['shed-bed|2026-10-12', '2026-10-19', 'available', 'Verfügbar'],
    ['shed-bed|2026-10-20', '2026-10-22', 'sold_out', 'Gebucht'],
    ['shed-bed|2026-10-23', '2026-10-31', 'available', 'Verfügbar'],
  ]);
  assert.equal(lknAvailability('Available', true), 'available');
  assert.equal(lknAvailability('Something else', true), 'unknown');
});

test('lkn: content', async () => {
  const c = await lkn.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'LearnKiteboardingNow Camping Deluxe B&B');
  assert.equal(c.country, 'Netherlands');
  assert.equal(c.region, 'Oostvoorne, South Holland');
  assert.equal(c.spotCoords, undefined);
  assert.match(c.summary, /kite school at Camping Ketjil in Oostvoorne/);
  assert.match(c.summary, /EUR 36 per person and night including breakfast/);
  assert.match(c.summary, /dinner buffet is EUR 15\.50 extra/);
  assert.match(c.summary, /running in Oostvoorne since 2004/);
  assert.equal(c.mealPlan, 'breakfast');
  assert.deepEqual(c.rooms.map(r => r.name), [LKN_UNIT]);
  assert.equal(c.imageUrls.length, 5);
  assert.ok(c.imageUrls.every(u => !/\.svg|logo|salad/i.test(u)));
});
