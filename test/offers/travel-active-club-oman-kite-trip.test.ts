// Travel Active Club Oman kite road trip: replays /copy-of-brazil-1-1 ("Oman 18-26 July 2026") recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { travelActiveClubOmanKiteTrip, parseTacTrip, buildTacSlots, fetchTacSlots, parseTacOmanContent, TAC_OMAN_URL } from '../../src/offers/adapters/travel-active-club-oman-kite-trip.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/travel-active-club-oman-kite-trip');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('tac oman: shared parser reads title year, heading dates, length, price, lists', () => {
  const t = parseTacTrip(html);
  assert.equal(t.title, 'Oman 18-26 July 2026');
  assert.deepEqual(t.departures, [{ start: '2026-07-18', end: '2026-07-26', label: '18-26 July 2026' }]);
  assert.deepEqual([t.days, t.nights], [9, 8]);
  assert.deepEqual(t.prices, [{ room: 'double room', key: 'double', amount: 2230, currency: 'EUR' }]);
  assert.equal(t.included.length, 6);
  assert.ok(t.excluded.some(l => /Kitesurfing equipment rental/i.test(l)));
});

test('tac oman: past departure -> no slots; before it -> one priced slot', async () => {
  const notes: string[] = [];
  assert.deepEqual(await fetchTacSlots(TAC_OMAN_URL, '2026-10-19', { note: n => notes.push(n) }), []);
  assert.match(notes[0], /all departures are past \(2026-07-18\)/);
  const early = buildTacSlots(parseTacTrip(html), '2026-06-01');
  assert.deepEqual(checkSlots(early).problems, []);
  assert.deepEqual(early.map(s => [s.key, s.endDate, s.price, s.currency, s.priceBasis, s.occupancy, s.availability]),
    [['double|2026-07-18', '2026-07-26', 2230, 'EUR', 'person', 2, 'on_request']]);
});

test('tac oman: a new dated heading with a year is read (cross-month)', () => {
  const t = parseTacTrip('<title>Oman 2027 | Travel Active Club</title><p>Oman</p><p>28 June - 6 July 2027</p><p>Plan of the Trip</p><p>Price per person in single room 2.650 euros</p>');
  assert.deepEqual(t.departures.map(d => [d.start, d.end]), [['2027-06-28', '2027-07-06']]);
  assert.deepEqual(t.prices.map(p => [p.key, p.amount]), [['single', 2650]]);
});

test('tac oman: content (tour, four stops, dates not published sentence)', async () => {
  const c = parseTacOmanContent(html, '2026-10-19');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.spot], ['tour', 9, 'Oman', 'Muscat']);
  assert.deepEqual(c.itinerarySpots.map(s => s.name), ['Muscat', 'Ras al Hadd', 'Masirah Island', 'Bar al Hikman']);
  assert.match(c.summary, /The next dates are not published yet \(last trip: 18-26 July 2026\)\. Price per person of the last trip \(2026\): EUR 2,230 in double room/);
  assert.ok(c.imageUrls.length >= 5 && c.imageUrls.every(u => !u.includes('11062b_')));
  assert.equal(contentProblem(await travelActiveClubOmanKiteTrip.fetchContent(ctx)), null);
});
