// Keros Blue: replays kerosblue.com + Cloudbeds metadata recorded 2026-10-09. The availability calendar
// fixture is the response captured in the built-in browser on 2026-10-09 (Cloudbeds answers 403 to our
// client): 357 days, all empty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kerosBlueLimnos, kbCalendarBody, parseKbCalendar, parseKbRoomTypes,
} from '../../src/offers/adapters/keros-blue-limnos.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/keros-blue-limnos');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const rooms = parseKbRoomTypes(read('hotels.cloudbeds.com_booking_metadata'));

test('keros-blue: Cloudbeds room types from the JSON-LD metadata', () => {
  assert.deepEqual(rooms.map(r => [r.id, r.name, r.minGuests, r.maxGuests, r.images.length]), [
    ['339347', 'Double deluxe', 2, 3, 6],
    ['339348', 'Deluxe Apartment', 5, 5, 8],
  ]);
});

test('keros-blue: calendar request covers 12 months from the first of the month', () => {
  assert.equal(kbCalendarBody('2026-10-09'), 'end_date=2027-09-30&property_id=199881&start_date=2026-10-01');
  assert.equal(kbCalendarBody('2026-01-15'), 'end_date=2026-12-31&property_id=199881&start_date=2026-01-01');
});

test('keros-blue: captured calendar (no rates loaded) -> closed months', () => {
  const slots = parseKbCalendar(read('hotels.cloudbeds.com_booking_availability_calendar'), rooms);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 24); // 2 room types x Oct 2026 .. Sep 2027
  assert.ok(slots.every(s => s.availability === 'closed' && s.price === null));
  const jul = slots.find(s => s.key === 'double-deluxe|2027-07')!;
  assert.deepEqual([jul.startDate, jul.endDate, jul.unit, jul.priceBasis, jul.occupancy, jul.availabilityText],
    ['2027-07-01', '2027-07-31', 'Double deluxe', 'room', 2, 'no online rate loaded for 2027-07']);
});

test('keros-blue: calendar entries -> price and availability (synthetic, field names from Cloudbeds\' calendar mapper)', () => {
  const e = (room: string, rate: number, avail: number, extra: Record<string, unknown> = {}) =>
    ({ room_type_id: room, package_id: '0', rate_id: '1', rate: String(rate), avail, closed: 0, cta: 0, ctd: 0, min_l: 3, max_l: 0, ...extra });
  const cal = {
    '2027-07-01': [e('339347', 140, 5), e('339348', 260, 1), e('339347', 120, 5, { package_id: '77' })],
    '2027-07-02': [e('339347', 135, 4), e('339348', 250, 2)],
    '2027-08-01': [e('339347', 160, 0), e('339348', 280, 0, { closed: 1 })],
  };
  const slots = parseKbCalendar(JSON.stringify(cal), rooms);
  const by = (k: string) => slots.find(s => s.key === k)!;
  assert.deepEqual([by('double-deluxe|2027-07').price, by('double-deluxe|2027-07').availability], [135, 'available']); // package 77 ignored
  assert.deepEqual([by('deluxe-apartment|2027-07').price, by('deluxe-apartment|2027-07').availability, by('deluxe-apartment|2027-07').spotsLeft], [250, 'limited', 2]);
  assert.equal(by('double-deluxe|2027-08').availability, 'sold_out');
  assert.equal(by('double-deluxe|2027-08').price, null);
  assert.equal(by('double-deluxe|2027-07').currency, 'EUR');
});

test('keros-blue: content', async () => {
  const c = await kerosBlueLimnos.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Keros Blue');
  assert.equal(c.country, 'Greece');
  assert.equal(c.spot, 'Keros Bay, Limnos');
  assert.match(c.summary, /16 deluxe double rooms and 7 two-bedroom apartments/);
  assert.match(c.summary, /season June 1st to the end of September/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Double deluxe', 'Deluxe Apartment']);
  assert.ok(c.rooms[0].features.includes('Hammock on veranda'));
  assert.equal(c.includedServices.length, 12);
  assert.ok(c.optionalServices.includes('Kite surf lessons'));
  assert.equal(c.kiteLessons, true);
  assert.equal(c.beginnerFriendly, true);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls[0].startsWith('https://h-img'), 'Cloudbeds room photos first');
  assert.ok(c.imageUrls.some(u => u.includes('gallery-beach')));
});

test('keros-blue: a 403 from Cloudbeds becomes a clear error, never an empty slot list', async () => {
  const realFetch = globalThis.fetch;
  const fixtureDir = process.env.OFFERS_FIXTURE_DIR;
  delete process.env.OFFERS_FIXTURE_DIR;
  // what hotels.cloudbeds.com answered our client on 2026-10-09: robots.txt 200, /booking/* 403
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    return url.endsWith('/robots.txt') ? new Response('User-agent: *\nDisallow: /widget\n', { status: 200 }) : new Response('<html>403 Forbidden</html>', { status: 403 });
  }) as typeof fetch;
  try {
    await assert.rejects(() => kerosBlueLimnos.fetchSlots(ctx), /Cloudbeds blocks non-browser clients/);
  } finally {
    globalThis.fetch = realFetch;
    process.env.OFFERS_FIXTURE_DIR = fixtureDir;
  }
});
