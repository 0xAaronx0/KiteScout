// LazyKite Surf House (Tarifa): replays the accommodation page recorded 2026-10-12 (scripts trimmed; styles trimmed to
// their background-image declarations, which carry the house photo) and the course page (photos) recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  lazyKiteSurfHouseTarifa, buildLazySlots, lazyCoursePhotos, lazyImages, lazyMonthBand, lazyPhotoCandidates, lazySeasonMonths, parseLazyFaq,
  parseLazyPriceNote, parseLazyRates,
} from '../../src/offers/adapters/lazy-kite-surf-house-tarifa.js';
import { roomsWithPrices } from '../../src/offers/ingest.js';
import { todayIso } from '../../src/offers/parse.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/lazy-kite-surf-house-tarifa');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const html = read('lazykiteschooltarifa.com_en_accommodation-tarifa_.');
const courses = read('lazykiteschooltarifa.com_en_kitesurfing-courses-tarifa_.');

test('lazy: TablePress price table = room type x season, per person per night', () => {
  const rates = parseLazyRates(html);
  assert.equal(rates.length, 12);
  assert.deepEqual(rates.filter(r => r.room === 'Double Room').map(r => [r.season.label, r.season.months, r.amount, r.currency]), [
    ['Low', 'October / June', 25, 'EUR'], ['Mid', 'July / September', 35, 'EUR'], ['High', 'August', 45, 'EUR'],
  ]);
  assert.deepEqual(rates.filter(r => r.season.key === 'low').map(r => r.amount), [40, 25, 20, 18]);
  assert.match(parseLazyPriceNote(html)!, /^Price per person per night/);
});

test('lazy: each printed month = its next occurrence that has not ended (the table has no year)', () => {
  assert.deepEqual(lazySeasonMonths('October / June'), [10, 6]);
  assert.deepEqual(lazySeasonMonths('August'), [8]);
  assert.deepEqual(lazyMonthBand(10, '2026-10-31'), { start: '2026-10-01', end: '2026-10-31' }); // last day still counts
  assert.deepEqual(lazyMonthBand(10, '2026-11-01'), { start: '2027-10-01', end: '2027-10-31' });
  assert.deepEqual(lazyMonthBand(6, '2026-10-31'), { start: '2027-06-01', end: '2027-06-30' });
  assert.deepEqual(lazyMonthBand(2, '2028-01-15'), { start: '2028-02-01', end: '2028-02-29' });
});

test('lazy: slots = room type x printed month, dated, per person per night', async () => {
  const today = '2026-10-31';
  const slots = buildLazySlots(parseLazyRates(html), parseLazyPriceNote(html), today);
  assert.deepEqual(await lazyKiteSurfHouseTarifa.fetchSlots(ctx), buildLazySlots(parseLazyRates(html), parseLazyPriceNote(html), todayIso()));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 20); // 4 rooms x 5 months (low: October + June, mid: July + September, high: August)
  const s = (k: string) => slots.find(x => x.key === k)!;
  assert.deepEqual([s('quadruple-room|low|2026-10').price, s('quadruple-room|low|2026-10').occupancy], [18, 4]);
  assert.deepEqual([s('quadruple-room|low|2027-06').startDate, s('quadruple-room|low|2027-06').endDate], ['2027-06-01', '2027-06-30']);
  assert.deepEqual([s('private-room|high|2027-08').price, s('private-room|high|2027-08').occupancy], [80, 1]);
  assert.match(s('triple-room|mid|2027-09').availabilityText!, /^Mid season \(July \/ September\); price table without year/);
  assert.deepEqual(slots.filter(x => x.unit === 'Double Room').map(x => [x.startDate!.slice(0, 7), x.price]),
    [['2026-10', 25], ['2027-06', 25], ['2027-07', 35], ['2027-08', 45], ['2027-09', 35]]);
  assert.ok(slots.every(x => x.datePrecision === 'month' && x.startDate!.endsWith('-01') && x.currency === 'EUR'
    && x.priceBasis === 'person' && x.priceUnit === 'per_night' && x.availability === 'on_request'));
});

test('lazy: the app gets month prices per room (roomsWithPrices)', async () => {
  const c = await lazyKiteSurfHouseTarifa.fetchContent(ctx);
  const today = '2026-10-31';
  const rooms = roomsWithPrices(c, buildLazySlots(parseLazyRates(html), parseLazyPriceNote(html), today), today);
  const double = rooms.find(r => r.name === 'Double Room')!;
  assert.deepEqual(double.priced_months, [6, 7, 8, 9, 10]);
  assert.equal(double.price_from, 25);
  assert.deepEqual(double.availability.map(a => [a.start_date, a.end_date, a.price]), [
    ['2026-10-01', '2026-10-31', 25], ['2027-06-01', '2027-06-30', 25], ['2027-07-01', '2027-07-31', 35],
    ['2027-08-01', '2027-08-31', 45], ['2027-09-01', '2027-09-30', 35],
  ]);
  // a month later October 2026 is over: the low season shows June and October 2027
  const later = roomsWithPrices(c, buildLazySlots(parseLazyRates(html), parseLazyPriceNote(html), '2026-11-01'), '2026-11-01');
  assert.deepEqual(later.find(r => r.name === 'Double Room')!.availability.map(a => a.start_date),
    ['2027-06-01', '2027-07-01', '2027-08-01', '2027-09-01', '2027-10-01']);
  assert.ok(rooms.every(r => r.priced_months.length === 5 && r.availability.length === 5));
});

test('lazy: FAQ and photo', () => {
  const faq = parseLazyFaq(html);
  assert.ok(faq.some(f => /storage available for equipment/i.test(f.q) && /garage/i.test(f.a)));
  assert.ok(faq.some(f => /travel+ing alone/i.test(f.q) && /minimum of two people/i.test(f.a)));
  assert.deepEqual(lazyImages(html), ['https://lazykiteschooltarifa.com/wp-content/uploads/DSC_6444-scaled.jpg']);
});

test('lazy: content', async () => {
  const c = await lazyKiteSurfHouseTarifa.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'LazyKite Surf House');
  assert.equal(c.region, 'Tarifa town');
  assert.match(c.summary, /from EUR 18 to 80 per person per night/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Private Room', 'Double Room', 'Triple Room', 'Quadruple Room']);
  assert.match(c.sourceText!, /carril playa, N-340, km 80/i);
  assert.deepEqual(c.imageUrls, lazyPhotoCandidates(html, courses));
});

test('lazy: photo candidates = house photo first + course-page kite photos, capped at 10', () => {
  const up = 'https://lazykiteschooltarifa.com/wp-content/uploads/';
  const all = lazyPhotoCandidates(html, courses);
  assert.equal(all.length, 10);
  assert.equal(all[0], `${up}DSC_6444-scaled.jpg`); // the house: must stay among the 10 the vision QC sees
  for (const f of ['clases-kitesurf-tarifa-privado.jpg', 'DSC_4267.jpg', 'curso-kitesurf-tarifa-barco.jpg', 'MAX-@_boeri-21.jpg']) {
    assert.ok(all.includes(up + f), `missing ${f}`);
  }
  assert.ok(lazyCoursePhotos(courses).every(u => !/logo|gorra|diseno-sin-titulo|\.png|\.svg/i.test(u)));
  // course page down: the house photo alone
  assert.deepEqual(lazyPhotoCandidates(html, null), [`${up}DSC_6444-scaled.jpg`]);
});
