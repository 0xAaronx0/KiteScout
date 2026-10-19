// Ölandkite Progression Kitecamp (Färjestaden, Öland): replays /kitecamps/oland/ recorded 2026-10-19 (only 14-17 May 2026
// listed -> no slots on the recording day; the slot builder is checked with an earlier "today").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  olandkiteProgressionKitecampFarjestaden, buildOkpSlots, fetchOkpSlots, parseOkpCamp, parseOkpContent, parseSvRange,
} from '../../src/offers/adapters/olandkite-progression-kitecamp-farjestaden.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/olandkite-progression-kitecamp-farjestaden');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const html = read('olandkite.se_kitecamps_oland_');

test('okp: Swedish date ranges and the camp block', () => {
  assert.deepEqual(parseSvRange('14-17 maj 2026'), { start: '2026-05-14', end: '2026-05-17' });
  assert.deepEqual(parseSvRange('30 maj - 2 juni 2027'), { start: '2027-05-30', end: '2027-06-02' });
  assert.deepEqual(parseOkpCamp(html), { start: '2026-05-14', end: '2026-05-17', dateText: '14-17 maj 2026', price: 6995, nights: 3, maxParticipants: 6 });
});

test('okp: slot only while the date is ahead', async () => {
  const early = buildOkpSlots(parseOkpCamp(html), '2026-03-20');
  assert.deepEqual(checkSlots(early).problems, []);
  assert.deepEqual(early.map(s => [s.key, s.endDate, s.price, s.currency, s.priceUnit, s.priceBasis, s.packageNights, s.availability]),
    [['2026-05-14', '2026-05-17', 6995, 'SEK', 'package', 'person', 3, 'on_request']]);
  const notes: string[] = [];
  assert.deepEqual(await fetchOkpSlots('2026-10-19', { note: t => notes.push(t) }), []);
  assert.match(notes[0], /14-17 maj 2026\) is past/);
});

test('okp: content', async () => {
  const c = await olandkiteProgressionKitecampFarjestaden.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 4, 'Sweden', 'Färjestaden, Öland', 'Färjestaden']);
  assert.match(parseOkpContent(html, '2026-10-19').summary, /Held in 2026 over the Ascension long weekend \(14-17 May\); the 2027 date is not yet published\.$/);
  assert.match(parseOkpContent(html, '2026-03-20').summary, /Next camp: 14-17 May 2026\./);
  assert.ok(c.imageUrls.length >= 5);
  assert.ok(!c.imageUrls.includes('https://olandkite.se/wp-content/uploads/2022/05/IMG_9632.jpeg'));
});
