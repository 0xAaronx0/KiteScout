// Versus Snowkite Trip (Hardangervidda): replays /en/snowkitetrip recorded 2026-10-19 (scripts except JSON-LD and the
// booking block's own script, styles, SVGs and the shop's mega-menu header trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  versusSnowkiteTripHaugastol, buildVersusSlots, parseVersusContent, parseVersusOptions, parseVersusPeriods, versusAvailability, versusTexts,
} from '../../src/offers/adapters/versus-snowkite-trip-haugastol.js';
import { todayIso } from '../../src/offers/parse.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/versus-snowkite-trip-haugastol');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith('www.versusshop.nl_en_snowkitetrip.'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('versus: periods from the booking text table + places left', () => {
  assert.equal(versusTexts(html).p1_d, 'Friday 12 February to Monday 22 February 2027');
  assert.deepEqual(parseVersusPeriods(html).map(p => [p.n, p.start, p.end, p.placesLeft]), [
    [1, '2027-02-12', '2027-02-22', 15],
    [2, '2027-03-04', '2027-03-14', 15],
  ]);
});

test('versus: priced options (rendered twice, read once)', () => {
  const o = parseVersusOptions(html);
  assert.deepEqual(o.map(x => [x.key, x.price]), [
    ['basis', 1899], ['verb_std', 0], ['verb_gedeeld', 435], ['verb_prive', 575], ['hut', 245], ['wk1', 495],
    ['kite_eigen', 0], ['kite_periode', 399], ['board_eigen', 0], ['ski', 249], ['ski_sch', 295], ['snb', 185],
    ['snb_sch', 215], ['bagage', 69],
  ]);
  assert.equal(o.find(x => x.key === 'verb_prive')!.label, 'Luxury room, private');
});

test('versus: one slot per period and room, EUR per person, places left as the page shows them', () => {
  const slots = buildVersusSlots(parseVersusPeriods(html), parseVersusOptions(html), '2026-10-19');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.availability, s.spotsLeft]), [
    ['2027-02-12|standard', 1899, 'available', 15],
    ['2027-02-12|shared', 2334, 'available', 15],
    ['2027-02-12|private', 2474, 'available', 15],
    ['2027-03-04|standard', 1899, 'available', 15],
    ['2027-03-04|shared', 2334, 'available', 15],
    ['2027-03-04|private', 2474, 'available', 15],
  ]);
  assert.ok(ok.every(s => s.currency === 'EUR' && s.priceUnit === 'package' && s.priceBasis === 'person'));
  // started / past periods are dropped
  assert.deepEqual(buildVersusSlots(parseVersusPeriods(html), parseVersusOptions(html), '2027-02-13').map(s => s.startDate), ['2027-03-04', '2027-03-04', '2027-03-04']);
  assert.deepEqual(buildVersusSlots(parseVersusPeriods(html), parseVersusOptions(html), '2027-03-05'), []);
});

test('versus: places-left wording maps like the page labels', () => {
  assert.deepEqual(versusAvailability(0), { availability: 'sold_out', text: 'Full' });
  assert.equal(versusAvailability(1).availability, 'limited');
  assert.equal(versusAvailability(4).availability, 'limited');
  assert.equal(versusAvailability(5).availability, 'available');
  assert.equal(versusAvailability(null).availability, 'on_request');
});

test('versus: adapter slots match the pure builder for today', async () => {
  assert.deepEqual(await versusSnowkiteTripHaugastol.fetchSlots(ctx), buildVersusSlots(parseVersusPeriods(html), parseVersusOptions(html), todayIso()));
});

test('versus: content', async () => {
  const c = await versusSnowkiteTripHaugastol.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.spot, 'Haugastøl, Hardangervidda');
  assert.equal(c.durationDays, 11);
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /16th edition/);
  assert.match(c.summary, /EUR 1,899 per person/);
  assert.match(parseVersusContent(html, '2026-10-19').summary, /Dates 2027: 12 February to 22 February and 4 March to 14 March; booking is by request form\./);
  assert.match(parseVersusContent(html, '2027-03-05').summary, /The 2027 dates are over; the next trip dates are not published yet\./);
  assert.ok(c.includedServices.includes('Breakfast, packed lunch and dinner, every day'));
  assert.ok(c.optionalServices.some(s => /^Kite rental, whole period .*\+EUR 399$/.test(s)));
  assert.ok(c.imageUrls.length >= 20 && c.imageUrls.every(u => u.startsWith('https://www.versusshop.nl/web/image/') && !/Schermafbeelding/.test(u)));
});
