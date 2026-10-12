// Fagerheim Snowkite Camp (Dagali Fjellpark, Hardangervidda): replays the camp page, the beginners page and
// the prices page recorded 2026-10-12 (scripts except JSON-LD, styles, SVGs trimmed; Google Maps key redacted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dagaliSnowkiteCampFagerheim, buildDagSlots, dagRentalPrice, parseDagCards, parseDagLessonPrices, parseDagSeason,
} from '../../src/offers/adapters/dagali-snowkite-camp-fagerheim.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/dagali-snowkite-camp-fagerheim');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };
const camp = read('dagalifjellpark.no_en_snowkite-camp-fagerheim_.');
const prices = read('dagalifjellpark.no_en_prices-dagali-fjellpark_.');

test('dagali: price cards and season line', () => {
  const cards = parseDagCards(camp);
  assert.deepEqual(cards.map(c => [c.label, c.amount]), [
    ['Beginners', 10900],
    ['Kitesurfers', 4900],
    ['Snowkiters', 3900],
    ['Accommodation, Full Board & Services', 13930],
  ]);
  assert.ok(cards[0].features.includes('Complete snowkiting gear package'));
  assert.equal(dagRentalPrice(cards), 4000);
  assert.deepEqual(parseDagSeason(camp), { start: '2026-02-07', end: '2026-04-25', raw: 'Hardangervidda, Norway, 7.2. – 25.4.2026' });
});

test('dagali: one season band per variant, stay + course, NOK per person for 7 nights, on request', async () => {
  const slots = await dagaliSnowkiteCampFagerheim.fetchSlots(ctx);
  assert.deepEqual(slots, buildDagSlots(parseDagCards(camp), parseDagSeason(camp)!));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price]), [
    ['stay-full-board|2026', 13930],
    ['beginners|2026', 24830],
    ['kitesurfers|2026', 18830],
    ['snowkiters|2026', 17830],
  ]);
  assert.ok(slots.every(s => s.startDate === '2026-02-07' && s.endDate === '2026-04-25' && s.datePrecision === 'season'
    && s.currency === 'NOK' && s.priceUnit === 'package' && s.priceBasis === 'person' && s.packageNights === 7
    && s.availability === 'on_request'));
  // the 2026 season is over on the recording day: the adapter says so
  assert.ok(notes.some(n => /season 2026-02-07\.\.2026-04-25 is over/.test(n)));
});

test('dagali: snowkite lesson prices outside the camp', () => {
  assert.deepEqual(parseDagLessonPrices(prices), { privateDay: 2700, groupDayMin: 1600, groupDayMax: 2300 });
});

test('dagali: content', async () => {
  const c = await dagaliSnowkiteCampFagerheim.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.title, 'Fagerheim Snowkite Camp');
  assert.equal(c.country, 'Norway');
  assert.equal(c.spot, 'Fagerheim, Hardangervidda');
  assert.equal(c.durationDays, 8);
  assert.equal(c.mealPlan, 'full_board');
  assert.equal(c.kiteLessons, true);
  assert.deepEqual(c.languages, ['en']);
  assert.match(c.summary, /kiting on snow with skis or a snowboard, not on water/);
  assert.match(c.summary, /the stay costs 13,930 NOK/);
  assert.match(c.summary, /7 February 2026 to 25 April 2026/);
  assert.ok(c.includedServices.includes('Evening sauna'));
  assert.equal(c.rooms[0].features.at(-1), 'Weekly camp capacity 12 persons');
  assert.equal(c.imageUrls.length, 15);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://dagalifjellpark.no/wp-content/uploads/') && !/Map_EN/.test(u)));
});
