// Kite House Sardinia (Punta Trettu): replays the pages recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kiteHouseSardiniaPuntaTrettu, buildKhsSlots, parseKhsApartments, parseKhsDistances,
} from '../../src/offers/adapters/kite-house-sardinia-punta-trettu.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { slotRoom } from '../../src/offers/ingest.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-house-sardinia-punta-trettu');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const apartments = read('kitehousesardinia.com_holiday-apartments-punta-trettu_.');

test('khs: apartment blocks with rate ranges', () => {
  const apts = parseKhsApartments(apartments);
  assert.deepEqual(apts.map(a => [a.slug, a.kind, a.maxGuests, a.size, a.rateMin, a.rateMax]), [
    ['palme', 'Two-room apartment', 3, '50 m²', 40, 180],
    ['eucalipti', 'Three-room apartment', 5, '65 m²', 50, 230],
    ['ulivi', 'Three-room apartment', 5, '65 m²', 50, 220],
    ['melone', 'Two-room apartment', 6, '75 m²', 50, 210],
    ['datteri', 'Studio apartment', 3, '35 m²', 35, 140],
  ]);
  assert.ok(apts[0].amenities.includes('Porch / veranda with hammock'));
  const one = parseKhsApartments('<h3>Studio “Test”</h3><p>Sleeps up to 2 guests.</p><ul><li>Rates: € 1.050 per night</li></ul>');
  assert.deepEqual(one.map(a => [a.slug, a.rateMin, a.rateMax, a.maxGuests]), [['test', 1050, null, 2]]);
});

test('khs: slots = apartment type at the low end of the range, undated, on request', async () => {
  const slots = await kiteHouseSardiniaPuntaTrettu.fetchSlots(ctx);
  assert.deepEqual(slots, buildKhsSlots(parseKhsApartments(apartments)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price]), [
    ['palme', 'Palme (two-room apartment, up to 3 guests)', 40],
    ['eucalipti', 'Eucalipti (three-room apartment, up to 5 guests)', 50],
    ['ulivi', 'Ulivi (three-room apartment, up to 5 guests)', 50],
    ['melone', 'Melone (two-room apartment, up to 6 guests)', 50],
    ['datteri', 'Datteri (studio apartment, up to 3 guests)', 35],
  ]);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'on_request' && s.startDate === null && s.endDate === null));
});

test('khs: distances from the home page', () => {
  const d = parseKhsDistances(read('kitehousesardinia.com_.'));
  assert.equal(d['Punta Trettu'], 6);
  assert.equal(d['Porto Botte'], 9);
  assert.equal(d['Cagliari Airport'], 72);
});

test('khs: content', async () => {
  const c = await kiteHouseSardiniaPuntaTrettu.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kite House Sardinia');
  assert.equal(c.country, 'Italy');
  assert.equal(c.region, 'Punta Trettu, Sardinia');
  assert.equal(c.spot, 'Punta Trettu');
  assert.equal(c.mealPlan, 'self_catering');
  assert.match(c.summary, /6 km from the Punta Trettu lagoon .* open all year/);
  assert.match(c.summary, /5 apartment types \(35-75 m², sleeping up to 3-6 guests\)/);
  assert.match(c.summary, /from EUR 35 to 230 per night/);
  assert.match(c.summary, /IKO affiliate/);
  assert.equal(c.rooms.length, 5);
  assert.ok(c.rooms[0].features.includes('Rates: EUR 40-180 per night'));
  assert.ok(c.optionalServices.includes('Kite: Kitesurf equipment rental'));
  assert.ok(c.optionalServices.every(s => s.length < 60));
  assert.equal(c.imageUrls[0], 'https://kitehousesardinia.com/wp-content/uploads/kite-house-sardinia-drone-hero.jpg');
  assert.ok(c.imageUrls.every(u => !/logo|plan-kite|screenshot|-\d+x\d+\./i.test(u)));
});

test('khs: every apartment slot links to its content room (slot.room)', async () => {
  const names = (await kiteHouseSardiniaPuntaTrettu.fetchContent(ctx)).rooms.map(r => r.name);
  const slots = await kiteHouseSardiniaPuntaTrettu.fetchSlots(ctx);
  assert.deepEqual(slots.map(s => [s.key, slotRoom(names, s)]), [
    ['palme', 'Two-room Apartments "Palme"'],
    ['eucalipti', 'Three-room Apartments "Eucalipti"'],
    ['ulivi', 'Three-room Apartments "Ulivi"'],
    ['melone', 'Two-room Apartment "Melone"'],
    ['datteri', 'Studio Apartments "Datteri"'],
  ]);
});
