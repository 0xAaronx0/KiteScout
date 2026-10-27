// Above The Water Cape Town camp + shared Above The Water helpers: replays the camp page and /next-camps recorded
// 2026-10-27 (scripts, styles, SVG and tracking params trimmed). "Today" is pinned to 2026-10-27.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ATW_CT_SPEC, ATW_CT_URL, aboveTheWaterKiteCampCapeTown, atwAnchor, atwCards, atwLevels, atwRanges, atwStatus, atwSupplements,
  atwVariants, buildAtwSlots, fetchAtwSlots, parseAtwCamp, parseAtwCtContent, readAtwCamps,
} from '../../src/offers/adapters/above-the-water-kite-camp-cape-town.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/above-the-water-kite-camp-cape-town');
process.env.OFFERS_FIXTURE_DIR = DIR;
const file = (part: string): string => readFileSync(join(DIR, readdirSync(DIR).find(f => f.includes(part))!), 'utf8');
const html = file('capetown-january-2027');
const next = file('next-camps');
const TODAY = '2026-10-27';
const ctx = { note: () => {}, incomplete: () => {} };

test('atw: year anchor from the title or the URL', () => {
  assert.deepEqual(atwAnchor('SA - Cape Town, January 2027 | Above The Water'), { year: 2027, month: 1 });
  assert.deepEqual(atwAnchor(null, 'https://www.abovethewater.online/langebaan-december-2026'), { year: 2026, month: 12 });
  assert.equal(atwAnchor('no date here'), null);
});

test('atw: date ranges in all printed forms, Dec before a January camp falls into the previous year', () => {
  const jan27 = { year: 2027, month: 1 };
  assert.deepEqual(atwRanges('27.12 - 03.01', jan27).map(r => [r.start, r.end]), [['2026-12-27', '2027-01-03']]);
  assert.deepEqual(atwRanges('03.01 - 10.01', jan27).map(r => [r.start, r.end]), [['2027-01-03', '2027-01-10']]);
  assert.deepEqual(atwRanges('27 Dec - 3 Jan, 3-10 January', jan27).map(r => [r.start, r.end]),
    [['2026-12-27', '2027-01-03'], ['2027-01-03', '2027-01-10']]);
  assert.deepEqual(atwRanges('13-20 December 2026', { year: 2026, month: 12 }).map(r => [r.start, r.end]), [['2026-12-13', '2026-12-20']]);
  assert.deepEqual(atwRanges('11-18, 18-25 July / 1-8 August', { year: 2027, month: 7 }).map(r => r.start), ['2027-07-11', '2027-07-18', '2027-08-01']);
  // a 2028 edition of the same page
  assert.deepEqual(atwRanges('27.12 - 03.01', { year: 2028, month: 1 }).map(r => [r.start, r.end]), [['2027-12-27', '2028-01-03']]);
  assert.deepEqual(atwRanges('PRICE 1880 EUR', jan27), []);
});

test('atw: price variants, layout A (PRICE ... INCLUDED) and form extras', () => {
  const v = atwVariants([
    'PRICE 1880 EUR', 'INCLUDED', '6 days pro-coaching with Fabio Ingrosso', '7 nights accommodation in double room', 'Breakfast',
    'PRICE 1280 EUR', 'ONLY ACTIVITIES OPTION INCLUDED', '6 days pro-coaching with Fabio Ingrosso', '*Traveling with family?', 'RIDER REGISTRATION FORM',
  ], ['27.12 - 03.01', 'Only Avtivities Camp Option']);
  assert.deepEqual(v.map(x => [x.label, x.amount, x.currency, x.nights]), [[null, 1880, 'EUR', 7], ['Only activities option', 1280, 'EUR', null]]);
  assert.deepEqual(v[0].details, ['6 days pro-coaching with Fabio Ingrosso', '7 nights accommodation in double room', 'Breakfast']);
  assert.deepEqual(atwSupplements(['Single room (+€50/night)', 'No hotel ( €1280 )']), ['Single room: +EUR 50 per night']);
});

test('atw: season grid cards and badges', () => {
  const cards = atwCards(next);
  const ct = cards.find(c => c.url.endsWith('/capetown-january-2027'))!;
  assert.deepEqual([ct.badge, ct.heading, ct.dates, ct.idealFor], ['BOOK NOW', 'SA - CAPE TOWN', '27.12-3.01 / 03.01-10.01', 'Intermediate, Pro']);
  const lb = cards.find(c => c.url.endsWith('/langebaan-december-2026'))!;
  assert.equal(lb.badge, '4 SPOTS LEFT');
  assert.ok(cards.some(c => c.badge === 'SOLD OUT!'));
  assert.ok(!cards.some(c => /^HOME$/.test(c.heading)), 'nav links are no cards');
  assert.deepEqual(atwStatus('4 SPOTS LEFT'), { availability: 'limited', spotsLeft: 4, text: '4 SPOTS LEFT' });
  assert.equal(atwStatus('SOLD OUT!').availability, 'sold_out');
  assert.equal(atwStatus('BOOK NOW').availability, 'on_request');
  assert.equal(atwStatus(null).availability, 'on_request');
  assert.deepEqual(atwLevels('Intermediate, Pro'), ['intermediate', 'advanced']);
  assert.deepEqual(atwLevels('Beginners, Intermediate, Pro'), ['beginner', 'intermediate', 'advanced']);
});

