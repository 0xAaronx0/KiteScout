// Swiss Snowkiting School packages (Simplon Pass): replays /en/packages and /en/location recorded 2026-10-19
// (scripts, styles and SVGs trimmed; the CSRF token went with the scripts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  swissSnowkitingSchoolPackagesSimplon, buildSssSlots, parseSssContent, parseSssPackages, parseSssSeason, sssImages,
} from '../../src/offers/adapters/swiss-snowkiting-school-packages-simplon.js';
import { todayIso } from '../../src/offers/parse.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/swiss-snowkiting-school-packages-simplon');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const packages = read('www.snowkiting.ch_en_packages.');
const location = read('www.snowkiting.ch_en_location.');

test('swiss snowkiting: four package cards, CHF per person, nights and single surcharge', () => {
  const p = parseSssPackages(packages);
  assert.deepEqual(p.map(x => [x.name, x.price, x.currency, x.perPerson, x.nights, x.singleSurcharge]), [
    ['Snowkite Beginner Package', 690, 'CHF', true, 2, 20],
    ['Advanced Snowkite Package', 590, 'CHF', true, 2, 20],
    ['Snowkite Training Package', 960, 'CHF', true, 4, 30],
    ['Kite & Fly Package', 590, 'CHF', true, 2, 20],
  ]);
  assert.ok(p[3].features.some(f => /tandem paragliding flight/.test(f)));
});

test('swiss snowkiting: booking months give the season band', () => {
  assert.deepEqual(parseSssSeason(packages), {
    start: '2026-11-01', end: '2027-04-30',
    months: ['November 2026', 'December 2026', 'January 2027', 'February 2027', 'March 2027', 'April 2027'],
  });
});

test('swiss snowkiting: one season slot per package; a season that is over gives none', () => {
  const p = parseSssPackages(packages);
  const s = parseSssSeason(packages)!;
  const slots = buildSssSlots(p, s, '2026-10-19');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(x => [x.key, x.price, x.packageNights]), [
    ['snowkite-beginner|2026-27', 690, 2],
    ['advanced-snowkite|2026-27', 590, 2],
    ['snowkite-training|2026-27', 960, 4],
    ['kite-and-fly|2026-27', 590, 2],
  ]);
  assert.ok(ok.every(x => x.startDate === '2026-11-01' && x.endDate === '2027-04-30' && x.datePrecision === 'season'
    && x.currency === 'CHF' && x.priceUnit === 'package' && x.priceBasis === 'person' && x.availability === 'unknown'));
  assert.equal(buildSssSlots(p, s, '2027-04-30').length, 4);
  assert.deepEqual(buildSssSlots(p, s, '2027-05-01'), []);
});

test('swiss snowkiting: adapter slots match the pure builder for today', async () => {
  const slots = await swissSnowkitingSchoolPackagesSimplon.fetchSlots(ctx);
  assert.deepEqual(slots, buildSssSlots(parseSssPackages(packages), parseSssSeason(packages)!, todayIso()));
});

test('swiss snowkiting: content', async () => {
  const c = await swissSnowkitingSchoolPackagesSimplon.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.country, 'Switzerland');
  assert.equal(c.spot, 'Simplon Pass, Valais');
  assert.equal(c.durationDays, 3);
  assert.equal(c.mealPlan, 'breakfast');
  assert.match(c.summary, /not on water/);
  assert.match(c.summary, /Snowkite Training CHF 960 \(4 nights\)/);
  assert.match(parseSssContent({ packages, location }, '2026-10-19').summary, /booked from November 2026 to April 2027/);
  assert.match(parseSssContent({ packages, location }, '2027-05-01').summary, /next season dates are not on the page yet/);
  assert.ok(c.optionalServices.includes('Snowkite Training Package: single room +CHF 30'));
  assert.deepEqual(sssImages(packages, location), c.imageUrls);
  assert.equal(c.imageUrls.length, 6);
  assert.ok(c.imageUrls.includes('https://www.snowkiting.ch/assets/img/server/fotos/snowkite-frestyle-snowboarding.jpg.JPG'));
});
