// FLY House Łeba (Fly Resort): replays the Polish pages recorded 2026-10-12 (content only, no prices on the site).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flyHouseLeba, fhCoords, fhVisiblePrices, parseFhKiteSchools } from '../../src/offers/adapters/fly-house-leba.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/fly-house-leba');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');

test('fly house: kite schools on the campsite, map pin from the directions link', () => {
  assert.deepEqual(parseFhKiteSchools(read('flyresort.pl_leba_atrakcje-leba_kitesurfing_.')), ['Kite and Sun', 'Airman Kite']);
  assert.deepEqual(fhCoords(read('flyresort.pl_leba_fly-house_.')), { lat: 54.7644383, lng: 17.5273659 });
  assert.deepEqual(fhVisiblePrices(read('flyresort.pl_leba_fly-house_.')), []);
});

test('fly house: no slots (prices only inside the nfhotel engine), with notes', async () => {
  const notes: string[] = [];
  const slots = await flyHouseLeba.fetchSlots({ note: n => notes.push(n), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /nfhotel/);
});

test('fly house: content', async () => {
  const c = await flyHouseLeba.fetchContent({ note: () => {}, incomplete: () => {} });
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'FLY House Łeba');
  assert.equal(c.country, 'Poland');
  assert.equal(c.region, 'Łeba, Pomerania');
  assert.match(c.summary, /Two kite schools work on the campsite \(Kite and Sun and Airman Kite\)/);
  assert.equal(c.kiteLessons, true);
  assert.deepEqual(c.skillLevels, ['beginner', 'intermediate', 'advanced']);
  assert.equal(c.mealPlan, 'self_catering');
  assert.equal(c.bookingUrl, 'https://booking.nfhotel.pl/preview/4153-978/4007');
  assert.deepEqual(c.rooms.map(r => r.name), ['FLY House cottage']);
  assert.ok(c.rooms[0].features.includes('Two separate bedrooms: one with a double bed, one with two single beds'));
  assert.ok(c.includedServices.includes('Free yoga and relaxation sessions (Monday, Wednesday, Friday 10:30)'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://flyresort.pl/img2/w2000-h-q80-p1/files/gallery/') && !/favicon|szkic|logo/i.test(u)));
});