test('cape town: fixture parses to two weeks x two variants, EUR per person, past weeks dropped', () => {
  const p = parseAtwCamp(ATW_CT_SPEC, ATW_CT_URL, html, atwCards(next), TODAY);
  assert.equal(p.weekSource, 'form');
  assert.deepEqual(p.weeks.map(w => [w.start, w.end]), [['2026-12-27', '2027-01-03'], ['2027-01-03', '2027-01-10']]);
  assert.deepEqual(p.hero.map(w => w.start), p.weeks.map(w => w.start), 'hero line agrees with the form');
  const { ok, problems } = checkSlots(p.slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.currency, s.priceUnit, s.priceBasis, s.packageNights, s.availability]), [
    ['2026-12-27|double-room-twin-beds', 1880, 'EUR', 'package', 'person', 7, 'on_request'],
    ['2026-12-27|only-activities-no-accommodation', 1280, 'EUR', 'package', 'person', null, 'on_request'],
    ['2027-01-03|double-room-twin-beds', 1880, 'EUR', 'package', 'person', 7, 'on_request'],
    ['2027-01-03|only-activities-no-accommodation', 1280, 'EUR', 'package', 'person', null, 'on_request'],
  ]);
  assert.equal(ok[0].room, 'Double room (twin beds)');
  // the first week is past on 2026-12-28; everything past on 2027-01-04
  assert.deepEqual(buildAtwSlots(ATW_CT_SPEC, p.weeks, p.variants, p.card, '2026-12-28').map(s => s.startDate), ['2027-01-03', '2027-01-03']);
  assert.deepEqual(buildAtwSlots(ATW_CT_SPEC, p.weeks, p.variants, p.card, '2027-01-04'), []);
});

test('cape town: a 2028 edition of the page is read with the right year', () => {
  const p = parseAtwCamp(ATW_CT_SPEC, 'https://www.abovethewater.online/capetown-january-2028',
    html.replace(/January 2027/g, 'January 2028'), [], '2027-10-01');
  assert.deepEqual(p.weeks.map(w => w.start), ['2027-12-27', '2028-01-03']);
  assert.equal(p.slots.length, 4);
});

test('cape town: content from the fixture, operator e-mail printed on the page', async () => {
  const [p] = await readAtwCamps(ATW_CT_SPEC, TODAY, ctx);
  const c = parseAtwCtContent(p, TODAY);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 8);
  assert.equal(c.region, 'Western Cape');
  assert.equal(c.spot, 'Bloubergstrand, Cape Town');
  assert.equal(c.mealPlan, 'breakfast');
  assert.deepEqual(c.skillLevels, ['intermediate', 'advanced']);
  assert.ok(c.includedServices.includes('7 nights accommodation in double room'));
  assert.ok(c.optionalServices.some(s => /Beginner's course/.test(s)));
  assert.ok(c.imageUrls.length >= 6 && c.imageUrls.length <= 12, `${c.imageUrls.length} photos`);
  assert.ok(c.imageUrls.every(u => /^https:\/\/static\.wixstatic\.com\/media\/941edc_[0-9a-f]{32}~mv2\.jpg$/.test(u)));
  assert.ok(!/[–—]/.test(c.summary + c.title + c.optionalServices.join() + c.includedServices.join()), 'no em/en dashes');
  assert.match(c.summary, /27 December 2026 to 3 January 2027/);
  assert.ok(html.includes(aboveTheWaterKiteCampCapeTown.operator.contactEmail!));
  assert.equal(aboveTheWaterKiteCampCapeTown.instantBooking, false);
  assert.equal(aboveTheWaterKiteCampCapeTown.liveAvailability, undefined);
});

test('cape town: fetchAtwSlots against the fixtures (2 pages, no extra edition in the grid)', async () => {
  const notes: string[] = [];
  const slots = await fetchAtwSlots(ATW_CT_SPEC, TODAY, { note: n => notes.push(n), incomplete: n => notes.push(n) });
  assert.equal(slots.length, 4);
  assert.deepEqual(notes, []);
});
