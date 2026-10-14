// ProBoarding Rügen Ferienwohnungen (Klein Zicker): replays the site pages and the WordPress page dates recorded 2026-10-14
// (pages trimmed of script/style bodies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  proboardingFerienwohnungenKleinZicker, PB_APARTMENTS, buildPbSlots, fetchPbSlots, parsePbCourses, parsePbPrices, parsePbYears,
  pbApartmentFacts, pbBands, pbMapCentre, pbSeasonYear,
} from '../../src/offers/adapters/proboarding-ferienwohnungen-klein-zicker.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/proboarding-ferienwohnungen-klein-zicker');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const see = read('www.proboarding.de_fewo_ferienwohnung-zur-seeseite_.');
const deluxe = read('www.proboarding.de_fewo_deluxe-ferienwohnung_.');

test('proboarding: year-less price list per apartment + the year from the WordPress page dates', () => {
  const p = parsePbPrices(see);
  assert.deepEqual(p.seasons.map(s => [s.season, s.price, s.ranges.map(r => [...r.from, ...r.to])]), [
    ['A', 44, [[11, 1, 3, 31]]], ['B', 66, [[4, 1, 5, 31], [9, 16, 10, 31]]], ['C', 88, [[6, 1, 9, 15]]],
  ]);
  assert.deepEqual([p.minNights, p.persons, p.extraBed, p.linen, p.cleaning, p.newYear], [3, 2, null, 20, 54, true]);
  assert.deepEqual(parsePbPrices(deluxe).seasons.map(s => s.price), [55, 77, 99]);
  assert.equal(parsePbPrices(deluxe).extraBed, 20);
  assert.deepEqual(parsePbYears(JSON.parse(read('www.proboarding.de_wp-json_'))),
    { 'deluxe-ferienwohnung': 2026, 'ferienwohnung-zur-seeseite': 2026, 'ferienwohnung-zur-bergseite': 2026 });
  assert.equal(pbSeasonYear(see), 2026); // footer fallback
  assert.deepEqual(pbBands(parsePbPrices(see), 2026).map(b => [b.season, b.start, b.end]), [
    ['A', '2026-01-01', '2026-03-31'], ['B', '2026-04-01', '2026-05-31'], ['C', '2026-06-01', '2026-09-15'],
    ['B', '2026-09-16', '2026-10-31'], ['A', '2026-11-01', '2027-03-31'],
  ]);
});

test('proboarding: slots = apartment x future band, EUR per apartment and night for 2', async () => {
  const slots = await fetchPbSlots(ctx, '2026-10-14');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.unit, s.startDate, s.endDate, s.price]), [
    ['seeseite|2026-09-16', 'Apartment 1 Seeseite', '2026-09-16', '2026-10-31', 66],
    ['seeseite|2026-11-01', 'Apartment 1 Seeseite', '2026-11-01', '2027-03-31', 44],
    ['bergseite|2026-09-16', 'Apartment 2 Bergseite', '2026-09-16', '2026-10-31', 66],
    ['bergseite|2026-11-01', 'Apartment 2 Bergseite', '2026-11-01', '2027-03-31', 44],
    ['deluxe|2026-09-16', 'Apartment 3 DeLuxe', '2026-09-16', '2026-10-31', 77],
    ['deluxe|2026-11-01', 'Apartment 3 DeLuxe', '2026-11-01', '2027-03-31', 55],
  ]);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.occupancy === 2
    && s.minNights === 3 && s.availability === 'unknown'));
  const apts = PB_APARTMENTS.map(apt => ({ apt, prices: parsePbPrices(see), year: 2026 }));
  assert.equal(buildPbSlots(apts, '2026-05-01').length, 12);
  assert.deepEqual(buildPbSlots(apts, '2027-04-01'), []); // 2026 list used up -> price on request
});

test('proboarding: apartment facts, courses, map centre', () => {
  const f = pbApartmentFacts(read('www.proboarding.de_fewo_ferienwohnung-zur-bergseite_.'));
  assert.deepEqual([f.size, f.persons], [42, '2-4']);
  assert.ok(f.features.includes('Maisonette with sleeping loft') && f.features.includes('Balcony'));
  assert.ok(pbApartmentFacts(deluxe).features.includes('Bathroom and WC'));
  const courses = parsePbCourses(read('www.proboarding.de_kitesurfen_.'));
  assert.equal(courses[0], 'Premium kite course (max. 4 students per instructor): EUR 150 per person and 3-hour day');
  assert.ok(courses.includes('VDWS kite licence EUR 60 (included with 5 course days)'));
  assert.deepEqual(pbMapCentre(read('www.proboarding.de_kitenlernenkitesurfenkiteboarding_')), { lat: 54.29469, lng: 13.69 });
});

test('proboarding: content', async () => {
  const c = await proboardingFerienwohnungenKleinZicker.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'ProBoarding Rügen Ferienwohnungen');
  assert.equal(c.region, 'Thiessow, Rügen');
  assert.equal(c.mealPlan, 'self_catering');
  assert.match(c.summary, /about 300 m from the Klein Zicker car park/);
  assert.match(c.summary, /Seeseite \(36 m², 2-3 people\), Bergseite \(42 m², 2-4 people, maisonette with balcony\), DeLuxe \(58 m², 2-3 people\)/);
  assert.match(c.summary, /2026 prices run from EUR 44 \(November to March\) to EUR 99 \(June to mid-September\)/);
  assert.match(c.summary, /season ran from 26 April to 18 October 2026/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Apartment 1 Seeseite', 'Apartment 2 Bergseite', 'Apartment 3 DeLuxe']);
  assert.ok(c.rooms[2].features.includes('2026 Saison C (01.06.-15.09.): EUR 99 per night for 2 people'));
  assert.ok(c.rooms[0].features.includes('Final cleaning EUR 54'));
  assert.equal(c.imageUrls.length, 30);
  assert.match(c.imageUrls[0], /Fewo-Haus-ProBoarding/);
  assert.ok(c.imageUrls.every(u => !/-\d+x\d+\.|Winter-|Zollhaus/.test(u)));
});
