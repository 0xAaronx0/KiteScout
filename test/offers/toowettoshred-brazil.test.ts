// Too Wet To Shred - Kite Camp Brazil: replays the page fixture recorded 2026-10-09.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  toowettoshredBrazil, parseToowettoshredContent, parseToowettoshredSlots, parseTwtsDepartures, parseTwtsRooms,
} from '../../src/offers/adapters/toowettoshred-brazil.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/toowettoshred-brazil');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith('www.toowettoshred.com'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('twts: departure cards', () => {
  assert.deepEqual(parseTwtsDepartures(html).map(d => [d.start, d.days, d.status, d.stops.length]), [
    ['2026-10-21', [11], 'Spots available', 4],
    ['2026-11-06', [11, 15], 'Waitlist only', 5],
  ]);
});

test('twts: room prices per trip length', () => {
  const rooms = parseTwtsRooms(html);
  assert.deepEqual(rooms.map(r => [r.name, r.prices[11], r.prices[15], r.currency]), [
    ['Twin Room', 2025, 2675, 'EUR'],
    ['Double Room', 1950, 2625, 'EUR'],
    ['Triple Room', 1825, 2400, 'EUR'],
    ['Flex Room', 1725, 2325, 'EUR'],
  ]);
});

test('twts: slots = departure x length x room, status from the badge', async () => {
  const slots = await toowettoshredBrazil.fetchSlots(ctx);
  assert.deepEqual(slots, parseToowettoshredSlots(html));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 12); // Oct: 4 rooms x 11d; Nov: 4 rooms x (11d + 15d)
  const oct = slots.find(s => s.key === 'twin-11d|2026-10-21')!;
  assert.equal(oct.price, 2025);
  assert.equal(oct.endDate, '2026-10-31');
  assert.equal(oct.unit, 'Twin Room');
  assert.equal(oct.occupancy, 2);
  assert.equal(oct.availability, 'available');
  assert.equal(oct.availabilityText, 'Spots available');
  const nov15 = slots.find(s => s.key === 'flex-15d|2026-11-06')!;
  assert.equal(nov15.price, 2325);
  assert.equal(nov15.endDate, '2026-11-20');
  assert.equal(nov15.availability, 'waitlist');
  assert.equal(nov15.availabilityText, 'Waitlist only');
  assert.equal(nov15.occupancy, null);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'package' && s.priceBasis === 'person'));
});

test('twts: content', async () => {
  const c = await toowettoshredBrazil.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kite Camp Brazil');
  assert.equal(c.country, 'Brazil');
  assert.equal(c.spot, 'Cumbuco');
  assert.equal(c.durationDays, 11);
  assert.deepEqual(c.itinerarySpots.map(s => s.name), ['Cumbuco', 'Icaráí de Amontada', 'Ilha do Guajiru', 'Jericoacoara', 'Barra Grande', 'Mácapa']);
  assert.equal(c.includedServices.length, 12);
  assert.ok(c.includedServices.includes('Trick coaching'));
  assert.deepEqual(c.optionalServices, ['Full rental pack (Kites, bar, board): €575']);
  assert.equal(c.equipmentRental, true);
  assert.deepEqual(c.rooms.map(r => r.name), ['Twin Room', 'Double Room', 'Triple Room', 'Flex Room']);
  assert.ok(c.imageUrls.length >= 8, `images ${c.imageUrls.length}`);
  assert.ok(c.imageUrls.every(u => !/logo/i.test(u)));
  assert.match(c.summary, /EUR 1,725 per person/);
  assert.ok(!/[—–]/.test(c.summary), 'summary has no em/en dashes');
});

test('twts: summary names only departures that have not started (#267)', () => {
  // recorded 2026-10-09: both departures ahead
  assert.match(parseToowettoshredContent(html, '2026-10-09').summary,
    /Departures: 2026-10-21 \(11 days, spots available\) and 2026-11-06 \(11 or 15 days, waitlist only\)\./);
  // the 21 Oct trip has started but the page still shows its card as "Spots available"
  const c = parseToowettoshredContent(html, '2026-10-22');
  assert.match(c.summary, /Departures: 2026-11-06 \(11 or 15 days, waitlist only\)\./);
  assert.ok(!c.summary.includes('2026-10-21'));
  // all past: no stale dates
  const later = parseToowettoshredContent(html, '2026-11-07');
  assert.match(later.summary, /The next departures are not published yet\./);
  assert.ok(!/2026-1[01]-/.test(later.summary));
});
