// REAL Watersports La Ventana SuperCamp adapter, replayed from fixtures recorded 2026-10-09.
// The landing-page fixture had its <style>/<script> blocks and the <header> mega-menu removed
// (size; the parser reads <main> and meta only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import {
  realLaVentanaSupercamp as adapter, parsePriceLines, perPersonPrice, supercampHandles, productYear,
} from '../../src/offers/adapters/real-la-ventana-supercamp.js';

process.env.OFFERS_FIXTURE_DIR = join(import.meta.dirname, '../fixtures/offers/real-la-ventana-supercamp');
const ctx = { note: () => {}, incomplete: () => {} };

test('price lines: per room for two vs per person', () => {
  const lines = parsePriceLines('<ul><li>Ultra Premium Double: $8590 ($4295 / person)</li><ul><li>Private penthouse suite for two</li></ul><li>Single: $4995 / person</li><ul><li>Queen bed</li></ul><li>Shared Single: $3995 / person</li><ul><li>Shared room for two people</li></ul></ul>');
  assert.deepEqual(lines.map(l => [l.name, l.total, l.perPerson]), [['Ultra Premium Double', 8590, 4295], ['Single', null, 4995], ['Shared Single', null, 3995]]);
  assert.deepEqual(lines[0].features, ['Private penthouse suite for two']);
  assert.deepEqual(perPersonPrice(8590, lines).price, 4295);
  assert.equal(perPersonPrice(8590, lines).occupancy, 2);
  assert.equal(perPersonPrice(4995, lines).occupancy, 1);
  assert.equal(perPersonPrice(3995, lines).occupancy, 2, 'shared room for two');
  assert.equal(perPersonPrice(1234, lines).occupancy, null, 'unknown price -> basis unknown');
});

test('handles + year', () => {
  assert.deepEqual(supercampHandles({ resources: { results: { products: [{ handle: 'la-ventana-supercamp-2027' }, { handle: 'zero-2-hero-wing-camp' }] } } }), ['la-ventana-supercamp-2027']);
  assert.equal(productYear({ title: 'La Ventana SuperCamp 2027', handle: 'la-ventana-supercamp-2027' }), 2027);
});

test('real slots: one per room variant with Shopify availability', async () => {
  const slots = await adapter.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 4);
  const by = Object.fromEntries(slots.map(s => [s.unit, s]));
  assert.equal(by['Single (Queen)'].key, 'single-queen|2027-02-06');
  assert.equal(by['Single (Queen)'].startDate, '2027-02-06');
  assert.equal(by['Single (Queen)'].endDate, '2027-02-13');
  assert.equal(by['Single (Queen)'].price, 4995);
  assert.equal(by['Single (Queen)'].currency, 'USD');
  assert.equal(by['Single (Queen)'].priceUnit, 'package');
  assert.equal(by['Premium Double (King)'].price, 3995, 'USD 7,990 room for two -> 3,995 p.p.');
  assert.equal(by['Premium Double (King)'].occupancy, 2);
  assert.equal(by['Ultra Premium Double (King)'].price, 4295);
  assert.equal(by['Ultra Premium Double (King)'].availability, 'sold_out', 'variant available:false');
  assert.equal(slots.filter(s => s.availability === 'available').length, 3);
});

test('real content', async () => {
  const c = await adapter.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'La Ventana SuperCamp 2027');
  assert.equal(c.country, 'Mexico');
  assert.equal(c.region, 'Baja California Sur');
  assert.equal(c.spot, 'La Ventana');
  assert.equal(c.durationDays, 8);
  assert.equal(c.mealPlan, 'full_board');
  assert.equal(c.equipmentRental, false, 'kite gear not included');
  assert.deepEqual(c.skillLevels, ['intermediate', 'advanced']);
  assert.deepEqual(c.rooms.map(r => r.name), ['Single (Queen)', 'Double (Twins)', 'Premium Double (King)', 'Ultra Premium Double (King)']);
  assert.ok(c.includedServices.some(s => /Kite House at Casa Cortez/.test(s)));
  assert.equal(c.optionalServices.length, 2);
  assert.ok(c.summary.includes('Brandon Scheid and Sensi Graves'));
  assert.ok(c.imageUrls.length >= 15, `images: ${c.imageUrls.length}`);
  assert.equal(c.bookingUrl, 'https://www.realwatersports.com/products/la-ventana-supercamp-2027');
  assert.ok(!/function\s*\(|var\s+\w+\s*=/.test(c.sourceText ?? ''), 'no inline script text in sourceText');
});
