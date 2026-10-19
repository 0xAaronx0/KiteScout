// MF Kite week course + Casa Alma (Almanarre, Hyères): replays /sejour-kitesurf-hebergement/ recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mfKiteStageCasaAlmaAlmanarre, buildMfkSlots, fetchMfkSlots, mfkBands, parseMfkTables,
} from '../../src/offers/adapters/mf-kite-stage-casa-alma-almanarre.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/mf-kite-stage-casa-alma-almanarre');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const html = read('www.mfkite.com_sejour-kitesurf-hebergement_');

test('mfk: room table, season key, stage semaine, page edit', () => {
  const t = parseMfkTables(html);
  assert.deepEqual(t.room, { hors: 320, mi: 450, saison: null });
  assert.deepEqual([t.roomMonths[1], t.roomMonths[4], t.roomMonths[7], t.roomMonths[9], t.roomMonths[10]], ['hors', 'mi', 'saison', 'mi', 'hors']);
  assert.deepEqual(t.stage, { hs: 500, saison: 600 });
  assert.deepEqual(t.stageSeason, { from: [4, 4], to: [11, 11] });
  assert.equal(t.modified, '2026-07-07');
  assert.equal(t.villas.length, 2);
});

test('mfk: bands split at room and lesson season changes, one cycle from the edit month', () => {
  const t = parseMfkTables(html);
  const b = mfkBands(t, '2026-07-07');
  assert.deepEqual(b.map(x => [x.start, x.end, x.roomSeason, x.stageHigh]), [
    ['2026-07-01', '2026-08-31', 'saison', true], ['2026-09-01', '2026-09-30', 'mi', true],
    ['2026-10-01', '2026-11-11', 'hors', true], ['2026-11-12', '2027-03-31', 'hors', false],
    ['2027-04-01', '2027-04-03', 'mi', false], ['2027-04-04', '2027-06-30', 'mi', true],
  ]);
  const early = buildMfkSlots(t, '2026-07-07', '2026-07-10');
  assert.deepEqual(checkSlots(early).problems, []);
  assert.deepEqual([early[0].price, early[0].currency, early[0].availabilityText?.includes('price on request')], [null, null, true]);
});

test('mfk: future slots from the recording day', async () => {
  const slots = await fetchMfkSlots('2026-10-19', ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.startDate, s.endDate, s.price]), [
    ['2026-10-01', '2026-11-11', 920], ['2026-11-12', '2027-03-31', 820], ['2027-04-01', '2027-04-03', 950], ['2027-04-04', '2027-06-30', 1050],
  ]);
  const s = slots[1];
  assert.deepEqual([s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.packageNights, s.availability], ['EUR', 'package', 'person', 1, 7, 'on_request']);
  const notes: string[] = [];
  assert.deepEqual(await fetchMfkSlots('2027-07-01', { note: t => notes.push(t) }), []);
  assert.match(notes[0], /cycle anchored on 2026-07-07 has passed/);
});

test('mfk: content', async () => {
  const c = await mfKiteStageCasaAlmaAlmanarre.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 8, 'France', "Provence-Alpes-Côte d'Azur", "L'Almanarre, Giens (Hyères)"]);
  assert.match(c.summary, /a week with lessons starts at EUR 820 per person/);
  assert.ok(c.imageUrls.length >= 6);
});
