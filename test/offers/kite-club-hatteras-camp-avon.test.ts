// Kite Club Hatteras kite camp (Avon): replays /kitesurfing-camps/ + the Store API product list recorded 2026-10-14.
// All four 2026 weeks were past on the recording day, so the adapter returns no slots; the week parser is checked with
// an earlier "today".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kiteClubHatterasCampAvon, buildKccSlots, fetchKccSlots, parseKccCamp } from '../../src/offers/adapters/kite-club-hatteras-camp-avon.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-club-hatteras-camp-avon');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const camps = read('kiteclubhatteras.com_kitesurfing-camps_');

test('kcc: dated 2026 weeks, USD range, second person', () => {
  const c = parseKccCamp(camps);
  assert.equal(c.year, 2026);
  assert.deepEqual(c.weeks.map(w => [w.start, w.end]), [
    ['2026-04-04', '2026-04-11'], ['2026-04-25', '2026-05-02'], ['2026-09-12', '2026-09-19'], ['2026-09-26', '2026-10-03'],
  ]);
  assert.deepEqual([c.priceMin, c.priceMax, c.secondPerson], [1500, 1600, 395]);
});

test('kcc: slots only for weeks that have not started', async () => {
  const c = parseKccCamp(camps);
  const early = buildKccSlots(c, '2026-04-20');
  assert.deepEqual(checkSlots(early).problems, []);
  assert.deepEqual(early.map(s => s.key), ['2026-04-25', '2026-09-12', '2026-09-26']);
  const s = early[0];
  assert.deepEqual([s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.availability, s.endDate],
    [1500, 'USD', 'package', 'person', 1, 'unknown', '2026-05-02']);
  assert.match(s.availabilityText!, /USD 1500-1600 per camp week .*second person sharing the room \+USD 395/);
  const notes: string[] = [];
  assert.deepEqual(await fetchKccSlots('2026-10-14', { note: t => notes.push(t) }), []);
  assert.match(notes[0], /all 2026 camp weeks are past/);
});

test('kcc: content', async () => {
  const c = await kiteClubHatterasCampAvon.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 8, 'United States', 'Hatteras Island, North Carolina', 'Avon']);
  assert.match(c.summary, /Camp dates 2026: April 4 - 11, April 25 - May 2, September 12 - 19, September 26 - October 3, at USD 1,500 to 1,600 per person/);
  assert.ok(c.imageUrls.length >= 10);
  assert.equal(c.imageUrls[1], 'https://kiteclubhatteras.com/wp-content/uploads/2023/10/Kiteboarding-Camp-Group-Photo.webp');
});
