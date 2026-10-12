// Mazava Loha Resort (Emerald Sea, Diego Suarez): replays the pages recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mazavaLohaResortDiegoSuarez, buildMzSlots, mzRateImage, MZ_BANDS, MZ_RATE_SHEET,
} from '../../src/offers/adapters/mazava-loha-resort-diego-suarez.js';
import { todayIso } from '../../src/offers/parse.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/mazava-loha-resort-diego-suarez');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };

test('mazava: the bungalows page still shows the hand-read rate sheet', () => {
  assert.deepEqual(mzRateImage(read('mazavaloha-resort.com_en_bungalow-hotel-emerald-sea-madagascar_.')), { file: MZ_RATE_SHEET, heading: 'Rates 2025/2026.' });
  // the kite page shows the kite rate sheet, not the room one
  assert.equal(mzRateImage(read('mazavaloha-resort.com_en_kite-windsurf-emerald-sea-madagascar_.'))?.file, 'Capture-decran-2026-01-08-152004.png');
  assert.equal(mzRateImage('<h2>Rates 2027.</h2><div><img src="https://mazavaloha-resort.com/wp-content/uploads/Rates-2027.png"></div>')?.file, 'Rates-2027.png');
});

test('mazava: season bands are contiguous from 2026-04-01 to 2027-01-05', () => {
  for (let i = 1; i < MZ_BANDS.length; i++) {
    const next = new Date(Date.parse(MZ_BANDS[i - 1].end) + 86400000).toISOString().slice(0, 10);
    assert.equal(MZ_BANDS[i].start, next);
  }
  assert.equal(MZ_BANDS[0].start, '2026-04-01');
  assert.equal(MZ_BANDS[MZ_BANDS.length - 1].end, '2027-01-05');
});

test('mazava: slots on 2026-10-12 = 3 bands x (3 suite + 5 bungalow occupancies), EUR per room per night', () => {
  const slots = buildMzSlots('2026-10-12');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 24);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.availability === 'on_request'));
  const by = (k: string) => slots.find(s => s.key === k)!;
  assert.deepEqual([by('sea-view-suite|2p|2026-10-01').price, by('sea-view-suite|2p|2026-10-01').endDate], [280, '2026-11-15']);
  assert.deepEqual([by('forest-bungalow|5p|2026-11-16').price, by('forest-bungalow|5p|2026-11-16').endDate], [375, '2026-12-20']);
  assert.deepEqual([by('forest-bungalow|1p|2026-12-21').price, by('forest-bungalow|1p|2026-12-21').endDate], [130, '2027-01-05']);
  assert.equal(Math.min(...slots.map(s => s.price!)), 110);
  assert.equal(buildMzSlots('2026-04-01').length, 64);
  assert.deepEqual(buildMzSlots('2027-01-06'), []);
});

test('mazava: fetchSlots releases the constants while the sheet is unchanged', async () => {
  const slots = await mazavaLohaResortDiegoSuarez.fetchSlots(ctx);
  assert.deepEqual(slots, buildMzSlots(todayIso()));
  assert.ok(notes.some(n => n.includes(MZ_RATE_SHEET)));
});

test('mazava: content', async () => {
  const c = await mazavaLohaResortDiegoSuarez.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Mazava Loha Resort');
  assert.equal(c.country, 'Madagascar');
  assert.equal(c.mealPlan, 'full_board');
  assert.equal(c.rooms.length, 2);
  assert.match(c.summary, /IKO instructor and two assistants/);
  assert.match(c.summary, /six wooden bungalows/);
  assert.match(c.summary, /early April to late November/);
  assert.ok(c.optionalServices.includes('Kite discovery course: 2 hours private lesson EUR 100'));
  assert.ok(c.optionalServices.includes('"Progression" group lessons (max 3 people): EUR 35 per person per hour with own equipment'));
  assert.ok(c.imageUrls.length >= 20);
  assert.ok(c.imageUrls.every(u => !/logo|Capture-d|-[bv]60/i.test(u)));
});
