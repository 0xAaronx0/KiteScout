// Surf House Chałupy 3 (Kite Zone): replays the surf-house and home pages recorded 2026-10-12 (scripts except JSON-LD,
// styles, SVGs and style attributes trimmed; the reCAPTCHA site key and the bank account number redacted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  surfHouseKiteZoneChalupy, buildShSlots, parseShSeasons, shAnchor, shBands, shModified,
} from '../../src/offers/adapters/surf-house-kite-zone-chalupy.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/surf-house-kite-zone-chalupy');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const page = read('www.kitesurf.pl_surf-house_.');
const home = read('www.kitesurf.pl_.');

test('sh: price blocks (months, Corpus Christi exclusion, regular vs course-participant price)', () => {
  const s = parseShSeasons(page);
  assert.deepEqual(s.map(x => [x.label, x.months, x.exclusions]), [
    ['low', [5, 6], ['*z wyłączeniem terminu 04-07.06 (Boże Ciało)']],
    ['high', [7, 8, 9], []],
  ]);
  assert.deepEqual(s.map(x => x.units.map(u => [u.key, u.basis, u.occupancy, u.price, u.reduced])), [
    [['bed', 'person', 1, 100, null], ['double', 'room', 2, 240, null], ['quad', 'room', 4, 400, null]],
    [['bed', 'person', 1, 150, 120], ['double', 'room', 2, 400, 320], ['quad', 'room', 4, 600, 480]],
  ]);
  assert.match(s[1].note, /20% rabatu dla kursantów Kite Zone & Paliki Surf/);
});

test('sh: year anchor = the newer of the page edit and the home edit that still shows the Surf House', () => {
  assert.equal(shModified(page), '2025-02-17');
  assert.equal(shModified(home), '2026-02-16');
  assert.equal(shAnchor(page, home), '2026-02-16');
  assert.equal(shAnchor(page, home.replace(/Surf House/gi, 'Nocleg')), '2025-02-17');
  assert.equal(shAnchor(page, null), '2025-02-17');
  const seasons = parseShSeasons(page);
  assert.deepEqual(shBands(seasons, '2026-02-16').map(b => [b.season.label, b.start, b.end]), [
    ['low', '2026-05-01', '2026-06-03'], ['low', '2026-06-08', '2026-06-30'], ['high', '2026-07-01', '2026-09-30'],
  ]);
  // an anchor after the season rolls into the next one
  assert.deepEqual(shBands(seasons, '2026-10-12').map(b => b.start), ['2027-05-01', '2027-06-08', '2027-07-01']);
});

test('sh: slots = unit x season band, PLN per night, regular price, availability unknown', async () => {
  const slots = await surfHouseKiteZoneChalupy.fetchSlots(ctx);
  assert.deepEqual(slots, buildShSlots(parseShSeasons(page), '2026-02-16'));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.startDate, s.endDate, s.unit, s.price, s.priceBasis, s.occupancy]), [
    ['bed|2026-05-01', '2026-05-01', '2026-06-03', 'Bed in a shared room', 100, 'person', 1],
    ['double|2026-05-01', '2026-05-01', '2026-06-03', 'Double room', 240, 'room', 2],
    ['quad|2026-05-01', '2026-05-01', '2026-06-03', 'Four-bed room', 400, 'room', 4],
    ['bed|2026-06-08', '2026-06-08', '2026-06-30', 'Bed in a shared room', 100, 'person', 1],
    ['double|2026-06-08', '2026-06-08', '2026-06-30', 'Double room', 240, 'room', 2],
    ['quad|2026-06-08', '2026-06-08', '2026-06-30', 'Four-bed room', 400, 'room', 4],
    ['bed|2026-07-01', '2026-07-01', '2026-09-30', 'Bed in a shared room', 150, 'person', 1],
    ['double|2026-07-01', '2026-07-01', '2026-09-30', 'Double room', 400, 'room', 2],
    ['quad|2026-07-01', '2026-07-01', '2026-09-30', 'Four-bed room', 600, 'room', 4],
  ]);
  assert.ok(slots.every(s => s.currency === 'PLN' && s.priceUnit === 'per_night' && s.availability === 'unknown'));
});

test('sh: content', async () => {
  const c = await surfHouseKiteZoneChalupy.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Surf House Chałupy 3 (Kite Zone)');
  assert.equal(c.region, 'Chałupy, Hel Peninsula');
  assert.equal(c.spot, 'Chałupy');
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.deepEqual(c.skillLevels, ['beginner', 'intermediate', 'advanced']);
  assert.match(c.summary, /since 1999/);
  assert.match(c.summary, /built in 2025/);
  assert.match(c.summary, /PLN 100 for a bed in a shared room/);
  assert.match(c.summary, /a course from PLN 800 includes up to 2 free nights here \(from PLN 1,500: up to 6\)/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Bed in a shared room', 'Double room', 'Four-bed room']);
  assert.ok(c.rooms[1].features.includes('High season (July, August and September): PLN 400 per night, PLN 320 for Kite Zone and Paliki Surf course participants'));
  assert.equal(c.imageUrls.length, 10);
  assert.ok(c.imageUrls.every(u => /\/uploads\/2025\/0[25]\//.test(u)));
  assert.match(c.bookingUrl ?? '', /mobile-calendar\.com\/booking-engine\//);
});
