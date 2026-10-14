// Watermen's Retreat (Waves, Hatteras Island): replays the site pages and the Streamline plugin proxy recorded
// 2026-10-14 (unit list + 12 sample-week date searches, search answers compacted to the fields the parser reads).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  watermensRetreatWaves, fetchWrSlots, parseWrSearch, parseWrUnits, wrSampleStays, wrSearchUrl, wrTypeFacts, wrUnitType,
  WR_LIST_URL,
} from '../../src/offers/adapters/watermens-retreat-waves.js';
import { fetchText } from '../../src/offers/http.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/watermens-retreat-waves');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const TODAY = '2026-10-14';
const post = (url: string) => fetchText(url, { method: 'POST' });

test('wr: sample weeks = 2nd Saturday of the next 12 months, 7 nights', () => {
  const s = wrSampleStays(TODAY);
  assert.equal(s.length, 12);
  assert.deepEqual(s[0], { month: '2026-11', checkIn: '2026-11-14', checkOut: '2026-11-21' });
  assert.deepEqual(s[11], { month: '2027-10', checkIn: '2027-10-09', checkOut: '2027-10-16' });
  assert.ok(s.every(x => new Date(`${x.checkIn}T00:00:00Z`).getUTCDay() === 6));
  assert.match(decodeURIComponent(wrSearchUrl('2027-05-08', '2027-05-15')), /"startdate":"05\/08\/2027","enddate":"05\/15\/2027"/);
});

test('wr: unit list -> 23 units in the site\'s nine types', async () => {
  const units = parseWrUnits(await post(WR_LIST_URL));
  assert.equal(units.length, 23);
  const types = new Map<string, string[]>();
  for (const u of units) types.set(wrUnitType(u), [...(types.get(wrUnitType(u)) ?? []), u.name]);
  assert.equal(types.size, 9);
  assert.deepEqual(types.get('Three Bedroom Waterfront Penthouse'), ['The Planet', 'The Slick']);
  assert.deepEqual(types.get('Three Bedroom Water View Suite'), ['Lighthouse', 'S Turns', 'The Boiler', 'The Cove']);
  assert.equal(types.get('Three Bedroom Cabana')!.length, 6);
  assert.deepEqual(types.get("Watermen's Hideout (cottage)"), ["Watermen's Hideout"]);
  assert.equal(units.find(u => u.name === 'Avon Pier')!.fromDaily, 149.99);
});

test('wr: date search -> free units with rent and tax', async () => {
  const q = parseWrSearch(await post(wrSearchUrl('2026-11-14', '2026-11-21')));
  const buxton = q.find(x => x.name === 'Buxton Slick')!;
  assert.deepEqual([buxton.rent, buxton.taxes, buxton.total], [1539.93, 196.35, 1736.28]);
  assert.ok(!q.some(x => x.name === 'Avon Pier')); // taken that week
});

test('wr: slots = unit type x sample week, USD per unit per night, sold_out when no unit is free', async () => {
  const slots = await fetchWrSlots(ctx, TODAY);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 108); // 9 types x 12 weeks
  const bux = slots.find(s => s.key === 'two-bedroom-waterfront-suite|2026-11')!;
  assert.deepEqual([bux.startDate, bux.endDate, bux.unit, bux.price, bux.currency, bux.priceUnit, bux.priceBasis, bux.availability, bux.spotsLeft],
    ['2026-11-14', '2026-11-20', 'Two Bedroom Waterfront Suite', 219.99, 'USD', 'per_night', 'room', 'available', 3]);
  assert.match(bux.availabilityText!, /rent USD 1,539\.93 \+ tax USD 196\.35/);
  const garden = slots.find(s => s.key === 'two-bedroom-garden-view-suite|2026-11')!;
  assert.deepEqual([garden.availability, garden.price, garden.spotsLeft], ['sold_out', null, 0]);
  const pent = slots.find(s => s.key === 'three-bedroom-waterfront-penthouse|2027-10')!;
  assert.deepEqual([pent.price, pent.spotsLeft], [419.99, 2]);
  assert.equal(Math.min(...slots.filter(s => s.price !== null).map(s => s.price!)), 149.99);
});

test('wr: type facts from /accommodations/', () => {
  const facts = wrTypeFacts(read('www.watermensretreat.com_accommodations_'));
  assert.equal(facts.size, 9);
  assert.equal(facts.get('three bedroom cabana'), 'Convenient location Pet friendly 1 King | 1 Queen | 2 Twins Weekly rental available');
});

test('wr: content', async () => {
  const c = await watermensRetreatWaves.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, "Watermen's Retreat");
  assert.deepEqual([c.country, c.region, c.spot, c.continent], ['United States', 'Hatteras Island, North Carolina', 'Waves', 'North America']);
  assert.deepEqual(c.spotCoords, { lat: 35.56631, lng: -75.46962 });
  assert.match(c.summary, /14 suites, 1 cottage and 8 cabanas/);
  assert.match(c.summary, /REAL Watersports/);
  assert.match(c.summary, /12\.75% tax/);
  assert.equal(c.rooms.length, 9);
  assert.ok(c.rooms.find(r => r.name === 'Two Bedroom Cabana')!.features.includes('Convenient location Pet friendly 1 King Bed | 2 Twin Beds Weekly rental available'));
  assert.ok(c.imageUrls.length >= 30);
  assert.ok(c.imageUrls.every(u => !/logo|amelia-island|icon|\.png$/i.test(u)));
  assert.equal(c.mealPlan, 'self_catering');
});
