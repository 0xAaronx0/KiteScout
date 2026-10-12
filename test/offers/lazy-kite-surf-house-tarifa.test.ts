// LazyKite Surf House (Tarifa): replays the accommodation page recorded 2026-10-12 (scripts trimmed; styles trimmed to
// their background-image declarations, which carry the house photo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  lazyKiteSurfHouseTarifa, buildLazySlots, lazyImages, parseLazyFaq, parseLazyPriceNote, parseLazyRates,
} from '../../src/offers/adapters/lazy-kite-surf-house-tarifa.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/lazy-kite-surf-house-tarifa');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const html = read('lazykiteschooltarifa.com_en_accommodation-tarifa_.');

test('lazy: TablePress price table = room type x season, per person per night', () => {
  const rates = parseLazyRates(html);
  assert.equal(rates.length, 12);
  assert.deepEqual(rates.filter(r => r.room === 'Double Room').map(r => [r.season.label, r.season.months, r.amount, r.currency]), [
    ['Low', 'October / June', 25, 'EUR'], ['Mid', 'July / September', 35, 'EUR'], ['High', 'August', 45, 'EUR'],
  ]);
  assert.deepEqual(rates.filter(r => r.season.key === 'low').map(r => r.amount), [40, 25, 20, 18]);
  assert.match(parseLazyPriceNote(html)!, /^Price per person per night/);
});

test('lazy: slots carry the season but no dates (year-less table)', async () => {
  const slots = await lazyKiteSurfHouseTarifa.fetchSlots(ctx);
  assert.deepEqual(slots, buildLazySlots(parseLazyRates(html), parseLazyPriceNote(html)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 12);
  const s = (k: string) => slots.find(x => x.key === k)!;
  assert.deepEqual([s('quadruple-room|low').price, s('quadruple-room|low').occupancy], [18, 4]);
  assert.deepEqual([s('private-room|high').price, s('private-room|high').occupancy], [80, 1]);
  assert.match(s('triple-room|mid').availabilityText!, /^Mid season \(July \/ September\)/);
  assert.ok(slots.every(x => x.startDate === null && x.endDate === null && x.datePrecision === 'season'
    && x.priceBasis === 'person' && x.priceUnit === 'per_night' && x.availability === 'on_request'));
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
});
