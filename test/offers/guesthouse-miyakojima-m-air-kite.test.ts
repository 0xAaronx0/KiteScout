// Guesthouse Miyakojima + M-air: replays the guesthouse site, the M-air school / rental pages and the guesthouse's
// yado-sagashi booking engine (plan list + 15 month calendars Oct 2026 - Feb 2027) recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildGhmSlots, fetchGhmSlots, guesthouseMiyakojimaMAirKite, parseGhmCalendar, parseGhmContent, parseGhmPlans,
  parseMairPrices, type GhmPlan,
} from '../../src/offers/adapters/guesthouse-miyakojima-m-air-kite.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/guesthouse-miyakojima-m-air-kite');
process.env.OFFERS_FIXTURE_DIR = DIR;
const fx = (prefix: string) => readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith(prefix))!), 'utf8');
const TODAY = '2026-10-21';
const ctx = { note: () => {}, incomplete: () => {} };

test('ghm: engine plan list -> 6 plans, rooms A (1-2 guests) and B (1 guest)', () => {
  const plans = parseGhmPlans(fx('www.yado-sagashi.net_yoyaku_plan_index2'));
  assert.deepEqual(plans.map(p => [p.id, p.kind, p.room, p.maxGuests, p.minNights, p.fromPrice]), [
    [1, 'standard', 'A', 2, 1, 4400],
    [3, 'multi', 'A', 2, 2, 4180],
    [5, 'early', 'A', 2, 2, 3960],
    [2, 'standard', 'B', 1, 1, 5500],
    [4, 'multi', 'B', 1, 2, 5225], // labelled "1泊から", title says 2+ nights: the stricter wins
    [6, 'early', 'B', 1, 2, 4950],
  ]);
});

test('ghm: month calendar -> per-adult price, rooms left, full days', () => {
  const cal = parseGhmCalendar(fx('www.yado-sagashi.net_yoyaku_plan_plcal.jsp_y_92728865459041_p_3_pe_1_in_2026_11_01'));
  assert.deepEqual([cal.year, cal.month, cal.perAdult, cal.days.length], [2026, 11, true, 30]);
  assert.deepEqual(cal.days.find(d => d.date === '2026-11-04'), { date: '2026-11-04', price: 6270, roomsLeft: 2, full: false });
  assert.deepEqual(cal.days.find(d => d.date === '2026-11-10'), { date: '2026-11-10', price: 6270, roomsLeft: null, full: true });
  const oct = parseGhmCalendar(fx('www.yado-sagashi.net_yoyaku_plan_plcal.jsp_y_92728865459041_p_3_pe_1_in_2026_10_01'));
  assert.deepEqual(oct.days.find(d => d.date === '2026-10-05'), { date: '2026-10-05', price: null, roomsLeft: null, full: false });
});

test('ghm: slots from the engine replay (today pinned), all valid', async () => {
  const slots = await fetchGhmSlots(TODAY, ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 59);
  assert.ok(slots.every(s => s.startDate! > TODAY && s.currency === 'JPY' && s.priceUnit === 'per_night' && s.priceBasis === 'person'));
  const first = slots[0];
  assert.deepEqual([first.key, first.startDate, first.endDate, first.price, first.occupancy, first.availability, first.spotsLeft, first.minNights, first.room],
    ['room-a-1p|multi|2026-10-22', '2026-10-22', '2026-10-22', 6270, 1, 'limited', 1, 2, 'Private room A (twin, bath and toilet)']);
  const two = slots.find(s => s.key === 'room-a-2p|multi|2026-11-04')!;
  assert.deepEqual([two.endDate, two.price, two.availability], ['2026-11-07', 4180, 'available']);
  assert.equal(slots.find(s => s.key === 'room-b-1p|multi|2026-12-24')?.availability, 'sold_out');
  assert.equal(Math.min(...slots.map(s => s.price!)), 4180);
  assert.equal(slots.at(-1)!.endDate, '2027-02-28');
});

test('ghm: build -> past days dropped, early-bird days only where the first plan has none', () => {
  const plan = (id: number, kind: GhmPlan['kind']): GhmPlan => ({ id, title: '', kind, room: 'A', maxGuests: 2, minNights: 2, fromPrice: null });
  const day = (date: string, price: number, roomsLeft: number | null, full = false) => ({ date, price, roomsLeft, full });
  const slots = buildGhmSlots([
    { plan: plan(3, 'multi'), guests: 2, days: [day('2026-12-30', 4180, 1), day('2026-12-31', 4180, 1)] },
    { plan: plan(5, 'early'), guests: 2, days: [day('2026-12-31', 3960, 1), day('2027-01-01', 3960, 2), day('2027-01-02', 3960, null, true)] },
  ], '2026-12-31');
  assert.deepEqual(slots.map(s => [s.key, s.startDate, s.endDate, s.price, s.availability]), [
    ['room-a-2p|multi|2026-12-31', '2026-12-31', '2026-12-31', 4180, 'limited'],
    ['room-a-2p|early|2027-01-01', '2027-01-01', '2027-01-01', 3960, 'available'],
    ['room-a-2p|early|2027-01-02', '2027-01-02', '2027-01-02', 3960, 'sold_out'],
  ]);
});

test('ghm: M-air prices (tax excluded) and content', async () => {
  const mair = parseMairPrices(fx('m-air-kite.com_information'), fx('m-air-kite.com_schedule'));
  assert.deepEqual(mair, { taster: 12000, master: 60000, masterDays: 4, private: 20000, kiteDay: 8000, boardDay: 4000, taxExcluded: true });
  const c = parseGhmContent({
    home: fx('g-miyakojima.com_.'), facilities: fx('g-miyakojima.com_facilities'), kite: fx('g-miyakojima.com_kiteboard'),
    price: fx('g-miyakojima.com_price'), school: fx('m-air-kite.com_information'), rental: fx('m-air-kite.com_schedule'),
    plans: fx('www.yado-sagashi.net_yoyaku_plan_index2'),
  });
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.deepEqual(c.spotCoords, { lat: 24.7476542, lng: 125.2680948 });
  assert.equal(c.heroVideoUrl, 'https://g-miyakojima.com/movie/top.mp4');
  assert.deepEqual(c.rooms.map(r => r.name), ['Private room A (twin, bath and toilet)', 'Private room B (single, shared shower and toilet)']);
  assert.match(c.rooms[0].description!, /1-2 guests/);
  assert.match(c.summary, /JPY 4,400 per person per night, tax included/);
  assert.match(c.summary, /excluding tax/);
  assert.doesNotMatch(c.summary, /[–—]/);
  assert.ok(c.optionalServices.some(s => /master course \(JPY 60,000, excluding tax/.test(s)));
  assert.ok(c.imageUrls.length >= 15 && c.imageUrls.every(u => /^https:\/\/(g-miyakojima|m-air-kite)\.com\//.test(u)));
  assert.ok(!c.imageUrls.some(u => /logo|bana|topai|cho01/.test(u)));
  // the adapter's own fetchContent replays the same pages
  const live = await guesthouseMiyakojimaMAirKite.fetchContent(ctx);
  assert.equal(live.summary, c.summary);
});
