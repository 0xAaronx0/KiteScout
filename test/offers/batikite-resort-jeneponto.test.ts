// Batikite Resort (Jeneponto, South Sulawesi): replays the own site's pages recorded 2026-10-12 (trimmed:
// script/style bodies and base64 data URIs dropped, JSON-LD kept).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  batikiteResortJeneponto, buildBkSlots, idr, parseBkFacts, parseBkFaq, parseBkLanguages, parseBkNotes, parseBkRates,
} from '../../src/offers/adapters/batikite-resort-jeneponto.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/batikite-resort-jeneponto');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const resort = read('indonesiakitesurfing.com_kitesurf-camp-indonesia_.');
const home = read('indonesiakitesurfing.com_.');
const faq = read('indonesiakitesurfing.com_kitesurf-travel_.');

test('bk: rupiah amounts', () => {
  assert.equal(idr('2.2', 'M'), 2_200_000);
  assert.equal(idr('700', 'K'), 700_000);
  assert.equal(idr('1,400,000'), 1_400_000);
  assert.equal(idr('0'), null);
});

test('bk: pricing tables 2026 + 2027 (IDR per bungalow per night, 2 persons, breakfast)', () => {
  assert.deepEqual(parseBkRates(resort).map(r => [r.year, r.room, r.price, r.persons]), [
    [2026, 'Gajah', 2_200_000, 2], [2026, 'Penyu', 1_400_000, 2], [2026, 'Monyet', 700_000, 2],
    [2027, 'Gajah', 2_200_000, 2], [2027, 'Penyu', 1_400_000, 2], [2027, 'Kuda', 3_600_000, 4], [2027, 'Monyet', 700_000, 2],
  ]);
  const kuda = parseBkRates(resort).find(r => r.room === 'Kuda')!;
  assert.deepEqual(kuda.features.slice(0, 3), ['2 bedrooms', '100 m2', 'Garden view']);
  assert.ok(parseBkNotes(resort).some(n => /Single occupancy -150K/.test(n)));
});

test('bk: home quick facts, languages, FAQ capacity and extras', () => {
  const f = parseBkFacts(home);
  assert.equal(f['wind season'], 'May to October, steady south-east trade wind');
  assert.equal(f['the spot'], '2 km flat, shallow lagoon with on-shore wind');
  assert.deepEqual(parseBkLanguages(home), ['en', 'fr', 'id']);
  const { capacity, extras } = parseBkFaq(faq);
  assert.deepEqual(capacity, ['3 x Gajah (Premium, 6 guests)', '7 x Penyu (Deluxe, 14 guests)', '1 x Monyet (Dormitory, 12 guests)']);
  assert.ok(extras.includes('Private kite lesson "Coaching" (1 hour, per person, gear included): IDR 1,200,000'));
  assert.ok(extras.includes('Airport transfer from Makassar (one way, private car): IDR 1,000,000'));
});

test('bk: slots = bungalow type x price-list year, on request; ended years dropped', async () => {
  const slots = await batikiteResortJeneponto.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(slots, buildBkSlots(parseBkRates(resort)));
  const fixed = buildBkSlots(parseBkRates(resort), '2026-10-12');
  assert.equal(fixed.length, 7);
  const g = fixed.find(s => s.key === 'gajah|2026')!;
  assert.deepEqual([g.unit, g.price, g.currency, g.priceUnit, g.priceBasis, g.occupancy, g.startDate, g.endDate, g.availability, g.datePrecision],
    ['Gajah (Premium)', 2_200_000, 'IDR', 'per_night', 'room', 2, '2026-01-01', '2026-12-31', 'on_request', 'season']);
  assert.equal(fixed.find(s => s.key === 'kuda|2027')!.occupancy, 4);
  assert.equal(buildBkSlots(parseBkRates(resort), '2027-01-02').length, 4); // 2026 bands ended
  assert.ok(ok.every(s => s.currency === 'IDR'));
});

test('bk: content', async () => {
  const c = await batikiteResortJeneponto.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Batikite Resort');
  assert.equal(c.country, 'Indonesia');
  assert.equal(c.region, 'South Sulawesi');
  assert.deepEqual(c.spotCoords, { lat: -5.6492245, lng: 119.5844938 });
  assert.equal(c.mealPlan, 'breakfast');
  assert.match(c.summary, /2 km flat, shallow lagoon with on-shore wind/);
  assert.match(c.summary, /IDR 700,000 to 2,200,000 per bungalow and night/);
  assert.match(c.summary, /wind season runs May to October/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Gajah (Premium)', 'Penyu (Deluxe)', 'Kuda (Two-bedroom)', 'Monyet (Dormitory)']);
  assert.equal(c.rooms[0].description, '3 units on site (Premium, 6 guests).');
  assert.ok(c.includedServices.includes('Breakfast included'));
  assert.equal(c.kiteLessons, true);
  assert.ok(c.imageUrls.length >= 25);
  assert.ok(c.imageUrls.every(u => !/elementor\/thumbs|logo|trustindex/i.test(u)));
});
