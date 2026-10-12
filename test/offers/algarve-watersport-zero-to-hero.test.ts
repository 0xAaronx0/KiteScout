// Algarve Watersport Zero to Hero adapter, replayed from the fixture recorded 2026-10-09.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import {
  algarveWatersportZeroToHero as adapter, monthList,
} from '../../src/offers/adapters/algarve-watersport-zero-to-hero.js';

process.env.OFFERS_FIXTURE_DIR = join(import.meta.dirname, '../fixtures/offers/algarve-watersport-zero-to-hero');
const ctx = { note: () => {}, incomplete: () => {} };

test('monthList: ranges and lists', () => {
  assert.deepEqual(monthList('May – Jun'), [5, 6]);
  assert.deepEqual(monthList('Jul, Sep'), [7, 9]);
  assert.deepEqual(monthList('Aug'), [8]);
});

test('algarve slots: month bands per package from the season table', async () => {
  const slots = await adapter.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 11);
  const hero = slots.filter(s => s.unit === 'Zero to Hero Kite Camp');
  assert.deepEqual(hero.map(s => [s.key, s.price]).sort(), [
    ['zero-to-hero-kite-camp|2026-05', 1200], ['zero-to-hero-kite-camp|2026-06', 1200],
    ['zero-to-hero-kite-camp|2026-07', 1300], ['zero-to-hero-kite-camp|2026-08', 1350],
    ['zero-to-hero-kite-camp|2026-09', 1300],
  ]);
  const aug = hero.find(s => s.key.endsWith('2026-08'))!;
  assert.equal(aug.startDate, '2026-08-01');
  assert.equal(aug.endDate, '2026-08-31');
  assert.equal(aug.currency, 'EUR');
  assert.equal(aug.priceUnit, 'per_week');
  assert.equal(aug.priceBasis, 'person');
  assert.ok(slots.every(s => s.availability === 'unknown'), 'no calendar on the page -> unknown');
  // secondary packages: low-season months only
  assert.deepEqual(slots.filter(s => s.unit === 'Surf & Kite').map(s => [s.key, s.price]), [['surf-kite|2026-05', 935], ['surf-kite|2026-06', 935]]);
  assert.equal(slots.find(s => s.key === 'intermediate-kite|2026-05')?.price, 1245);
  assert.equal(slots.find(s => s.key === 'kite-wake|2026-06')?.price, 1320);
});

test('algarve content', async () => {
  const c = await adapter.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.title, 'Zero to Hero Kite Camp - Algarve Watersport, Lagos');
  assert.equal(c.country, 'Portugal');
  assert.equal(c.region, 'Algarve');
  assert.equal(c.spot, 'Ria de Alvor lagoon, Lagos');
  assert.equal(c.durationDays, 8);
  assert.deepEqual(c.skillLevels, ['beginner', 'intermediate']);
  assert.equal(c.mealPlan, 'half_board');
  assert.equal(c.equipmentRental, true);
  assert.equal(c.includedServices.length, 6);
  assert.deepEqual(c.rooms.map(r => r.name), ['Shared Dorm', 'Bungalow', 'Apartment', 'The Hill — Premium Twin Rooms']);
  assert.equal(c.optionalServices.filter(s => s.startsWith('Room upgrade')).length, 3);
  assert.ok(c.optionalServices.some(s => /Faro \(€80 per booking\)/.test(s)));
  assert.ok(c.imageUrls.length >= 15, `images: ${c.imageUrls.length}`);
  assert.equal(c.bookingUrl, 'https://algarve-watersports.bookinglayer.com/en/product/0-hero-kite-camp');
  assert.ok((c.sourceText ?? '').includes('Low Season'));
});
