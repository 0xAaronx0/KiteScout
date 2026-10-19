// Nordseewindsport kite event weeks (Ringkøbing Fjord): replays the Denmark camp page recorded 2026-10-19 (all three 2026
// weeks past and sold out -> no slots; the week parser is checked with an earlier "today").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  nordseewindsportKitecampRingkobingFjord, buildNwsSlots, fetchNwsSlots, nwsAvailability, nwsImages, parseNwsContent, parseNwsPrices, parseNwsWeeks,
} from '../../src/offers/adapters/nordseewindsport-kitecamp-ringkobing-fjord.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/nordseewindsport-kitecamp-ringkobing-fjord');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const html = read('nordseewindsport.de_Camps_Daenemark_index.php_');

test('nws: dated weeks with status, room prices', () => {
  assert.deepEqual(parseNwsWeeks(html).map(w => [w.start, w.end, w.level, w.status]), [
    ['2026-08-29', '2026-09-05', 'alle Level', 'leider ausgebucht'],
    ['2026-09-05', '2026-09-12', 'alle Level', 'leider ausgebucht'],
    ['2026-09-12', '2026-09-19', 'alle Level', 'leider ausgebucht'],
  ]);
  assert.deepEqual(parseNwsPrices(html), { single: 999, double: 899, ownGear: 200, lessons: 250 });
  assert.deepEqual(['leider ausgebucht', 'Warteliste', 'nur noch 2 Plätze', null].map(nwsAvailability), ['sold_out', 'waitlist', 'limited', 'on_request']);
});

test('nws: slots only for weeks that have not started (none on the recording day)', async () => {
  const early = buildNwsSlots(parseNwsWeeks(html), parseNwsPrices(html), '2026-09-01');
  assert.deepEqual(checkSlots(early).problems, []);
  assert.deepEqual(early.map(s => s.key), ['single|2026-09-05', 'double|2026-09-05', 'single|2026-09-12', 'double|2026-09-12']);
  const s = early[1];
  assert.deepEqual([s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.packageNights, s.availability, s.endDate],
    [899, 'EUR', 'package', 'person', 2, 7, 'sold_out', '2026-09-12']);
  const notes: string[] = [];
  assert.deepEqual(await fetchNwsSlots('2026-10-19', { note: t => notes.push(t) }), []);
  assert.match(notes[0], /all listed event weeks are past/);
});

test('nws: content', async () => {
  const c = await nordseewindsportKitecampRingkobingFjord.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 8, 'Denmark', 'Hvide Sande, West Jutland', 'Hvide Sande']);
  assert.match(parseNwsContent(html, '2026-10-19').summary, /Runs every year; 2027 dates not yet published \(2026: August and September\)\.$/);
  assert.match(parseNwsContent(html, '2026-08-01').summary, /Event weeks: 2026-08-29 to 2026-09-05/);
  const imgs = nwsImages(html);
  assert.ok(imgs.length >= 15);
  assert.ok(imgs.every(u => u.includes('/picture-1600')));
  assert.ok(!imgs.some(u => /logo/i.test(u)));
});
