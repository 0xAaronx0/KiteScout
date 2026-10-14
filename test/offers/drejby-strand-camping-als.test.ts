// Drejby Strand Camping (Als): replays the English site pages and the Compusoft answers recorded 2026-10-12 (pages
// without scripts / styles / srcsets; profile lists and price answers trimmed to the fields the parser reads). Slots are
// built with today pinned to the recording day so the sample weeks (and their fixtures) stay the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  drejbyStrandCampingAls, DSC_PORTAL, fetchDscSlots, parseDscSeasons, parseDscUnits,
} from '../../src/offers/adapters/drejby-strand-camping-als.js';
import { csobSaturdaySamples, parseCsobList } from '../../src/offers/adapters/hvide-sande-camping.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/drejby-strand-camping-als');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const incomplete: string[] = [];
const ctx = { note: () => {}, incomplete: (r: string) => { incomplete.push(r); } };
const TODAY = '2026-10-12';
const cabins = read('www.drejby.com_holiday-cabins_.');

test('drejby: season footer and sample weeks', () => {
  const seasons = parseDscSeasons(cabins);
  assert.deepEqual(seasons, [
    { year: 2026, start: '2026-03-27', end: '2026-09-20' },
    { year: 2027, start: '2027-03-19', end: '2027-09-19' },
  ]);
  assert.deepEqual(csobSaturdaySamples(TODAY, seasons, { max: 9 }), ['2027-03-20', '2027-04-03', '2027-05-01', '2027-06-05', '2027-07-03', '2027-08-07', '2027-09-04']);
});

test('drejby: cabin and apartment blocks', () => {
  const c = parseDscUnits(cabins);
  assert.deepEqual(c.map(u => [u.name, u.numbers]), [
    ['Standard cabin with a terrace', 'Cabins 1-4 and 11-16'],
    ['Rice inspired cabins', 'Cabins 24-32'],
    ['Cabin in the Outdoor oasis', 'Cabins 33 – 40'],
    ['Economy cabin', 'Cabins 5, 6, 7, 8 and 17-18 & 23'],
  ]);
  assert.equal(c[0].image, 'https://www.drejby.com/wp-content/uploads/2021/06/Hytte-Standard-Front.jpg');
  const a = parseDscUnits(read('www.drejby.com_holiday-apartments_.'));
  assert.equal(a.length, 6);
  assert.equal(a[5].name, 'Holiday apartment 6 – The Porch');
});

test('drejby: unit filter drops pitches and package offers', () => {
  const list = files.filter(f => f.startsWith('v3.onlinebooking.dk_profile_getCSProfileListViewModel')).flatMap(f => parseCsobList(readFileSync(join(DIR, f), 'utf8')));
  const units = [...new Set(list.filter(DSC_PORTAL.isUnit).map(p => p.title))].sort();
  assert.ok(units.includes('Standard Cabin') && units.includes('Apartment no 1') && units.includes('Apartment "Veranda" - 4 people'));
  assert.ok(units.every(t => !/offer|including|short holiday|pitch/i.test(t)));
});

test('drejby: slots = unit type x sample week, DKK per unit for 7 nights', async () => {
  const slots = await fetchDscSlots(TODAY, ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 63); // Apartment "Veranda" is free in no sampled week -> left out, not sold out
  assert.deepEqual(incomplete, []);
  const s = slots.find(x => x.key === 'standard-cabin|2027-06-05')!;
  assert.deepEqual([s.startDate, s.endDate, s.price, s.currency, s.priceUnit, s.packageNights, s.availability, s.spotsLeft],
    ['2027-06-05', '2027-06-11', 6445, 'DKK', 'package', 7, 'available', 9]);
  assert.equal(slots.find(x => x.key === 'apartment-no-1|2027-07-03')!.price, 10150);
  assert.equal(slots.find(x => x.key === 'apartment-no-1|2027-07-03')!.availability, 'limited');
  assert.equal(slots.find(x => x.key === 'apartment-no-3|2027-07-03')!.availability, 'sold_out');
  assert.equal(Math.min(...slots.filter(x => x.price !== null).map(x => x.price!)), 5145); // Outdoor cabins 03.-10.04.2027
});

test('drejby: content', async () => {
  const c = await drejbyStrandCampingAls.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Drejby Strand Camping');
  assert.equal(c.region, 'Kegnæs, Als');
  assert.equal(c.spotCoords, undefined);
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /four-star beach campsite with 450 pitches on Als/);
  assert.match(c.summary, /Surfers Paradise\) offers surf and kite lessons/);
  assert.equal(c.rooms.length, 10);
  assert.match(c.sourceText ?? '', /possibility to lean to surf or kite\. We cooperate with Surfers Paradise\./);
  assert.ok(c.imageUrls.length >= 12 && c.imageUrls.every(u => /^https:\/\/www\.drejby\.com\/wp-content\/uploads\//.test(u)));
});
