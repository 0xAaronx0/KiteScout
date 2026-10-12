// LakeUnited Kitecamp Tunisia adapter, replayed from the fixture recorded 2026-10-09.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { lakeunitedDjerba as adapter, bestsellerPrice, campWeeks, visibleRoot } from '../../src/offers/adapters/lakeunited-djerba.js';

process.env.OFFERS_FIXTURE_DIR = join(import.meta.dirname, '../fixtures/offers/lakeunited-djerba');

test('bestseller price + hidden Elementor widgets', () => {
  assert.deepEqual(bestsellerPrice('Bestseller Djerba package 1 week in a double room € 2.090,- Including'), { weeks: 1, room: 'Double room', amount: 2090, currency: 'EUR' });
  const html = '<div class="elementor-element"><ul><li class="eael-feature-list-item"><h4 class="eael-feature-list-title">03.04. - 10.04.2027</h4><p class="eael-feature-list-content">Kitecamp for all levels</p></li></ul></div>'
    + '<div class="elementor-element elementor-hidden-desktop elementor-hidden-tablet elementor-hidden-mobile"><ul><li class="eael-feature-list-item"><h4 class="eael-feature-list-title">24.04. -  01.05.2027</h4></li></ul></div>';
  const { root, hidden } = visibleRoot(html);
  assert.deepEqual(campWeeks(root).map(w => [w.start, w.end, w.label]), [['2027-04-03', '2027-04-10', 'Kitecamp for all levels']]);
  assert.deepEqual(hidden.flatMap(campWeeks).map(w => w.start), ['2027-04-24'], 'cross-month week still parses');
});

test('lakeunited slots: visible fixed weeks, inquiry-only', async () => {
  const notes: string[] = [];
  const slots = await adapter.fetchSlots({ note: t => notes.push(t), incomplete: () => {} });
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 2);
  assert.deepEqual(slots.map(s => [s.key, s.startDate, s.endDate]), [
    ['2027-04-03', '2027-04-03', '2027-04-10'], ['2027-04-10', '2027-04-10', '2027-04-17'],
  ]);
  for (const s of slots) {
    assert.equal(s.price, 2090);
    assert.equal(s.currency, 'EUR');
    assert.equal(s.priceUnit, 'package');
    assert.equal(s.unit, 'Double room');
    assert.equal(s.availability, 'on_request');
    assert.equal(s.availabilityText, 'Send request (non-binding inquiry)');
  }
  assert.equal(notes.length, 1);
  assert.match(notes[0], /17\.04\. - 24\.04\.2027; 24\.04\. - +01\.05\.2027/);
});

test('lakeunited content', async () => {
  const c = await adapter.fetchContent({ note: () => {}, incomplete: () => {} });
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kite camp Tunisia - Kiting in the Djerba lagoon');
  assert.equal(c.country, 'Tunisia');
  assert.equal(c.spot, 'Djerba lagoon');
  assert.equal(c.durationDays, 8);
  assert.equal(c.mealPlan, 'half_board');
  assert.equal(c.equipmentRental, true);
  assert.deepEqual(c.includedServices, ['Half board (1a breakfast and 3-course dinner)', 'Equipment rental', 'Coaching', 'Guiding']);
  assert.ok(c.optionalServices.some(s => /excursions/.test(s)));
  assert.deepEqual(c.rooms.map(r => r.name), ['Double room', 'Triple room', 'Single room']);
  assert.equal(c.bookingUrl, 'https://www.lakeunited.com/en/portfolio/kitecamps-request/?kitecamp=tu');
  assert.ok(c.imageUrls.length >= 15, `images: ${c.imageUrls.length}`);
  assert.ok(c.imageUrls.some(u => u.endsWith('Kitecamp-Tunesien-Teambus-am-Strand.jpg')), 'og:image kept');
  assert.ok(c.imageUrls.some(u => u.endsWith('Tunesien-Kitelaunch.jpg')), 'Elementor gallery (data-thumbnail) read, upscaled');
  assert.ok(!c.imageUrls.some(u => /LU_Team_|LakeUnited-Team/.test(u)), 'no team portraits');
  assert.ok(!(c.sourceText ?? '').includes('24.04. - 01.05.2027'), 'hidden widgets not in sourceText');
});
