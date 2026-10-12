// The Ocean Spirits Lodge (Burgau): replays the lodge page and the Kiteschool Portugal home page recorded
// 2026-10-12 (scripts except JSON-LD, styles, SVGs and data URIs trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  oceanSpiritsLodgeBurgau, buildOslSlots, oslTableYear, parseOslFacilities, parseOslRates, parseOslRooms,
} from '../../src/offers/adapters/ocean-spirits-lodge-burgau.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/ocean-spirits-lodge-burgau');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const lodge = read('kiteschoolportugal.com_the-ocean-spirits-kitesurf-camp_.');

test('osl: stay-only price table = unit x month group', () => {
  const rates = parseOslRates(lodge);
  assert.equal(rates.length, 12);
  assert.deepEqual(rates.filter(r => r.unit === 'Dorm').map(r => [r.label, r.months, r.amount, r.currency]), [
    ['March, Nov, Dec', [3, 11, 12], 30, 'EUR'],
    ['April, May, Oct', [4, 5, 10], 42, 'EUR'],
    ['June, Sept', [6, 9], 46, 'EUR'],
    ['July, August', [7, 8], 48, 'EUR'],
  ]);
  assert.deepEqual(rates.filter(r => r.unit === 'Suite w/ balcony').map(r => r.amount), [70, 107, 132, 160]);
});

test('osl: table year = page dateModified', () => {
  assert.equal(oslTableYear(lodge), 2026);
  assert.equal(oslTableYear('<meta property="article:modified_time" content="2027-02-01T10:00:00+00:00" />'), 2027);
  assert.equal(oslTableYear('<p>no date</p>'), null);
});

test('osl: slots = runs of consecutive months with the same price', async () => {
  const slots = await oceanSpiritsLodgeBurgau.fetchSlots(ctx);
  assert.deepEqual(slots, buildOslSlots(parseOslRates(lodge), 2026));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 21); // 3 units x 7 runs (Mar | Apr-May | Jun | Jul-Aug | Sep | Oct | Nov-Dec)
  const s = (k: string) => slots.find(x => x.key === k)!;
  assert.deepEqual([s('suite|2026-11').startDate, s('suite|2026-11').endDate, s('suite|2026-11').price], ['2026-11-01', '2026-12-31', 60]);
  assert.deepEqual([s('suite-w-balcony|2026-07').startDate, s('suite-w-balcony|2026-07').endDate, s('suite-w-balcony|2026-07').price], ['2026-07-01', '2026-08-31', 160]);
  assert.deepEqual([s('dorm|2026-10').price, s('dorm|2026-10').priceBasis, s('dorm|2026-10').occupancy], [42, 'person', 1]);
  assert.deepEqual([s('suite|2026-04').endDate, s('suite|2026-04').priceBasis, s('suite|2026-04').occupancy], ['2026-05-31', 'room', 2]);
  assert.ok(slots.every(x => x.currency === 'EUR' && x.priceUnit === 'per_night' && x.availability === 'unknown'));
  assert.ok(!slots.some(x => /-0[12]-/.test(x.startDate!))); // January and February are not in the table
});

test('osl: rooms and facilities', () => {
  assert.deepEqual(parseOslRooms(lodge).map(r => [r.name, r.features[0]]), [
    ['Suite w/ balcony', '3 cosy suites with private balconies overlooking the surrounding nature'],
    ['Suite', "2 rooms with palette wood interior: Feels like living in a postmodern pirate admiral's cabin"],
    ['Dorm Room', 'Luxury dorm w/ 8 Bunkbeds'],
  ]);
  const f = parseOslFacilities(lodge);
  assert.ok(f.includes('Beach in 700m walking distance'));
  assert.ok(f.includes('Kite, surf & SUP gear rental'));
});

test('osl: content', async () => {
  const c = await oceanSpiritsLodgeBurgau.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'The Ocean Spirits Lodge');
  assert.equal(c.country, 'Portugal');
  assert.equal(c.region, 'Algarve');
  assert.equal(c.spot, 'Burgau');
  assert.equal(c.mealPlan, 'self_catering');
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /from €30 per dorm bed to €160 per suite per night/);
  assert.match(c.summary, /VDWS- and IKO-certified/);
  assert.ok(c.rooms.find(r => r.name === 'Dorm Room')!.features.includes('March, Nov, Dec: €30 per night per bed'));
  assert.ok(c.imageUrls.length >= 15);
  assert.ok(c.imageUrls.every(u => !/logo|social-share|ProfilePic|\.svg|-\d+x\d+\.jpg$/i.test(u)));
  assert.equal(new Set(c.imageUrls.map(u => u.replace(/-e\d{10,}(?=\.[a-z]+$)/, ''))).size, c.imageUrls.length);
});
