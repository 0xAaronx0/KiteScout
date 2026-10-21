// BookSurfCamps / Atlanticzin Watersports adapter. The live site answers 403 to KiteScoutBot, so the
// fixture is a browser capture (2026-10-09) of the raw listing HTML, reduced to what the parser reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import {
  bscAtlanticzinEssaouira as adapter, decodeBscAvailability, bscPackages,
} from '../../src/offers/adapters/bsc-atlanticzin-essaouira.js';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = join(import.meta.dirname, '../fixtures/offers/bsc-atlanticzin-essaouira');
process.env.OFFERS_FIXTURE_DIR = DIR;
const ctx = { note: () => {}, incomplete: () => {} };

test('decodeBscAvailability: first entry date, offsets, repeats, guaranteed slots', () => {
  const days = decodeBscAvailability('2610090570#570,00000570#570-3,0000106570#570,00021011435#1400');
  assert.deepEqual(days.map(d => [d.date, d.type, d.slots, d.price, d.discountedPrice]), [
    ['2026-10-09', 0, null, 570, 570],
    ['2026-10-10', 0, null, 570, 570], ['2026-10-11', 0, null, 570, 570], ['2026-10-12', 0, null, 570, 570],
    ['2026-10-13', 1, 6, 570, 570],
    ['2026-10-16', 1, 1, 1435, 1400], // offset 0002 skips two days
  ]);
  assert.equal(decodeBscAvailability('261231057000#57000,0000057000#57000')[1].date, '2027-01-01', 'month/year rollover');
});

test('fixture calendar: 357 arrival days through 2027-09-30, guaranteed from 2027', () => {
  const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.endsWith('.txt'))!), 'utf8');
  const pkgs = bscPackages(html);
  assert.deepEqual(pkgs.map(p => [p.title, p.persons, p.days.length]), [
    ['Private double room', 1, 357], ['Private double room', 2, 357], ['Private triple room', 3, 357],
  ]);
  const one = pkgs[0].days;
  assert.equal(one[0].date, '2026-10-09');
  assert.equal(one.at(-1)!.date, '2027-09-30');
  assert.equal(one.find(d => d.date === '2026-12-31')!.type, 0);
  assert.deepEqual([one.find(d => d.date === '2027-01-01')!.type, one.find(d => d.date === '2027-01-01')!.slots], [1, 6]);
});

test('bsc slots: month bands per room option, per-person price, calendar availability', async () => {
  const slots = await adapter.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 18, '3 options x 6 months');
  const get = (k: string) => slots.find(s => s.key === k)!;
  const oct = get('private-double-room-1-person|2026-10');
  assert.deepEqual([oct.startDate, oct.endDate, oct.price, oct.currency, oct.priceUnit, oct.occupancy], ['2026-10-09', '2026-10-31', 570, 'EUR', 'per_week', 1]);
  assert.deepEqual([oct.availability, oct.availabilityText, oct.spotsLeft], ['on_request', 'Request to book', null]);
  const jan = get('private-double-room-1-person|2027-01');
  assert.deepEqual([jan.availability, jan.availabilityText, jan.spotsLeft], ['available', 'Guaranteed availability', 6]);
  assert.equal(get('private-double-room-2-persons|2027-02').price, 445, 'EUR 890 for 2 -> 445 p.p.');
  const triple = get('private-triple-room-3-persons|2027-03');
  assert.deepEqual([triple.price, triple.occupancy, triple.availability, triple.spotsLeft], [478.33, 3, 'limited', 1]);
  assert.ok(!slots.some(s => s.startDate! >= '2027-04-01'), '6-month horizon');
});

test('bsc content', async () => {
  const c = await adapter.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, '8 Day Beginner or Intermediate Pack Kitesurf Camp in Essaouira, Marrakesh-Safi, Morocco');
  assert.equal(c.country, 'Morocco');
  assert.equal(c.region, 'Marrakesh-Safi');
  assert.equal(c.durationDays, 8);
  assert.deepEqual(c.skillLevels, ['beginner', 'intermediate']);
  assert.equal(c.mealPlan, 'breakfast');
  // our own text from the listing's facts, not the listing's intro sentences (#267 verifier, Aaron 2026-10-21)
  assert.equal(c.summary, "Atlanticzin Watersports' 8-day kite camp in Essaouira (Morocco) for beginner and intermediate riders: 7 nights at Riad Inna in the medina, 12 hours of kite lessons with gear, free use of surfboards, breakfast every day, a dinner with the team and the other guests. Airport transfers cost extra.");
  assert.equal(c.accommodation, 'Riad Inna in the Essaouira medina: private double or triple rooms with bathroom.');
  assert.deepEqual(c.languages, ['en', 'ar', 'fr', 'es']);
  assert.equal(c.includedServices.length, 9);
  assert.equal(c.optionalServices.length, 4, 'airport transfers');
  assert.equal(c.rooms.length, 3);
  assert.equal(c.rooms[1].name, 'Private double room (2 persons)');
  assert.ok(c.imageUrls.length >= 20, `images: ${c.imageUrls.length}`);
  assert.equal(adapter.operator.rootDomain, 'riadinna.com');
  assert.notEqual(adapter.operator.rootDomain, 'booksurfcamps.com');
});
