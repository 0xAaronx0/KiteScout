// Swiss Snowkiting School packages (Simplon Pass): replays the relaunched /en/packages overview, the four package pages
// and /en/location recorded 2026-11-11; the one-page layout of 2026-10-19 is kept as old-layout-2026-10-19_en_packages.txt
// (scripts, styles and SVGs trimmed; the CSRF token went with the scripts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  swissSnowkitingSchoolPackagesSimplon, buildSssSlots, parseSssContent, parseSssOverview, parseSssPackages, parseSssSeason, sssImages,
  sssPackagesAndSeason,
} from '../../src/offers/adapters/swiss-snowkiting-school-packages-simplon.js';
import { todayIso } from '../../src/offers/parse.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/swiss-snowkiting-school-packages-simplon');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const packages = read('old-layout-2026-10-19_en_packages.');
const location = read('www.snowkiting.ch_en_location.');
const overview = read('www.snowkiting.ch_en_packages.');
const details = ['snowkite-beginner-package', 'advanced-snowkite-package', 'snowkite-training-package', 'kite-fly-package']
  .map(slug => read(`www.snowkiting.ch_en_courses_${slug}.`));

// the relaunch of 2026-11-11 (cron: "package cards not found or changed (0 parsed)")
test('swiss snowkiting: the relaunched overview links four package pages, per person', () => {
  assert.deepEqual(parseSssPackages(overview), [], 'no h3.kurs on the overview any more');
  assert.deepEqual(parseSssOverview(overview).map(l => [l.url.replace('https://www.snowkiting.ch/en/courses/', ''), l.name, l.from, l.perPerson]), [
    ['snowkite-beginner-package', 'Snowkite Beginner Package', 690, true],
    ['advanced-snowkite-package', 'Advanced Snowkite Package', 590, true],
    ['snowkite-training-package', 'Snowkite Training Package', 960, true],
    ['kite-fly-package', 'Kite & Fly Package', 590, true],
  ]);
  const { pkgs, season } = sssPackagesAndSeason({ packages: overview, details });
  assert.deepEqual(pkgs.map(x => [x.name, x.id, x.price, x.currency, x.perPerson, x.nights, x.singleSurcharge]), [
    ['Snowkite Beginner Package', '211', 690, 'CHF', true, 2, null],
    ['Advanced Snowkite Package', pkgs[1].id, 590, 'CHF', true, 2, null],
    ['Snowkite Training Package', pkgs[2].id, 960, 'CHF', true, 4, null],
    ['Kite & Fly Package', pkgs[3].id, 590, 'CHF', true, 2, null],
  ]);
  assert.ok(pkgs[3].features.some(f => /tandem paragliding flight/.test(f)));
  assert.deepEqual(season, {
    start: '2026-11-01', end: '2027-04-30',
    months: ['November 2026', 'December 2026', 'January 2027', 'February 2027', 'March 2027', 'April 2027'],
  });
  // same keys and prices as before the relaunch: the stored slots carry on
  assert.deepEqual(buildSssSlots(pkgs, season!, '2026-11-11').map(x => [x.key, x.price, x.packageNights]),
    buildSssSlots(parseSssPackages(packages), parseSssSeason(packages)!, '2026-11-11').map(x => [x.key, x.price, x.packageNights]));
});

test('swiss snowkiting: old layout - four package cards, CHF per person, nights and single surcharge', () => {
  const p = parseSssPackages(packages);
  assert.deepEqual(p.map(x => [x.name, x.price, x.currency, x.perPerson, x.nights, x.singleSurcharge]), [
    ['Snowkite Beginner Package', 690, 'CHF', true, 2, 20],
    ['Advanced Snowkite Package', 590, 'CHF', true, 2, 20],
    ['Snowkite Training Package', 960, 'CHF', true, 4, 30],
    ['Kite & Fly Package', 590, 'CHF', true, 2, 20],
  ]);
  assert.ok(p[3].features.some(f => /tandem paragliding flight/.test(f)));
});

test('swiss snowkiting: old layout - booking months give the season band', () => {
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

test('swiss snowkiting: adapter slots (relaunched pages) match the pure builder for today', async () => {
  const slots = await swissSnowkitingSchoolPackagesSimplon.fetchSlots(ctx);
  const { pkgs, season } = sssPackagesAndSeason({ packages: overview, details });
  assert.deepEqual(slots, buildSssSlots(pkgs, season!, todayIso()));
  assert.ok(slots.every(x => x.availabilityText === "Dates checked on the school's own availability form"));
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
  assert.match(parseSssContent({ packages: overview, details, location }, '2026-11-11').summary, /booked from November 2026 to April 2027/);
  assert.match(parseSssContent({ packages: overview, details, location }, '2027-05-01').summary, /next season dates are not on the page yet/);
  assert.ok(c.optionalServices.includes('Snowkite Training Package: course extension possible for CHF 50.–/h'));
  assert.ok(!c.optionalServices.some(x => /single room/.test(x)), 'no single surcharge on the new pages');
  assert.deepEqual(sssImages(overview, ...details, location), c.imageUrls);
  assert.equal(c.imageUrls.length, 5);
  // the old one-page layout still parses
  const old = parseSssContent({ packages, details: [], location }, '2026-10-19');
  assert.ok(old.optionalServices.includes('Snowkite Training Package: single room +CHF 30'));
});
