// Loop It Academy apartments (Jastarnia): replays the apartments page (/kursy-kitesuringu/) and the course page
// recorded 2026-10-12 (scripts except JSON-LD, styles, SVGs and style attributes trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loopItAcademyApartmentsJastarnia, buildLiaSlots, fetchLiaSlots, liaFresh, liaModified, parseLiaUnits,
} from '../../src/offers/adapters/loop-it-academy-apartments-jastarnia.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/loop-it-academy-apartments-jastarnia');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };
const page = read('loopitacademy.pl_kursy-kitesuringu_.');

test('lia: unit blocks with prices per guest count', () => {
  const units = parseLiaUnits(page);
  assert.deepEqual(units.map(u => [u.key, u.name, u.maxGuests, u.prices.map(p => [p.guests, p.amount, p.orFewer])]), [
    ['apartment-tarifa', 'Apartment "Tarifa"', 6, [[6, 800, false], [5, 725, false], [4, 650, true]]],
    ['apartment-cape-town', 'Apartment "Cape Town"', 7, [[7, 900, false], [6, 840, false], [5, 750, true]]],
    ['caravan', 'Caravan', 4, [[4, 400, false]]],
  ]);
  assert.match(units[2].description, /klimatyzacja/);
  assert.ok(units[0].images.length > 0);
});

test('lia: freshness gate on the page edit (15 months)', () => {
  assert.equal(liaModified(page), '2026-03-16');
  assert.equal(liaFresh('2026-03-16', '2027-06-16'), true);
  assert.equal(liaFresh('2026-03-16', '2027-06-17'), false);
  assert.equal(liaFresh(null, '2026-10-12'), false);
});

test('lia: slots = unit x guest count, undated, on request', async () => {
  const slots = await fetchLiaSlots(ctx, '2026-10-12');
  assert.deepEqual(slots, buildLiaSlots(parseLiaUnits(page)));
  assert.deepEqual(await loopItAcademyApartmentsJastarnia.fetchSlots(ctx), slots);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.occupancy]), [
    ['apartment-tarifa-6p', 800, 6], ['apartment-tarifa-5p', 725, 5], ['apartment-tarifa-4p', 650, 4],
    ['apartment-cape-town-7p', 900, 7], ['apartment-cape-town-6p', 840, 6], ['apartment-cape-town-5p', 750, 5],
    ['caravan-4p', 400, 4],
  ]);
  assert.ok(slots.every(s => s.currency === 'PLN' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'on_request' && s.startDate === null && s.endDate === null));
  assert.deepEqual(await fetchLiaSlots(ctx, '2027-07-01'), []);
  assert.ok(notes.some(n => /last edited 2026-03-16 .*price on request/.test(n)));
});

test('lia: content', async () => {
  const c = await loopItAcademyApartmentsJastarnia.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Loop It Academy apartments, Jastarnia');
  assert.equal(c.region, 'Jastarnia, Hel Peninsula');
  assert.equal(c.spot, 'Jastarnia');
  assert.equal(c.kiteLessons, true);
  assert.equal(c.beginnerFriendly, true);
  assert.deepEqual(c.skillLevels, ['beginner', 'intermediate', 'advanced']);
  assert.match(c.summary, /rents 2 two-level apartments and a caravan on a quiet campsite 30 m from Puck Bay, with the school right below the apartments/);
  assert.match(c.summary, /group lessons from PLN 140 per hour/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Apartment "Tarifa"', 'Apartment "Cape Town"', 'Caravan']);
  assert.ok(c.rooms[1].features.includes('Extra bedroom'));
  assert.ok(c.rooms[2].features.includes('Air conditioning'));
  assert.ok(c.imageUrls.length >= 10);
  assert.ok(c.imageUrls.every(u => /loopitacademy\.pl\/wp-content\/uploads\/.*\.jpe?g$/.test(u)));
});
