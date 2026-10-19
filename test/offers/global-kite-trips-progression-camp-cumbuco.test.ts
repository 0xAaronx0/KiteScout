// Global Kite Trips Progression Camp Cumbuco: replays the camp page + /booking/ recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globalKiteTripsProgressionCampCumbuco, buildGktCampSlots, fetchGktCumbucoSlots, parseGktCamp, parseGktCumbucoContent, parseGktFormOptions } from '../../src/offers/adapters/global-kite-trips-progression-camp-cumbuco.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/global-kite-trips-progression-camp-cumbuco');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const camp = read('www.globalkitetrips.com_cumbuco-brazil');
const booking = read('www.globalkitetrips.com_booking_');
const ctx = { note: () => {}, incomplete: () => {} };

test('gkt cumbuco: sessions, sold-out headline, price picture linked', () => {
  const c = parseGktCamp(camp);
  assert.deepEqual(c.sessions.map(s => [s.start, s.end]), [['2026-10-24', '2026-11-03'], ['2026-11-14', '2026-11-24']]);
  assert.equal(c.soldOut, true);
  assert.equal(c.pricesLinked, true);
  assert.deepEqual(parseGktFormOptions(booking).filter(o => o.days === 8).map(o => [o.month, o.from, o.to]), [[10, 31, 3], [11, 14, 21]]);
});

test('gkt cumbuco: 8 slots per session, 8-day dates from the form when consistent', async () => {
  const s = buildGktCampSlots(parseGktCamp(camp), parseGktFormOptions(booking), '2026-10-19');
  assert.deepEqual(checkSlots(s).problems, []);
  assert.equal(s.length, 16);
  assert.ok(s.every(x => x.availability === 'sold_out' && x.currency === 'USD' && x.priceBasis === 'person'));
  const novShort = s.find(x => x.key === 'beginner-shared-8d|2026-11-14')!;
  assert.deepEqual([novShort.startDate, novShort.endDate, novShort.price, novShort.packageNights], ['2026-11-14', '2026-11-21', 1850, null]);
  const octShort = s.find(x => x.key === 'independent-private-8d|2026-10-24')!;
  assert.deepEqual([octShort.startDate, octShort.endDate, octShort.price, octShort.packageNights], ['2026-10-24', '2026-11-03', 2550, 7]);
  assert.equal(s.find(x => x.key === 'independent-private-11d|2026-11-14')!.price, 2750);
  assert.equal((await fetchGktCumbucoSlots('2026-10-30', ctx)).length, 8);
});

test('gkt cumbuco: content', async () => {
  const c = parseGktCumbucoContent(camp, '2026-10-19');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 11, 'Brazil', 'Ceará', 'Cumbuco']);
  assert.match(c.summary, /provider marks the camp sold out/);
  assert.ok(c.imageUrls.length >= 10 && !c.imageUrls.some(u => /Untitled-3|dummy/.test(u)));
  assert.equal(contentProblem(await globalKiteTripsProgressionCampCumbuco.fetchContent(ctx)), null);
});
